const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { withTransaction } = require('../../db/transaction');
const { createAdminEventService } = require('../../services/admin-events');
const {
  createWebhookHandler,
} = require('../../services/telegram/webhook-handler');
const { createMockLogger } = require('../helpers');
const { EVENT_ID, createCallback } = require('../fixtures/telegram-callback');

const schema = `telegram_auth_${randomUUID().replaceAll('-', '')}`;
let owner;
let pools = [];
let services = [];
let webhook;
let notifications = [];

before(async () => {
  assert.ok(
    process.env.DATABASE_URL,
    'A disposable test DATABASE_URL is required'
  );
  const settings = {
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 3000,
    query_timeout: 5000,
  };
  owner = new Pool({ ...settings, max: 1 });
  await owner.query(`CREATE SCHEMA ${schema}`);
  pools = [0, 1].map(
    () => new Pool({ ...settings, max: 2, options: `-c search_path=${schema}` })
  );
  // Use the real event/link/config migrations in a private schema. Users only
  // needs the columns consumed by authorization and account approval here.
  await pools[0].query(`CREATE TABLE users (
    _id TEXT PRIMARY KEY, username TEXT, role TEXT, approval_status TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await require('../../db/migrations/migrations/020_admin_events_telegram').up(
    pools[0]
  );
  await require('../../db/migrations/migrations/045_add_admin_events_actions').up(
    pools[0]
  );
  const dbs = pools.map((pool) => ({
    raw: (sql, params) => pool.query(sql, params),
    withTransaction: (callback) => withTransaction(pool, callback),
  }));
  services = dbs.map((db) => {
    const service = createAdminEventService({
      db,
      logger: createMockLogger(),
      telegramNotifier: {
        updateEventMessage: async (event) => notifications.push(event),
      },
    });
    service.registerAccountApprovalHandlers();
    return service;
  });
  webhook = createWebhookHandler(dbs[0], {}, createMockLogger());
});

beforeEach(async () => {
  notifications = [];
  await pools[0].query(
    'TRUNCATE admin_events, telegram_admins, telegram_config, users CASCADE'
  );
  await pools[0].query(`INSERT INTO users (_id, username, role, approval_status)
    VALUES ('admin-1', 'admin', 'admin', 'approved'), ('pending-user', 'pending', 'user', 'pending')`);
  await pools[0].query(
    `INSERT INTO telegram_admins (telegram_user_id, user_id) VALUES (123, 'admin-1')`
  );
  await pools[0].query(
    `INSERT INTO telegram_config (chat_id, enabled) VALUES (-789, true)`
  );
  await pools[0].query(
    `INSERT INTO admin_events (id, event_type, title, data, telegram_chat_id, telegram_message_id)
    VALUES ($1, 'account_approval', 'Synthetic approval', $2, -789, 456)`,
    [EVENT_ID, { userId: 'pending-user', username: 'pending' }]
  );
});

after(async () => {
  await Promise.all(pools.map((pool) => pool.end()));
  if (owner) {
    try {
      await owner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await owner.end();
    }
  }
});

const execute = (
  service = services[0],
  action = 'approve',
  callback = createCallback()
) => service.executeAction(EVENT_ID, action, null, 'telegram', callback);

async function readState() {
  const user = await pools[0].query(
    "SELECT approval_status FROM users WHERE _id = 'pending-user'"
  );
  const event = await pools[0].query(
    'SELECT status, resolved_by, resolved_via FROM admin_events WHERE id = $1',
    [EVENT_ID]
  );
  return { approval: user.rows[0].approval_status, ...event.rows[0] };
}

test('current linked approved admin resolves event with database attribution', async () => {
  assert.deepEqual(await webhook.getLinkedAdmin(123), {
    _id: 'admin-1',
    username: 'admin',
  });
  assert.equal((await execute()).success, true);
  assert.deepEqual(await readState(), {
    approval: 'approved',
    status: 'approve',
    resolved_by: 'admin-1',
    resolved_via: 'telegram',
  });
  assert.equal(notifications.length, 1);
});

for (const [name, mutation] of [
  ['unlinked', 'DELETE FROM telegram_admins'],
  ['demoted', "UPDATE users SET role = 'user' WHERE _id = 'admin-1'"],
  [
    'rejected',
    "UPDATE users SET approval_status = 'rejected' WHERE _id = 'admin-1'",
  ],
  [
    'pending',
    "UPDATE users SET approval_status = 'pending' WHERE _id = 'admin-1'",
  ],
  [
    'missing approval',
    "UPDATE users SET approval_status = NULL WHERE _id = 'admin-1'",
  ],
  ['deleted', "DELETE FROM users WHERE _id = 'admin-1'"],
]) {
  test(`${name} actor cannot resolve an event or change user approval`, async () => {
    await pools[0].query(mutation);
    assert.equal(await webhook.getLinkedAdmin(123), null);
    assert.equal((await execute()).success, false);
    assert.deepEqual(await readState(), {
      approval: 'pending',
      status: 'pending',
      resolved_by: null,
      resolved_via: null,
    });
    assert.equal(notifications.length, 0);
  });
}

for (const [name, mutation] of [
  ['disabled configuration', 'UPDATE telegram_config SET enabled = false'],
  ['changed configured chat', 'UPDATE telegram_config SET chat_id = -999'],
  ['missing configuration', 'DELETE FROM telegram_config'],
  [
    'missing event message',
    'UPDATE admin_events SET telegram_message_id = NULL',
  ],
  ['wrong event chat', 'UPDATE admin_events SET telegram_chat_id = -999'],
]) {
  test(`${name} denies even a valid linked admin`, async () => {
    await pools[0].query(mutation);
    assert.equal((await execute()).success, false);
    assert.equal((await readState()).approval, 'pending');
    assert.equal(notifications.length, 0);
  });
}

test('direct web invocation cannot rely on a stale admin-shaped object', async () => {
  await pools[0].query("UPDATE users SET role = 'user' WHERE _id = 'admin-1'");
  const result = await services[0].executeAction(EVENT_ID, 'approve', {
    _id: 'admin-1',
    role: 'admin',
    approval_status: 'approved',
  });
  assert.equal(result.success, false);
  assert.equal((await readState()).approval, 'pending');
});

test('two independent services concurrently approving/rejecting resolve exactly once', async () => {
  const results = await Promise.all([
    execute(services[0], 'approve'),
    execute(services[1], 'reject'),
  ]);
  assert.equal(results.filter((result) => result.success).length, 1);
  assert.match(
    results.find((result) => !result.success).message,
    /already resolved/
  );
  const state = await readState();
  assert.equal(
    state.approval,
    state.status === 'approve' ? 'approved' : 'rejected'
  );
  assert.equal(state.resolved_by, 'admin-1');
  assert.equal(notifications.length, 1);
  assert.equal((await execute()).success, false);
});

test('event persistence failure rolls back user approval and publishes no notification', async () => {
  await pools[0]
    .query(`CREATE FUNCTION fail_event_update() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'synthetic event failure'; END $$`);
  await pools[0].query(
    'CREATE TRIGGER fail_event_update BEFORE UPDATE ON admin_events FOR EACH ROW EXECUTE FUNCTION fail_event_update()'
  );
  try {
    assert.equal((await execute()).success, false);
    assert.equal((await readState()).approval, 'pending');
    assert.equal((await readState()).status, 'pending');
    assert.equal(notifications.length, 0);
  } finally {
    await pools[0].query('DROP TRIGGER fail_event_update ON admin_events');
    await pools[0].query('DROP FUNCTION fail_event_update()');
  }
});
