const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TransactionAbort } = require('../db/transaction');
const { bulkUpdate } = require('../services/list/management/bulk-update');
const { createYearLock } = require('../services/year-lock-service');
const {
  validateAndCompactOrder,
} = require('../services/list/write/validate-order');
const {
  createListWriteOperations,
  preserveDisqualificationState,
} = require('../services/list/write-operations');
const {
  withListTransaction,
  registerListMutationPublisher,
} = require('../services/list/transaction');

test('track-pick ownership reads reuse the transaction instead of acquiring a second pool connection', async () => {
  const {
    createListItemsRepository,
  } = require('../db/repositories/list-items-repository');
  const repository = createListItemsRepository({
    db: {
      raw: async () => {
        throw new Error('Second connection requested');
      },
    },
  });
  const owner = { list_item_id: 'item', list_id: 'list', user_id: 'owner' };
  const result = await repository.findItemWithOwner('item', {
    query: async () => ({ rows: [owner] }),
  });
  assert.deepEqual(result, owner);
});

test('setup wizard treats rejected bulk entries as failures instead of hiding unsaved changes', async () => {
  const { assertBulkUpdateResult } =
    await import('../src/js/modules/list-setup-wizard.js');
  assert.doesNotThrow(() =>
    assertBulkUpdateResult({ results: [{ success: true }] })
  );
  assert.throws(
    () =>
      assertBulkUpdateResult({
        results: [
          { success: true },
          { success: false, error: 'Year is locked' },
        ],
      }),
    /Year is locked/
  );
  assert.throws(
    () => assertBulkUpdateResult(undefined),
    /Invalid list update response/
  );
});

test('bulk move cannot change a main list in a locked source year', async () => {
  const checked = [];
  const writes = [];
  const client = {
    query: async (sql, params) => {
      if (sql.includes('SELECT _id, year, is_main'))
        return { rows: [{ _id: 'list', year: 2025, is_main: true }] };
      if (sql.includes('SELECT locked')) {
        checked.push(params[0]);
        return { rows: [{ locked: params[0] === 2025 }] };
      }
      if (sql.includes('UPDATE lists')) writes.push(sql);
      return { rows: [], rowCount: 0 };
    },
  };
  const lock = createYearLock();
  const outcome = await bulkUpdate(
    {
      db: { withTransaction: (fn) => fn(client) },
      acquireYearLocks: lock.acquireYearLocks,
      isYearLocked: lock.isYearLocked,
      TransactionAbort,
    },
    'owner',
    [{ listId: 'list', year: 2026 }]
  );
  assert.equal(outcome.results[0].success, false);
  assert.ok(checked.includes(2025));
  assert.equal(writes.length, 0);
});

test('final ordering rejects duplicate ranks and compacts deletion gaps', async () => {
  for (const positions of [
    [1, 1],
    [0, 2],
    [-1, 2],
    [1, 1.5],
  ]) {
    await assert.rejects(
      validateAndCompactOrder(
        {
          query: async () => ({
            rows: positions.map((position, index) => ({
              _id: String(index),
              position,
            })),
          }),
        },
        'list'
      ),
      (error) => error.statusCode === 409
    );
  }
  let compacted;
  await validateAndCompactOrder(
    {
      query: async (sql, params) => {
        if (sql.startsWith('SELECT'))
          return {
            rows: [
              { _id: 'a', position: 2 },
              { _id: 'b', position: 5 },
            ],
          };
        compacted = params;
        return { rowCount: 2 };
      },
    },
    'list'
  );
  assert.deepEqual(compacted, [['a', 'b'], [1, 2], 'list']);
});

test('replacement rejects stale or missing revisions before destructive SQL', async () => {
  const queries = [];
  const writes = createListWriteOperations({
    db: {
      withTransaction: (fn) =>
        fn({
          query: async (sql) => {
            queries.push(sql);
            return { rows: [] };
          },
        }),
    },
    TransactionAbort,
    crypto: {},
    managementOperations: {},
    itemOperations: {},
    findListByIdOrThrow: async () => ({ _id: 'list', revision: '7' }),
    findOrCreateYearGroup() {},
    findOrCreateUncategorizedGroup() {},
    acquireYearLocks() {},
    validateMainListNotLocked() {},
  });
  for (const [revision, status] of [
    [undefined, 428],
    ['6', 412],
  ]) {
    await assert.rejects(
      writes.replaceListItems('list', 'owner', [], revision),
      (error) => error.statusCode === status
    );
  }
  assert.ok(queries.every((sql) => !sql.includes('DELETE')));
});

test('replacement identities come from the destination list, never from submitted foreign IDs', () => {
  const items = preserveDisqualificationState(
    [
      { _id: 'foreign', album_id: 'album-a' },
      { _id: 'other-foreign', album_id: 'new-album' },
    ],
    [{ _id: 'owned', album_id: 'album-a', is_disqualified: true }]
  );
  assert.equal(items[0]._id, 'owned');
  assert.equal(items[0].is_disqualified, true);
  assert.equal(items[1]._id, undefined);
});

test('shared mutations acquire the user lock first and publish old/new years only after commit', async () => {
  for (const failCommit of [false, true]) {
    const events = [];
    let year = 2025;
    const db = {
      withTransaction: async (fn) => {
        const result = await fn({
          query: async (sql, params) => {
            if (sql.includes('pg_advisory_xact_lock'))
              events.push(['lock', params[0]]);
            return {
              rows: sql.includes('SELECT DISTINCT year') ? [{ year }] : [],
            };
          },
        });
        if (failCommit) throw new Error('commit failed');
        events.push('commit');
        return result;
      },
    };
    registerListMutationPublisher(db, async (outcome) => events.push(outcome));
    const operation = withListTransaction(db, 'owner', async () => {
      events.push('mutation');
      year = 2026;
      return 'saved';
    });
    if (failCommit) await assert.rejects(operation, /commit failed/);
    else assert.equal(await operation, 'saved');
    assert.deepEqual(events[0], ['lock', 104]);
    if (failCommit) assert.equal(events.length, 2);
    else
      assert.deepEqual(events.slice(-2), [
        'commit',
        { userId: 'owner', years: [2025, 2026] },
      ]);
  }
});

test('copy with real diff/save reconciliation assigns the destination item identity', async () => {
  const { transferAlbumToList } =
    await import('../src/js/modules/album-transfer.js');
  const { createAppListOperations } =
    await import('../src/js/modules/app-list-operations.js');
  const { computeListDiff } = await import('../src/js/utils/save-optimizer.js');
  const lists = {
    source: {
      _data: [
        { _id: 'source-item', album_id: 'a', artist: 'Artist', album: 'Album' },
      ],
    },
    target: { _data: [] },
  };
  const snapshots = new Map([['target', []]]);
  const operations = createAppListOperations({
    apiCall: async (_url, options) => {
      assert.equal(JSON.parse(options.body).added[0]._id, undefined);
      return { addedItems: [{ album_id: 'a', _id: 'destination-item' }] };
    },
    getLists: () => lists,
    getLastSavedSnapshots: () => snapshots,
    computeListDiff,
    setListData: (id, data) => {
      lists[id]._data = data;
    },
    createListSnapshot: (data) => data.map((item) => item.album_id),
    saveSnapshotToStorage() {},
    markLocalSave() {},
    updateListNav() {},
    showToast() {},
    logger: { log() {} },
  });
  await transferAlbumToList(
    {
      getCurrentList: () => 'source',
      getLists: () => lists,
      getListData: (id) => lists[id]._data,
      getListMetadata: () => ({ name: 'Target' }),
      saveList: operations.saveList,
      showToast() {},
    },
    { index: 0, targetListId: 'target', mode: 'copy' }
  );
  assert.equal(lists.target._data[0]._id, 'destination-item');
  assert.equal(lists.source._data[0]._id, 'source-item');
});

test('server duplicate results do not become phantom local list items', async () => {
  const { createAppListOperations } =
    await import('../src/js/modules/app-list-operations.js');
  const { computeListDiff } = await import('../src/js/utils/save-optimizer.js');
  const owned = {
    _id: 'owned',
    album_id: 'canonical',
    artist: 'Artist',
    album: 'Album',
  };
  const alias = { album_id: 'alias', artist: 'Alias', album: 'Album' };
  const lists = { target: { _data: [owned, alias] } };
  const snapshots = new Map([['target', ['canonical']]]);
  const operations = createAppListOperations({
    apiCall: async () => ({
      addedItems: [],
      duplicates: [{ album_id: 'canonical', artist: 'Alias', album: 'Album' }],
    }),
    getLists: () => lists,
    getLastSavedSnapshots: () => snapshots,
    computeListDiff,
    setListData: (id, data) => {
      lists[id]._data = data;
    },
    createListSnapshot: (data) => data.map((item) => item.album_id),
    saveSnapshotToStorage() {},
    markLocalSave() {},
    updateListNav() {},
    showToast() {},
    logger: { log() {} },
  });
  const result = await operations.saveList('target', lists.target._data);
  assert.equal(result.duplicates.length, 1);
  assert.deepEqual(lists.target._data, [owned]);
  assert.deepEqual(snapshots.get('target'), ['canonical']);
});

test('failed target loading leaves the source and subsequent save diff intact', async () => {
  const { transferAlbumToList } =
    await import('../src/js/modules/album-transfer.js');
  const { computeListDiff } = await import('../src/js/utils/save-optimizer.js');
  const source = [
    { _id: 'source-item', album_id: 'a', artist: 'Artist', album: 'Album' },
  ];
  await assert.rejects(
    transferAlbumToList(
      {
        getCurrentList: () => 'source',
        getLists: () => ({ source: {}, target: {} }),
        getListData: (id) => (id === 'source' ? source : null),
        getListMetadata: () => ({}),
        apiCall: async () => {
          throw new Error('network failed');
        },
      },
      { index: 0, targetListId: 'target', mode: 'move' }
    ),
    /network failed/
  );
  assert.equal(source.length, 1);
  assert.equal(computeListDiff(['a'], source).totalChanges, 0);
});

test('a pending destination write never exposes a source removal to another save', async () => {
  const { transferAlbumToList } =
    await import('../src/js/modules/album-transfer.js');
  const source = [
    { _id: 'source-item', album_id: 'a', artist: 'Artist', album: 'Album' },
  ];
  const target = [];
  let rejectTarget;
  const write = new Promise((_resolve, reject) => {
    rejectTarget = reject;
  });
  const moving = transferAlbumToList(
    {
      getCurrentList: () => 'source',
      getLists: () => ({ source: {}, target: {} }),
      getListData: (id) => (id === 'source' ? source : target),
      getListMetadata: () => ({}),
      saveList: () => write,
      showToast() {},
    },
    { index: 0, targetListId: 'target', mode: 'move' }
  );
  const rejected = assert.rejects(moving, /target write failed/);
  assert.equal(source.length, 1);
  rejectTarget(new Error('target write failed'));
  await rejected;
  assert.equal(source.length, 1);
  assert.equal(target.length, 0);
});

test('moves pin their original source revision and preserve newer source data on conflict', async () => {
  const { transferAlbumToList } =
    await import('../src/js/modules/album-transfer.js');
  const { rememberListRevision } =
    await import('../src/js/modules/list-revisions.js');
  const album = {
    _id: 'source-item',
    album_id: 'a',
    artist: 'Artist',
    album: 'Album',
  };
  const remote = { _id: 'remote-item', album_id: 'remote' };
  let source = [album];
  const target = [];
  rememberListRevision('guarded-source', '7');
  await assert.rejects(
    transferAlbumToList(
      {
        getCurrentList: () => 'guarded-source',
        getLists: () => ({ 'guarded-source': {}, target: {} }),
        getListData: (id) => (id === 'guarded-source' ? source : target),
        getListMetadata: () => ({}),
        showToast() {},
        saveList: async (id, data, _year, options) => {
          if (id === 'target') {
            source = [{ ...album }, remote];
            rememberListRevision('guarded-source', '8');
            return {};
          }
          assert.equal(options.expectedRevision, '7');
          assert.deepEqual(data, [remote]);
          throw new Error('source conflict');
        },
      },
      { index: 0, targetListId: 'target', mode: 'move' }
    ),
    /source conflict/
  );
  assert.equal(source.length, 2);
  assert.equal(source[0]._id, 'source-item');
  assert.equal(target.length, 1);
});
