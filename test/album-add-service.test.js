const { describe, it, mock } = require('node:test');
const assert = require('node:assert');

require('../browser-extension/album-add-enrichment.js');
require('../browser-extension/album-add-service.js');

const albumUrl =
  'https://rateyourmusic.com/release/album/test-artist/test-album/';
const identity = {
  artist: 'Test Artist',
  album: 'Test Album',
  albumUrl,
  canonicalPath: '/release/album/test-artist/test-album/',
};

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createDeps(overrides = {}) {
  const albumApi = {
    searchMusicBrainz: mock.fn(async () => ({ id: 'release-group-1' })),
    fetchArtistCountry: mock.fn(async () => 'NO'),
    buildAlbumPayload: mock.fn(() => ({
      album_id: 'release-group-1',
      artist: identity.artist,
      album: identity.album,
    })),
    saveAlbum: mock.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ addedItems: [{ album_id: 'release-group-1' }] }),
    })),
    updateAlbumMetadata: mock.fn(async () => ({ ok: true, status: 200 })),
    updateSourceObservation: mock.fn(async () => ({ ok: true, status: 200 })),
    ...overrides.albumApi,
  };
  const chrome = {
    tabs: {
      sendMessage: mock.fn(async () => ({
        ...identity,
        sourceObservation: { taxonomy: { complete: true } },
      })),
    },
    scripting: { executeScript: mock.fn(async () => {}) },
    ...overrides.chrome,
  };

  return {
    constants: {
      ACTIONS: { EXTRACT_ALBUM_IDENTITY: 'extractAlbumIdentity' },
    },
    albumIdentity: {
      getAlbumIdentityFromUrl: (url) => (url === albumUrl ? identity : null),
    },
    showNotification: mock.fn(),
    showNotificationWithImage: mock.fn(),
    validateAndCleanToken: mock.fn(async () => ({ valid: true })),
    handleUnauthorized: mock.fn(async () => {}),
    ensureStateLoaded: mock.fn(async () => {}),
    getApiBase: () => 'https://sushe.test',
    getAuthHeaders: () => ({ Authorization: 'Bearer token' }),
    showErrorMenu: mock.fn(async () => {}),
    onAlbumAdded: mock.fn(async () => {}),
    logger: { log: mock.fn(), warn: mock.fn(), error: mock.fn() },
    ...overrides,
    albumApi,
    chrome,
  };
}

describe('album-add-service', () => {
  it('starts identity lookup before page extraction and avoids a second detail request', async () => {
    const extraction = deferred();
    const deps = createDeps();
    deps.chrome.tabs.sendMessage = mock.fn(() => extraction.promise);
    const service = globalThis.AlbumAddService.createAlbumAddService(deps);

    const adding = service.addAlbumToList(
      { linkUrl: albumUrl, srcUrl: 'https://images.test/cover.jpg' },
      { id: 7 },
      'list-1',
      'Albums'
    );
    while (deps.chrome.tabs.sendMessage.mock.calls.length === 0) {
      await Promise.resolve();
    }

    assert.strictEqual(deps.albumApi.searchMusicBrainz.mock.calls.length, 1);
    assert.strictEqual(deps.albumApi.saveAlbum.mock.calls.length, 0);

    extraction.resolve({
      ...identity,
      genre_1: '',
      genre_2: '',
      sourceObservation: { taxonomy: { complete: true } },
    });
    await adding;

    assert.strictEqual(deps.chrome.tabs.sendMessage.mock.calls.length, 1);
    assert.strictEqual(deps.albumApi.searchMusicBrainz.mock.calls.length, 1);
    assert.strictEqual(deps.albumApi.fetchArtistCountry.mock.calls.length, 1);
    assert.strictEqual(deps.albumApi.saveAlbum.mock.calls.length, 1);
    assert.strictEqual(deps.albumApi.updateAlbumMetadata.mock.calls.length, 1);
    assert.strictEqual(deps.onAlbumAdded.mock.calls.length, 1);
  });

  it('retries a failed speculative lookup with the extracted album data', async () => {
    let attempt = 0;
    const searchMusicBrainz = mock.fn(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error('temporary lookup failure');
      }
      return { id: 'release-group-1' };
    });
    const deps = createDeps({ albumApi: { searchMusicBrainz } });
    const service = globalThis.AlbumAddService.createAlbumAddService(deps);

    await service.addAlbumToList(
      { linkUrl: albumUrl },
      { id: 8 },
      'list-1',
      'Albums'
    );

    assert.strictEqual(searchMusicBrainz.mock.calls.length, 2);
    assert.strictEqual(deps.albumApi.saveAlbum.mock.calls.length, 1);
    assert.strictEqual(deps.logger.warn.mock.calls.length, 1);
  });

  it('retries missing RYM taxonomy without holding the initial save', async () => {
    const retry = deferred();
    const deps = createDeps();
    let extractionCount = 0;
    deps.chrome.tabs.sendMessage = mock.fn(() => {
      extractionCount += 1;
      if (extractionCount === 1) {
        return Promise.resolve({ ...identity });
      }
      return retry.promise;
    });
    const service = globalThis.AlbumAddService.createAlbumAddService(deps);

    const adding = service.addAlbumToList(
      { linkUrl: albumUrl },
      { id: 9 },
      'list-1',
      'Albums'
    );
    while (deps.showNotificationWithImage.mock.calls.length === 0) {
      await Promise.resolve();
    }

    assert.strictEqual(deps.albumApi.saveAlbum.mock.calls.length, 1);
    assert.strictEqual(deps.showNotificationWithImage.mock.calls.length, 1);

    retry.resolve({
      ...identity,
      sourceObservation: { taxonomy: { complete: true } },
    });
    await adding;

    assert.strictEqual(deps.chrome.tabs.sendMessage.mock.calls.length, 2);
    assert.strictEqual(deps.albumApi.saveAlbum.mock.calls.length, 1);
    assert.deepStrictEqual(
      deps.albumApi.updateSourceObservation.mock.calls[0].arguments.slice(1),
      ['release-group-1', { taxonomy: { complete: true } }]
    );
  });
});
