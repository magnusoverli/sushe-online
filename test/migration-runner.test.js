/**
 * Tests for the migration runner's new guards:
 *   1. Postgres advisory lock around runMigrations
 *   2. Forward-schema guard that refuses to start if the DB has unknown versions
 *   3. `irreversible: true` opt-out handling in rollbackMigration
 *
 * Uses a mock pg Pool so no live database is required.
 */

const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const MigrationManager = require('../db/migrations');

/** Build a mock pg Pool whose clients record every query in order. */
function makePool({ executedVersions = [], lockCalls } = {}) {
  const allClientCalls = [];
  const poolQueries = [];
  const connect = mock.fn(async () => {
    const client = {
      query: mock.fn(async (sql, _params) => {
        allClientCalls.push({ sql });
        if (lockCalls && /pg_advisory_lock|pg_advisory_unlock/.test(sql)) {
          lockCalls.push(sql);
        }
        if (/SELECT version FROM/.test(sql)) {
          return { rows: executedVersions.map((v) => ({ version: v })) };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: mock.fn(),
    };
    return client;
  });
  const pool = {
    connect,
    query: mock.fn(async (sql, _params) => {
      poolQueries.push({ sql });
      if (/SELECT version FROM/.test(sql)) {
        return { rows: executedVersions.map((v) => ({ version: v })) };
      }
      return { rows: [], rowCount: 0 };
    }),
  };
  return { pool, connect, allClientCalls, poolQueries };
}

describe('MigrationManager.runMigrations — advisory lock', () => {
  it('acquires and releases the advisory lock around the pending loop', async () => {
    const lockCalls = [];
    const { pool } = makePool({ executedVersions: [], lockCalls });
    const manager = new MigrationManager(pool);

    // Temporarily point migrationsDir at an empty temp dir so no actual
    // migrations are attempted.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'migr-test-'));
    manager.migrationsDir = tmp;

    await manager.runMigrations();

    // Lock acquired, then released — in that order
    assert.strictEqual(lockCalls.length, 2);
    assert.ok(
      /pg_advisory_lock/.test(lockCalls[0]) && !/unlock/.test(lockCalls[0])
    );
    assert.ok(/pg_advisory_unlock/.test(lockCalls[1]));

    fs.rmdirSync(tmp);
  });
});

describe('MigrationManager.runMigrations — forward-schema guard', () => {
  it('refuses to run when DB has versions not present on disk', async () => {
    const { pool } = makePool({
      executedVersions: ['001_initial', '999_future_migration'],
    });
    const manager = new MigrationManager(pool);

    // Point at an empty temp dir so the "on disk" set is empty.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'migr-test-'));
    manager.migrationsDir = tmp;

    await assert.rejects(
      () => manager.runMigrations(),
      /migrations unknown to this code version/
    );

    fs.rmdirSync(tmp);
  });

  it('succeeds when all executed versions exist on disk', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'migr-test-'));
    // Create a dummy migration file matching the executed version
    fs.writeFileSync(
      path.join(tmp, '001_initial.js'),
      'module.exports = { up: async () => {} };'
    );

    const { pool } = makePool({ executedVersions: ['001_initial'] });
    const manager = new MigrationManager(pool);
    manager.migrationsDir = tmp;

    await manager.runMigrations(); // should not throw

    fs.unlinkSync(path.join(tmp, '001_initial.js'));
    fs.rmdirSync(tmp);
  });
});

describe('MigrationManager.rollbackMigration — irreversible handling', () => {
  it('refuses to rollback a migration marked irreversible', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'migr-test-'));
    const migrationPath = path.join(tmp, '050_irreversible.js');
    fs.writeFileSync(
      migrationPath,
      `module.exports = {
         up: async () => {},
         irreversible: true,
         down: async () => { throw new Error('never reached'); },
       };`
    );

    const { pool } = makePool();
    const manager = new MigrationManager(pool);

    await assert.rejects(
      () =>
        manager.rollbackMigration({
          version: '050_irreversible',
          filePath: migrationPath,
        }),
      /marked irreversible/
    );

    fs.unlinkSync(migrationPath);
    fs.rmdirSync(tmp);
  });

  it('errors clearly when a migration lacks both down() and irreversible', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'migr-test-'));
    const migrationPath = path.join(tmp, '060_no_down.js');
    fs.writeFileSync(migrationPath, `module.exports = { up: async () => {} };`);

    const { pool } = makePool();
    const manager = new MigrationManager(pool);

    await assert.rejects(
      () =>
        manager.rollbackMigration({
          version: '060_no_down',
          filePath: migrationPath,
        }),
      /does not export a 'down' function/
    );

    fs.unlinkSync(migrationPath);
    fs.rmdirSync(tmp);
  });

  it('runs down() for a normal reversible migration', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'migr-test-'));
    const migrationPath = path.join(tmp, '070_reversible.js');
    // Write a migration whose down() sets a flag we can observe.
    fs.writeFileSync(
      migrationPath,
      `module.exports = {
         up: async () => {},
         down: async (client) => {
           await client.query('DROP TABLE IF EXISTS foo');
         },
       };`
    );

    const { pool, allClientCalls } = makePool();
    const manager = new MigrationManager(pool);

    await manager.rollbackMigration({
      version: '070_reversible',
      filePath: migrationPath,
    });

    // BEGIN, DROP, DELETE (from schema_migrations), COMMIT
    const sqls = allClientCalls.map((c) => c.sql);
    assert.ok(sqls.some((s) => /BEGIN/.test(s)));
    assert.ok(sqls.some((s) => /DROP TABLE IF EXISTS foo/.test(s)));
    assert.ok(sqls.some((s) => /DELETE FROM/.test(s)));
    assert.ok(sqls.some((s) => /COMMIT/.test(s)));

    fs.unlinkSync(migrationPath);
    fs.rmdirSync(tmp);
  });
});
