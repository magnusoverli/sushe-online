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

async function inTestTransaction(action) {
  const { pool, canonical } = fixture();
  const client = await pool.connect();
  const db = {
    raw: (sql, args) => client.query(sql, args),
    withTransaction: (fn) => fn(client),
  };
  try {
    await client.query('BEGIN');
    await action(client, db, canonical);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
}

test('replaying 250 albums preserves every tuple; enriching one rewrites only that album', async () => {
  await inTestTransaction(async (client, db, canonical) => {
    const artist = crypto.randomUUID();
    const albums = Array.from({ length: 250 }, (_, i) => ({
      artist,
      album: `title ${i}`,
      ...(i % 2 && { album_id: crypto.randomUUID() }),
    }));
    const save = () =>
      canonical.batchUpsertCanonical(albums, new Date(), client);
    const tuples = async () =>
      (
        await db.raw(
          'SELECT album_id,ctid::text AS tuple,updated_at FROM albums WHERE artist=$1 ORDER BY album_id',
          [artist]
        )
      ).rows;
    const first = await save();
    const before = await tuples();
    const replay = await save();
    assert.equal(replay.size, 250);
    for (const [key, row] of replay) {
      assert.equal(row.albumId, first.get(key).albumId);
      assert.equal(row.metadataChanged, false);
      assert.equal(row.needsCoverFetch, true);
    }
    assert.deepEqual(await tuples(), before);
    albums[0].country = 'Canada';
    const mixed = await save();
    assert.equal(
      [...mixed.values()].filter((r) => r.metadataChanged).length,
      1
    );
    assert.equal(
      (await tuples()).filter((r, i) => r.tuple !== before[i].tuple).length,
      1
    );
    const single = await canonical.upsertCanonical(
      albums[0],
      new Date(),
      client
    );
    assert.equal(single.metadataChanged, false);
  });
});

test('daily sweep skips empty accounts and advances past a full page of still-eligible users', async () => {
  const {
    usersDueThisCycle,
  } = require('../../services/playcount-sync-service');
  await inTestTransaction(async (client, db) => {
    await client.query(`CREATE TEMP TABLE users AS SELECT _id,username,lastfm_username,lastfm_auth FROM public.users WITH NO DATA;
      CREATE TEMP TABLE lists (_id text,user_id text);
      CREATE TEMP TABLE list_items(list_id text,album_id text);
      CREATE TEMP TABLE albums(album_id text, artist text, album text);
      CREATE TEMP TABLE user_album_stats(id int,user_id text,album_id text,lastfm_updated_at timestamptz);
      INSERT INTO users SELECT lpad(i::text,3,'0'),'test','test','{}' FROM generate_series(1,101) i;
      INSERT INTO lists SELECT _id,_id FROM users WHERE _id>'050';
      INSERT INTO albums VALUES('album','artist','title');
      INSERT INTO list_items SELECT _id,'album' FROM lists;`);
    const users = [];
    for await (const u of usersDueThisCycle(db, 86400000)) users.push(u._id);
    assert.deepEqual(
      users,
      Array.from({ length: 51 }, (_, i) => String(i + 51).padStart(3, '0'))
    );
  });
});

test('cover reads project only the requested bytes and use the matching format', async () => {
  const { createAlbumService } = require('../../services/album-service');
  await inTestTransaction(async (client, db) => {
    const id = crypto.randomUUID();
    await client.query(
      `INSERT INTO albums(album_id,artist,album,cover_image,cover_image_format,cover_thumbnail,cover_thumbnail_format)
      VALUES($1,'Artist','Title',$2,'jpeg',$3,'webp')`,
      [id, Buffer.alloc(64000), Buffer.alloc(3000)]
    );
    const payloads = [];
    const service = createAlbumService({
      db: {
        raw: async (sql, args) => {
          const result = await db.raw(sql, args);
          payloads.push(
            Object.values(result.rows[0])
              .filter(Buffer.isBuffer)
              .map((b) => b.length)
          );
          return result;
        },
      },
    });
    const thumb = await service.getCoverImage(id, { size: 'thumb' });
    assert.equal(thumb.contentType, 'image/webp');
    assert.equal((await service.getCoverImage(id)).contentType, 'image/jpeg');
    await client.query(
      'UPDATE albums SET cover_thumbnail=NULL WHERE album_id=$1',
      [id]
    );
    assert.equal(
      (await service.getCoverImage(id, { size: 'thumb' })).contentType,
      'image/jpeg'
    );
    assert.deepEqual(payloads, [[3000], [64000], [64000]]);
  });
});

test('unrelated collection and bulk edits publish only years whose main lists changed', async () => {
  const {
    registerListMutationPublisher,
    withListTransaction,
    recordChangedAlbum,
  } = require('../../services/list/transaction');
  const { bulkUpdate } = require('../../services/list/management/bulk-update');
  const { createGroupService } = require('../../services/group-service');
  await inTestTransaction(async (client, db) => {
    await client.query(`CREATE TEMP TABLE lists(_id text,user_id text,year int,is_main boolean,updated_at timestamptz);
      CREATE TEMP TABLE list_groups(id serial,_id text,user_id text,name text,year int,sort_order int,updated_at timestamptz);
      CREATE TEMP TABLE list_items(list_id text,album_id text,position int,is_disqualified boolean);
      CREATE TEMP TABLE aggregate_list_contributors(year int,user_id text);
      INSERT INTO lists SELECT y::text,'owner',y,true,now() FROM generate_series(2020,2025)y;
      INSERT INTO lists SELECT 'list-'||i,'owner',2020,false, now() FROM generate_series(1,100)i;
      INSERT INTO list_groups(_id,user_id,name) VALUES('collection','owner','Before');
      INSERT INTO lists VALUES('other-main','other',2019,true,now());
      INSERT INTO aggregate_list_contributors VALUES(2019,'other');
      INSERT INTO list_items VALUES('other-main','shared',2,false);`);
    const events = [];
    const queries = [];
    db.withTransaction = (fn) =>
      fn({
        query: (sql, args) => {
          queries.push(sql);
          return client.query(sql, args);
        },
      });
    registerListMutationPublisher(db, (event) => events.push(event.years));
    await createGroupService({ db }).updateGroup('owner', 'collection', {
      name: 'After',
    });
    const context = {
      db,
      acquireYearLocks: async () => {},
      isYearLocked: async () => false,
    };
    const bulk = (updates) => bulkUpdate(context, 'owner', updates);
    const tids = async () =>
      (await client.query('SELECT ctid::text FROM lists ORDER BY _id')).rows;
    const before = await tids();
    const noops = await bulk(
      Array.from({ length: 100 }, (_, i) => ({
        listId: `list-${i + 1}`,
        isMain: false,
      }))
    );
    assert.equal(noops.results.filter((r) => r.success).length, 100);
    assert.equal(
      queries.filter((q) => q.includes('_id = ANY($1::text[])')).length,
      1
    );
    assert.deepEqual(await tids(), before);
    await bulk([
      { listId: 'list-1', isMain: true },
      { listId: 'list-2', isMain: true },
      { listId: 'list-1', isMain: true },
    ]);
    assert.deepEqual(
      (await client.query('SELECT _id FROM lists WHERE year=2020 AND is_main'))
        .rows,
      [{ _id: 'list-1' }]
    );
    await withListTransaction(db, 'owner', (tx) =>
      recordChangedAlbum(tx, 'shared')
    );
    assert.deepEqual(events, [[], [], [2020], [2019]]);
  });
});

test('catalog cleanup clears only the stats references counted by its preview', async () => {
  const {
    createCatalogCleanupService,
  } = require('../../services/catalog-cleanup');
  await inTestTransaction(async (client, db) => {
    await client.query(`CREATE TEMP TABLE albums(id serial,album_id text,artist text,album text,created_at timestamptz);
      CREATE TEMP TABLE list_items(album_id text);
      CREATE TEMP TABLE recommendations(album_id text);
      CREATE TEMP TABLE album_service_mappings(album_id text);
      CREATE TEMP TABLE artist_service_aliases(source_album_id text);
      CREATE TEMP TABLE user_album_stats (album_id text);
      CREATE TEMP TABLE album_distinct_pairs(album_id_1 text,album_id_2 text);
      INSERT INTO albums(album_id) VALUES('retained'),('orphan');
      INSERT INTO list_items VALUES ('retained');
      INSERT INTO user_album_stats VALUES('retained'),('orphan'),('already-dangling');`);
    const cleanup = createCatalogCleanupService({ db });
    const preview = await cleanup.getPreview();
    assert.equal(preview.userAlbumStatsReferences, 1);
    const outcome = await cleanup.executeCleanup({
      expectedDeleteCount: preview.orphanAlbums,
    });
    assert.equal(outcome.nullifiedUserAlbumStats, 1);
    assert.deepEqual(
      (
        await client.query(
          'SELECT album_id FROM user_album_stats ORDER BY album_id'
        )
      ).rows.map((r) => r.album_id),
      ['already-dangling', 'retained', null]
    );
  });
});

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
