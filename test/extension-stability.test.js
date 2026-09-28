const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../browser-extension/extension-constants');
require('../browser-extension/shared-utils');
require('../browser-extension/album-identity-service');
require('../browser-extension/album-api-service');
require('../browser-extension/rym-album-extractor');

test('album names preserve meaningful numbers and Unicode matching identities', () => {
  const identity = globalThis.AlbumIdentity;
  assert.equal(identity.cleanName('blink-182'), 'Blink 182');
  assert.equal(identity.cleanName('apokalyps-1618'), 'Apokalyps 1618');
  assert.equal(
    identity.getAlbumKey({ artist: '東京', album: '音楽' }),
    '東京::音楽'
  );
  assert.notEqual(
    identity.getAlbumKey({ artist: '東京', album: '音楽' }),
    identity.getAlbumKey({ artist: '大阪', album: '音楽' })
  );
});

test('MusicBrainz search preserves query delimiters and rejects mismatched or ambiguous releases', async () => {
  let url;
  let releases = [
    {
      id: 'correct',
      title: 'Bookends',
      'artist-credit': [{ name: 'Simon & Garfunkel' }],
    },
  ];
  const api = globalThis.AlbumApiService.createAlbumApiService({
    getAuthHeaders: () => ({ Authorization: 'test' }),
    handleUnauthorized: async () => {},
    fetchWithTimeout: async (value) => {
      url = value;
      return { ok: true, json: async () => ({ 'release-groups': releases }) };
    },
  });
  const query = { artist: 'Simon & Garfunkel', album: 'Bookends' };
  assert.equal(
    (await api.searchMusicBrainz('https://sushe.test', query)).id,
    'correct'
  );
  const endpoint = new URL(url).searchParams.get('endpoint');
  assert.equal(
    new URL(endpoint, 'https://musicbrainz.org/').searchParams.get('query'),
    'Simon & Garfunkel Bookends'
  );
  releases = [
    { id: 'wrong', title: 'Other', 'artist-credit': [{ name: query.artist }] },
  ];
  await assert.rejects(
    api.searchMusicBrainz('https://sushe.test', query),
    /match/i
  );
  releases = ['one', 'two'].map((id) => ({
    id,
    title: query.album,
    'artist-credit': [{ name: query.artist }],
  }));
  await assert.rejects(
    api.searchMusicBrainz('https://sushe.test', query),
    /ambiguous/i
  );
});

test('partial RYM sections are not an authoritative empty taxonomy snapshot', () => {
  const document = {
    querySelector: (selector) =>
      selector === '.release_pri_genres' ? {} : null,
    querySelectorAll: () => [],
  };
  const observation = globalThis.RymAlbumExtractor.extract(
    document,
    'https://rateyourmusic.com/release/album/artist/record/'
  );
  assert.equal(observation.taxonomy.complete, false);
});

test('transport honors caller cancellation and times out while consuming the body', async (t) => {
  const controller = new AbortController();
  controller.abort();
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => {
    signal.throwIfAborted();
    return new globalThis.Response(
      new globalThis.ReadableStream({ start() {} })
    );
  });
  await assert.rejects(
    globalThis.SharedUtils.fetchApiWithTimeout('https://sushe.test', {
      signal: controller.signal,
    }),
    { name: 'AbortError' }
  );
  await assert.rejects(
    globalThis.SharedUtils.fetchApiWithTimeout('https://sushe.test', {}, 10),
    /timed out/
  );
});

test('streamed response size is bounded by bytes and the reader is cancelled', async (t) => {
  let cancelled = false;
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new globalThis.Response(
        new globalThis.ReadableStream({
          pull(controller) {
            controller.enqueue(new Uint8Array(20));
          },
          cancel() {
            cancelled = true;
          },
        })
      )
  );
  await assert.rejects(
    globalThis.SharedUtils.fetchWithTimeout('https://rateyourmusic.com', {
      maxResponseBytes: 10,
    }),
    /size limit/
  );
  assert.equal(cancelled, true);
});

test('notification artwork failures fall back to the packaged icon without unhandled errors', async (t) => {
  const icons = [];
  const chrome = {
    runtime: {},
    notifications: {
      create(options, callback) {
        icons.push(options.iconUrl);
        chrome.runtime.lastError =
          icons.length === 1 ? { message: 'Image unavailable' } : undefined;
        callback();
      },
    },
  };
  const previous = globalThis.chrome;
  globalThis.chrome = chrome;
  t.after(() => {
    if (previous) globalThis.chrome = previous;
    else delete globalThis.chrome;
  });
  assert.equal(
    await globalThis.SharedUtils.showNotificationWithImage(
      'Added',
      'Album',
      'https://bad-image.test'
    ),
    true
  );
  assert.deepEqual(icons, ['https://bad-image.test', 'icons/icon128.png']);
});
