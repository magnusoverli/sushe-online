const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
const { withDatabase } = require('../../config/database-connection');
const { createStatsService } = require('../../services/stats-service');
const aliases = require('../../db/migrations/migrations/085_index_artist_alias_source_album');
const cleanup = require('../../db/migrations/migrations/086_remove_redundant_indexes');

test('upgrade preserves custom indexes, cascades and stats on populated tables', async () => {
  const name = `upgrade_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name}`);
    const db = new Client(withDatabase(process.env.DATABASE_URL, name));
    try {
      await db.connect();
      await db.query(`
        CREATE TABLE users (_id text, email text UNIQUE, username text UNIQUE, role text, last_activity date, created_at date);
        CREATE INDEX idx_users_email ON users(email);
        CREATE INDEX idx_users_username ON users(lower(username));
        CREATE TABLE albums (album_id text UNIQUE);
        CREATE TABLE artist_service_aliases (source_album_id text REFERENCES albums(album_id) ON UPDATE CASCADE);
        CREATE TABLE lists (user_id text, updated_at date);
        CREATE TABLE list_items (album_id text);
        INSERT INTO albums VALUES ('old');
        INSERT INTO artist_service_aliases VALUES ('old');
        INSERT INTO list_items VALUES ('a'), ('b'), ('b'), (NULL), ('');
      `);
      await db.query('BEGIN');
      await aliases.up(db);
      await cleanup.up(db);
      await db.query('ROLLBACK');
      const indexes = async () =>
        (
          await db.query(`SELECT to_regclass('idx_users_email') IS NOT NULL AS redundant,
          to_regclass('idx_users_username') IS NOT NULL AS custom,
          to_regclass('idx_artist_service_aliases_source_album_id') IS NOT NULL AS added`)
        ).rows[0];
      assert.deepEqual(await indexes(), {
        redundant: true,
        custom: true,
        added: false,
      });
      await aliases.up(db);
      await cleanup.up(db);
      assert.deepEqual(await indexes(), {
        redundant: false,
        custom: true,
        added: true,
      });
      await db.query("INSERT INTO users(email) VALUES ('unique')");
      await assert.rejects(
        db.query("INSERT INTO users(email) VALUES ('unique')"),
        { code: '23505' }
      );
      await db.query(
        "UPDATE albums SET album_id = 'new' WHERE album_id = 'old'"
      );
      assert.equal(
        (await db.query('SELECT source_album_id FROM artist_service_aliases'))
          .rows[0].source_album_id,
        'new'
      );
      const stats = createStatsService({
        db: { raw: (sql, params) => db.query(sql, params) },
      });
      assert.equal((await stats.getPublicStats()).totalAlbums, 2);
      assert.equal((await stats.getAdminStats()).totalAlbums, 2);
    } finally {
      await db.end();
      await admin.query(`DROP DATABASE ${name}`);
    }
  } finally {
    await admin.end();
  }
});
