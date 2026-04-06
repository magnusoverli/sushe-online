const { describe, it, mock } = require('node:test');
const assert = require('node:assert');

const { createListService } = require('../services/list-service');
const { TransactionAbort } = require('../db/transaction');
const { createMockLogger } = require('./helpers');

function createServiceDeps(pool) {
  return {
    pool,
    logger: createMockLogger(),
    listsAsync: {},
    listItemsAsync: {},
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
            rows: [
              {
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
              },
            ],
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
            rows: [
              {
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
              },
            ],
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
