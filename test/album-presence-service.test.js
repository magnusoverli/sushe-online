const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert');
require('../browser-extension/shared-utils');

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

function createHarness({
  stored = {},
  items = [],
  fetchError = null,
  responseStatus = 200,
} = {}) {
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
      ok: responseStatus === 200,
      status: responseStatus,
      json: async () => ({ items }),
    };
  });
  const handleUnauthorized = mock.fn(async () => {});
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
    handleUnauthorized,
    getApiBase: () => 'https://sushe.example',
    getAuthHeaders: () => ({ Authorization: 'Bearer token' }),
    logger: { warn: mock.fn() },
  });

  return { fetchWithTimeout, handleUnauthorized, service, storage };
}

describe('extension album presence identity index', () => {
  beforeEach(loadServices);

  afterEach(() => {
    delete globalThis.AlbumIdentity;
    delete globalThis.AlbumPresenceService;
    mock.reset();
  });

  it('preserves a successful addition when an older presence response arrives', async () => {
    const harness = createHarness();
    let resolve;
    harness.fetchWithTimeout.mock.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const albums = [{ key: 'new', artist: 'Artist', album: 'Album' }];
    const reading = harness.service.getPresenceForAlbums(albums);
    while (!resolve) await Promise.resolve();
    await harness.service.rememberAlbumInList(
      { album_id: 'album', artist: 'Artist', album: 'Album' },
      { id: 'list', name: 'List', isMain: true }
    );
    resolve({ ok: true, status: 200, json: async () => ({ items: [] }) });
    const matches = await reading;
    assert.equal(matches.new[0].albumId, 'album');
    assert.equal(matches.new[0].isMain, true);
  });

  it('remembering a single album does not mark the entire presence index fresh', async () => {
    const harness = createHarness();
    await harness.service.rememberAlbumInList(
      { artist: 'Artist', album: 'Album' },
      { id: 'list', name: 'List' }
    );
    assert.equal(harness.storage.albumPresenceLastFetched, 0);
    await harness.service.getPresenceForAlbums([], { forceRefresh: true });
    assert.equal(harness.fetchWithTimeout.mock.calls.length, 1);
  });

  it('concurrent callers get the same offline fallback', async () => {
    const harness = createHarness();
    let reject;
    harness.fetchWithTimeout.mock.mockImplementation(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        })
    );
    const first = harness.service.getPresenceForAlbums([], {
      forceRefresh: true,
    });
    while (!reject) await Promise.resolve();
    const second = harness.service.getPresenceForAlbums([], {
      forceRefresh: true,
    });
    await new Promise((resolve) => setImmediate(resolve));
    reject(new Error('offline'));
    assert.deepEqual(await Promise.all([first, second]), [{}, {}]);
    assert.equal(harness.fetchWithTimeout.mock.calls.length, 1);
  });

  for (const status of [401, 403]) {
    it(`${status === 401 ? 'clears' : 'retains'} cached presence after HTTP ${status}`, async () => {
      const harness = createHarness({
        responseStatus: status,
        stored: {
          albumPresenceIndex: {
            version: 4,
            entries: {
              'name:artist::album': [
                { listId: 'old-list', identityKeys: ['name:artist::album'] },
              ],
            },
          },
          albumPresenceLastFetched: Date.now(),
        },
      });
      const matches = await harness.service.getPresenceForAlbums(
        [{ key: 'album', artist: 'Artist', album: 'Album' }],
        { forceRefresh: true }
      );
      assert.strictEqual(
        harness.handleUnauthorized.mock.calls.length,
        status === 401 ? 1 : 0
      );
      assert.strictEqual(Boolean(matches.album), status === 403);
      assert.strictEqual(
        Boolean(harness.storage.albumPresenceIndex),
        status === 403
      );
    });
  }

  it('cannot repopulate the old account cache when a fetch finishes after logout', async () => {
    const harness = createHarness({
      items: [{ artist: 'Artist', album: 'Album', listId: 'old-list' }],
    });
    let release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const originalFetch = harness.fetchWithTimeout;
    const response = await originalFetch();
    originalFetch.mock.mockImplementation(async () => pending);
    const reading = harness.service.getPresenceForAlbums([
      { key: 'album', artist: 'Artist', album: 'Album' },
    ]);
    while (originalFetch.mock.calls.length < 2) await Promise.resolve();
    await harness.service.clear();
    release(response);
    assert.deepStrictEqual(await reading, {});
    assert.strictEqual(harness.storage.albumPresenceIndex, undefined);
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
    assert.strictEqual(storage.albumPresenceIndex.version, 4);
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
      version: 4,
      entries: {
        'name:artist::album': [
          { ...rebuiltEntry, identityKeys: ['name:artist::album'] },
        ],
      },
    });
  });

  it('does not reuse lossy legacy name matches when their rebuild fails', async () => {
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

    assert.strictEqual(matches['artist::album'], undefined);
  });

  it('loads the persisted index before remembering an album after worker restart', async () => {
    const existingEntry = {
      albumId: 'existing-album',
      listId: 'existing-list',
      listName: 'Existing',
      identityKeys: ['rym-id:101'],
    };
    const { service, storage } = createHarness({
      stored: {
        albumPresenceIndex: {
          version: 4,
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

  it('rejects conflicting numeric IDs before canonical or name fallback and conflicting paths before name fallback', async () => {
    const url = 'https://rateyourmusic.com/release/album/artist/record/';
    const { service } = createHarness({
      items: [
        {
          artist: 'Artist',
          album: 'Record',
          rymNumericId: '111',
          rymCanonicalUrl: url,
          albumId: 'existing',
          listId: 'list',
          listName: 'List',
        },
      ],
    });
    const matches = await service.getPresenceForAlbums([
      {
        key: 'numeric-conflict',
        artist: 'Artist',
        album: 'Record',
        numericId: '222',
        canonicalUrl: url,
      },
      {
        key: 'path-conflict',
        artist: 'Artist',
        album: 'Record',
        canonicalUrl: url.replace('/record/', '/record-2/'),
      },
      {
        key: 'both-conflict',
        artist: 'Artist',
        album: 'Record',
        numericId: '222',
        canonicalUrl: url.replace('/record/', '/record-2/'),
      },
      {
        key: 'same-id-renamed-url',
        numericId: '111',
        canonicalUrl: url.replace('/record/', '/renamed-record/'),
      },
      { key: 'legacy-name-only', artist: 'Artist', album: 'Record' },
    ]);
    assert.equal(matches['numeric-conflict'], undefined);
    assert.equal(matches['path-conflict'], undefined);
    assert.equal(matches['both-conflict'], undefined);
    assert.equal(matches['same-id-renamed-url'][0].albumId, 'existing');
    assert.equal(matches['legacy-name-only'][0].albumId, 'existing');
  });

  it('preserves distinct same-name albums in one list and filters conflicts per entry after restart', async () => {
    const albums = ['111', '222'].map((id) => ({
      artist: 'Artist',
      album: 'Record',
      rymNumericId: id,
      albumId: id,
      listId: 'shared-list',
      listName: 'Shared',
    }));
    const first = createHarness({ items: albums });
    const query = [{ key: 'record', artist: 'Artist', album: 'Record' }];
    assert.equal(
      (await first.service.getPresenceForAlbums(query)).record.length,
      2
    );
    const restarted = createHarness({
      stored: first.storage,
      fetchError: new Error('offline'),
    });
    const matches = await restarted.service.getPresenceForAlbums([
      { ...query[0], numericId: '111' },
    ]);
    assert.deepEqual(
      matches.record.map((entry) => entry.albumId),
      ['111']
    );
    const conflicts = await restarted.service.getPresenceForAlbums([
      { ...query[0], numericId: '333' },
    ]);
    assert.deepEqual(conflicts, {});
    assert.equal(restarted.fetchWithTimeout.mock.calls.length, 0);
  });

  it('discards old indexes without per-entry identity evidence, including exact-path entries', async () => {
    const canonicalUrl =
      'https://rateyourmusic.com/release/album/artist/record/';
    const { service, fetchWithTimeout } = createHarness({
      stored: {
        albumPresenceIndex: {
          version: 3,
          entries: {
            'rym-id:111': [{ listId: 'list', albumId: 'existing' }],
            'rym-path:/release/album/artist/record/': [
              { listId: 'list', albumId: 'existing' },
            ],
            'name:artist::record': [{ listId: 'list', albumId: 'existing' }],
          },
        },
        albumPresenceLastFetched: Date.now(),
      },
      fetchError: new Error('offline'),
    });
    assert.deepEqual(
      await service.getPresenceForAlbums([
        {
          key: 'record',
          numericId: '222',
          canonicalUrl,
          artist: 'Artist',
          album: 'Record',
        },
      ]),
      {}
    );
    assert.equal(fetchWithTimeout.mock.calls.length, 1);
  });
});
