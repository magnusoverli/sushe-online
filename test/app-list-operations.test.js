const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert');

describe('app-list-operations module', () => {
  let createAppListOperations;

  beforeEach(async () => {
    const module = await import('../src/js/modules/app-list-operations.js');
    createAppListOperations = module.createAppListOperations;
  });

  it('refreshes groups and list metadata while preserving loaded list data', async () => {
    const lists = {
      'list-1': {
        _id: 'list-1',
        name: 'Old Name',
        year: 2022,
        isMain: false,
        count: 1,
        groupId: null,
        sortOrder: 0,
        _data: [{ album_id: 'a1' }],
      },
    };

    const apiCall = mock.fn(async (url) => {
      if (url === '/api/lists') {
        return {
          'list-1': {
            name: 'New Name',
            year: 2024,
            isMain: true,
            count: 2,
            groupId: 'g1',
            sortOrder: 3,
            updatedAt: 'u1',
          },
          'list-2': {
            name: 'Another List',
            year: null,
            isMain: false,
            count: 0,
            groupId: null,
            sortOrder: 0,
            updatedAt: 'u2',
            createdAt: 'c2',
          },
        };
      }
      if (url === '/api/groups') {
        return [{ _id: 'g1', name: 'Group' }];
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const updateGroupsFromServer = mock.fn();
    const updateListNav = mock.fn();

    const operations = createAppListOperations({
      apiCall,
      showToast: () => {},
      getLists: () => lists,
      setLists: () => {},
      getListData: () => [],
      setListData: () => {},
      updateListMetadata: () => {},
      updateGroupsFromServer,
      getCurrentListId: () => null,
      selectList: () => {},
      updateListNav,
      setRecommendationYears: () => {},
      loadSnapshotFromStorage: () => null,
      getLastSavedSnapshots: () => new Map(),
      createListSnapshot: () => [],
      saveSnapshotToStorage: () => {},
      markLocalSave: () => {},
      computeListDiff: () => null,
      logger: { error: () => {} },
    });

    await operations.refreshGroupsAndLists();

    assert.strictEqual(updateGroupsFromServer.mock.calls.length, 1);
    assert.strictEqual(updateListNav.mock.calls.length, 1);
    assert.deepStrictEqual(lists['list-1']._data, [{ album_id: 'a1' }]);
    assert.strictEqual(lists['list-1'].name, 'New Name');
    assert.strictEqual(lists['list-2']._data, null);
  });

  it('loads lists metadata and auto-selects the stored list', async () => {
    let listsState = {};
    const snapshots = new Map();
    const selectList = mock.fn();
    const setListData = mock.fn();
    const setRecommendationYears = mock.fn();
    const updateGroupsFromServer = mock.fn();
    const updateListNav = mock.fn();
    const storage = {
      getItem: mock.fn(() => 'list-1'),
      setItem: mock.fn(),
    };

    const apiCall = mock.fn(async (url) => {
      if (url === '/api/lists') {
        return {
          'list-1': {
            name: 'Stored',
            year: 2024,
            isMain: false,
            count: 1,
            groupId: null,
            sortOrder: 1,
          },
        };
      }
      if (url === '/api/groups') {
        return [];
      }
      if (url === '/api/recommendations/years') {
        return { years: [2024] };
      }
      if (url === '/api/lists/list-1') {
        return [{ album_id: 'a1' }];
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const operations = createAppListOperations({
      apiCall,
      showToast: () => {},
      getLists: () => listsState,
      setLists: (nextLists) => {
        listsState = nextLists;
      },
      getListData: () => [],
      setListData,
      updateListMetadata: () => {},
      updateGroupsFromServer,
      getCurrentListId: () => null,
      selectList,
      updateListNav,
      setRecommendationYears,
      loadSnapshotFromStorage: (listId) =>
        listId === 'list-1' ? ['snapshot'] : null,
      getLastSavedSnapshots: () => snapshots,
      createListSnapshot: () => [],
      saveSnapshotToStorage: () => {},
      markLocalSave: () => {},
      computeListDiff: () => null,
      storage,
      win: { lastSelectedList: null },
      logger: { warn: () => {}, error: () => {} },
    });

    await operations.loadLists();

    assert.strictEqual(setRecommendationYears.mock.calls.length, 1);
    assert.deepStrictEqual(setRecommendationYears.mock.calls[0].arguments, [
      [2024],
    ]);
    assert.strictEqual(updateGroupsFromServer.mock.calls.length, 1);
    assert.strictEqual(updateListNav.mock.calls.length, 1);
    assert.strictEqual(setListData.mock.calls.length, 1);
    assert.deepStrictEqual(setListData.mock.calls[0].arguments, [
      'list-1',
      [{ album_id: 'a1' }],
    ]);
    assert.strictEqual(selectList.mock.calls.length, 1);
    assert.deepStrictEqual(selectList.mock.calls[0].arguments, ['list-1']);
    assert.deepStrictEqual(snapshots.get('list-1'), ['snapshot']);
    assert.strictEqual(storage.setItem.mock.calls.length, 0);
  });

  it('saves lists incrementally, updates snapshots, and refreshes mobile bar', async () => {
    const snapshots = new Map([['list-1', [{ album_id: 'old' }]]]);
    const markLocalSave = mock.fn();
    const setListData = mock.fn();
    const updateListMetadata = mock.fn();
    const saveSnapshotToStorage = mock.fn();
    const refreshMobileBarVisibility = mock.fn();

    const operations = createAppListOperations({
      apiCall: async () => ({
        addedItems: [{ album_id: 'a1', _id: 'new-item' }],
      }),
      showToast: () => {},
      getLists: () => ({ 'list-1': { name: 'My List' } }),
      setLists: () => {},
      getListData: () => [],
      setListData,
      updateListMetadata,
      updateGroupsFromServer: () => {},
      getCurrentListId: () => 'list-1',
      selectList: () => {},
      updateListNav: () => {},
      setRecommendationYears: () => {},
      loadSnapshotFromStorage: () => null,
      getLastSavedSnapshots: () => snapshots,
      createListSnapshot: () => ['new-snapshot'],
      saveSnapshotToStorage,
      markLocalSave,
      computeListDiff: () => ({
        added: [{ album_id: 'a1' }],
        removed: [],
        updated: [],
        totalChanges: 1,
      }),
      win: { refreshMobileBarVisibility },
      logger: { log: () => {} },
    });

    const data = [{ album_id: 'a1' }];
    await operations.saveList('list-1', data, 2024);

    assert.strictEqual(markLocalSave.mock.calls.length, 1);
    assert.strictEqual(setListData.mock.calls.length, 1);
    assert.strictEqual(saveSnapshotToStorage.mock.calls.length, 1);
    assert.strictEqual(updateListMetadata.mock.calls.length, 1);
    assert.deepStrictEqual(updateListMetadata.mock.calls[0].arguments, [
      'list-1',
      { year: 2024 },
    ]);
    assert.strictEqual(refreshMobileBarVisibility.mock.calls.length, 1);
    assert.strictEqual(
      setListData.mock.calls[0].arguments[1][0]._id,
      'new-item'
    );
  });

  it('imports list data and related track picks/summaries', async () => {
    const listsState = {};
    const refreshMobileBarVisibility = mock.fn();
    const logger = { warn: mock.fn(), log: mock.fn() };

    const apiCall = mock.fn(async (url) => {
      if (url === '/api/lists') {
        return { _id: 'new-list' };
      }
      if (url === '/api/lists/new-list') {
        return [{ _id: 'item-1', album_id: 'album-1' }];
      }
      if (url === '/api/track-picks/item-1') {
        return { success: true };
      }
      if (url === '/api/albums/album-1/summary') {
        return { success: true };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const operations = createAppListOperations({
      apiCall,
      showToast: () => {},
      getLists: () => listsState,
      setLists: () => {},
      getListData: () => [],
      setListData: () => {},
      updateListMetadata: () => {},
      updateGroupsFromServer: () => {},
      getCurrentListId: () => 'new-list',
      selectList: () => {},
      updateListNav: () => {},
      setRecommendationYears: () => {},
      loadSnapshotFromStorage: () => null,
      getLastSavedSnapshots: () => new Map(),
      createListSnapshot: () => [],
      saveSnapshotToStorage: () => {},
      markLocalSave: () => {},
      computeListDiff: () => null,
      win: { refreshMobileBarVisibility },
      logger,
    });

    const importedId = await operations.importList(
      'Imported List',
      [
        {
          album_id: 'album-1',
          primary_track: 'Track A',
          secondary_track: 'Track B',
          summary: 'Nice album',
          summary_source: 'editorial',
        },
      ],
      { year: 2025, group_id: 'group-1' }
    );

    assert.strictEqual(importedId, 'new-list');
    assert.strictEqual(listsState['new-list'].name, 'Imported List');
    assert.strictEqual(refreshMobileBarVisibility.mock.calls.length, 1);
    assert.strictEqual(logger.log.mock.calls.length, 1);
    assert.strictEqual(apiCall.mock.calls.length, 5);
  });
});
