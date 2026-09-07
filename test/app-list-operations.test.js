const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert');

describe('app-list-operations module', () => {
  let createAppListOperations;

  beforeEach(async () => {
    const module = await import('../src/js/modules/app-list-operations.js');
    createAppListOperations = module.createAppListOperations;
  });

  it('refreshes groups and list metadata while preserving loaded list data', async () => {
    let lists = {
      'list-1': {
        _id: 'list-1',
        name: 'Old Name',
        year: 2022,
        isMain: false,
        count: 1,
        groupId: null,
        sortOrder: 0,
        _data: [{ album_id: 'a1' }],
        _dataProfile: 'core',
      },
      stale: {
        _id: 'stale',
        name: 'Deleted elsewhere',
        _data: [{ album_id: 'stale' }],
        _dataProfile: 'full',
      },
    };

    const apiCall = mock.fn(async (url) => {
      if (url === '/api/app-bootstrap?selectedListId=list-1') {
        return {
          lists: {
            'list-1': {
              name: 'Stored',
              year: 2024,
              isMain: false,
              count: 1,
              groupId: null,
              sortOrder: 1,
            },
          },
          groups: [],
          recommendationYears: [2024],
          selectedListId: 'list-1',
          selectedListItems: [{ album_id: 'a1' }],
          selectedListProfile: 'core',
        };
      }
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
      setLists: (nextLists) => {
        lists = nextLists;
      },
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
    assert.strictEqual(lists['list-1']._dataProfile, 'core');
    assert.strictEqual(lists['list-1'].name, 'New Name');
    assert.strictEqual(lists['list-2']._data, null);
    assert.strictEqual(Object.hasOwn(lists, 'stale'), false);
  });

  it('clears selection when metadata refresh removes the current list', async () => {
    const selected = [];
    const operations = createAppListOperations({
      apiCall: async (url) => (url === '/api/lists' ? {} : []),
      showToast() {},
      getLists: () => ({ removed: { _data: [] } }),
      setLists() {},
      setListData() {},
      updateListMetadata() {},
      updateGroupsFromServer() {},
      getCurrentListId: () => 'removed',
      selectList: async (listId) => selected.push(listId),
      updateListNav() {},
      setRecommendationYears() {},
      loadSnapshotFromStorage() {},
      getLastSavedSnapshots: () => new Map(),
      createListSnapshot() {},
      saveSnapshotToStorage() {},
      markLocalSave() {},
      computeListDiff() {},
      logger: { error() {} },
    });

    await operations.refreshGroupsAndLists();

    assert.deepStrictEqual(selected, [null]);
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
      if (url === '/api/app-bootstrap?selectedListId=list-1') {
        return {
          lists: {
            'list-1': {
              name: 'Stored',
              year: 2024,
              isMain: false,
              count: 1,
              groupId: null,
              sortOrder: 1,
            },
          },
          groups: [],
          recommendationYears: [2024],
          selectedListId: 'list-1',
          selectedListItems: [{ album_id: 'a1' }],
          selectedListProfile: 'core',
          selectedListPlaycounts: {
            'item-1': { playcount: 42, status: 'success' },
          },
          selectedListPlaycountRefreshing: 2,
        };
      }
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
    assert.deepStrictEqual(updateListNav.mock.calls[0].arguments, ['list-1']);
    assert.strictEqual(setListData.mock.calls.length, 1);
    assert.deepStrictEqual(setListData.mock.calls[0].arguments, [
      'list-1',
      [{ album_id: 'a1' }],
      true,
      { profile: 'core' },
    ]);
    assert.strictEqual(selectList.mock.calls.length, 1);
    assert.deepStrictEqual(selectList.mock.calls[0].arguments, [
      'list-1',
      {
        initialPlaycounts: {
          'item-1': { playcount: 42, status: 'success' },
        },
      },
    ]);
    assert.deepStrictEqual(snapshots.get('list-1'), ['snapshot']);
    assert.strictEqual(storage.setItem.mock.calls.length, 0);
  });

  it('prioritizes an album deep link and focuses the requested album', async () => {
    let listsState = {};
    const selectList = mock.fn();
    const focusAlbum = mock.fn();
    const apiCall = mock.fn(async (url) => {
      assert.strictEqual(url, '/api/app-bootstrap?selectedListId=main-list');
      return {
        lists: {
          'stored-list': { name: 'Stored', year: 2025 },
          'main-list': { name: 'Main', year: 2026, isMain: true },
        },
        groups: [],
        recommendationYears: [],
        selectedListId: 'main-list',
        selectedListItems: [{ album_id: 'album/1' }],
        selectedListProfile: 'core',
      };
    });
    const storage = {
      getItem: mock.fn(() => 'stored-list'),
      setItem: mock.fn(),
    };
    const operations = createAppListOperations({
      apiCall,
      showToast() {},
      getLists: () => listsState,
      setLists: (lists) => {
        listsState = lists;
      },
      setListData() {},
      updateListMetadata() {},
      updateGroupsFromServer() {},
      getCurrentListId: () => null,
      selectList,
      focusAlbum,
      updateListNav() {},
      setRecommendationYears() {},
      loadSnapshotFromStorage() {},
      getLastSavedSnapshots: () => new Map(),
      createListSnapshot() {},
      saveSnapshotToStorage() {},
      markLocalSave() {},
      computeListDiff() {},
      storage,
      win: {
        lastSelectedList: 'stored-list',
        location: { search: '?listId=main-list&albumId=album%2F1' },
      },
      logger: { warn() {}, error() {} },
    });

    await operations.loadLists();

    assert.strictEqual(selectList.mock.calls[0].arguments[0], 'main-list');
    assert.deepStrictEqual(focusAlbum.mock.calls[0].arguments, [
      'main-list',
      'album/1',
    ]);
    assert.deepStrictEqual(storage.setItem.mock.calls[0].arguments, [
      'lastSelectedList',
      'main-list',
    ]);
  });

  it('clears stale last-selected list references and never selects missing list data', async () => {
    let listsState = {};
    const setListData = mock.fn();
    const selectList = mock.fn();
    const setRecommendationYears = mock.fn();
    const updateGroupsFromServer = mock.fn();
    const updateListNav = mock.fn();
    const storage = {
      getItem: mock.fn(() => 'missing-list'),
      setItem: mock.fn(),
      removeItem: mock.fn(),
    };
    const win = { lastSelectedList: 'missing-list' };

    const apiCall = mock.fn(async (url) => {
      if (url === '/api/app-bootstrap?selectedListId=missing-list') {
        return {
          lists: {
            'list-1': {
              name: 'Existing List',
              year: 2024,
              isMain: false,
              count: 0,
              groupId: null,
              sortOrder: 0,
            },
          },
          groups: [],
          recommendationYears: [],
          selectedListId: null,
          selectedListItems: null,
          selectedListProfile: null,
        };
      }
      if (url === '/api/lists') {
        return {
          'list-1': {
            name: 'Existing List',
            year: 2024,
            isMain: false,
            count: 0,
            groupId: null,
            sortOrder: 0,
          },
        };
      }
      if (url === '/api/groups') {
        return [];
      }
      if (url === '/api/recommendations/years') {
        return { years: [] };
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
      loadSnapshotFromStorage: () => null,
      getLastSavedSnapshots: () => new Map(),
      createListSnapshot: () => [],
      saveSnapshotToStorage: () => {},
      markLocalSave: () => {},
      computeListDiff: () => null,
      storage,
      win,
      logger: { warn: () => {}, error: () => {} },
    });

    await operations.loadLists();

    assert.strictEqual(apiCall.mock.calls.length, 1);
    assert.strictEqual(setRecommendationYears.mock.calls.length, 1);
    assert.strictEqual(updateGroupsFromServer.mock.calls.length, 1);
    assert.strictEqual(updateListNav.mock.calls.length, 1);
    assert.strictEqual(setListData.mock.calls.length, 0);
    assert.strictEqual(selectList.mock.calls.length, 0);
    assert.strictEqual(storage.removeItem.mock.calls.length, 1);
    assert.deepStrictEqual(storage.removeItem.mock.calls[0].arguments, [
      'lastSelectedList',
    ]);
    assert.strictEqual(win.lastSelectedList, null);
  });

  it('saves lists incrementally and updates snapshots', async () => {
    const snapshots = new Map([['list-1', [{ album_id: 'old' }]]]);
    const markLocalSave = mock.fn();
    const setListData = mock.fn();
    const updateListMetadata = mock.fn();
    const saveSnapshotToStorage = mock.fn();

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
      win: {},
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
    assert.strictEqual(
      setListData.mock.calls[0].arguments[1][0]._id,
      'new-item'
    );
  });

  it('refreshes sidebar counts only when a save changes the album total', async () => {
    const snapshots = new Map([['list-1', [{ album_id: 'old' }]]]);
    const updateListNav = mock.fn();
    const operations = createAppListOperations({
      apiCall: async () => ({ addedItems: [] }),
      showToast: () => {},
      getLists: () => ({ 'list-1': { name: 'My List', count: 2 } }),
      setLists: () => {},
      setListData: () => {},
      updateListMetadata: () => {},
      updateGroupsFromServer: () => {},
      getCurrentListId: () => 'list-1',
      selectList: () => {},
      updateListNav,
      setRecommendationYears: () => {},
      loadSnapshotFromStorage: () => null,
      getLastSavedSnapshots: () => snapshots,
      createListSnapshot: (data) => data,
      saveSnapshotToStorage: () => {},
      markLocalSave: () => {},
      computeListDiff: () => ({
        added: [{ album_id: 'new' }],
        removed: [],
        updated: [],
        totalChanges: 1,
      }),
      win: {},
      logger: { log: () => {} },
    });

    await operations.saveList('list-1', [
      { album_id: 'old' },
      { album_id: 'new' },
    ]);

    assert.strictEqual(updateListNav.mock.calls.length, 1);

    await operations.saveList('list-1', [
      { album_id: 'old' },
      { album_id: 'new' },
    ]);

    assert.strictEqual(updateListNav.mock.calls.length, 1);
  });

  it('imports list data and related track picks/summaries', async () => {
    const listsState = {};
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
      win: {},
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
    assert.strictEqual(logger.log.mock.calls.length, 1);
    assert.strictEqual(apiCall.mock.calls.length, 5);
  });
});

describe('saveList with real state and diff computation', () => {
  let state;
  let operations;
  let apiCall;
  let showToast;

  beforeEach(async (t) => {
    state = await import('../src/js/modules/app-state.js');
    const { computeListDiff } =
      await import('../src/js/utils/save-optimizer.js');
    const { createAppListOperations } =
      await import('../src/js/modules/app-list-operations.js');
    const previousStorage = globalThis.localStorage;
    globalThis.localStorage = { setItem: mock.fn() };
    t.after(() => {
      if (previousStorage === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = previousStorage;
      state.setLists({});
      state.getLastSavedSnapshots().clear();
    });
    state.setLists({});
    state.getLastSavedSnapshots().clear();
    apiCall = mock.fn(async () => ({ addedItems: [] }));
    showToast = mock.fn();
    operations = createAppListOperations({
      ...state,
      computeListDiff,
      apiCall,
      showToast,
      markLocalSave: mock.fn(),
      updateListNav: mock.fn(),
      logger: { log() {} },
    });
  });

  for (const baseline of [[], [{ album_id: 'old', _id: 'old-item' }]]) {
    it(`PATCHes one addition from ${baseline.length ? 'a populated' : 'an empty'} saved baseline`, async () => {
      state.setListData('list-1', baseline);
      const added = { album_id: 'new', album: 'New', rank: 2, points: 10 };
      const optimistic = [...baseline, added];
      state.setListData('list-1', optimistic, false);
      apiCall.mock.mockImplementation(async () => ({
        addedItems: [{ album_id: 'new', _id: 'new-item' }],
      }));

      await operations.saveList('list-1', optimistic);

      assert.strictEqual(apiCall.mock.callCount(), 1);
      const [url, options] = apiCall.mock.calls[0].arguments;
      assert.strictEqual(url, '/api/lists/list-1/items');
      assert.strictEqual(options.method, 'PATCH');
      assert.deepStrictEqual(JSON.parse(options.body), {
        added: [
          { album_id: 'new', album: 'New', position: baseline.length + 1 },
        ],
        removed: [],
        updated: [],
      });
      assert.strictEqual(state.getListData('list-1').at(-1)._id, 'new-item');
      assert.strictEqual(added._id, undefined);
      assert.deepStrictEqual(state.getLastSavedSnapshots().get('list-1'), [
        ...baseline.map((item) => item.album_id),
        'new',
      ]);
      assert.deepStrictEqual(
        globalThis.localStorage.setItem.mock.calls.at(-1).arguments,
        [
          'list-snapshot-list-1',
          JSON.stringify(state.getLastSavedSnapshots().get('list-1')),
        ]
      );
    });
  }

  it('serializes saves per list, rebases the second diff and merges assigned IDs while other lists save independently', async () => {
    state.setListData('list-1', []);
    state.setListData('list-2', []);
    const gate = Promise.withResolvers();
    const started = Promise.withResolvers();
    apiCall.mock.mockImplementation((url, options) => {
      const { added } = JSON.parse(options.body);
      if (url.includes('list-1') && added[0].album_id === 'a') {
        started.resolve();
        return gate.promise;
      }
      return Promise.resolve({
        addedItems: added.map((item) => ({
          album_id: item.album_id,
          _id: `item-${item.album_id}`,
        })),
      });
    });
    state.setListData('list-1', [{ album_id: 'a' }], false);
    const first = operations.saveList('list-1', state.getListData('list-1'));
    await started.promise;
    state.setListData('list-1', [{ album_id: 'a' }, { album_id: 'b' }], false);
    const second = operations.saveList('list-1', state.getListData('list-1'));
    state.setListData('list-2', [{ album_id: 'c' }], false);
    await operations.saveList('list-2', state.getListData('list-2'));
    assert.strictEqual(apiCall.mock.callCount(), 2);
    assert.deepStrictEqual(state.getLastSavedSnapshots().get('list-1'), []);
    assert.deepStrictEqual(state.getLastSavedSnapshots().get('list-2'), ['c']);

    gate.resolve({ addedItems: [{ album_id: 'a', _id: 'item-a' }] });
    await Promise.all([first, second]);

    assert.strictEqual(apiCall.mock.callCount(), 3);
    assert.deepStrictEqual(
      JSON.parse(apiCall.mock.calls[2].arguments[1].body),
      {
        added: [{ album_id: 'b', position: 2 }],
        removed: [],
        updated: [],
      }
    );
    assert.deepStrictEqual(state.getListData('list-1'), [
      { album_id: 'a', _id: 'item-a' },
      { album_id: 'b', _id: 'item-b' },
    ]);
    assert.deepStrictEqual(state.getLastSavedSnapshots().get('list-1'), [
      'a',
      'b',
    ]);
  });

  it('prunes a failed addition from an already-queued save but allows an explicit later retry', async () => {
    state.setListData('list-1', []);
    const gate = Promise.withResolvers();
    const started = Promise.withResolvers();
    apiCall.mock.mockImplementationOnce(() => {
      started.resolve();
      return gate.promise;
    });
    state.setListData('list-1', [{ album_id: 'a' }], false);
    const first = operations.saveList('list-1', state.getListData('list-1'));
    const rejected = assert.rejects(first, /offline/);
    await started.promise;
    state.setListData('list-1', [{ album_id: 'a' }, { album_id: 'b' }], false);
    const second = operations.saveList('list-1', state.getListData('list-1'));
    apiCall.mock.mockImplementation(() => {
      assert.deepStrictEqual(state.getLastSavedSnapshots().get('list-1'), []);
      return Promise.resolve({ addedItems: [] });
    });
    gate.reject(new Error('offline'));
    await rejected;
    await second;

    assert.strictEqual(apiCall.mock.callCount(), 2);
    assert.strictEqual(apiCall.mock.calls[1].arguments[1].method, 'PATCH');
    assert.deepStrictEqual(
      JSON.parse(apiCall.mock.calls[1].arguments[1].body).added,
      [{ album_id: 'b', position: 1 }]
    );
    assert.deepStrictEqual(state.getListData('list-1'), [{ album_id: 'b' }]);
    assert.deepStrictEqual(state.getLastSavedSnapshots().get('list-1'), ['b']);
    assert.strictEqual(showToast.mock.callCount(), 1);

    apiCall.mock.mockImplementation(async () => ({
      addedItems: [{ album_id: 'a', _id: 'item-a' }],
    }));
    state.setListData('list-1', [{ album_id: 'b' }, { album_id: 'a' }], false);
    await operations.saveList('list-1', state.getListData('list-1'));

    assert.strictEqual(apiCall.mock.callCount(), 3);
    assert.strictEqual(apiCall.mock.calls[2].arguments[1].method, 'PATCH');
    assert.deepStrictEqual(
      JSON.parse(apiCall.mock.calls[2].arguments[1].body),
      {
        added: [{ album_id: 'a', position: 2 }],
        removed: [],
        updated: [],
      }
    );
    assert.deepStrictEqual(state.getListData('list-1'), [
      { album_id: 'b' },
      { album_id: 'a', _id: 'item-a' },
    ]);
    assert.deepStrictEqual(state.getLastSavedSnapshots().get('list-1'), [
      'b',
      'a',
    ]);
  });

  it('invalidates the failed addition across three queued saves while allowing a retry queued after failure before they drain', async () => {
    const old = { album_id: 'old', _id: 'old-item', comment: 'Original' };
    state.setListData('list-1', [old]);
    const responses = Array.from({ length: 5 }, () => Promise.withResolvers());
    const started = Array.from({ length: 5 }, () => Promise.withResolvers());
    let request = 0;
    apiCall.mock.mockImplementation(() => {
      const index = request++;
      started[index].resolve();
      return responses[index].promise;
    });
    state.setListData('list-1', [old, { album_id: 'a' }], false);
    const first = operations.saveList('list-1', state.getListData('list-1'));
    const rejected = assert.rejects(first, /addition failed/);
    await started[0].promise;
    const queued = [];
    for (let index = 1; index <= 3; index++) {
      state.setListData(
        'list-1',
        [{ ...old, comment: `Edit ${index}` }, { album_id: 'a' }],
        false
      );
      queued.push(operations.saveList('list-1', state.getListData('list-1')));
    }
    assert.strictEqual(apiCall.mock.callCount(), 1);
    responses[0].reject(new Error('addition failed'));
    await rejected;
    await started[1].promise;
    assert.deepStrictEqual(state.getLastSavedSnapshots().get('list-1'), [
      'old',
    ]);
    const retryData = [{ ...old, comment: 'Edit 3' }, { album_id: 'a' }];
    state.setListData('list-1', retryData, false);
    const retry = operations.saveList('list-1', retryData);

    for (let index = 1; index <= 3; index++) {
      await started[index].promise;
      const [url, options] = apiCall.mock.calls[index].arguments;
      assert.strictEqual(url, '/api/lists/list-1');
      assert.strictEqual(options.method, 'PUT');
      assert.deepStrictEqual(JSON.parse(options.body), {
        data: [{ ...old, comment: `Edit ${index}` }],
      });
      responses[index].resolve({});
      await queued[index - 1];
      assert.deepStrictEqual(state.getLastSavedSnapshots().get('list-1'), [
        'old',
      ]);
    }
    await started[4].promise;
    assert.strictEqual(apiCall.mock.callCount(), 5);
    assert.strictEqual(apiCall.mock.calls[4].arguments[1].method, 'PATCH');
    assert.deepStrictEqual(
      JSON.parse(apiCall.mock.calls[4].arguments[1].body),
      {
        added: [{ album_id: 'a', position: 2 }],
        removed: [],
        updated: [],
      }
    );
    responses[4].resolve({ addedItems: [{ album_id: 'a', _id: 'item-a' }] });
    await retry;
    assert.deepStrictEqual(state.getListData('list-1'), [
      { ...old, comment: 'Edit 3' },
      { album_id: 'a', _id: 'item-a' },
    ]);
    assert.deepStrictEqual(state.getLastSavedSnapshots().get('list-1'), [
      'old',
      'a',
    ]);
    assert.strictEqual(operations.getListSaveState('list-1').pending, 0);
  });

  for (const inPlace of [false, true]) {
    it(`preserves a newer ${inPlace ? 'in-place edit' : 'optimistic replacement'} while merging only missing IDs`, async () => {
      state.setListData('list-1', []);
      const gate = Promise.withResolvers();
      const started = Promise.withResolvers();
      apiCall.mock.mockImplementation(() => {
        started.resolve();
        return gate.promise;
      });
      state.setListData(
        'list-1',
        [{ album_id: 'a', album: 'Before' }, { album_id: 'b' }],
        false
      );
      const saving = operations.saveList('list-1', state.getListData('list-1'));
      await started.promise;
      const newer = inPlace
        ? state.getListData('list-1')
        : globalThis.structuredClone(state.getListData('list-1'));
      newer[0].album = 'Edited';
      newer[1]._id = 'newer-item-b';
      newer.push({ album_id: 'c' });
      if (!inPlace) state.setListData('list-1', newer, false);
      gate.resolve({
        addedItems: [
          { album_id: 'a', _id: 'item-a' },
          { album_id: 'b', _id: 'stale-item-b' },
        ],
      });
      await saving;

      assert.deepStrictEqual(state.getListData('list-1'), [
        { album_id: 'a', album: 'Edited', _id: 'item-a' },
        { album_id: 'b', _id: 'newer-item-b' },
        { album_id: 'c' },
      ]);
      assert.deepStrictEqual(state.getLastSavedSnapshots().get('list-1'), [
        'a',
        'b',
      ]);
    });
  }
});
