const { describe, it, mock } = require('node:test');
const assert = require('node:assert');

const { createListService } = require('../services/list-service');
const { TransactionAbort } = require('../db/transaction');
const { createMockLogger } = require('./helpers');

function createServiceDeps(pool) {
  return {
    pool,
    logger: createMockLogger(),
    listsAsync: {
      find: mock.fn(async () => []),
      findWithCounts: mock.fn(async () => []),
      findAllUserListsWithItems: mock.fn(async () => []),
    },
    listItemsAsync: {
      count: mock.fn(async () => 0),
      findWithAlbumData: mock.fn(async () => []),
    },
    crypto: { randomBytes: () => Buffer.from('123456789012') },
    validateYear: () => ({ valid: true, value: 2024 }),
    helpers: {
      upsertAlbumRecord: mock.fn(),
      batchUpsertAlbumRecords: mock.fn(),
      findOrCreateYearGroup: mock.fn(),
      findOrCreateUncategorizedGroup: mock.fn(),
      deleteGroupIfEmptyAutoGroup: mock.fn(),
    },
    getPointsForPosition: mock.fn(() => 100),
    refreshPlaycountsInBackground: mock.fn(),
  };
}

function createOwnedListRow() {
  return {
    id: 1,
    _id: 'list1',
    user_id: 'user1',
    name: 'My List',
    year: 2024,
    is_main: false,
    group_id: 10,
    group_external_id: 'group1',
    group_name: '2024',
    group_year: 2024,
    sort_order: 0,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

describe('list-service reorderItems', () => {
  it('should reject partial order payloads', async () => {
    const client = {
      query: mock.fn(async (sql) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }

        if (
          sql.includes(
            'SELECT _id, album_id FROM list_items WHERE list_id = $1'
          )
        ) {
          return {
            rows: [
              { _id: 'item1', album_id: 'album1' },
              { _id: 'item2', album_id: 'album2' },
            ],
          };
        }

        if (sql.includes('UPDATE list_items')) {
          return { rows: [], rowCount: 2 };
        }

        throw new Error(`Unexpected query: ${sql}`);
      }),
      release: mock.fn(),
    };

    const pool = {
      query: mock.fn(async (sql) => {
        if (sql.includes('FROM lists l') && sql.includes('WHERE l._id = $1')) {
          return {
            rows: [createOwnedListRow()],
          };
        }

        throw new Error(`Unexpected pool query: ${sql}`);
      }),
      connect: mock.fn(async () => client),
    };

    const service = createListService(createServiceDeps(pool));

    await assert.rejects(
      () => service.reorderItems('list1', 'user1', ['album1']),
      (err) => {
        assert.ok(err instanceof TransactionAbort);
        assert.strictEqual(err.statusCode, 400);
        assert.match(err.body.error, /include all list items exactly once/i);
        return true;
      }
    );
  });

  it('should reorder by album IDs using resolved item IDs', async () => {
    let updateParams = null;

    const client = {
      query: mock.fn(async (sql, params) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }

        if (
          sql.includes(
            'SELECT _id, album_id FROM list_items WHERE list_id = $1'
          )
        ) {
          return {
            rows: [
              { _id: 'item1', album_id: 'album1' },
              { _id: 'item2', album_id: 'album2' },
            ],
          };
        }

        if (sql.includes('UPDATE list_items')) {
          updateParams = params;
          return { rows: [], rowCount: 2 };
        }

        throw new Error(`Unexpected query: ${sql}`);
      }),
      release: mock.fn(),
    };

    const pool = {
      query: mock.fn(async (sql) => {
        if (sql.includes('FROM lists l') && sql.includes('WHERE l._id = $1')) {
          return {
            rows: [createOwnedListRow()],
          };
        }

        throw new Error(`Unexpected pool query: ${sql}`);
      }),
      connect: mock.fn(async () => client),
    };

    const service = createListService(createServiceDeps(pool));
    const result = await service.reorderItems('list1', 'user1', [
      'album2',
      'album1',
    ]);

    assert.strictEqual(result.itemCount, 2);
    assert.deepStrictEqual(updateParams[1], ['item2', 'item1']);
    assert.deepStrictEqual(updateParams[2], [1, 2]);
  });
});

describe('list-service item comments', () => {
  it('should update comment using album identifier', async () => {
    let executedUpdateSql = '';

    const client = {
      query: mock.fn(async (sql) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes('UPDATE list_items SET comments = $1')) {
          executedUpdateSql = sql;
          return { rows: [{ _id: 'item1' }], rowCount: 1 };
        }

        throw new Error(`Unexpected query: ${sql}`);
      }),
      release: mock.fn(),
    };

    const pool = {
      query: mock.fn(async (sql) => {
        if (sql.includes('FROM lists l') && sql.includes('WHERE l._id = $1')) {
          return {
            rows: [createOwnedListRow()],
          };
        }

        throw new Error(`Unexpected pool query: ${sql}`);
      }),
      connect: mock.fn(async () => client),
    };

    const service = createListService(createServiceDeps(pool));
    await service.updateItemComment('list1', 'user1', 'album1', 'Great album');

    assert.ok(executedUpdateSql.includes('SET comments = $1'));
    assert.strictEqual(client.query.mock.calls.length, 3);
  });

  it('should fallback to item id for comment 2 updates', async () => {
    const updateQueries = [];

    const client = {
      query: mock.fn(async (sql) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes('UPDATE list_items SET comments_2 = $1')) {
          updateQueries.push(sql);
          if (updateQueries.length === 1) {
            return { rows: [], rowCount: 0 };
          }
          return { rows: [{ _id: 'item1' }], rowCount: 1 };
        }

        throw new Error(`Unexpected query: ${sql}`);
      }),
      release: mock.fn(),
    };

    const pool = {
      query: mock.fn(async (sql) => {
        if (sql.includes('FROM lists l') && sql.includes('WHERE l._id = $1')) {
          return {
            rows: [createOwnedListRow()],
          };
        }

        throw new Error(`Unexpected pool query: ${sql}`);
      }),
      connect: mock.fn(async () => client),
    };

    const service = createListService(createServiceDeps(pool));
    await service.updateItemComment2('list1', 'user1', 'item1', 'Second note');

    assert.strictEqual(updateQueries.length, 2);
    assert.ok(
      updateQueries[0].includes('WHERE list_id = $3 AND album_id = $4')
    );
    assert.ok(updateQueries[1].includes('WHERE _id = $3 AND list_id = $4'));
    assert.strictEqual(client.query.mock.calls.length, 4);
  });
});

describe('list-service fetchers and setup status', () => {
  it('should return list metadata with counts', async () => {
    const pool = {
      query: mock.fn(async (sql) => {
        throw new Error(`Unexpected pool query: ${sql}`);
      }),
      connect: mock.fn(),
    };

    const deps = createServiceDeps(pool);
    deps.listsAsync.find = mock.fn(async () => []);
    deps.listsAsync.findWithCounts = mock.fn(async () => [
      {
        _id: 'list1',
        name: 'My List',
        year: 2024,
        isMain: true,
        itemCount: 42,
        group: { _id: 'group1' },
        sortOrder: 0,
        updatedAt: 'updated',
        createdAt: 'created',
      },
    ]);

    const service = createListService(deps);
    const result = await service.getAllLists('user1', { full: false });

    assert.deepStrictEqual(result.list1, {
      _id: 'list1',
      name: 'My List',
      year: 2024,
      isMain: true,
      count: 42,
      groupId: 'group1',
      sortOrder: 0,
      updatedAt: 'updated',
      createdAt: 'created',
    });
  });

  it('should compute setup status for missing year and missing main list', async () => {
    const pool = {
      query: mock.fn(async () => ({
        rows: [
          {
            _id: 'list1',
            name: 'Main 2024',
            year: 2024,
            is_main: true,
            group_id: null,
            group_year: null,
          },
          {
            _id: 'list2',
            name: 'No Main 2023',
            year: 2023,
            is_main: false,
            group_id: null,
            group_year: null,
          },
          {
            _id: 'list3',
            name: 'Needs Year',
            year: null,
            is_main: false,
            group_id: 9,
            group_year: 2022,
          },
        ],
      })),
      connect: mock.fn(),
    };

    const service = createListService(createServiceDeps(pool));
    const result = await service.getSetupStatus('user1', {
      listSetupDismissedUntil: '2026-01-01',
    });

    assert.strictEqual(result.needsSetup, true);
    assert.deepStrictEqual(result.listsWithoutYear, [
      { id: 'list3', name: 'Needs Year' },
    ]);
    assert.deepStrictEqual(result.yearsNeedingMain, [2023]);
    assert.strictEqual(result.dismissedUntil, '2026-01-01');
  });

  it('should return mapped list items with recommendation metadata', async () => {
    const pool = {
      query: mock.fn(async (sql) => {
        if (sql.includes('FROM recommendations r')) {
          return {
            rows: [
              {
                year: 2024,
                album_id: 'album1',
                created_at: '2025-01-01',
                recommended_by: 'alice',
              },
            ],
          };
        }

        if (sql.includes('FROM lists l') && sql.includes('WHERE l._id = $1')) {
          return { rows: [createOwnedListRow()] };
        }

        throw new Error(`Unexpected pool query: ${sql}`);
      }),
      connect: mock.fn(),
    };

    const deps = createServiceDeps(pool);
    deps.listItemsAsync.findWithAlbumData = mock.fn(async () => [
      {
        _id: 'item1',
        artist: 'Artist',
        album: 'Album',
        albumId: 'album1',
        releaseDate: '2024-01-01',
        country: 'NO',
        genre1: 'Metal',
        genre2: 'Prog',
        primaryTrack: 'Track',
        secondaryTrack: null,
        comments: '',
        comments2: '',
        tracks: null,
        coverImageFormat: 'jpeg',
        summary: '',
        summarySource: '',
      },
    ]);

    const service = createListService(deps);
    const result = await service.getListById('list1', 'user1');

    assert.strictEqual(
      result.items[0].cover_image_url,
      '/api/albums/album1/cover'
    );
    assert.strictEqual(result.items[0].recommended_by, 'alice');
    assert.strictEqual(result.items[0].recommended_at, '2025-01-01');
  });
});
