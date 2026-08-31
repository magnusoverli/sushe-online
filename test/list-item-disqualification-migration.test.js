const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const migration = require('../db/migrations/migrations/076_add_list_item_disqualification');

describe('076 list-item disqualification migration', () => {
  it('adds state, reason, and a bounded reason constraint', async () => {
    const pool = { query: mock.fn(async () => ({ rows: [] })) };

    await migration.up(pool);

    const sql = pool.query.mock.calls
      .map((call) => call.arguments[0])
      .join('\n');
    assert.match(
      sql,
      /ADD COLUMN is_disqualified BOOLEAN NOT NULL DEFAULT FALSE/
    );
    assert.match(sql, /ADD COLUMN disqualification_reason TEXT/);
    assert.match(sql, /char_length\(disqualification_reason\) <= 1000/);
    assert.match(sql, /VALIDATE CONSTRAINT/);
  });

  it('removes the disqualification columns on rollback', async () => {
    const pool = { query: mock.fn(async () => ({ rows: [] })) };

    await migration.down(pool);

    const sql = pool.query.mock.calls[0].arguments[0];
    assert.match(sql, /DROP COLUMN IF EXISTS disqualification_reason/);
    assert.match(sql, /DROP COLUMN IF EXISTS is_disqualified/);
  });
});
