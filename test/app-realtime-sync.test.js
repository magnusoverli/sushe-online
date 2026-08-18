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
      assert.strictEqual(typeof config.onAlbumAvailabilityUpdated, 'function');
      assert.strictEqual(typeof config.onAlbumMetadataUpdated, 'function');
      assert.strictEqual(typeof config.onAlbumTaxonomyUpdated, 'function');
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
      refreshGroupsAndLists: () => {},
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
    const refreshGroupsAndLists = mock.fn();
    const updateListNav = mock.fn();

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
      updateListNav,
      displayAlbums,
      refreshGroupsAndLists,
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
    assert.strictEqual(updateListNav.mock.calls.length, 1);

    await realtimeConfig.refreshListDataSilent('list-3');
    assert.strictEqual(apiCall.mock.calls.length, 2);
    assert.strictEqual(setListData.mock.calls.length, 2);
    assert.strictEqual(updateListNav.mock.calls.length, 2);

    await realtimeConfig.refreshListNav();
    assert.strictEqual(refreshGroupsAndLists.mock.calls.length, 1);
  });

  it('patches album enrichments across loaded lists without list refetches', async () => {
    let realtimeConfig = null;
    const sharedAlbumOne = { album_id: 'album/1' };
    const sharedAlbumTwo = { album_id: 'album/1' };
    const lists = {
      'list-1': { _data: [sharedAlbumOne] },
      'list-2': { _data: [{ album_id: 'other' }, sharedAlbumTwo] },
    };
    const displayAlbums = mock.fn();
    const taxonomyResponse = {
      taxonomy: { schema_version: 1, rym: { primary_genres: ['Rock'] } },
      genre_1: 'Rock',
      genre_2: '',
      taxonomy_updated_at: '2026-08-17T13:00:00.000Z',
    };
    const apiCall = mock.fn(async () => taxonomyResponse);

    createAppRealtimeSync({
      createRealtimeSync: (config) => {
        realtimeConfig = config;
        return { connect: () => {}, disconnect: () => {} };
      },
      getRealtimeSyncModuleInstance: () => null,
      setRealtimeSyncModuleInstance: () => {},
      getCurrentListId: () => 'list-2',
      getLists: () => lists,
      getListData: (listId) => lists[listId]?._data || null,
      apiCall,
      updateAlbumSummaryInPlace: () => {},
      wasRecentLocalSave: () => false,
      setListData: () => {},
      updateListNav: () => {},
      displayAlbums,
      refreshGroupsAndLists: () => {},
      showToast: () => {},
      logger: { log: () => {}, warn: () => {} },
      win: null,
    }).getRealtimeSyncModule();

    const availability = ['spotify', 'tidal'];
    const availabilityLinks = [
      { service: 'spotify', url: 'https://open.spotify.com/album/1' },
    ];
    await realtimeConfig.onAlbumAvailabilityUpdated({
      albumId: 'album/1',
      availability,
      availabilityLinks,
    });

    assert.strictEqual(sharedAlbumOne.availability, availability);
    assert.strictEqual(sharedAlbumTwo.availability_links, availabilityLinks);
    assert.strictEqual(apiCall.mock.calls.length, 0);
    assert.strictEqual(displayAlbums.mock.calls.length, 1);
    assert.strictEqual(
      displayAlbums.mock.calls[0].arguments[0],
      lists['list-2']._data
    );

    await realtimeConfig.onAlbumMetadataUpdated({
      albumId: 'album/1',
      metadataVersion: '2',
      patch: {
        country: 'Norway',
        unsafe: 'ignored',
      },
    });
    await realtimeConfig.onAlbumMetadataUpdated({
      albumId: 'album/1',
      metadataVersion: '1',
      patch: {
        country: 'Sweden',
        tracks: [{ name: 'Opening' }],
      },
    });
    assert.strictEqual(sharedAlbumOne.country, 'Norway');
    assert.deepStrictEqual(sharedAlbumTwo.tracks, [{ name: 'Opening' }]);
    assert.strictEqual(sharedAlbumOne.unsafe, undefined);
    assert.strictEqual(displayAlbums.mock.calls.length, 3);

    await realtimeConfig.onAlbumTaxonomyUpdated({
      albumId: 'album/1',
      taxonomyUpdatedAt: '2026-08-17T12:00:00.000Z',
    });

    assert.deepStrictEqual(apiCall.mock.calls[0].arguments, [
      '/api/albums/album%2F1/taxonomy',
    ]);
    assert.strictEqual(sharedAlbumOne.taxonomy, taxonomyResponse.taxonomy);
    assert.strictEqual(sharedAlbumTwo.genre_1, 'Rock');
    assert.strictEqual(sharedAlbumTwo.genre_2, '');
    assert.strictEqual(
      sharedAlbumOne.taxonomy_updated_at,
      taxonomyResponse.taxonomy_updated_at
    );
    assert.strictEqual(displayAlbums.mock.calls.length, 4);
  });

  it('does not full-refetch when a taxonomy patch request fails', async () => {
    let realtimeConfig = null;
    const lists = { 'list-1': { _data: [{ album_id: 'album-1' }] } };
    const apiCall = mock.fn(async () => {
      throw new Error('network failed');
    });
    const displayAlbums = mock.fn();
    const logger = { log: mock.fn(), warn: mock.fn() };

    createAppRealtimeSync({
      createRealtimeSync: (config) => {
        realtimeConfig = config;
        return { connect: () => {}, disconnect: () => {} };
      },
      getRealtimeSyncModuleInstance: () => null,
      setRealtimeSyncModuleInstance: () => {},
      getCurrentListId: () => 'list-1',
      getLists: () => lists,
      getListData: (listId) => lists[listId]?._data || null,
      apiCall,
      updateAlbumSummaryInPlace: () => {},
      wasRecentLocalSave: () => false,
      setListData: mock.fn(),
      updateListNav: mock.fn(),
      displayAlbums,
      refreshGroupsAndLists: mock.fn(),
      showToast: () => {},
      logger,
      win: null,
    }).getRealtimeSyncModule();

    await assert.doesNotReject(() =>
      realtimeConfig.onAlbumTaxonomyUpdated({ albumId: 'album-1' })
    );
    assert.strictEqual(displayAlbums.mock.calls.length, 0);
    assert.strictEqual(logger.warn.mock.calls.length, 1);
  });

  it('reapplies enrichment that arrives during an older list refresh', async () => {
    let realtimeConfig = null;
    let resolveRefresh;
    const refreshed = new Promise((resolve) => {
      resolveRefresh = resolve;
    });
    const setListData = mock.fn();

    createAppRealtimeSync({
      createRealtimeSync: (config) => {
        realtimeConfig = config;
        return { connect: () => {}, disconnect: () => {} };
      },
      getRealtimeSyncModuleInstance: () => null,
      setRealtimeSyncModuleInstance: () => {},
      getCurrentListId: () => 'list-1',
      getLists: () => ({ 'list-1': { _data: [] } }),
      getListData: () => [],
      apiCall: () => refreshed,
      updateAlbumSummaryInPlace: () => {},
      wasRecentLocalSave: () => false,
      setListData,
      updateListNav: () => {},
      displayAlbums: () => {},
      refreshGroupsAndLists: () => {},
      showToast: () => {},
      logger: { log: () => {}, warn: () => {} },
      win: null,
    }).getRealtimeSyncModule();

    const refreshPromise = realtimeConfig.refreshListData('list-1');
    realtimeConfig.onAlbumMetadataUpdated({
      albumId: 'album-1',
      patch: { country: 'Norway' },
    });
    resolveRefresh([{ album_id: 'album-1', country: '' }]);
    await refreshPromise;

    assert.strictEqual(
      setListData.mock.calls[0].arguments[1][0].country,
      'Norway'
    );
  });

  it('does not apply an old enrichment over a newer list response', async () => {
    let realtimeConfig = null;
    const setListData = mock.fn();

    createAppRealtimeSync({
      createRealtimeSync: (config) => {
        realtimeConfig = config;
        return { connect: () => {}, disconnect: () => {} };
      },
      getRealtimeSyncModuleInstance: () => null,
      setRealtimeSyncModuleInstance: () => {},
      getCurrentListId: () => 'list-1',
      getLists: () => ({ 'list-1': { _data: [] } }),
      getListData: () => [],
      apiCall: async () => [{ album_id: 'album-1', country: 'Sweden' }],
      updateAlbumSummaryInPlace: () => {},
      wasRecentLocalSave: () => false,
      setListData,
      updateListNav: () => {},
      displayAlbums: () => {},
      refreshGroupsAndLists: () => {},
      showToast: () => {},
      logger: { log: () => {}, warn: () => {} },
      win: null,
    }).getRealtimeSyncModule();

    realtimeConfig.onAlbumMetadataUpdated({
      albumId: 'album-1',
      patch: { country: 'Norway' },
    });
    await realtimeConfig.refreshListData('list-1');

    assert.strictEqual(
      setListData.mock.calls[0].arguments[1][0].country,
      'Sweden'
    );
  });

  it('ignores an older taxonomy response that resolves after a newer event', async () => {
    let realtimeConfig = null;
    const album = { album_id: 'album-1' };
    const lists = { 'list-1': { _data: [album] } };
    const requests = [];
    const apiCall = mock.fn(
      () =>
        new Promise((resolve) => {
          requests.push(resolve);
        })
    );

    createAppRealtimeSync({
      createRealtimeSync: (config) => {
        realtimeConfig = config;
        return { connect: () => {}, disconnect: () => {} };
      },
      getRealtimeSyncModuleInstance: () => null,
      setRealtimeSyncModuleInstance: () => {},
      getCurrentListId: () => 'list-1',
      getLists: () => lists,
      getListData: (listId) => lists[listId]?._data || null,
      apiCall,
      updateAlbumSummaryInPlace: () => {},
      wasRecentLocalSave: () => false,
      setListData: () => {},
      updateListNav: () => {},
      displayAlbums: () => {},
      refreshGroupsAndLists: () => {},
      showToast: () => {},
      logger: { log: () => {}, warn: () => {} },
      win: null,
    }).getRealtimeSyncModule();

    const older = realtimeConfig.onAlbumTaxonomyUpdated({
      albumId: 'album-1',
      taxonomyUpdatedAt: '2026-08-17T12:00:00.000Z',
    });
    const newer = realtimeConfig.onAlbumTaxonomyUpdated({
      albumId: 'album-1',
      taxonomyUpdatedAt: '2026-08-17T13:00:00.000Z',
    });

    requests[1]({
      taxonomy: { rym: { primary_genres: ['New'] } },
      genre_1: 'New',
      genre_2: '',
      taxonomy_updated_at: '2026-08-17T13:00:00.000Z',
    });
    await newer;
    requests[0]({
      taxonomy: { rym: { primary_genres: ['Old'] } },
      genre_1: 'Old',
      genre_2: '',
      taxonomy_updated_at: '2026-08-17T12:00:00.000Z',
    });
    await older;

    assert.strictEqual(album.genre_1, 'New');
  });
});
