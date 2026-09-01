const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const migration = require('../db/migrations/migrations/077_add_user_list_year_visibility');
const unifiedRevealMigration = require('../db/migrations/migrations/078_unify_year_reveal');

describe('077 user-list year visibility migration', () => {
  it('creates independent visibility and backfills only revealed aggregate years', async () => {
    const pool = { query: mock.fn(async () => ({ rows: [] })) };

    await migration.up(pool);

    const sql = pool.query.mock.calls
      .map((call) => call.arguments[0])
      .join('\n');
    assert.match(sql, /CREATE TABLE user_list_year_visibility/);
    assert.match(sql, /year INTEGER PRIMARY KEY/);
    assert.match(sql, /revealed BOOLEAN NOT NULL DEFAULT FALSE/);
    assert.match(sql, /REFERENCES users\(_id\) ON DELETE SET NULL/);
    assert.match(sql, /CHECK \(revealed = \(revealed_at IS NOT NULL\)\)/);
    assert.match(sql, /FROM master_lists\s+WHERE revealed = TRUE/);
    assert.doesNotMatch(sql, /(?:INSERT INTO|UPDATE|DELETE FROM) master_lists/);
  });

  it('drops only the independent visibility table on rollback', async () => {
    const pool = { query: mock.fn(async () => ({ rows: [] })) };

    await migration.down(pool);

    const sql = pool.query.mock.calls[0].arguments[0];
    assert.match(sql, /DROP TABLE IF EXISTS user_list_year_visibility/);
    assert.doesNotMatch(sql, /master_lists/);
  });
});

describe('078 unified year reveal migration', () => {
  it('removes only the redundant user-list visibility table', async () => {
    const pool = { query: mock.fn(async () => ({ rows: [] })) };

    await unifiedRevealMigration.up(pool);

    const sql = pool.query.mock.calls[0].arguments[0];
    assert.match(sql, /DROP TABLE IF EXISTS user_list_year_visibility/);
    assert.doesNotMatch(sql, /master_lists/);
    assert.strictEqual(unifiedRevealMigration.irreversible, true);
  });
});
