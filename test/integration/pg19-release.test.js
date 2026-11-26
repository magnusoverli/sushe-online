const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { createAlbumCanonical } = require('../../services/album-canonical');
const { albumBatchKey } = require('../../utils/album-batch-key');
const {
  createListItemOperations,
} = require('../../services/list/item-operations');
const { createListFetchers } = require('../../services/list/fetchers');
const identityMigration = require('../../db/migrations/migrations/087_manual_album_identity_and_lookup');

function fixture() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = { raw: (sql, args) => pool.query(sql, args) };
  const canonical = createAlbumCanonical({ db });
  return { pool, db, canonical };
}

test('concurrent manual inserts converge; batch results preserve input identities and separate releases', async () => {
  const { pool, canonical } = fixture();
  const artist = crypto.randomUUID();
  const input = { artist, album: 'Case | Study' };
  const variant = { ...input, album: ' case | study ' };
  const releases = [1, 2].map(() => ({
    ...input,
    album_id: crypto.randomUUID(),
  }));
  try {
    const inserts = await Promise.all(
      [input, variant].map((a) => canonical.upsertCanonical(a, new Date()))
    );
    assert.equal(inserts[0].albumId, inserts[1].albumId);
    assert.equal(inserts.filter((r) => r.wasInserted).length, 1);
    const batch = await canonical.batchUpsertCanonical(
      [input, variant, ...releases],
      new Date()
    );
    for (const album of [input, variant, ...releases])
      assert.equal(
        batch.get(albumBatchKey(album)).albumId,
        album.album_id ?? inserts[0].albumId
      );
  } finally {
    await pool.query('DELETE FROM albums WHERE artist=$1', [artist]);
    await pool.end();
  }
});

test('upgrade of conflicting manual identities preserves every old ID', async () => {
  const { pool } = fixture();
  const client = await pool.connect();
  try {
    await client.query(`BEGIN;
      CREATE TEMP TABLE albums(id serial, album_id text, artist text, album text, created_at timestamptz DEFAULT now());
      INSERT INTO albums(album_id,artist,album) VALUES ('internal-a','A','B'),('internal-b','a',' b '),('external','a','b');`);
    await identityMigration.up(client);
    assert.deepEqual(
      (
        await client.query(
          'SELECT album_id,manual_identity_alias AS alias FROM albums ORDER BY id'
        )
      ).rows,
      [
        { album_id: 'internal-a', alias: false },
        { album_id: 'internal-b', alias: true },
        { album_id: 'external', alias: false },
      ]
    );
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
});

test('full replacement only versions changed items; list mappings, moves and empty lists survive', async () => {
  const { pool, db, canonical } = fixture();
  const client = await pool.connect();
  const items = createListItemOperations({
    db,
    crypto,
    upsertAlbumRecord: canonical.upsertCanonical,
    batchUpsertAlbumRecords: canonical.batchUpsertCanonical,
  });
  const user = crypto.randomUUID(),
    list = crypto.randomUUID(),
    other = crypto.randomUUID();
  const albums = Array.from({ length: 3 }, (_, i) => ({
    artist: user,
    album: String(i),
    album_id: crypto.randomUUID(),
  }));
  const existing = async () =>
    (
      await client.query(
        'SELECT _id,album_id,ctid::text AS tuple FROM list_items WHERE list_id=$1 ORDER BY position',
        [list]
      )
    ).rows;
  const revision = async (id) =>
    Number(
      (await client.query('SELECT revision FROM lists WHERE _id=$1', [id]))
        .rows[0].revision
    );
  try {
    await client.query('BEGIN');
    await client.query(
      "INSERT INTO users(_id,email,username,hash) VALUES ($1,$1,$1,'synthetic')",
      [user]
    );
    const group = (
      await client.query(
        "INSERT INTO list_groups(_id,user_id,name,sort_order) VALUES ($1,$1,'group',1) RETURNING id",
        [user]
      )
    ).rows[0].id;
    await client.query(
      "INSERT INTO lists(_id,user_id,name,group_id,sort_order) VALUES ($1,$3,'one',$4,1),($2,$3,'two',$4,2)",
      [list, other, user, group]
    );
    await items.insertListItems(client, list, albums, new Date());
    const before = await existing();
    const rev = await revision(list);
    const replacement = [albums[0], { ...albums[1], comments: 'changed' }];
    await items.insertListItems(client, list, replacement, new Date(), before);
    const after = await existing();
    assert.equal(after.length, 2);
    assert.deepEqual(before[0], after[0]);
    assert.equal(before[1]._id, after[1]._id);
    assert.notEqual(before[1].tuple, after[1].tuple);
    assert.equal(await revision(list), rev + 2);
    await items.insertListItems(client, list, replacement, new Date(), after);
    assert.deepEqual(await existing(), after);
    assert.equal(await revision(list), rev + 2);
    await client.query(
      `INSERT INTO album_service_mappings(album_id,service,external_url,strategy)
      VALUES ($1,'spotify','https://example.test/track',null),($1,'tidal',null,'availability:test'),
      ($1,'rateyourmusic','https://example.test/rym',null)`,
      [albums[0].album_id]
    );
    const fetchers = createListFetchers({
      db: { raw: (s, p) => client.query(s, p) },
      fetchRecommendationMaps: async () => new Map(),
      findListById: () => {},
      getPointsForPosition: () => 0,
    });
    const full = await fetchers.getAllLists(user, { full: true });
    assert.deepEqual(full[other], []);
    assert.deepEqual(full[list][0].availability, ['spotify', 'tidal']);
    assert.deepEqual(full[list][0].availability_links, [
      { service: 'spotify', url: 'https://example.test/track' },
    ]);
    assert.equal(full[list][0].rym_canonical_url, 'https://example.test/rym');
    await client.query('UPDATE list_items SET list_id=$2 WHERE list_id=$1', [
      list,
      other,
    ]);
    assert.equal(await revision(list), rev + 4);
    assert.equal(await revision(other), 2);
    await client.query('DELETE FROM lists WHERE _id=$1', [other]);
    assert.equal(
      (
        await client.query(
          'SELECT count(*)::int n FROM list_items WHERE list_id=$1',
          [other]
        )
      ).rows[0].n,
      0
    );
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
});
