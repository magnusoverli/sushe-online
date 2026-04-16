const { describe, it, mock } = require('node:test');
const assert = require('node:assert');

const { createDuplicateService } = require('../services/duplicate-service');
const { createMockLogger, createMockPool } = require('./helpers');

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
    const service = createDuplicateService({ pool, logger });

    const result = await service.scanDuplicates(0.15);

    assert.strictEqual(result.totalAlbums, 3);
    assert.ok(result.potentialDuplicates >= 1);

    const hasExpectedPair = result.pairs.some((pair) => {
      const ids = [pair.album1.album_id, pair.album2.album_id].sort();
      return ids[0] === 'a1' && ids[1] === 'a2';
    });
    assert.ok(hasExpectedPair);
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
    const service = createDuplicateService({ pool, logger });
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
      query: mock.fn(async () => ({ rows: [], rowCount: 0 })),
    };

    const service = createDuplicateService({
      pool,
      logger: createMockLogger(),
    });

    await assert.rejects(
      () => service.mergeAlbums('keep1', 'del1'),
      /simulated delete failure/
    );

    assert.ok(callLog.includes('BEGIN'));
    assert.ok(callLog.includes('ROLLBACK'));
    assert.ok(!callLog.includes('COMMIT'));
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
      query: mock.fn(async () => ({ rows: [], rowCount: 0 })),
    };

    const service = createDuplicateService({
      pool,
      logger: createMockLogger(),
    });

    const result = await service.mergeAlbums('keep1', 'del1');

    assert.strictEqual(result.collisionsResolved, 1);
    assert.strictEqual(result.collisionRowsDeleted, 1);
    assert.strictEqual(result.albumsDeleted, 1);
    assert.ok(updates.length >= 1);
    assert.ok(deletions.length >= 1);
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

        if (sql.includes('UPDATE album_service_mappings')) {
          return { rows: [], rowCount: 3 };
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
      pool,
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
      pool,
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
});
