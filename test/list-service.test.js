const { describe, it, mock } = require('node:test');
const assert = require('node:assert');

const { createListService } = require('../services/list-service');
const { TransactionAbort } = require('../db/transaction');
const { createMockLogger, asMockDb } = require('./helpers');

function createServiceDeps(pool) {
  const db = asMockDb(pool);
  return {
    db,
    logger: createMockLogger(),
    listsAsync: {
      find: mock.fn(async () => []),
      findWithCounts: mock.fn(async () => []),
      findAllUserListsWithItems: mock.fn(async () => []),
      // raw() — shares the pool.query mock so existing poolQuery assertions work.
      raw: mock.fn((sql, params) => pool.query(sql, params)),
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

function createSingleListItemRow(overrides = {}) {
  return {
    list_internal_id: 1,
    list_external_id: 'list1',
    list_user_id: 'user1',
    list_name: 'My List',
    list_year: 2024,
    list_is_main: false,
    list_group_id: 10,
    group_external_id: 'group1',
    group_name: '2024',
    group_year: 2024,
    list_sort_order: 0,
    list_created_at: 'created',
    list_updated_at: 'updated',
    _id: 'item1',
    list_id: 'list1',
    position: 1,
    comments: '',
    comments_2: '',
    album_id: 'album1',
    primary_track: 'Track',
    secondary_track: null,
    artist: 'Artist',
    album: 'Album',
    release_date: '2024-01-01',
    country: 'NO',
    genre_1: 'Metal',
    genre_2: 'Prog',
    tracks: ['Track'],
    cover_image_format: 'jpeg',
    cover_image_updated_at: null,
    cover_thumbnail_updated_at: null,
    summary: 'Summary',
    summary_source: 'musicbrainz',
    availability: ['spotify'],
    recommended_by: 'alice',
    recommended_at: '2025-01-01',
    ...overrides,
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

  it('should reject non-string entries in order payload', async () => {
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
      () =>
        service.reorderItems('list1', 'user1', [{ _id: 'item1' }, 'album2']),
      (err) => {
        assert.ok(err instanceof TransactionAbort);
        assert.strictEqual(err.statusCode, 400);
        assert.match(err.body.error, /invalid entries/i);
        return true;
      }
    );
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
    assert.strictEqual(client.query.mock.calls.length, 4);
  });

  it('should reject comment 2 updates with non-album identifiers', async () => {
    const updateQueries = [];

    const client = {
      query: mock.fn(async (sql) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes('UPDATE list_items SET comments_2 = $1')) {
          updateQueries.push(sql);
          return { rows: [], rowCount: 0 };
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
      () =>
        service.updateItemComment2('list1', 'user1', 'item1', 'Second note'),
      (err) => {
        assert.ok(err instanceof TransactionAbort);
        assert.strictEqual(err.statusCode, 404);
        assert.strictEqual(err.body.error, 'Album not found in list');
        return true;
      }
    );

    assert.strictEqual(updateQueries.length, 1);
    assert.ok(
      updateQueries[0].includes('WHERE list_id = $3 AND album_id = $4')
    );
    assert.strictEqual(client.query.mock.calls.length, 4);
  });
});

describe('list-service fetchers and setup status', () => {
  it('should return list metadata with counts', async () => {
    const pool = {
      query: mock.fn(async (sql) => {
        if (sql.includes('COUNT(li._id) AS item_count')) {
          return {
            rows: [
              {
                _id: 'list1',
                name: 'My List',
                year: 2024,
                is_main: true,
                item_count: '42',
                group_external_id: 'group1',
                sort_order: 0,
                updated_at: 'updated',
                created_at: 'created',
              },
            ],
          };
        }

        throw new Error(`Unexpected pool query: ${sql}`);
      }),
      connect: mock.fn(),
    };

    const deps = createServiceDeps(pool);

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

  it('should return lightweight album presence rows for extension badges', async () => {
    let executedSql = '';
    let executedParams = null;
    const pool = {
      query: mock.fn(async (sql, params) => {
        executedSql = sql;
        executedParams = params;

        return {
          rows: [
            {
              list_id: 'list1',
              list_name: '2024',
              year: 2024,
              album_id: 'album1',
              artist: 'Artist',
              album: 'Album',
            },
          ],
        };
      }),
      connect: mock.fn(),
    };

    const service = createListService(createServiceDeps(pool));
    const result = await service.getAlbumPresence('user1');

    assert.ok(executedSql.includes('JOIN list_items'));
    assert.ok(executedSql.includes('JOIN albums'));
    assert.ok(!executedSql.includes('tracks'));
    assert.deepStrictEqual(executedParams, ['user1']);
    assert.deepStrictEqual(result, [
      {
        listId: 'list1',
        listName: '2024',
        year: 2024,
        albumId: 'album1',
        artist: 'Artist',
        album: 'Album',
      },
    ]);
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
    let executedSql = '';
    let executedParams = null;
    const pool = {
      query: mock.fn(async (sql, params) => {
        if (sql.includes('WITH target_list AS')) {
          executedSql = sql;
          executedParams = params;
          return { rows: [createSingleListItemRow()] };
        }

        throw new Error(`Unexpected pool query: ${sql}`);
      }),
      connect: mock.fn(),
    };

    const service = createListService(createServiceDeps(pool));
    const result = await service.getListById('list1', 'user1');

    assert.strictEqual(
      result.items[0].cover_image_url,
      '/api/albums/album1/cover'
    );
    assert.strictEqual(result.items[0].recommended_by, 'alice');
    assert.strictEqual(result.items[0].recommended_at, '2025-01-01');
    assert.deepStrictEqual(result.items[0].availability, ['spotify']);
    assert.ok(executedSql.includes('LEFT JOIN availability av'));
    assert.ok(executedSql.includes('LEFT JOIN recommendations r'));
    assert.strictEqual(executedParams.length, 3);
  });

  it('should fetch core list items with availability but no other detail joins', async () => {
    let executedSql = '';
    let executedParams = null;
    const pool = {
      query: mock.fn(async (sql, params) => {
        if (sql.includes('WITH target_list AS')) {
          executedSql = sql;
          executedParams = params;
          return {
            rows: [
              createSingleListItemRow({
                tracks: null,
                summary: '',
                summary_source: '',
                availability: ['spotify'],
                recommended_by: null,
                recommended_at: null,
              }),
            ],
          };
        }

        throw new Error(`Unexpected pool query: ${sql}`);
      }),
      connect: mock.fn(),
    };

    const service = createListService(createServiceDeps(pool));
    const result = await service.getListById('list1', 'user1', {
      profile: 'core',
    });

    assert.strictEqual(result.items[0].tracks, null);
    // Availability ships in the core profile (like the cover URL) so badges
    // render on the first paint instead of waiting for the detail hydrate.
    assert.deepStrictEqual(result.items[0].availability, ['spotify']);
    assert.strictEqual(result.items[0].recommended_by, null);
    assert.ok(executedSql.includes('NULL AS tracks'));
    assert.ok(executedSql.includes('LEFT JOIN availability av'));
    assert.ok(!executedSql.includes('LEFT JOIN recommendations r'));
    assert.strictEqual(executedParams.length, 3);
  });
});

describe('list-service management operations', () => {
  it('bulkUpdate should reject invalid year updates', async () => {
    const client = {
      query: mock.fn(async (sql) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes('SELECT _id, year, is_main FROM lists')) {
          return { rows: [{ _id: 'list1', year: 2024, is_main: false }] };
        }

        throw new Error(`Unexpected query: ${sql}`);
      }),
      release: mock.fn(),
    };

    const pool = {
      query: mock.fn(async (sql) => {
        if (sql.includes('SELECT locked FROM master_lists')) {
          return { rows: [{ locked: false }] };
        }

        throw new Error(`Unexpected pool query: ${sql}`);
      }),
      connect: mock.fn(async () => client),
    };

    const service = createListService(createServiceDeps(pool));
    const result = await service.bulkUpdate('user1', [
      { listId: 'list1', year: 999, isMain: false },
    ]);

    assert.strictEqual(result.results[0].success, false);
    assert.strictEqual(result.results[0].error, 'Invalid year');
  });

  it('updateListMetadata should reject empty updates', async () => {
    const client = {
      query: mock.fn(async (sql) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes('FROM lists l') && sql.includes('WHERE l._id = $1')) {
          return {
            rows: [
              {
                id: 1,
                _id: 'list1',
                name: 'My List',
                year: 2024,
                group_id: 10,
                is_main: false,
                group_year: 2024,
              },
            ],
          };
        }

        throw new Error(`Unexpected query: ${sql}`);
      }),
      release: mock.fn(),
    };

    const pool = {
      query: mock.fn(async (sql) => {
        if (sql.includes('SELECT locked FROM master_lists')) {
          return { rows: [{ locked: false }] };
        }

        throw new Error(`Unexpected pool query: ${sql}`);
      }),
      connect: mock.fn(async () => client),
    };

    const service = createListService(createServiceDeps(pool));

    await assert.rejects(
      () => service.updateListMetadata('list1', 'user1', {}),
      (err) => {
        assert.ok(err instanceof TransactionAbort);
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.body.error, 'No updates provided');
        return true;
      }
    );
  });

  it('toggleMainStatus should unset main when requested', async () => {
    const client = {
      query: mock.fn(async (sql) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes('FROM lists l') && sql.includes('WHERE l._id = $1')) {
          return {
            rows: [
              {
                id: 1,
                _id: 'list1',
                name: 'My List',
                year: 2024,
                is_main: true,
                group_year: 2024,
              },
            ],
          };
        }

        if (sql.includes('UPDATE lists SET is_main = FALSE')) {
          return { rows: [], rowCount: 1 };
        }

        throw new Error(`Unexpected query: ${sql}`);
      }),
      release: mock.fn(),
    };

    const pool = {
      query: mock.fn(async (sql) => {
        if (sql.includes('SELECT locked FROM master_lists')) {
          return { rows: [{ locked: false }] };
        }

        throw new Error(`Unexpected pool query: ${sql}`);
      }),
      connect: mock.fn(async () => client),
    };

    const service = createListService(createServiceDeps(pool));
    const result = await service.toggleMainStatus('list1', 'user1', false);

    assert.strictEqual(result.isRemoval, true);
    assert.strictEqual(result.year, 2024);
  });

  it('deleteList should block deletion of main list', async () => {
    const client = {
      query: mock.fn(async (sql) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes('SELECT id, _id, name, year, group_id, is_main')) {
          return {
            rows: [
              {
                id: 1,
                _id: 'list1',
                name: 'Main List',
                year: 2024,
                group_id: 10,
                is_main: true,
              },
            ],
          };
        }

        throw new Error(`Unexpected query: ${sql}`);
      }),
      release: mock.fn(),
    };

    const pool = {
      query: mock.fn(async (sql) => {
        throw new Error(`Unexpected pool query: ${sql}`);
      }),
      connect: mock.fn(async () => client),
    };

    const service = createListService(createServiceDeps(pool));

    await assert.rejects(
      () => service.deleteList('list1', 'user1'),
      (err) => {
        assert.ok(err instanceof TransactionAbort);
        assert.strictEqual(err.statusCode, 403);
        assert.match(err.body.error, /cannot delete main list/i);
        return true;
      }
    );
  });
});

describe('list-service write operations', () => {
  it('createList should create an uncategorized list without albums', async () => {
    const client = {
      query: mock.fn(async (sql) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }

        if (sql.startsWith('SELECT 1 FROM lists WHERE user_id = $1')) {
          return { rows: [] };
        }

        if (sql.includes('SELECT COALESCE(MAX(sort_order), -1) + 1')) {
          return { rows: [{ next_order: 3 }] };
        }

        if (sql.startsWith('INSERT INTO lists')) {
          return { rows: [], rowCount: 1 };
        }

        throw new Error(`Unexpected query: ${sql}`);
      }),
      release: mock.fn(),
    };

    const pool = {
      query: mock.fn(async (sql) => {
        throw new Error(`Unexpected pool query: ${sql}`);
      }),
      connect: mock.fn(async () => client),
    };

    const deps = createServiceDeps(pool);
    deps.helpers.findOrCreateUncategorizedGroup = mock.fn(async () => 42);

    const service = createListService(deps);
    const result = await service.createList('user1', { name: 'New List' });

    assert.strictEqual(result.name, 'New List');
    assert.strictEqual(result.year, null);
    assert.strictEqual(result.count, 0);
    assert.strictEqual(result.groupId, null);
    assert.strictEqual(
      deps.helpers.findOrCreateUncategorizedGroup.mock.calls.length,
      1
    );
  });

  it('incrementalUpdate should handle empty changes with zero updates', async () => {
    const client = {
      query: mock.fn(async (sql) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes('SELECT locked FROM master_lists')) {
          return { rows: [] };
        }

        if (sql.startsWith('UPDATE lists SET updated_at = $1 WHERE _id = $2')) {
          return { rows: [], rowCount: 1 };
        }

        throw new Error(`Unexpected query: ${sql}`);
      }),
      release: mock.fn(),
    };

    const pool = {
      query: mock.fn(async (sql) => {
        if (sql.includes('FROM lists l') && sql.includes('WHERE l._id = $1')) {
          return { rows: [createOwnedListRow()] };
        }

        throw new Error(`Unexpected pool query: ${sql}`);
      }),
      connect: mock.fn(async () => client),
    };

    const deps = createServiceDeps(pool);
    const service = createListService(deps);

    const result = await service.incrementalUpdate(
      'list1',
      'user1',
      { added: [], removed: [], updated: [] },
      { _id: 'user1', lastfmUsername: 'listener' }
    );

    assert.strictEqual(result.changeCount, 0);
    assert.deepStrictEqual(result.addedItems, []);
    assert.deepStrictEqual(result.duplicateAlbums, []);
    assert.strictEqual(result.list._id, 'list1');
  });

  it('incrementalUpdate triggers album background fetches after commit', async () => {
    const events = [];
    const client = {
      query: mock.fn(async (sql) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          events.push(sql);
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes('SELECT locked FROM master_lists')) {
          return { rows: [] };
        }

        if (sql.includes('FROM lists l') && sql.includes('WHERE l._id = $1')) {
          return { rows: [createOwnedListRow()] };
        }

        if (sql.includes('COALESCE(MAX(position), 0)')) {
          return { rows: [{ max_pos: 0 }] };
        }

        if (sql.includes('FROM list_items')) {
          return { rows: [] };
        }

        if (sql.includes('INSERT INTO list_items')) {
          return { rows: [], rowCount: 1 };
        }

        if (sql.startsWith('UPDATE lists SET updated_at = $1 WHERE _id = $2')) {
          return { rows: [], rowCount: 1 };
        }

        throw new Error(`Unexpected query: ${sql}`);
      }),
      release: mock.fn(),
    };

    const pool = {
      query: mock.fn(async (sql) => {
        throw new Error(`Unexpected pool query: ${sql}`);
      }),
      connect: mock.fn(async () => client),
    };

    const deps = createServiceDeps(pool);
    deps.helpers.batchUpsertAlbumRecords = mock.fn(
      async () =>
        new Map([
          [
            'Panopticon|Det Hjemsokte Hjertet',
            {
              albumId: '01ce764b-626f-43a7-b73a-378bcb4c03ea',
              needsCoverFetch: true,
            },
          ],
        ])
    );
    deps.helpers.triggerAlbumBackgroundFetches = mock.fn(() => {
      events.push('background-fetches');
    });

    const service = createListService(deps);
    const result = await service.incrementalUpdate(
      'list1',
      'user1',
      {
        added: [
          {
            artist: 'Panopticon',
            album: 'Det Hjemsokte Hjertet',
            album_id: '01ce764b-626f-43a7-b73a-378bcb4c03ea',
          },
        ],
        removed: [],
        updated: [],
      },
      { _id: 'user1' }
    );

    assert.strictEqual(result.changeCount, 1);
    assert.deepStrictEqual(events.slice(-2), ['COMMIT', 'background-fetches']);
    assert.deepStrictEqual(
      deps.helpers.triggerAlbumBackgroundFetches.mock.calls[0].arguments[0],
      [
        {
          album_id: '01ce764b-626f-43a7-b73a-378bcb4c03ea',
          _id: '313233343536373839303132',
          artist: 'Panopticon',
          album: 'Det Hjemsokte Hjertet',
        },
      ]
    );
  });
});
