const { describe, it, mock } = require('node:test');
const assert = require('node:assert');

const { createDuplicateService } = require('../services/duplicate-service');
const { createMockLogger, createMockPool, asMockDb } = require('./helpers');

function taxonomySnapshot({
  url,
  receivedAt,
  primary = [],
  secondary = [],
  descriptors = [],
  optional = {},
}) {
  return {
    primary_genres: primary,
    secondary_genres: secondary,
    descriptors,
    ...optional,
    source_url: url,
    extractor_version: 'test-1',
    captured_at: null,
    received_at: receivedAt,
    complete: true,
  };
}

function albumTaxonomy({ rym, overrides = {} } = {}) {
  return {
    schema_version: 1,
    manual_overrides: overrides,
    ...(rym ? { rym } : {}),
  };
}

function createMergeHarness({ albums, tables = [], mappings = [] }) {
  const albumUpdates = [];
  const mappingQueries = [];
  const client = {
    query: async (sql, params) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('FROM pg_tables')) {
        return { rows: tables.map((tablename) => ({ tablename })) };
      }
      if (sql.includes('ORDER BY album_id') && sql.includes('FOR UPDATE')) {
        return { rows: albums.map(({ album_id }) => ({ album_id })) };
      }
      if (sql.includes('FROM albums WHERE album_id = $1 OR album_id = $2')) {
        return { rows: albums, rowCount: albums.length };
      }
      if (sql.includes('UPDATE albums SET')) {
        albumUpdates.push({ sql, params });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('FROM list_items') && sql.includes('ORDER BY list_id')) {
        return { rows: [], rowCount: 0 };
      }
      if (
        sql.includes('FROM album_service_mappings') &&
        sql.includes('FOR UPDATE')
      ) {
        mappingQueries.push({ sql, params, operation: 'select' });
        return { rows: mappings, rowCount: mappings.length };
      }
      if (sql.includes('UPDATE album_service_mappings')) {
        mappingQueries.push({ sql, params, operation: 'update' });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('DELETE FROM album_service_mappings')) {
        mappingQueries.push({ sql, params, operation: 'delete' });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('UPDATE list_items SET album_id')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('DELETE FROM albums WHERE album_id = $1')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release: mock.fn(),
  };
  const pool = {
    connect: mock.fn(async () => client),
    query: mock.fn(async () => ({ rows: [], rowCount: 0 })),
  };
  return {
    service: createDuplicateService({
      db: asMockDb(pool),
      logger: createMockLogger(),
    }),
    albumUpdates,
    mappingQueries,
  };
}

describe('duplicate-service', () => {
  it('scanDuplicates should find obvious duplicates with candidate blocking enabled', async () => {
    const pool = createMockPool([
      {
        rows: [
          {
            album_id: 'a1',
            artist: 'Radiohead',
            album: 'OK Computer',
            release_date: null,
            country: null,
            genre_1: null,
            genre_2: null,
            album_taxonomy: {
              schema_version: 1,
              manual_overrides: {},
              rym: {
                primary_genres: ['Art Rock'],
                secondary_genres: [],
                descriptors: [],
                source_url:
                  'https://rateyourmusic.com/release/album/radiohead/ok-computer/',
                extractor_version: '1',
                received_at: '2026-08-17T10:00:00.000Z',
                complete: true,
              },
            },
            taxonomy_updated_at: '2026-08-17T10:00:00.000Z',
            tracks: null,
            summary: null,
            track_count: 12,
            has_cover: true,
            created_at: new Date('2020-01-01T00:00:00Z'),
          },
          {
            album_id: 'a2',
            artist: 'Radiohead',
            album: 'OK Computer (Deluxe Edition)',
            release_date: null,
            country: null,
            genre_1: null,
            genre_2: null,
            tracks: null,
            summary: null,
            track_count: 24,
            has_cover: true,
            created_at: new Date('2021-01-01T00:00:00Z'),
          },
          {
            album_id: 'a3',
            artist: 'Miles Davis',
            album: 'Kind of Blue',
            release_date: null,
            country: null,
            genre_1: null,
            genre_2: null,
            tracks: null,
            summary: null,
            track_count: 5,
            has_cover: false,
            created_at: new Date('2019-01-01T00:00:00Z'),
          },
        ],
      },
      { rows: [] },
      {
        rows: [
          { album_id: 'a1', list_refs: 2 },
          { album_id: 'a2', list_refs: 1 },
        ],
      },
    ]);

    const logger = createMockLogger();
    const service = createDuplicateService({ db: asMockDb(pool), logger });

    const result = await service.scanDuplicates(0.15);

    assert.strictEqual(result.totalAlbums, 3);
    assert.ok(result.potentialDuplicates >= 1);

    const hasExpectedPair = result.pairs.some((pair) => {
      const ids = [pair.album1.album_id, pair.album2.album_id].sort();
      return ids[0] === 'a1' && ids[1] === 'a2';
    });
    assert.ok(hasExpectedPair);
    const taxonomyAlbum = result.pairs
      .flatMap((pair) => [pair.album1, pair.album2])
      .find((album) => album.album_id === 'a1');
    assert.deepStrictEqual(taxonomyAlbum.album_taxonomy.rym.primary_genres, [
      'Art Rock',
    ]);
    assert.strictEqual(
      taxonomyAlbum.taxonomy_updated_at,
      '2026-08-17T10:00:00.000Z'
    );
    assert.ok(Array.isArray(result.clusters));
    assert.ok(result.totalClusters >= 1);

    const radioheadCluster = result.clusters.find((cluster) =>
      cluster.members.some((member) => member.album_id === 'a1')
    );
    assert.ok(radioheadCluster);
    assert.ok(radioheadCluster.suggestedCanonicalId);
  });

  it('scanDuplicates should log comparison reduction metrics', async () => {
    const pool = createMockPool([
      {
        rows: [
          {
            album_id: 'x1',
            artist: 'Boards of Canada',
            album: 'Geogaddi',
            release_date: null,
            country: null,
            genre_1: null,
            genre_2: null,
            tracks: null,
            summary: null,
            track_count: 23,
            has_cover: true,
            created_at: new Date('2020-01-01T00:00:00Z'),
          },
          {
            album_id: 'x2',
            artist: 'Bicep',
            album: 'Isles',
            release_date: null,
            country: null,
            genre_1: null,
            genre_2: null,
            tracks: null,
            summary: null,
            track_count: 10,
            has_cover: true,
            created_at: new Date('2020-01-02T00:00:00Z'),
          },
        ],
      },
      { rows: [] },
      { rows: [] },
    ]);

    const logger = createMockLogger();
    const service = createDuplicateService({ db: asMockDb(pool), logger });
    await service.scanDuplicates(0.15);

    const completionLog = logger.info.mock.calls.find(
      (call) => call.arguments[0] === 'Duplicate scan completed'
    );

    assert.ok(completionLog);
    assert.ok(
      Number.isFinite(completionLog.arguments[1].totalPossibleComparisons)
    );
    assert.ok(Number.isFinite(completionLog.arguments[1].comparisonsEvaluated));
    assert.ok(
      Number.isFinite(completionLog.arguments[1].comparisonReductionPct)
    );
  });

  it('mergeAlbums should run in transaction and rollback on failure', async () => {
    const callLog = [];

    const client = {
      query: async (sql) => {
        callLog.push(sql);

        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes('FROM albums WHERE album_id = $1 OR album_id = $2')) {
          return {
            rows: [
              {
                album_id: 'keep1',
                artist: 'Artist',
                album: 'Album',
                release_date: null,
                country: null,
                genre_1: null,
                genre_2: null,
                tracks: null,
                cover_image: null,
                cover_image_format: null,
                summary: null,
                summary_source: null,
                summary_fetched_at: null,
              },
              {
                album_id: 'del1',
                artist: 'Artist',
                album: 'Album (Deluxe)',
                release_date: '2000',
                country: 'US',
                genre_1: 'Rock',
                genre_2: null,
                tracks: null,
                cover_image: null,
                cover_image_format: null,
                summary: null,
                summary_source: null,
                summary_fetched_at: null,
              },
            ],
          };
        }

        if (sql.includes('UPDATE albums SET')) {
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes('FROM list_items')) {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes('UPDATE list_items SET album_id')) {
          return { rows: [], rowCount: 3 };
        }

        if (sql.includes('DELETE FROM albums WHERE album_id = $1')) {
          throw new Error('simulated delete failure');
        }

        return { rows: [], rowCount: 0 };
      },
      release: mock.fn(),
    };

    const pool = {
      connect: mock.fn(async () => client),
      query: mock.fn(async (sql) => {
        if (sql.includes('SELECT DISTINCT l.user_id')) {
          return { rows: [{ user_id: 'user1' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const coverCache = { invalidateAlbum: mock.fn() };
    const responseCache = { invalidate: mock.fn() };
    const service = createDuplicateService({
      db: asMockDb(pool),
      logger: createMockLogger(),
      coverCache,
      responseCache,
    });

    await assert.rejects(
      () => service.mergeAlbums('keep1', 'del1'),
      /simulated delete failure/
    );

    assert.ok(callLog.includes('BEGIN'));
    assert.ok(callLog.includes('ROLLBACK'));
    assert.ok(!callLog.includes('COMMIT'));
    assert.strictEqual(coverCache.invalidateAlbum.mock.calls.length, 0);
    assert.strictEqual(responseCache.invalidate.mock.calls.length, 0);
  });

  it('mergeAlbums should resolve same-list collisions before remap', async () => {
    const updates = [];
    const deletions = [];

    const client = {
      query: async (sql, params) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes('FROM albums WHERE album_id = $1 OR album_id = $2')) {
          return {
            rows: [
              {
                album_id: 'keep1',
                artist: 'Artist',
                album: 'Album',
                release_date: null,
                country: null,
                genre_1: null,
                genre_2: null,
                tracks: null,
                cover_image: null,
                cover_image_format: null,
                summary: null,
                summary_source: null,
                summary_fetched_at: null,
              },
              {
                album_id: 'del1',
                artist: 'Artist',
                album: 'Album (Remaster)',
                release_date: '2020-01-01',
                country: null,
                genre_1: 'Rock',
                genre_2: null,
                tracks: null,
                cover_image: null,
                cover_image_format: null,
                summary: null,
                summary_source: null,
                summary_fetched_at: null,
              },
            ],
          };
        }

        if (
          sql.includes('FROM list_items') &&
          sql.includes('album_id = $1 OR album_id = $2')
        ) {
          return {
            rows: [
              {
                _id: 'item-keep',
                list_id: 'list-1',
                album_id: 'keep1',
                position: 5,
                comments: 'Existing comment',
                comments_2: null,
                primary_track: 'Track A',
                secondary_track: null,
                created_at: new Date('2020-01-01T00:00:00Z'),
              },
              {
                _id: 'item-del',
                list_id: 'list-1',
                album_id: 'del1',
                position: 3,
                comments: 'New comment',
                comments_2: 'Extra',
                primary_track: 'Track B',
                secondary_track: null,
                created_at: new Date('2020-01-02T00:00:00Z'),
              },
            ],
          };
        }

        if (
          sql.includes('UPDATE list_items') &&
          sql.includes('WHERE _id = $7')
        ) {
          updates.push({ sql, params });
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes('DELETE FROM list_items WHERE _id = ANY')) {
          deletions.push(params);
          return { rows: [], rowCount: 1 };
        }

        if (
          sql.includes(
            'UPDATE list_items SET album_id = $1, updated_at = NOW()'
          )
        ) {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes('DELETE FROM albums WHERE album_id = $1')) {
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes('DELETE FROM album_distinct_pairs')) {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes('UPDATE albums SET')) {
          return { rows: [], rowCount: 1 };
        }

        return { rows: [], rowCount: 0 };
      },
      release: mock.fn(),
    };

    const pool = {
      connect: mock.fn(async () => client),
      query: mock.fn(async (sql) => {
        if (sql.includes('SELECT DISTINCT l.user_id')) {
          return { rows: [{ user_id: 'user1' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const coverCache = { invalidateAlbum: mock.fn() };
    const responseCache = { invalidate: mock.fn() };
    const service = createDuplicateService({
      db: asMockDb(pool),
      logger: createMockLogger(),
      coverCache,
      responseCache,
    });

    const result = await service.mergeAlbums('keep1', 'del1');

    assert.strictEqual(result.collisionsResolved, 1);
    assert.strictEqual(result.collisionRowsDeleted, 1);
    assert.strictEqual(result.albumsDeleted, 1);
    assert.ok(updates.length >= 1);
    assert.ok(deletions.length >= 1);
    assert.deepStrictEqual(
      coverCache.invalidateAlbum.mock.calls.map((call) => call.arguments[0]),
      ['keep1', 'del1']
    );
    assert.deepStrictEqual(
      responseCache.invalidate.mock.calls.map((call) => call.arguments[0]),
      [':user1']
    );
  });

  it('mergeAlbums should remap dependent references safely', async () => {
    const client = {
      query: async (sql) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes('pg_advisory_xact_lock')) {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes('FROM pg_tables')) {
          return {
            rows: [
              { tablename: 'recommendations' },
              { tablename: 'album_service_mappings' },
              { tablename: 'artist_service_aliases' },
              { tablename: 'user_album_stats' },
              { tablename: 'album_distinct_pairs' },
            ],
            rowCount: 5,
          };
        }

        if (sql.includes('ORDER BY album_id') && sql.includes('FOR UPDATE')) {
          return { rows: [{ album_id: 'del1' }, { album_id: 'keep1' }] };
        }

        if (sql.includes('FROM albums WHERE album_id = $1 OR album_id = $2')) {
          return {
            rows: [
              {
                album_id: 'keep1',
                artist: 'Artist',
                album: 'Canonical Album',
                release_date: '2020-01-01',
                country: 'US',
                genre_1: 'Rock',
                genre_2: null,
                tracks: null,
                cover_image: null,
                cover_image_format: null,
                summary: null,
                summary_source: null,
                summary_fetched_at: null,
              },
              {
                album_id: 'del1',
                artist: 'Artist',
                album: 'Album',
                release_date: '2020-01-01',
                country: 'US',
                genre_1: 'Rock',
                genre_2: null,
                tracks: null,
                cover_image: null,
                cover_image_format: null,
                summary: null,
                summary_source: null,
                summary_fetched_at: null,
              },
            ],
            rowCount: 2,
          };
        }

        if (
          sql.includes('FROM list_items') &&
          sql.includes('ORDER BY list_id')
        ) {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes('DELETE FROM recommendations retiring')) {
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes('UPDATE recommendations')) {
          return { rows: [], rowCount: 2 };
        }

        if (sql.includes('DELETE FROM album_service_mappings retiring')) {
          return { rows: [], rowCount: 1 };
        }

        if (
          sql.includes('FROM album_service_mappings') &&
          sql.includes('FOR UPDATE')
        ) {
          return {
            rows: [
              {
                album_id: 'keep1',
                service: 'spotify',
                external_album_id: 'canonical-spotify',
                strategy: 'verified',
              },
              {
                album_id: 'del1',
                service: 'spotify',
                external_album_id: 'retiring-spotify',
                strategy: 'search',
              },
              {
                album_id: 'del1',
                service: 'tidal',
                external_album_id: 'retiring-tidal',
                strategy: 'search',
              },
            ],
          };
        }

        if (sql.includes('UPDATE album_service_mappings')) {
          return { rows: [], rowCount: 3 };
        }

        if (
          sql.includes('DELETE FROM album_service_mappings') &&
          sql.includes('WHERE album_id = $1 AND service = $2')
        ) {
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes('UPDATE artist_service_aliases')) {
          return { rows: [], rowCount: 4 };
        }

        if (sql.includes('UPDATE user_album_stats')) {
          return { rows: [], rowCount: 5 };
        }

        if (sql.includes('WITH affected AS')) {
          return { rows: [{ inserted_count: 2 }], rowCount: 1 };
        }

        if (
          sql.includes('DELETE FROM album_distinct_pairs') &&
          sql.includes('album_id_1 = $1 OR album_id_2 = $1')
        ) {
          return { rows: [], rowCount: 2 };
        }

        if (
          sql.includes(
            'UPDATE list_items SET album_id = $1, updated_at = NOW() WHERE album_id = $2'
          )
        ) {
          return { rows: [], rowCount: 6 };
        }

        if (sql.includes('DELETE FROM albums WHERE album_id = $1')) {
          return { rows: [], rowCount: 1 };
        }

        return { rows: [], rowCount: 0 };
      },
      release: mock.fn(),
    };

    const pool = {
      connect: mock.fn(async () => client),
      query: mock.fn(async () => ({ rows: [], rowCount: 0 })),
    };

    const service = createDuplicateService({
      db: asMockDb(pool),
      logger: createMockLogger(),
    });

    const result = await service.mergeAlbums('keep1', 'del1');

    assert.strictEqual(result.dependentRemaps.recommendationsUpdated, 2);
    assert.strictEqual(
      result.dependentRemaps.recommendationsConflictsRemoved,
      1
    );
    assert.strictEqual(result.dependentRemaps.albumMappingsUpdated, 3);
    assert.strictEqual(result.dependentRemaps.albumMappingsConflictsRemoved, 1);
    assert.strictEqual(result.dependentRemaps.artistAliasSourcesUpdated, 4);
    assert.strictEqual(result.dependentRemaps.userAlbumStatsUpdated, 5);
    assert.strictEqual(result.dependentRemaps.distinctPairsRemapped, 2);
    assert.strictEqual(result.dependentRemaps.distinctPairsRemoved, 2);
  });

  it('mergeAlbums should allow metadata merge to be skipped', async () => {
    const callLog = [];

    const client = {
      query: async (sql) => {
        callLog.push(sql);

        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes('pg_advisory_xact_lock')) {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes('FROM pg_tables')) {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes('ORDER BY album_id') && sql.includes('FOR UPDATE')) {
          return { rows: [] };
        }

        if (sql.includes('FROM albums WHERE album_id = $1 OR album_id = $2')) {
          return {
            rows: [
              {
                album_id: 'keep1',
                artist: 'Artist',
                album: 'Album',
                release_date: null,
                country: null,
                genre_1: null,
                genre_2: null,
                tracks: null,
                cover_image: null,
                cover_image_format: null,
                summary: null,
                summary_source: null,
                summary_fetched_at: null,
              },
              {
                album_id: 'del1',
                artist: 'Artist (Deluxe Edition)',
                album: 'Album (Deluxe Edition)',
                release_date: '2024-01-01',
                country: 'US',
                genre_1: 'Rock',
                genre_2: 'Alt',
                tracks: null,
                cover_image: null,
                cover_image_format: null,
                summary: 'Long summary',
                summary_source: 'test',
                summary_fetched_at: null,
              },
            ],
          };
        }

        if (
          sql.includes('FROM list_items') &&
          sql.includes('ORDER BY list_id')
        ) {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes('UPDATE list_items SET album_id')) {
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes('DELETE FROM albums WHERE album_id = $1')) {
          return { rows: [], rowCount: 1 };
        }

        return { rows: [], rowCount: 0 };
      },
      release: mock.fn(),
    };

    const pool = {
      connect: mock.fn(async () => client),
      query: mock.fn(async () => ({ rows: [], rowCount: 0 })),
    };

    const service = createDuplicateService({
      db: asMockDb(pool),
      logger: createMockLogger(),
    });

    const result = await service.mergeAlbums('keep1', 'del1', {
      mergeMetadata: false,
    });

    assert.strictEqual(result.metadataMerged, false);
    const hasMetadataUpdate = callLog.some((sql) =>
      sql.includes('UPDATE albums SET')
    );
    assert.strictEqual(hasMetadataUpdate, false);
  });

  it('mergeCluster should invalidate cover cache for canonical and retired albums', async () => {
    const client = {
      query: async (sql) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes('pg_advisory_xact_lock')) {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes('FROM pg_tables')) {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes('ORDER BY album_id') && sql.includes('FOR UPDATE')) {
          return { rows: [] };
        }

        if (sql.includes('FROM albums WHERE album_id = $1 OR album_id = $2')) {
          return {
            rows: [
              {
                album_id: 'keep1',
                artist: 'Artist',
                album: 'Album',
                release_date: null,
                country: null,
                genre_1: null,
                genre_2: null,
                tracks: null,
                cover_image: null,
                cover_image_format: null,
                summary: null,
                summary_source: null,
                summary_fetched_at: null,
              },
              {
                album_id: 'del1',
                artist: 'Artist',
                album: 'Album',
                release_date: '2024-01-01',
                country: null,
                genre_1: null,
                genre_2: null,
                tracks: null,
                cover_image: null,
                cover_image_format: null,
                summary: null,
                summary_source: null,
                summary_fetched_at: null,
              },
            ],
          };
        }

        if (sql.includes('UPDATE albums SET')) {
          return { rows: [], rowCount: 1 };
        }

        if (
          sql.includes('FROM list_items') &&
          sql.includes('ORDER BY list_id')
        ) {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes('UPDATE list_items SET album_id')) {
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes('DELETE FROM albums WHERE album_id = $1')) {
          return { rows: [], rowCount: 1 };
        }

        return { rows: [], rowCount: 0 };
      },
      release: mock.fn(),
    };
    const pool = {
      connect: mock.fn(async () => client),
      query: mock.fn(async (sql) => {
        if (sql.includes('SELECT DISTINCT l.user_id')) {
          return { rows: [{ user_id: 'user2' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };
    const coverCache = { invalidateAlbum: mock.fn() };
    const responseCache = { invalidate: mock.fn() };
    const service = createDuplicateService({
      db: asMockDb(pool),
      logger: createMockLogger(),
      coverCache,
      responseCache,
    });

    const result = await service.mergeCluster('keep1', ['del1']);

    assert.strictEqual(result.albumsDeleted, 1);
    assert.deepStrictEqual(
      coverCache.invalidateAlbum.mock.calls.map((call) => call.arguments[0]),
      ['keep1', 'del1']
    );
    assert.deepStrictEqual(
      responseCache.invalidate.mock.calls.map((call) => call.arguments[0]),
      [':user2']
    );
  });

  it('mergeAlbums should choose the newest same-source RYM snapshot and layer manual overrides', async () => {
    const sourceUrl = 'https://rateyourmusic.com/release/album/artist/album/';
    const keepTaxonomy = albumTaxonomy({
      rym: taxonomySnapshot({
        url: sourceUrl.slice(0, -1),
        receivedAt: '2026-08-17T10:00:00.000Z',
        primary: ['Old Primary', 'Old Secondary'],
        descriptors: ['Old descriptor'],
        optional: { languages: ['English'] },
      }),
      overrides: {
        genre_1: { value: 'Keep override', source: 'manual' },
      },
    });
    const retiringTaxonomy = albumTaxonomy({
      rym: taxonomySnapshot({
        url: sourceUrl,
        receivedAt: '2026-08-17T11:00:00.000Z',
        primary: ['New Primary', 'New Secondary'],
        descriptors: ['New descriptor'],
        optional: { scenes: ['Canterbury Scene'] },
      }),
      overrides: {
        genre_1: { value: 'Retiring override', source: 'manual' },
        genre_2: { value: 'Filled override', source: 'manual' },
      },
    });
    const harness = createMergeHarness({
      albums: [
        {
          album_id: 'keep1',
          artist: 'Artist',
          album: 'Album',
          genre_1: 'Old scalar',
          genre_2: 'Other scalar',
          album_taxonomy: keepTaxonomy,
        },
        {
          album_id: 'del1',
          artist: 'Artist',
          album: 'Album',
          genre_1: 'Ignored scalar',
          genre_2: 'Ignored scalar 2',
          album_taxonomy: retiringTaxonomy,
        },
      ],
    });

    const result = await harness.service.mergeAlbums('keep1', 'del1');

    assert.strictEqual(result.taxonomyConflict, false);
    assert.deepStrictEqual(result.albumTaxonomy.rym.primary_genres, [
      'New Primary',
      'New Secondary',
    ]);
    assert.deepStrictEqual(result.albumTaxonomy.rym.descriptors, [
      'New descriptor',
    ]);
    assert.deepStrictEqual(result.albumTaxonomy.rym.languages, ['English']);
    assert.deepStrictEqual(result.albumTaxonomy.rym.scenes, [
      'Canterbury Scene',
    ]);
    assert.strictEqual(
      result.albumTaxonomy.manual_overrides.genre_1.value,
      'Keep override'
    );
    assert.strictEqual(
      result.albumTaxonomy.manual_overrides.genre_2.value,
      'Filled override'
    );
    const update = harness.albumUpdates[0];
    const genre1Index = result.mergedFieldNames.indexOf('genre_1');
    const genre2Index = result.mergedFieldNames.indexOf('genre_2');
    assert.strictEqual(update.params[genre1Index + 1], 'Keep override');
    assert.strictEqual(update.params[genre2Index + 1], 'Filled override');
    assert.match(update.sql, /album_taxonomy = \$\d+/);
    assert.match(update.sql, /taxonomy_updated_at = \$\d+/);
  });

  it('mergeAlbums should move a sole RYM snapshot without unioning scalar genres', async () => {
    const retiringTaxonomy = albumTaxonomy({
      rym: taxonomySnapshot({
        url: 'https://rateyourmusic.com/release/album/artist/sole/',
        receivedAt: '2026-08-17T12:00:00.000Z',
        primary: ['Sole Primary'],
        secondary: ['Sole Secondary'],
      }),
    });
    const harness = createMergeHarness({
      albums: [
        {
          album_id: 'keep1',
          artist: 'Artist',
          album: 'Album',
          genre_1: 'Legacy Keep',
          genre_2: null,
          album_taxonomy: albumTaxonomy(),
        },
        {
          album_id: 'del1',
          artist: 'Artist',
          album: 'Album',
          genre_1: 'Legacy Delete',
          genre_2: 'Legacy Extra',
          album_taxonomy: retiringTaxonomy,
        },
      ],
    });

    const result = await harness.service.mergeAlbums('keep1', 'del1');
    const update = harness.albumUpdates[0];

    assert.deepStrictEqual(result.albumTaxonomy.rym, retiringTaxonomy.rym);
    assert.strictEqual(
      update.params[result.mergedFieldNames.indexOf('genre_1') + 1],
      'Sole Primary'
    );
    assert.strictEqual(
      update.params[result.mergedFieldNames.indexOf('genre_2') + 1],
      'Sole Secondary'
    );
  });

  it('mergeAlbums should report divergent taxonomy and RYM mapping identities while retaining canonical mappings', async () => {
    const canonicalRym = taxonomySnapshot({
      url: 'https://rateyourmusic.com/release/album/artist/canonical/',
      receivedAt: '2026-08-17T10:00:00.000Z',
      primary: ['Canonical Genre'],
    });
    const retiringRym = taxonomySnapshot({
      url: 'https://rateyourmusic.com/release/album/artist/retiring/',
      receivedAt: '2026-08-17T12:00:00.000Z',
      primary: ['Retiring Genre'],
    });
    const harness = createMergeHarness({
      tables: ['album_service_mappings'],
      albums: [
        {
          album_id: 'keep1',
          artist: 'Artist',
          album: 'Album',
          genre_1: 'Canonical Genre',
          genre_2: '',
          album_taxonomy: albumTaxonomy({ rym: canonicalRym }),
        },
        {
          album_id: 'del1',
          artist: 'Artist',
          album: 'Album',
          genre_1: 'Retiring Genre',
          genre_2: '',
          album_taxonomy: albumTaxonomy({ rym: retiringRym }),
        },
      ],
      mappings: [
        {
          album_id: 'keep1',
          service: 'rateyourmusic',
          external_album_id: '100',
          external_url: canonicalRym.source_url,
          strategy: 'rym:verified',
        },
        {
          album_id: 'del1',
          service: 'rateyourmusic',
          external_album_id: '200',
          external_url: retiringRym.source_url,
          strategy: 'rym:verified',
        },
        {
          album_id: 'keep1',
          service: 'spotify',
          external_album_id: 'verified-spotify',
          strategy: 'verified',
        },
        {
          album_id: 'del1',
          service: 'spotify',
          external_album_id: 'retiring-spotify',
          strategy: 'search',
        },
      ],
    });

    const result = await harness.service.mergeAlbums('keep1', 'del1');

    assert.strictEqual(result.taxonomyConflict, true);
    assert.deepStrictEqual(result.albumTaxonomy.rym, canonicalRym);
    assert.strictEqual(result.mappingConflicts.length, 1);
    assert.deepStrictEqual(result.mappingConflicts[0].conflictingFields, [
      'external_album_id',
      'external_url',
    ]);
    assert.strictEqual(
      result.mappingConflicts[0].canonical.externalAlbumId,
      '100'
    );
    assert.strictEqual(
      harness.mappingQueries.filter((query) => query.operation === 'update')
        .length,
      0
    );
    assert.strictEqual(
      harness.mappingQueries.filter((query) => query.operation === 'delete')
        .length,
      2
    );
  });

  it('mergeAlbums should free a compatible retiring RYM identity before filling the canonical mapping', async () => {
    const url = 'https://rateyourmusic.com/release/album/artist/album/';
    const harness = createMergeHarness({
      tables: ['album_service_mappings'],
      albums: [
        { album_id: 'keep1', artist: 'Artist', album: 'Album' },
        { album_id: 'del1', artist: 'Artist', album: 'Album' },
      ],
      mappings: [
        {
          album_id: 'keep1',
          service: 'rateyourmusic',
          external_album_id: null,
          external_url: url,
        },
        {
          album_id: 'del1',
          service: 'rateyourmusic',
          external_album_id: '100',
          external_url: url,
        },
      ],
    });

    const result = await harness.service.mergeAlbums('keep1', 'del1');
    const operations = harness.mappingQueries.map((query) => query.operation);

    assert.deepStrictEqual(result.mappingConflicts, []);
    assert.deepStrictEqual(operations, ['select', 'delete', 'update']);
    assert.strictEqual(harness.mappingQueries[2].params[2], '100');
  });

  it('previewMergeCluster should expose merged taxonomy and identity conflicts', async () => {
    const canonicalRym = taxonomySnapshot({
      url: 'https://rateyourmusic.com/release/album/artist/canonical/',
      receivedAt: '2026-08-17T10:00:00.000Z',
      primary: ['Canonical Genre'],
    });
    const retiringRym = taxonomySnapshot({
      url: 'https://rateyourmusic.com/release/album/artist/retiring/',
      receivedAt: '2026-08-17T11:00:00.000Z',
      primary: ['Retiring Genre'],
    });
    const albums = [
      {
        album_id: 'keep1',
        artist: 'Artist',
        album: 'Album',
        genre_1: 'Canonical Genre',
        genre_2: '',
        album_taxonomy: albumTaxonomy({ rym: canonicalRym }),
        taxonomy_updated_at: '2026-08-17T10:00:00.000Z',
      },
      {
        album_id: 'del1',
        artist: 'Artist',
        album: 'Album',
        genre_1: 'Retiring Genre',
        genre_2: 'Manual Retiring',
        album_taxonomy: albumTaxonomy({
          rym: retiringRym,
          overrides: {
            genre_2: { value: 'Manual Retiring', source: 'manual' },
          },
        }),
        taxonomy_updated_at: '2026-08-17T11:00:00.000Z',
      },
    ];
    const mappings = [
      {
        album_id: 'keep1',
        service: 'rateyourmusic',
        external_album_id: '100',
        external_url: canonicalRym.source_url,
      },
      {
        album_id: 'del1',
        service: 'rateyourmusic',
        external_album_id: '200',
        external_url: retiringRym.source_url,
      },
    ];
    const query = mock.fn(async (sql) => {
      if (sql.includes('FROM pg_tables')) {
        return { rows: [{ tablename: 'album_service_mappings' }] };
      }
      if (sql.includes('FROM albums') && sql.includes('ANY($1::text[])')) {
        return { rows: albums };
      }
      if (sql.includes('FROM list_items li')) return { rows: [] };
      if (
        sql.includes('SELECT album_id, service') &&
        sql.includes('FROM album_service_mappings')
      ) {
        return { rows: mappings };
      }
      if (sql.includes('COUNT(*)::int')) {
        return { rows: [{ count: 1 }] };
      }
      return { rows: [] };
    });
    const service = createDuplicateService({
      db: asMockDb({ query }),
      logger: createMockLogger(),
    });

    const preview = await service.previewMergeCluster('keep1', ['del1']);

    assert.strictEqual(preview.taxonomyConflict, true);
    assert.deepStrictEqual(preview.albumTaxonomy.rym, canonicalRym);
    assert.strictEqual(
      preview.albumTaxonomy.manual_overrides.genre_2.value,
      'Manual Retiring'
    );
    assert.strictEqual(preview.genre_1, 'Canonical Genre');
    assert.strictEqual(preview.genre_2, 'Manual Retiring');
    assert.strictEqual(preview.mappingConflicts.length, 1);
    assert.strictEqual(
      preview.dependentImpacts.albumMappingIdentityConflicts,
      1
    );
  });

  it('mergeAlbums should preserve scalar-only genre merging', async () => {
    const harness = createMergeHarness({
      albums: [
        {
          album_id: 'keep1',
          artist: 'Artist',
          album: 'Album',
          genre_1: 'Rock',
          genre_2: null,
        },
        {
          album_id: 'del1',
          artist: 'Artist',
          album: 'Album',
          genre_1: 'Ambient',
          genre_2: null,
        },
      ],
    });

    const result = await harness.service.mergeAlbums('keep1', 'del1');
    const update = harness.albumUpdates[0];

    assert.strictEqual(result.albumTaxonomy, null);
    assert.strictEqual(
      update.params[result.mergedFieldNames.indexOf('genre_2') + 1],
      'Ambient'
    );
    assert.ok(!result.mergedFieldNames.includes('album_taxonomy'));
  });
});
