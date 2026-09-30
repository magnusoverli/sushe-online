const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createAdminEventService } = require('../services/admin-events');
const {
  createWebhookHandler,
} = require('../services/telegram/webhook-handler');
const registerRoutes = require('../routes/api/telegram');
const { createMockLogger } = require('./helpers');

const { EVENT_ID, createCallback } = require('./fixtures/telegram-callback');
const SECRET = 'synthetic-webhook-secret';

// These tests exercise HTTP/service boundaries with injected storage. Real
// PostgreSQL authorization predicates and locking are verified separately.
function createFixture({
  actor = { _id: 'admin-1', username: 'current-admin' },
  lookupFails = false,
} = {}) {
  const logger = createMockLogger();
  const event = {
    id: EVENT_ID,
    event_type: 'account_approval',
    status: 'pending',
    data: { userId: 'pending-user', username: 'pending' },
    telegram_chat_id: '-789',
    telegram_message_id: '456',
  };
  const calls = [];
  let approvalStatus = 'pending';
  let inTransaction = false;
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('FROM admin_events')) return { rows: [{ ...event }] };
    if (sql.includes('FROM users u')) {
      assert.equal(inTransaction, true);
      if (lookupFails) throw new Error('private-lookup-error');
      return { rows: actor ? [actor] : [] };
    }
    if (sql.includes('UPDATE users')) {
      approvalStatus = sql.includes("'approved'") ? 'approved' : 'rejected';
      return { rows: [{ _id: 'pending-user' }] };
    }
    if (sql.includes('UPDATE admin_events')) {
      event.status = params[0];
      event.resolved_by = params[1];
      event.resolved_via = params[2];
      return { rows: [{ ...event }] };
    }
    throw new Error('Unexpected query');
  };
  const db = {
    raw: query,
    withTransaction: async (callback) => {
      inTransaction = true;
      try {
        return await callback({ query });
      } finally {
        inTransaction = false;
      }
    },
  };
  const config = { enabled: true, webhookSecret: SECRET };
  const notifier = {
    ...createWebhookHandler(db, { getConfig: async () => config }, logger),
    answerCallbackQuery: async (...args) => answers.push(args),
    updateEventMessage: async () => {
      assert.equal(inTransaction, false, 'notification must follow commit');
      notifications.push(event.status);
    },
  };
  const answers = [];
  const notifications = [];
  const service = createAdminEventService({
    db,
    logger,
    telegramNotifier: notifier,
  });
  service.registerAccountApprovalHandlers();
  const app = express();
  app.use(express.json());
  app.locals.telegramNotifier = notifier;
  app.locals.adminEventService = service;
  registerRoutes(app, { db, logger });
  const send = (callback = createCallback()) =>
    request(app)
      .post(`/api/telegram/webhook/${SECRET}`)
      .send({ callback_query: callback });
  return {
    app,
    send,
    service,
    db,
    logger,
    event,
    config,
    notifier,
    calls,
    answers,
    notifications,
    getApproval: () => approvalStatus,
  };
}

test('linked admin callback uses fresh attribution and notifies after commit', async () => {
  const fixture = createFixture();
  await fixture.send().expect(200);
  assert.equal(fixture.getApproval(), 'approved');
  assert.equal(fixture.event.resolved_by, 'admin-1');
  assert.equal(fixture.event.resolved_via, 'telegram');
  assert.deepEqual(fixture.notifications, ['approve']);
  assert.match(fixture.answers[0][1], /Approved registration/);
  const lookup = fixture.calls.find(({ sql }) => sql.includes('FROM users u'));
  assert.deepEqual(lookup.params, [123, -789]);
});

test('missing authorized linked actor and failed lookups never mutate events or users', async () => {
  for (const options of [{ actor: null }, { lookupFails: true }]) {
    const fixture = createFixture(options);
    await fixture.send().expect(200);
    assert.equal(fixture.getApproval(), 'pending');
    assert.equal(fixture.event.status, 'pending');
    assert.equal(fixture.notifications.length, 0);
    assert.equal(
      fixture.calls.some(({ sql }) => sql.startsWith('UPDATE')),
      false
    );
    assert.equal(fixture.answers[0][2], true);
    assert.doesNotMatch(
      JSON.stringify(fixture.answers),
      /private-lookup-error/
    );
  }
});

test('callbacks must match the stored event chat and message', async () => {
  for (const field of ['chat', 'message']) {
    const fixture = createFixture();
    const callback = createCallback();
    if (field === 'chat') callback.message.chat.id = -999;
    else callback.message.message_id = 999;
    await fixture.send(callback).expect(200);
    assert.equal(fixture.getApproval(), 'pending');
    assert.equal(
      fixture.calls.some(({ sql }) => sql.includes('FROM users u')),
      false
    );
  }
});

test('replayed resolved callback cannot execute a second action', async () => {
  const fixture = createFixture();
  await fixture.send().expect(200);
  const callback = createCallback();
  callback.data = `event:${EVENT_ID}:reject`;
  await fixture.send(callback).expect(200);
  assert.equal(fixture.getApproval(), 'approved');
  assert.equal(fixture.notifications.length, 1);
  assert.match(fixture.answers[1][1], /already resolved/);
});

test('service denies synthetic, stale or missing actors and unsupported execution sources', async () => {
  for (const [actor, via, callback] of [
    [{ _id: 'telegram:123', role: 'admin' }, 'telegram', null],
    [
      { _id: 'demoted', role: 'admin', approval_status: 'approved' },
      'web',
      null,
    ],
    [null, 'web', null],
    [{ _id: 'admin-1' }, 'other', null],
    [{ _id: 'admin-1', role: 'admin' }, 'telegram', createCallback()],
  ]) {
    const fixture = createFixture({ actor: null });
    const result = await fixture.service.executeAction(
      EVENT_ID,
      'approve',
      actor,
      via,
      callback
    );
    assert.equal(result.success, false);
    assert.equal(fixture.getApproval(), 'pending');
  }
});

test('service fails closed without transactional storage', async () => {
  const fixture = createFixture();
  delete fixture.db.withTransaction;
  const result = await fixture.service.executeAction(
    EVENT_ID,
    'approve',
    null,
    'telegram',
    createCallback()
  );
  assert.equal(result.success, false);
  assert.equal(fixture.calls.length, 0);
});

test('malformed and forwarded/inline callbacks are rejected before action lookup', async () => {
  const mutations = [
    (c) => {
      delete c.from;
    },
    (c) => {
      c.from.id = '123';
    },
    (c) => {
      c.from.is_bot = true;
    },
    (c) => {
      delete c.message;
    },
    (c) => {
      c.message.date = 0;
    },
    (c) => {
      c.message.message_id = 0;
    },
    (c) => {
      c.message.chat.id = 0;
    },
    (c) => {
      c.inline_message_id = 'inline';
    },
    (c) => {
      c.message.forward_origin = { type: 'user' };
    },
    (c) => {
      c.message.forward_from = { id: 123 };
    },
    (c) => {
      c.message.is_automatic_forward = true;
    },
    (c) => {
      c.data = {};
    },
    (c) => {
      c.data += ':extra';
    },
    (c) => {
      c.data = 'event:not-a-uuid:approve';
    },
    (c) => {
      c.data = `event:${EVENT_ID}:`;
    },
    (c) => {
      c.data = `event:${EVENT_ID}:${'a'.repeat(100)}`;
    },
  ];
  for (const mutate of mutations) {
    const fixture = createFixture();
    const callback = createCallback();
    mutate(callback);
    await fixture.send(callback).expect(400);
    assert.equal(fixture.calls.length, 0);
    const directResult = await fixture.service.executeAction(
      EVENT_ID,
      'approve',
      null,
      'telegram',
      callback
    );
    // Payload parsing belongs to the HTTP boundary; message context is also
    // enforced by the service for alternate callers.
    if (callback.data === `event:${EVENT_ID}:approve`)
      assert.equal(directResult.success, false);
  }
  await createFixture().send(null).expect(400);
});

test('delivery authentication rejects invalid secrets, headers and disabled configuration', async () => {
  const fixture = createFixture();
  await request(fixture.app)
    .post('/api/telegram/webhook/wrong')
    .send({ callback_query: createCallback() })
    .expect(403);
  await fixture
    .send()
    .set('X-Telegram-Bot-Api-Secret-Token', 'wrong')
    .expect(403);
  fixture.config.enabled = false;
  await fixture.send().expect(403);
  assert.equal(fixture.calls.length, 0);
  for (const config of [
    null,
    {},
    { enabled: true },
    { enabled: true, webhookSecret: '' },
  ]) {
    const webhook = createWebhookHandler(
      null,
      { getConfig: async () => config },
      fixture.logger
    );
    assert.equal(await webhook.verifyWebhookSecret(undefined), false);
  }
});

test('matching header and legacy URL-only deliveries work; unrelated updates are acknowledged', async () => {
  await createFixture()
    .send()
    .set('X-Telegram-Bot-Api-Secret-Token', SECRET)
    .expect(200);
  const fixture = createFixture();
  await request(fixture.app)
    .post(`/api/telegram/webhook/${SECRET}`)
    .send({ message: {} })
    .expect(200);
  await request(fixture.app)
    .post(`/api/telegram/webhook/${SECRET}`)
    .send([])
    .expect(400);
  await request(fixture.app)
    .post(`/api/telegram/webhook/${SECRET}`)
    .expect(400);
  assert.equal(fixture.calls.length, 0);
});
