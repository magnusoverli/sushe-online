const { describe, it, mock } = require('node:test');
const assert = require('node:assert');

const { createAlbumService } = require('../services/album-service');
const { TransactionAbort } = require('../db/transaction');
const { createMockLogger, createMockPool } = require('./helpers');

// Valid 1x1 RGBA PNG. Every chunk CRC verifies.
const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=';

describe('album-service', () => {
  it('updateSummary should throw 404 when album does not exist', async () => {
    const pool = createMockPool([{ rows: [], rowCount: 0 }]);

    const service = createAlbumService({
      db: pool,
      logger: createMockLogger(),
      upsertAlbumRecord: mock.fn(),
    });

    await assert.rejects(
      () => service.updateSummary('missing', 'Summary', 'manual'),
      (err) => {
        assert.ok(err instanceof TransactionAbort);
        assert.strictEqual(err.statusCode, 404);
        assert.strictEqual(err.body.error, 'Album not found');
        return true;
      }
    );

    assert.strictEqual(pool.query.mock.calls.length, 1);
    assert.ok(
      pool.query.mock.calls[0].arguments[0].includes('RETURNING album_id')
    );
  });

  it('updateCountry should update and invalidate caches for affected users', async () => {
    const responseCache = { invalidate: mock.fn() };
    const albumMetadataUpdated = mock.fn();
    const pool = createMockPool([
      { rows: [{ album_id: 'a1' }], rowCount: 1 },
      { rows: [{ user_id: 'user-1' }], rowCount: 1 },
    ]);

    const service = createAlbumService({
      db: pool,
      logger: createMockLogger(),
      upsertAlbumRecord: mock.fn(),
      responseCache,
      broadcast: { albumMetadataUpdated },
    });

    await service.updateCountry('a1', ' Norway ', 'user1');

    assert.strictEqual(pool.query.mock.calls.length, 2);
    assert.ok(
      pool.query.mock.calls[0].arguments[0].includes('RETURNING album_id')
    );
    assert.ok(
      pool.query.mock.calls[1].arguments[0].includes(
        'SELECT DISTINCT l.user_id'
      )
    );
    assert.strictEqual(responseCache.invalidate.mock.calls.length, 1);
    assert.strictEqual(
      responseCache.invalidate.mock.calls[0].arguments[0],
      ':user-1'
    );
    assert.deepStrictEqual(albumMetadataUpdated.mock.calls[0].arguments, [
      'user-1',
      'a1',
      { country: 'Norway' },
    ]);
  });

  it('updateGenres should reject empty genre updates', async () => {
    const pool = createMockPool([{ rows: [{ album_id: 'a1' }] }]);

    const service = createAlbumService({
      db: pool,
      logger: createMockLogger(),
      upsertAlbumRecord: mock.fn(),
    });

    await assert.rejects(
      () => service.updateGenres('a1', {}, 'user1'),
      (err) => {
        assert.ok(err instanceof TransactionAbort);
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.body.error, 'No genre updates provided');
        return true;
      }
    );
  });

  it('updateGenres delegates current edits to manual taxonomy overrides', async () => {
    const taxonomyUpdatedAt = new Date('2026-08-17T12:00:00.000Z');
    const albumTaxonomyService = {
      applyManualGenreOverrides: mock.fn(async () => ({
        taxonomy_updated_at: taxonomyUpdatedAt,
      })),
      resetManualGenreOverrides: mock.fn(async () => ({})),
    };
    const albumTaxonomyUpdated = mock.fn();
    const pool = createMockPool([
      { rows: [{ user_id: 'user-1' }], rowCount: 1 },
    ]);
    const service = createAlbumService({
      db: pool,
      logger: createMockLogger(),
      upsertAlbumRecord: mock.fn(),
      albumTaxonomyService,
      broadcast: { albumTaxonomyUpdated },
    });

    await service.updateGenres(
      'album-1',
      { genre_1: ' Dream Pop ', genre_2: null },
      'user-1'
    );

    assert.deepStrictEqual(
      albumTaxonomyService.applyManualGenreOverrides.mock.calls[0].arguments,
      [
        'album-1',
        { genre_1: ' Dream Pop ', genre_2: null },
        { updatedBy: 'user-1' },
      ]
    );
    assert.deepStrictEqual(albumTaxonomyUpdated.mock.calls[0].arguments, [
      'user-1',
      'album-1',
      taxonomyUpdatedAt,
    ]);
  });

  it('updateGenres should throw 404 when no album row is updated', async () => {
    const pool = createMockPool([{ rows: [], rowCount: 0 }]);

    const service = createAlbumService({
      db: pool,
      logger: createMockLogger(),
      upsertAlbumRecord: mock.fn(),
    });

    await assert.rejects(
      () =>
        service.updateGenres('missing', { genre_1: 'Black Metal' }, 'user1'),
      (err) => {
        assert.ok(err instanceof TransactionAbort);
        assert.strictEqual(err.statusCode, 404);
        assert.strictEqual(err.body.error, 'Album not found');
        return true;
      }
    );

    assert.ok(
      pool.query.mock.calls.some((call) =>
        call.arguments[0].includes('SELECT album_taxonomy')
      )
    );
  });

  it('batchUpdate should reject non-string metadata values', async () => {
    const client = {
      query: mock.fn(async (sql) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: mock.fn(),
    };

    const pool = {
      connect: mock.fn(async () => client),
      query: mock.fn(async () => ({ rows: [], rowCount: 0 })),
    };
    pool.raw = pool.query;
    // Match the canonical datastore surface so album-service's
    // db.withTransaction(cb) runs the callback with the mock client.
    pool.withTransaction = mock.fn(async (cb) => {
      await client.query('BEGIN');
      try {
        const r = await cb(client);
        await client.query('COMMIT');
        return r;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });

    const service = createAlbumService({
      db: pool,
      logger: createMockLogger(),
      upsertAlbumRecord: mock.fn(),
    });

    await assert.rejects(
      () =>
        service.batchUpdate(
          [
            {
              albumId: 'a1',
              country: 123,
            },
          ],
          'user1'
        ),
      (err) => {
        assert.ok(err instanceof TransactionAbort);
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.body.error, 'Invalid country value');
        return true;
      }
    );
  });

  it('batchUpdate should resolve two-letter country codes', async () => {
    const responseCache = { invalidate: mock.fn() };
    const albumMetadataUpdated = mock.fn();
    const pool = createMockPool([
      { rows: [], rowCount: 0 },
      { rows: [{ album_id: 'a1' }], rowCount: 1 },
      { rows: [], rowCount: 0 },
      { rows: [{ user_id: 'user-1' }], rowCount: 1 },
    ]);

    const service = createAlbumService({
      db: pool,
      logger: createMockLogger(),
      upsertAlbumRecord: mock.fn(),
      responseCache,
      broadcast: { albumMetadataUpdated },
    });

    const updated = await service.batchUpdate(
      [{ albumId: 'a1', country: 'no' }],
      'user1'
    );

    assert.strictEqual(updated, 1);
    assert.ok(pool.query.mock.calls[1].arguments[0].includes('country = $1'));
    assert.strictEqual(pool.query.mock.calls[1].arguments[1][0], 'Norway');
    assert.deepStrictEqual(albumMetadataUpdated.mock.calls[0].arguments, [
      'user-1',
      'a1',
      { country: 'Norway' },
    ]);
  });

  it('batchUpdate applies genre fields as taxonomy overrides in its transaction', async () => {
    const taxonomyUpdatedAt = new Date('2026-08-17T12:00:00.000Z');
    const albumTaxonomyService = {
      applyManualGenreOverrides: mock.fn(async () => ({
        genre_1: 'Rock',
        taxonomy_updated_at: taxonomyUpdatedAt,
      })),
      resetManualGenreOverrides: mock.fn(async () => ({})),
    };
    const albumTaxonomyUpdated = mock.fn();
    const pool = createMockPool([
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
      { rows: [{ user_id: 'user-1' }], rowCount: 1 },
    ]);
    const service = createAlbumService({
      db: pool,
      logger: createMockLogger(),
      upsertAlbumRecord: mock.fn(),
      albumTaxonomyService,
      broadcast: { albumTaxonomyUpdated },
    });

    const updated = await service.batchUpdate(
      [{ albumId: 'album-1', genre_1: 'Rock', genre_2: null }],
      'user-1'
    );

    assert.strictEqual(updated, 1);
    const [albumId, overrides, options] =
      albumTaxonomyService.applyManualGenreOverrides.mock.calls[0].arguments;
    assert.strictEqual(albumId, 'album-1');
    assert.deepStrictEqual(overrides, { genre_1: 'Rock', genre_2: null });
    assert.strictEqual(options.updatedBy, 'user-1');
    assert.ok(options.client);
    assert.deepStrictEqual(albumTaxonomyUpdated.mock.calls[0].arguments, [
      'user-1',
      'album-1',
      taxonomyUpdatedAt,
    ]);
  });

  it('markDistinct should resolve string user _id to numeric created_by', async () => {
    const pool = {
      query: mock.fn(async (sql, params) => {
        if (sql.includes('SELECT id FROM users WHERE _id = $1')) {
          assert.deepStrictEqual(params, ['user-cuid-123']);
          return { rows: [{ id: 77 }], rowCount: 1 };
        }

        if (sql.includes('INSERT INTO album_distinct_pairs')) {
          assert.deepStrictEqual(params, ['album-a', 'album-z', 77]);
          return { rows: [], rowCount: 1 };
        }

        return { rows: [], rowCount: 0 };
      }),
      connect: mock.fn(async () => ({
        query: mock.fn(async () => ({ rows: [], rowCount: 0 })),
        release: mock.fn(),
      })),
    };
    pool.raw = pool.query;

    const service = createAlbumService({
      db: pool,
      logger: createMockLogger(),
      upsertAlbumRecord: mock.fn(),
    });

    await service.markDistinct('album-z', 'album-a', 'user-cuid-123');

    assert.strictEqual(pool.query.mock.calls.length, 2);
  });

  it('markDistinct should fall back to null created_by when user is unknown', async () => {
    const pool = {
      query: mock.fn(async (sql, params) => {
        if (sql.includes('SELECT id FROM users WHERE _id = $1')) {
          assert.deepStrictEqual(params, ['missing-user']);
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes('INSERT INTO album_distinct_pairs')) {
          assert.deepStrictEqual(params, ['album-1', 'album-2', null]);
          return { rows: [], rowCount: 1 };
        }

        return { rows: [], rowCount: 0 };
      }),
      connect: mock.fn(async () => ({
        query: mock.fn(async () => ({ rows: [], rowCount: 0 })),
        release: mock.fn(),
      })),
    };
    pool.raw = pool.query;

    const service = createAlbumService({
      db: pool,
      logger: createMockLogger(),
      upsertAlbumRecord: mock.fn(),
    });

    await service.markDistinct('album-1', 'album-2', 'missing-user');

    assert.strictEqual(pool.query.mock.calls.length, 2);
  });

  it('updateCoverImage should process and store an explicit cover replacement', async () => {
    const updatedAt = new Date('2026-05-11T10:20:34.794Z');
    const thumbnailUpdatedAt = new Date('2026-05-11T10:20:35.794Z');
    const responseCache = { invalidate: mock.fn() };
    const albumMetadataUpdated = mock.fn();
    const pool = createMockPool([
      {
        rows: [
          {
            album_id: 'album-1',
            cover_image_updated_at: updatedAt,
            cover_thumbnail_updated_at: thumbnailUpdatedAt,
          },
        ],
        rowCount: 1,
      },
      { rows: [{ user_id: 'user-1' }], rowCount: 1 },
    ]);

    const service = createAlbumService({
      db: pool,
      logger: createMockLogger(),
      upsertAlbumRecord: mock.fn(),
      responseCache,
      broadcast: { albumMetadataUpdated },
    });

    const result = await service.updateCoverImage(
      'album-1',
      PNG_1X1_BASE64,
      'user-1'
    );

    assert.strictEqual(result.albumId, 'album-1');
    assert.strictEqual(result.format, 'JPEG');
    assert.strictEqual(result.coverImageUpdatedAt, updatedAt);
    assert.strictEqual(result.coverThumbnailUpdatedAt, thumbnailUpdatedAt);
    assert.strictEqual(result.thumbnailFormat, 'JPEG');
    assert.strictEqual(pool.query.mock.calls.length, 2);
    assert.ok(
      pool.query.mock.calls[0].arguments[0].includes(
        'cover_image_updated_at = NOW()'
      )
    );
    assert.ok(Buffer.isBuffer(pool.query.mock.calls[0].arguments[1][0]));
    assert.ok(Buffer.isBuffer(pool.query.mock.calls[0].arguments[1][2]));
    assert.ok(
      pool.query.mock.calls[0].arguments[0].includes(
        'cover_thumbnail_updated_at = NOW()'
      )
    );
    assert.strictEqual(responseCache.invalidate.mock.calls.length, 1);
    assert.match(
      albumMetadataUpdated.mock.calls[0].arguments[2].cover_image_url,
      /\/api\/albums\/album-1\/cover\?v=/
    );
  });

  it('updates a source observation only while the user still owns the album', async () => {
    const apply = mock.fn(async () => ({
      result: { albumId: 'album-1', status: 'applied' },
      warnings: [],
    }));
    const pool = createMockPool([
      { rows: [], rowCount: 0 },
      { rows: [{ _id: 'item-1' }], rowCount: 1 },
      { rows: [], rowCount: 0 },
      { rows: [{ user_id: 'user-1' }], rowCount: 1 },
    ]);
    const responseCache = { invalidate: mock.fn() };
    const service = createAlbumService({
      db: pool,
      logger: createMockLogger(),
      upsertAlbumRecord: mock.fn(),
      responseCache,
      sourceObservationService: { apply },
    });
    const observation = { schemaVersion: 1 };

    const result = await service.updateSourceObservation(
      'album-1',
      observation,
      'user-1'
    );

    assert.strictEqual(result.result.status, 'applied');
    assert.strictEqual(apply.mock.calls.length, 1);
    assert.strictEqual(apply.mock.calls[0].arguments[1], 'album-1');
    assert.strictEqual(apply.mock.calls[0].arguments[2], observation);
    assert.strictEqual(responseCache.invalidate.mock.calls.length, 1);
    assert.ok(
      pool.query.mock.calls[1].arguments[0].includes('FOR SHARE OF li')
    );
  });

  it('does not apply a delayed observation after list membership is removed', async () => {
    const apply = mock.fn();
    const pool = createMockPool([
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
    ]);
    const service = createAlbumService({
      db: pool,
      logger: createMockLogger(),
      upsertAlbumRecord: mock.fn(),
      sourceObservationService: { apply },
    });

    await assert.rejects(
      () => service.updateSourceObservation('album-1', {}, 'user-1'),
      (error) => error instanceof TransactionAbort && error.statusCode === 404
    );
    assert.strictEqual(apply.mock.calls.length, 0);
  });

  it('broadcasts availability added by a delayed source observation', async () => {
    const apply = mock.fn(async () => ({
      result: {
        albumId: 'album-1',
        status: 'applied',
        providerHints: ['spotify'],
      },
      warnings: [],
    }));
    const pool = createMockPool([
      { rows: [], rowCount: 0 },
      { rows: [{ _id: 'item-1' }], rowCount: 1 },
      { rows: [], rowCount: 0 },
      { rows: [{ user_id: 'user-1' }], rowCount: 1 },
      {
        rows: [
          {
            user_id: 'user-1',
            availability: ['spotify'],
            availability_links: [
              {
                service: 'spotify',
                url: 'https://open.spotify.com/album/1',
              },
            ],
          },
        ],
        rowCount: 1,
      },
    ]);
    const albumAvailabilityUpdated = mock.fn();
    const service = createAlbumService({
      db: pool,
      logger: createMockLogger(),
      upsertAlbumRecord: mock.fn(),
      responseCache: { invalidate: mock.fn() },
      sourceObservationService: { apply },
      broadcast: { albumAvailabilityUpdated },
    });

    await service.updateSourceObservation('album-1', {}, 'user-1');

    assert.deepStrictEqual(albumAvailabilityUpdated.mock.calls[0].arguments, [
      'user-1',
      'album-1',
      ['spotify'],
      [
        {
          service: 'spotify',
          url: 'https://open.spotify.com/album/1',
        },
      ],
    ]);
  });

  it('updateCoverImage should reject invalid cover payloads', async () => {
    const pool = createMockPool();
    const service = createAlbumService({
      db: pool,
      logger: createMockLogger(),
      upsertAlbumRecord: mock.fn(),
    });

    await assert.rejects(
      () => service.updateCoverImage('album-1', '', 'user-1'),
      (err) => {
        assert.ok(err instanceof TransactionAbort);
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.body.error, 'cover_image is required');
        return true;
      }
    );
    assert.strictEqual(pool.query.mock.calls.length, 0);
  });
});
