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
            genre_1: null,
            genre_2: null,
            track_count: 12,
            has_cover: true,
          },
          {
            album_id: 'a2',
            artist: 'Radiohead',
            album: 'OK Computer (Deluxe Edition)',
            release_date: null,
            genre_1: null,
            genre_2: null,
            track_count: 24,
            has_cover: true,
          },
          {
            album_id: 'a3',
            artist: 'Miles Davis',
            album: 'Kind of Blue',
            release_date: null,
            genre_1: null,
            genre_2: null,
            track_count: 5,
            has_cover: false,
          },
        ],
      },
      { rows: [] },
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
            genre_1: null,
            genre_2: null,
            track_count: 23,
            has_cover: true,
          },
          {
            album_id: 'x2',
            artist: 'Bicep',
            album: 'Isles',
            release_date: null,
            genre_1: null,
            genre_2: null,
            track_count: 10,
            has_cover: true,
          },
        ],
      },
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
});
