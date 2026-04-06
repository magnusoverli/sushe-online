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
});
