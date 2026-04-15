const { describe, it, mock } = require('node:test');
const assert = require('node:assert');

const { createAlbumService } = require('../services/album-service');
const { TransactionAbort } = require('../db/transaction');
const { createMockLogger, createMockPool } = require('./helpers');

describe('album-service', () => {
  it('updateGenres should reject empty genre updates', async () => {
    const pool = createMockPool([{ rows: [{ album_id: 'a1' }] }]);

    const service = createAlbumService({
      pool,
      logger: createMockLogger(),
      upsertAlbumRecord: mock.fn(),
      invalidateCachesForAlbumUsers: mock.fn(async () => {}),
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

    const service = createAlbumService({
      pool,
      logger: createMockLogger(),
      upsertAlbumRecord: mock.fn(),
      invalidateCachesForAlbumUsers: mock.fn(async () => {}),
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

    const service = createAlbumService({
      pool,
      logger: createMockLogger(),
      upsertAlbumRecord: mock.fn(),
      invalidateCachesForAlbumUsers: mock.fn(async () => {}),
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

    const service = createAlbumService({
      pool,
      logger: createMockLogger(),
      upsertAlbumRecord: mock.fn(),
      invalidateCachesForAlbumUsers: mock.fn(async () => {}),
    });

    await service.markDistinct('album-1', 'album-2', 'missing-user');

    assert.strictEqual(pool.query.mock.calls.length, 2);
  });
});
