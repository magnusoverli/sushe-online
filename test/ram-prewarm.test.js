const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const { createMockLogger } = require('./helpers');
const {
  coverVersion,
  runRamPrewarm,
  selectActiveUserIds,
  selectCoverWarmTargets,
  warmCoverCache,
  warmUserResponses,
} = require('../services/startup/ram-prewarm');

describe('ram-prewarm', () => {
  it('computes cover version from updated timestamp when available', () => {
    assert.strictEqual(
      coverVersion({
        coverImageUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
        coverLength: 123,
      }),
      1767225600000
    );
    assert.strictEqual(coverVersion({ coverLength: 123 }), 123);
  });

  it('selects active users with the configured limit', async () => {
    const db = {
      raw: mock.fn(async (_sql, params) => {
        assert.deepStrictEqual(params, [2]);
        return { rows: [{ _id: 'u1' }, { _id: 'u2' }] };
      }),
    };

    assert.deepStrictEqual(await selectActiveUserIds(db, 2), ['u1', 'u2']);
  });

  it('does not query cover targets without users or limit', async () => {
    const db = { raw: mock.fn() };

    assert.deepStrictEqual(await selectCoverWarmTargets(db, [], 100), []);
    assert.deepStrictEqual(await selectCoverWarmTargets(db, ['u1'], 0), []);
    assert.strictEqual(db.raw.mock.calls.length, 0);
  });

  it('warms user response-cache entries', async () => {
    const responseCache = { set: mock.fn() };
    const listService = {
      getAllLists: mock.fn(async (_userId, options = {}) =>
        options.full ? { full: true } : { metadata: true }
      ),
    };
    const groupService = {
      getGroups: mock.fn(async () => [{ name: 'Group' }]),
    };
    const recommendationService = { getYears: mock.fn(async () => [2026]) };

    const result = await warmUserResponses({
      userIds: ['u1'],
      listService,
      groupService,
      recommendationService,
      responseCache,
      logger: createMockLogger(),
    });

    assert.strictEqual(result.users, 1);
    assert.strictEqual(responseCache.set.mock.calls.length, 3);
    assert.strictEqual(
      responseCache.set.mock.calls[0].arguments[0],
      'GET:/api/lists:u1'
    );
    assert.strictEqual(
      responseCache.set.mock.calls[2].arguments[0],
      'GET:/api/app-bootstrap:u1'
    );
  });

  it('warms thumbnail cover cache through album service', async () => {
    const albumService = {
      getCoverMeta: mock.fn(async () => ({
        albumId: 'a1',
        contentType: 'image/jpeg',
        coverImageUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
        coverLength: 5,
      })),
      getCachedCover: mock.fn(() => null),
      getCoverImage: mock.fn(async () => ({
        imageBuffer: Buffer.from('cover'),
      })),
      cacheCover: mock.fn(() => true),
    };

    const result = await warmCoverCache({
      albumService,
      coverTargets: [{ album_id: 'a1' }],
      logger: createMockLogger(),
    });

    assert.strictEqual(result.covers, 1);
    assert.strictEqual(albumService.cacheCover.mock.calls.length, 1);
    assert.strictEqual(
      albumService.cacheCover.mock.calls[0].arguments[0],
      'a1'
    );
    assert.strictEqual(
      albumService.cacheCover.mock.calls[0].arguments[1].size,
      'thumb'
    );
  });

  it('does not count covers that are not retained in cache', async () => {
    const albumService = {
      getCoverMeta: mock.fn(async () => ({
        albumId: 'a1',
        contentType: 'image/jpeg',
        coverImageUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
        coverLength: 5,
      })),
      getCachedCover: mock.fn(() => null),
      getCoverImage: mock.fn(async () => ({
        imageBuffer: Buffer.from('cover'),
      })),
      cacheCover: mock.fn(() => false),
    };

    const result = await warmCoverCache({
      albumService,
      coverTargets: [{ album_id: 'a1' }],
      logger: createMockLogger(),
    });

    assert.strictEqual(result.covers, 0);
  });

  it('runs DB prewarm and skips app prewarm when disabled', async () => {
    const db = { raw: mock.fn() };
    const result = await runRamPrewarm({
      db,
      config: { dbPrewarmEnabled: false, appPrewarmEnabled: false },
      logger: createMockLogger(),
    });

    assert.strictEqual(result.db.skipped, true);
    assert.strictEqual(result.users, 0);
  });

  it('skips cover target queries when cover cache is disabled', async () => {
    let queriedCoverTargets = false;
    const db = {
      raw: mock.fn(async (sql) => {
        if (sql.includes('FROM users')) {
          return { rows: [{ _id: 'u1' }] };
        }
        if (sql.includes('FROM list_items')) {
          queriedCoverTargets = true;
        }
        return { rows: [] };
      }),
    };

    const result = await runRamPrewarm({
      db,
      config: {
        dbPrewarmEnabled: false,
        appPrewarmEnabled: true,
        coverCacheEnabled: false,
        appPrewarmUsersLimit: 1,
        appPrewarmCoversLimit: 10,
      },
      services: {
        listService: {
          getAllLists: mock.fn(async () => []),
        },
        groupService: {
          getGroups: mock.fn(async () => []),
        },
        recommendationService: {
          getYears: mock.fn(async () => []),
        },
        aggregateList: {
          get: mock.fn(),
          getStatus: mock.fn(),
        },
      },
      responseCache: { set: mock.fn() },
      logger: createMockLogger(),
    });

    assert.strictEqual(result.covers, 0);
    assert.strictEqual(queriedCoverTargets, false);
  });
});
