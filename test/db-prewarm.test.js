const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const { createMockLogger } = require('./helpers');
const {
  getExistingTables,
  getIndexesForTables,
  runDbPrewarm,
} = require('../services/startup/db-prewarm');
const pgPrewarmMigration = require('../db/migrations/migrations/068_enable_pg_prewarm');

describe('db-prewarm', () => {
  it('selects existing hot tables', async () => {
    const db = {
      raw: mock.fn(async (_sql, params) => {
        assert.deepStrictEqual(params, [['users', 'albums']]);
        return { rows: [{ relname: 'users' }] };
      }),
    };

    assert.deepStrictEqual(await getExistingTables(db, ['users', 'albums']), [
      'users',
    ]);
  });

  it('selects indexes for existing hot tables', async () => {
    const db = {
      raw: mock.fn(async (_sql, params) => {
        assert.deepStrictEqual(params, [['users']]);
        return { rows: [{ indexname: 'users_pkey' }] };
      }),
    };

    assert.deepStrictEqual(await getIndexesForTables(db, ['users']), [
      'users_pkey',
    ]);
  });

  it('warms indexes only in hot mode', async () => {
    const warmed = [];
    const db = {
      raw: mock.fn(async (sql, params) => {
        if (sql.includes('FROM pg_class')) {
          return { rows: [{ relname: 'users' }] };
        }
        if (sql.includes('FROM pg_indexes')) {
          return { rows: [{ indexname: 'users_pkey' }] };
        }
        if (sql.includes('pg_prewarm')) {
          warmed.push(params[0]);
          return { rows: [{ blocks: 7 }] };
        }
        return { rows: [] };
      }),
    };

    const result = await runDbPrewarm({
      db,
      config: { dbPrewarmEnabled: true, dbPrewarmMode: 'hot' },
      logger: createMockLogger(),
    });

    assert.strictEqual(result.skipped, false);
    assert.deepStrictEqual(warmed, ['users_pkey']);
    assert.strictEqual(result.relations[0].blocks, 7);
  });

  it('skips when disabled', async () => {
    const db = { raw: mock.fn() };
    const result = await runDbPrewarm({
      db,
      config: { dbPrewarmEnabled: false },
      logger: createMockLogger(),
    });

    assert.strictEqual(result.skipped, true);
    assert.strictEqual(db.raw.mock.calls.length, 0);
  });

  it('enables pg_prewarm through a transaction-safe DO block', async () => {
    const pool = { query: mock.fn(async () => ({ rows: [] })) };

    await pgPrewarmMigration.up(pool);

    const sql = pool.query.mock.calls[0].arguments[0];
    assert.match(sql, /DO \$\$/);
    assert.match(sql, /CREATE EXTENSION IF NOT EXISTS pg_prewarm/);
    assert.match(sql, /EXCEPTION/);
  });
});
