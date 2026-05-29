const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  createPlaycountSyncService,
  invalidateUserPlaycounts,
} = require('../services/playcount-sync-service');
const { createMockLogger, createMockPool } = require('./helpers');

describe('playcount-sync-service', () => {
  describe('getUsersNeedingSync', () => {
    it('should use set-based query with fresh and missing coverage CTEs', async () => {
      const pool = createMockPool([
        {
          rows: [
            {
              _id: 'u1',
              username: 'user1',
              lastfm_username: 'lastfm-user1',
            },
          ],
        },
      ]);

      const service = createPlaycountSyncService({
        db: pool,
        logger: createMockLogger(),
      });

      const users = await service.getUsersNeedingSync(10);
      assert.strictEqual(users.length, 1);

      const [query, params] = pool.query.mock.calls[0].arguments;
      assert.ok(query.includes('WITH fresh_users AS'));
      assert.ok(query.includes('users_with_missing_coverage AS'));
      assert.ok(query.includes('LEFT JOIN user_album_stats uas'));
      assert.ok(!query.includes('REGEXP_REPLACE'));
      assert.deepStrictEqual(params, [10, 24 * 60 * 60]);
    });

    it('should apply default limit when none is provided', async () => {
      const pool = createMockPool([{ rows: [] }]);

      const service = createPlaycountSyncService({
        db: pool,
        logger: createMockLogger(),
      });

      await service.getUsersNeedingSync();

      const params = pool.query.mock.calls[0].arguments[1];
      assert.strictEqual(params[0], 50);
      assert.strictEqual(params[1], 24 * 60 * 60);
    });
  });

  describe('invalidateUserPlaycounts', () => {
    it('deletes cached playcounts for one user', async () => {
      const pool = createMockPool([{ rows: [], rowCount: 3 }]);
      const logger = createMockLogger();

      const deleted = await invalidateUserPlaycounts(pool, logger, 'user1');

      assert.strictEqual(deleted, 3);
      const [query, params] = pool.query.mock.calls[0].arguments;
      assert.ok(query.includes('DELETE FROM user_album_stats'));
      assert.deepStrictEqual(params, ['user1']);
      assert.strictEqual(logger.info.mock.calls.length, 1);
    });
  });
});
