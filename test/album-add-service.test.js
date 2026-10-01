const { describe, it, mock } = require('node:test');
const assert = require('node:assert');

require('../browser-extension/shared-utils.js');
require('../browser-extension/album-identity-service.js');
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

  const deps = {
    constants: {
      ACTIONS: { EXTRACT_ALBUM_IDENTITY: 'extractAlbumIdentity' },
    },
    albumIdentity: globalThis.AlbumIdentity,
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
  deps.captureScope = () => {
    const apiBase = deps.getApiBase();
    const authorization = deps.getAuthHeaders().Authorization;
    const isCurrent = () =>
      apiBase === deps.getApiBase() &&
      authorization === deps.getAuthHeaders().Authorization;
    return {
      apiBase,
      isCurrent,
      assertCurrent: () => {
        if (!isCurrent()) throw new Error('Account changed');
      },
      unauthorized: async () => {
        if (isCurrent()) await deps.handleUnauthorized();
      },
    };
  };
  return deps;
}

describe('album-add-service', () => {
  it('rejects an unsupported clicked release before extraction or lookup, even on an album page', async () => {
    const deps = createDeps();
    await globalThis.AlbumAddService.createAlbumAddService(deps).addAlbumToList(
      { linkUrl: albumUrl.replace('/album/', '/ep/'), pageUrl: albumUrl },
      { id: 7 },
      'list',
      'List'
    );
    assert.equal(deps.albumApi.searchMusicBrainz.mock.calls.length, 0);
    assert.equal(deps.chrome.tabs.sendMessage.mock.calls.length, 0);
    assert.equal(deps.albumApi.saveAlbum.mock.calls.length, 0);
    assert.match(
      deps.showNotification.mock.calls[0].arguments[1],
      /Only album releases/
    );
  });

  it('accepts a listing cover only after extraction identifies its album', async () => {
    const deps = createDeps();
    const pageUrl = 'https://rateyourmusic.com/charts/top/album/all-time/';
    await globalThis.AlbumAddService.createAlbumAddService(deps).addAlbumToList(
      {
        pageUrl,
        linkUrl: 'https://images.test/full.jpg',
        srcUrl: 'https://images.test/cover.jpg',
      },
      { id: 7 },
      'list',
      'List'
    );
    assert.equal(deps.albumApi.saveAlbum.mock.calls.length, 1);
    assert.equal(deps.showNotification.mock.calls.length, 0);
  });

  it('adds an album from its own cover image linked to the RYM buy page', async () => {
    const deps = createDeps();
    await globalThis.AlbumAddService.createAlbumAddService(deps).addAlbumToList(
      {
        pageUrl: albumUrl,
        linkUrl: `${albumUrl}buy/`,
        srcUrl: 'https://cdn.sonemic.net/i/600/cover.png',
        mediaType: 'image',
      },
      { id: 7 },
      'list',
      'List'
    );
    assert.equal(deps.chrome.tabs.sendMessage.mock.calls.length, 1);
    assert.equal(
      deps.chrome.tabs.sendMessage.mock.calls[0].arguments[1].mediaType,
      'image'
    );
    assert.equal(deps.albumApi.saveAlbum.mock.calls.length, 1);
    assert.equal(deps.showNotification.mock.calls.length, 0);
  });

  it('rejects an unsupported release linked from an image before extraction', async () => {
    const deps = createDeps();
    await globalThis.AlbumAddService.createAlbumAddService(deps).addAlbumToList(
      {
        pageUrl: albumUrl,
        linkUrl: albumUrl.replace('/album/', '/ep/'),
        srcUrl: 'https://images.test/cover.jpg',
      },
      { id: 7 },
      'list',
      'List'
    );
    assert.equal(deps.chrome.tabs.sendMessage.mock.calls.length, 0);
    assert.equal(deps.albumApi.saveAlbum.mock.calls.length, 0);
  });

  for (const extraction of [
    { error: 'Selected release is unsupported' },
    {
      ...identity,
      albumUrl: albumUrl.replace('test-album', 'different-album'),
      canonicalPath: undefined,
    },
  ]) {
    it(`does not override an extraction rejection or conflicting identity: ${extraction.error || extraction.albumUrl}`, async () => {
      const deps = createDeps();
      deps.chrome.tabs.sendMessage = mock.fn(async () => extraction);
      await globalThis.AlbumAddService.createAlbumAddService(
        deps
      ).addAlbumToList({ linkUrl: albumUrl }, { id: 7 }, 'list', 'List');
      assert.equal(deps.albumApi.saveAlbum.mock.calls.length, 0);
      assert.equal(deps.showNotificationWithImage.mock.calls.length, 0);
      assert.equal(deps.showNotification.mock.calls.length, 1);
    });
  }

  it('does not save or clear replacement auth when an account changes during extraction', async () => {
    const extraction = deferred();
    let token = 'old';
    const deps = createDeps({
      getAuthHeaders: () => ({ Authorization: token }),
    });
    deps.chrome.tabs.sendMessage = mock.fn(() => extraction.promise);
    const adding = globalThis.AlbumAddService.createAlbumAddService(
      deps
    ).addAlbumToList({ linkUrl: albumUrl }, { id: 7 }, 'list', 'List');
    while (!deps.chrome.tabs.sendMessage.mock.calls.length)
      await Promise.resolve();
    token = 'new';
    extraction.resolve({ ...identity });
    await adding;
    assert.equal(deps.albumApi.saveAlbum.mock.calls.length, 0);
    assert.equal(deps.handleUnauthorized.mock.calls.length, 0);
  });

  it('duplicate additions reconcile badges and last-used state without incrementing counts', async () => {
    const deps = createDeps({
      albumApi: {
        saveAlbum: async () => ({
          ok: true,
          json: async () => ({ duplicates: [{ album_id: 'canonical' }] }),
        }),
      },
    });
    await globalThis.AlbumAddService.createAlbumAddService(deps).addAlbumToList(
      { linkUrl: albumUrl },
      { id: 7 },
      'list',
      'List'
    );
    assert.equal(deps.onAlbumAdded.mock.calls[0].arguments[0].added, false);
    assert.equal(
      deps.onAlbumAdded.mock.calls[0].arguments[0].album.album_id,
      'canonical'
    );
  });
  for (const { status, body, message } of [
    {
      status: 403,
      body: { code: 'CSRF_INVALID', error: { message: 'Invalid CSRF token' } },
      message: 'Invalid CSRF token',
    },
    {
      status: 403,
      body: { error: 'List is locked' },
      message: 'List is locked',
    },
    {
      status: 502,
      body: '<html>Bad gateway</html>',
      message: 'Failed to add album (HTTP 502)',
    },
    {
      status: 401,
      body: { error: 'Unauthorized' },
      message:
        'Not authenticated. Please click the extension icon and login again.',
    },
  ]) {
    it(`reports a ${status} save failure without retrying or running post-save work: ${message}`, async () => {
      const deps = createDeps({
        albumApi: {
          saveAlbum: mock.fn(
            async () =>
              new globalThis.Response(
                typeof body === 'string' ? body : JSON.stringify(body),
                { status }
              )
          ),
        },
      });
      const service = globalThis.AlbumAddService.createAlbumAddService(deps);
      await service.addAlbumToList(
        { linkUrl: albumUrl },
        { id: 7 },
        'list-1',
        'Albums'
      );
      assert.deepStrictEqual(deps.showNotification.mock.calls[0].arguments, [
        '❌ Error',
        message,
      ]);
      assert.strictEqual(deps.albumApi.saveAlbum.mock.calls.length, 1);
      assert.strictEqual(
        deps.handleUnauthorized.mock.calls.length,
        status === 401 ? 1 : 0
      );
      assert.strictEqual(deps.showNotificationWithImage.mock.calls.length, 0);
      assert.strictEqual(
        deps.albumApi.updateAlbumMetadata.mock.calls.length,
        0
      );
      assert.strictEqual(
        deps.albumApi.updateSourceObservation.mock.calls.length,
        0
      );
      assert.strictEqual(deps.onAlbumAdded.mock.calls.length, 0);
    });
  }

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
