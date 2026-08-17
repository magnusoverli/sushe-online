const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert');

const STORAGE_KEYS = {
  ALBUM_PRESENCE_INDEX: 'albumPresenceIndex',
  ALBUM_PRESENCE_LAST_FETCHED: 'albumPresenceLastFetched',
};

function loadServices() {
  delete globalThis.AlbumIdentity;
  delete globalThis.AlbumPresenceService;
  delete require.cache[
    require.resolve('../browser-extension/album-identity-service.js')
  ];
  delete require.cache[
    require.resolve('../browser-extension/album-presence-service.js')
  ];
  require('../browser-extension/album-identity-service.js');
  require('../browser-extension/album-presence-service.js');
}

function createHarness({ stored = {}, items = [], fetchError = null } = {}) {
  const storage = { ...stored };
  const chrome = {
    storage: {
      local: {
        get: mock.fn(async () => ({ ...storage })),
        set: mock.fn(async (updates) => Object.assign(storage, updates)),
        remove: mock.fn(async (keys) => {
          keys.forEach((key) => delete storage[key]);
        }),
      },
    },
  };
  const fetchWithTimeout = mock.fn(async () => {
    if (fetchError) throw fetchError;
    return {
      ok: true,
      status: 200,
      json: async () => ({ items }),
    };
  });
  const service = globalThis.AlbumPresenceService.createAlbumPresenceService({
    albumIdentity: globalThis.AlbumIdentity,
    chrome,
    constants: {
      STORAGE_KEYS,
      API: { LIST_ALBUM_PRESENCE: '/api/lists/presence', LISTS: '/api/lists' },
      ALBUM_PRESENCE_CACHE_DURATION_MS: 300000,
    },
    ensureStateLoaded: async () => {},
    fetchWithTimeout,
    getApiBase: () => 'https://sushe.example',
    getAuthHeaders: () => ({ Authorization: 'Bearer token' }),
    logger: { warn: mock.fn() },
  });

  return { fetchWithTimeout, service, storage };
}

describe('extension album presence identity index', () => {
  beforeEach(loadServices);

  afterEach(() => {
    delete globalThis.AlbumIdentity;
    delete globalThis.AlbumPresenceService;
    mock.reset();
  });

  it('matches numeric identity before canonical path and normalized names', async () => {
    const numericUrl =
      'https://rateyourmusic.com/release/album/numeric/record/';
    const canonicalUrl =
      'https://rateyourmusic.com/release/album/canonical/record/';
    const nameUrl = 'https://rateyourmusic.com/release/album/name/record/';
    const { service, storage } = createHarness({
      items: [
        {
          rymNumericId: 101,
          rymCanonicalUrl: numericUrl,
          artist: 'Shared Artist',
          album: 'Shared Album',
          albumId: 'numeric-album',
          listId: 'numeric-list',
          listName: 'Numeric',
        },
        {
          rymNumericId: '202',
          rymCanonicalUrl: canonicalUrl,
          artist: 'Other Artist',
          album: 'Other Album',
          albumId: 'canonical-album',
          listId: 'canonical-list',
          listName: 'Canonical',
        },
        {
          artist: 'Name Artist',
          album: 'Name Album',
          albumId: 'name-album',
          listId: 'name-list',
          listName: 'Name',
        },
      ],
    });

    const matches = await service.getPresenceForAlbums([
      {
        key: 'numeric-query',
        numericId: 101,
        canonicalUrl,
        artist: 'Name Artist',
        album: 'Name Album',
      },
      {
        key: 'canonical-query',
        numericId: '999',
        canonicalPath: '/release/album/canonical/record/',
        artist: 'Name Artist',
        album: 'Name Album',
      },
      {
        key: 'name-query',
        numericId: '999',
        canonicalUrl: nameUrl,
        artist: 'Name Artist',
        album: 'Name Album',
      },
    ]);

    assert.strictEqual(matches['numeric-query'][0].listId, 'numeric-list');
    assert.strictEqual(matches['canonical-query'][0].listId, 'canonical-list');
    assert.strictEqual(matches['name-query'][0].listId, 'name-list');
    assert.strictEqual(storage.albumPresenceIndex.version, 2);
    assert.ok(storage.albumPresenceIndex.entries['rym-id:101']);
    assert.ok(
      storage.albumPresenceIndex.entries[
        'rym-path:/release/album/canonical/record/'
      ]
    );
    assert.ok(
      storage.albumPresenceIndex.entries['name:name artist::name album']
    );
  });

  it('rebuilds a legacy name-only cache into the versioned shape', async () => {
    const oldEntry = {
      albumId: 'album-1',
      listId: 'list-1',
      listName: 'Legacy',
    };
    const { fetchWithTimeout, service, storage } = createHarness({
      stored: {
        albumPresenceIndex: { 'artist::album': [oldEntry] },
        albumPresenceLastFetched: Date.now(),
      },
      items: [
        {
          artist: 'Artist',
          album: 'Album',
          albumId: 'album-1',
          listId: 'list-1',
          listName: 'Legacy',
        },
      ],
    });

    const matches = await service.getPresenceForAlbums([
      { key: 'artist::album', artist: 'Artist', album: 'Album' },
    ]);

    assert.strictEqual(fetchWithTimeout.mock.calls.length, 1);
    const rebuiltEntry = { ...oldEntry, year: null, isMain: false };
    assert.deepStrictEqual(matches['artist::album'], [rebuiltEntry]);
    assert.deepStrictEqual(storage.albumPresenceIndex, {
      version: 2,
      entries: { 'name:artist::album': [rebuiltEntry] },
    });
  });

  it('keeps legacy name matches available when their rebuild fails', async () => {
    const oldEntry = {
      albumId: 'album-1',
      listId: 'list-1',
      listName: 'Legacy',
    };
    const { service } = createHarness({
      stored: {
        albumPresenceIndex: { 'artist::album': [oldEntry] },
        albumPresenceLastFetched: Date.now(),
      },
      fetchError: new Error('offline'),
    });

    const matches = await service.getPresenceForAlbums([
      { key: 'artist::album', artist: 'Artist', album: 'Album' },
    ]);

    assert.deepStrictEqual(matches['artist::album'], [oldEntry]);
  });

  it('loads the persisted index before remembering an album after worker restart', async () => {
    const existingEntry = {
      albumId: 'existing-album',
      listId: 'existing-list',
      listName: 'Existing',
    };
    const { service, storage } = createHarness({
      stored: {
        albumPresenceIndex: {
          version: 2,
          entries: { 'rym-id:101': [existingEntry] },
        },
        albumPresenceLastFetched: Date.now(),
      },
    });

    await service.rememberAlbumInList(
      {
        album_id: 'new-album',
        rymNumericId: '202',
        artist: 'New Artist',
        album: 'New Album',
      },
      { id: 'new-list', name: 'New List' }
    );

    assert.deepStrictEqual(storage.albumPresenceIndex.entries['rym-id:101'], [
      existingEntry,
    ]);
    assert.strictEqual(
      storage.albumPresenceIndex.entries['rym-id:202'][0].albumId,
      'new-album'
    );
  });
});
