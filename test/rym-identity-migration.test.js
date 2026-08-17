const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const migration = require('../db/migrations/migrations/072_add_rym_identity_and_availability_state');

function recordingPool() {
  const statements = [];
  return {
    statements,
    query: mock.fn(async (sql) => {
      statements.push(sql.replace(/\s+/g, ' ').trim());
      return { rows: [] };
    }),
  };
}

describe('072 RYM identity and availability migration', () => {
  it('adds availability state, numeric RYM validation, and partial uniqueness', async () => {
    const pool = recordingPool();
    await migration.up(pool);
    const sql = pool.statements.join('\n');

    assert.match(sql, /availability_checked_at TIMESTAMPTZ/);
    assert.match(
      sql,
      /availability_resolution_version INTEGER NOT NULL DEFAULT 0/
    );
    assert.match(sql, /CHECK \(availability_resolution_version >= 0\)/);
    assert.match(sql, /external_album_id ~ '\^\[1-9\]\[0-9\]\*\$'/);
    assert.match(
      sql,
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_album_service_mappings_rym_numeric_id/
    );
    assert.match(
      sql,
      /WHERE service = 'rateyourmusic' AND external_album_id IS NOT NULL/
    );
    assert.match(
      sql,
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_album_service_mappings_rym_external_url/
    );
    assert.doesNotMatch(sql, /UPDATE albums SET/);
  });

  it('drops all added indexes, constraints, and columns', async () => {
    const pool = recordingPool();
    await migration.down(pool);
    const sql = pool.statements.join('\n');

    assert.match(
      sql,
      /DROP INDEX IF EXISTS idx_album_service_mappings_rym_external_url/
    );
    assert.match(
      sql,
      /DROP INDEX IF EXISTS idx_album_service_mappings_rym_numeric_id/
    );
    assert.match(
      sql,
      /DROP CONSTRAINT IF EXISTS album_service_mappings_rym_numeric_id/
    );
    assert.match(
      sql,
      /DROP CONSTRAINT IF EXISTS albums_availability_resolution_version_nonnegative/
    );
    assert.match(sql, /DROP COLUMN IF EXISTS availability_resolution_version/);
    assert.match(sql, /DROP COLUMN IF EXISTS availability_checked_at/);
  });
});
