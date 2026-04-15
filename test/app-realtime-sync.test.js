const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert');

describe('app-realtime-sync module', () => {
  let createAppRealtimeSync;

  beforeEach(async () => {
    const module = await import('../src/js/modules/app-realtime-sync.js');
    createAppRealtimeSync = module.createAppRealtimeSync;
  });

  it('initializes sync module once and disconnects on unload', () => {
    let syncInstance = null;
    let beforeUnloadHandler = null;

    const connect = mock.fn();
    const disconnect = mock.fn();
    const createRealtimeSync = mock.fn((config) => {
      assert.strictEqual(typeof config.refreshListData, 'function');
      assert.strictEqual(typeof config.refreshListDataSilent, 'function');
      assert.strictEqual(typeof config.refreshListNav, 'function');
      return { connect, disconnect };
    });

    const realtimeSync = createAppRealtimeSync({
      createRealtimeSync,
      getRealtimeSyncModuleInstance: () => syncInstance,
      setRealtimeSyncModuleInstance: (instance) => {
        syncInstance = instance;
      },
      getCurrentListId: () => 'list-1',
      getListData: () => [],
      apiCall: async () => [],
      updateAlbumSummaryInPlace: () => {},
      wasRecentLocalSave: () => false,
      setListData: () => {},
      displayAlbums: () => {},
      loadLists: () => {},
      showToast: () => {},
      logger: { log: () => {} },
      win: {
        addEventListener(eventName, handler) {
          if (eventName === 'beforeunload') {
            beforeUnloadHandler = handler;
          }
        },
      },
    });

    realtimeSync.initializeRealtimeSync();
    realtimeSync.initializeRealtimeSync();

    assert.strictEqual(createRealtimeSync.mock.calls.length, 1);
    assert.strictEqual(connect.mock.calls.length, 2);
    assert.strictEqual(typeof beforeUnloadHandler, 'function');

    beforeUnloadHandler();
    assert.strictEqual(disconnect.mock.calls.length, 1);
  });

  it('refreshes list data only for non-local saves', async () => {
    let syncInstance = null;
    let realtimeConfig = null;
    let currentListId = 'list-1';
    let localSave = false;
    const setListData = mock.fn();
    const displayAlbums = mock.fn();
    const apiCall = mock.fn(async () => [{ album: 'A' }]);
    const logger = { log: mock.fn() };

    createAppRealtimeSync({
      createRealtimeSync: (config) => {
        realtimeConfig = config;
        return { connect: () => {}, disconnect: () => {} };
      },
      getRealtimeSyncModuleInstance: () => syncInstance,
      setRealtimeSyncModuleInstance: (instance) => {
        syncInstance = instance;
      },
      getCurrentListId: () => currentListId,
      getListData: () => [],
      apiCall,
      updateAlbumSummaryInPlace: () => {},
      wasRecentLocalSave: () => localSave,
      setListData,
      displayAlbums,
      loadLists: () => {},
      showToast: () => {},
      logger,
      win: null,
    }).getRealtimeSyncModule();

    localSave = true;
    const localResult = await realtimeConfig.refreshListData('list-2');
    assert.deepStrictEqual(localResult, { wasLocalSave: true });
    assert.strictEqual(apiCall.mock.calls.length, 0);
    assert.strictEqual(logger.log.mock.calls.length, 1);

    localSave = false;
    currentListId = 'list-2';
    const remoteResult = await realtimeConfig.refreshListData('list-2');
    assert.deepStrictEqual(remoteResult, { wasLocalSave: false });
    assert.strictEqual(apiCall.mock.calls.length, 1);
    assert.deepStrictEqual(apiCall.mock.calls[0].arguments, [
      '/api/lists/list-2',
    ]);
    assert.strictEqual(setListData.mock.calls.length, 1);
    assert.strictEqual(displayAlbums.mock.calls.length, 1);

    await realtimeConfig.refreshListDataSilent('list-3');
    assert.strictEqual(apiCall.mock.calls.length, 2);
    assert.strictEqual(setListData.mock.calls.length, 2);
  });
});
