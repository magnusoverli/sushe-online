const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const migration = require('../db/migrations/migrations/071_add_album_taxonomy');
const extendedMigration = require('../db/migrations/migrations/073_validate_extended_rym_taxonomy');
const metadataEventMigration = require('../db/migrations/migrations/074_add_album_metadata_event_version');

describe('071 album taxonomy migration', () => {
  it('types chained JSONB subtraction operands explicitly', async () => {
    const statements = [];
    const pool = {
      query: mock.fn(async (sql) => {
        statements.push(sql.replace(/\s+/g, ' ').trim());
        return { rows: [] };
      }),
    };

    await migration.up(pool);

    const sql = statements.join('\n');
    assert.match(
      sql,
      /\(album_taxonomy->'manual_overrides'\) - 'genre_1'::text - 'genre_2'::text/
    );
  });
});

describe('073 extended RYM taxonomy migration', () => {
  it('validates optional taxonomy arrays and removes its constraint on rollback', async () => {
    const statements = [];
    const pool = {
      query: mock.fn(async (sql) => {
        statements.push(sql.replace(/\s+/g, ' ').trim());
        return { rows: [] };
      }),
    };

    await extendedMigration.up(pool);
    await extendedMigration.down(pool);

    const sql = statements.join('\n');
    for (const field of ['languages', 'scenes', 'movements']) {
      assert.match(sql, new RegExp(`rym'->'${field}'.*jsonb_array_length`));
    }
    assert.match(
      sql,
      /DROP CONSTRAINT IF EXISTS albums_rym_extended_taxonomy_shape_check/
    );
  });
});

describe('074 album metadata event version migration', () => {
  it('creates and removes the event sequence', async () => {
    const statements = [];
    const pool = {
      query: mock.fn(async (sql) => {
        statements.push(sql.replace(/\s+/g, ' ').trim());
        return { rows: [] };
      }),
    };

    await metadataEventMigration.up(pool);
    await metadataEventMigration.down(pool);

    assert.match(
      statements[0],
      /CREATE SEQUENCE IF NOT EXISTS album_metadata_event_version_seq/
    );
    assert.match(
      statements[1],
      /DROP SEQUENCE IF EXISTS album_metadata_event_version_seq/
    );
  });
});
