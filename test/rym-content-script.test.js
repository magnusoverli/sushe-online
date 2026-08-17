const { describe, it, afterEach, mock } = require('node:test');
const assert = require('node:assert');

const albumUrl =
  'https://rateyourmusic.com/release/album/talk-talk/spirit-of-eden/';
const nativeSetTimeout = globalThis.setTimeout;
const nativeClearTimeout = globalThis.clearTimeout;

function element({ text = '', href = '', children = {} } = {}) {
  return {
    textContent: text,
    href,
    getAttribute: () => null,
    querySelectorAll: (selector) => children[selector] || [],
  };
}

function createDetailDocument({ title = '', canonicalUrl = null } = {}) {
  const section = element();
  return {
    title,
    querySelector: (selector) => {
      if (selector === 'parsererror') return null;
      if (selector === 'link[rel="canonical"]') {
        return canonicalUrl ? { href: canonicalUrl } : null;
      }
      if (selector === 'meta[property="og:url"]') return null;
      if (
        [
          '.release_pri_genres',
          '.release_sec_genres',
          '.release_descriptors',
        ].includes(selector)
      ) {
        return section;
      }
      return null;
    },
    querySelectorAll: (selector) => {
      const selectors = {
        '.release_pri_genres': [section],
        '.release_pri_genres .genre': [element({ text: 'Art Rock' })],
        '.release_sec_genres': [section],
        '.release_sec_genres .genre': [element({ text: 'Post-Rock' })],
        '.release_descriptors': [section],
        '.release_descriptors .release_pri_descriptors': [
          element({ text: 'atmospheric, melancholic' }),
        ],
      };
      return selectors[selector] || [];
    },
  };
}

function createListingDocument() {
  const container = {
    querySelectorAll: (selector) =>
      selector === '.genre'
        ? [element({ text: 'Legacy Genre' }), element({ text: 'Legacy Two' })]
        : [],
  };
  const albumLink = {
    closest: () => container,
  };

  return {
    title: 'Charts - Rate Your Music',
    querySelector: (selector) =>
      selector.startsWith('a[href*=') ? albumLink : null,
    querySelectorAll: () => [],
  };
}

function response({ html = '<html></html>', url = albumUrl, ok = true } = {}) {
  return {
    ok,
    url,
    headers: {
      get: (name) =>
        name === 'content-type' ? 'text/html; charset=utf-8' : null,
    },
    text: async () => html,
  };
}

function loadContentScript({
  fetchResponse,
  parsedDocument,
  pageDocument = createListingDocument(),
  locationHref = 'https://rateyourmusic.com/charts/top/album/all-time/',
}) {
  const listeners = [];
  globalThis.document = pageDocument;
  globalThis.location = { href: locationHref };
  globalThis.chrome = {
    runtime: {
      onMessage: { addListener: (listener) => listeners.push(listener) },
      sendMessage: async () => ({}),
    },
    storage: { local: { get: async () => ({}) } },
  };
  globalThis.fetch = mock.fn(async () =>
    typeof fetchResponse === 'function' ? fetchResponse() : fetchResponse
  );
  globalThis.DOMParser = class {
    parseFromString() {
      return parsedDocument;
    }
  };
  globalThis.setTimeout = mock.fn(() => 1);
  globalThis.clearTimeout = mock.fn();

  delete require.cache[
    require.resolve('../browser-extension/extension-constants.js')
  ];
  delete require.cache[
    require.resolve('../browser-extension/album-identity-service.js')
  ];
  delete require.cache[
    require.resolve('../browser-extension/rym-album-extractor.js')
  ];
  delete require.cache[
    require.resolve('../browser-extension/content-script.js')
  ];
  require('../browser-extension/extension-constants.js');
  require('../browser-extension/album-identity-service.js');
  require('../browser-extension/rym-album-extractor.js');
  require('../browser-extension/content-script.js');

  return globalThis.RymContentScript;
}

afterEach(() => {
  for (const name of [
    'document',
    'location',
    'chrome',
    'fetch',
    'DOMParser',
    'ExtensionConstants',
    'AlbumIdentity',
    'RymAlbumExtractor',
    'RymContentScript',
  ]) {
    delete globalThis[name];
  }
  globalThis.setTimeout = nativeSetTimeout;
  globalThis.clearTimeout = nativeClearTimeout;
  mock.reset();
});

describe('RateYourMusic listing observation fetch', () => {
  it('fetches authoritative detail taxonomy for a listing add', async () => {
    const contentScript = loadContentScript({
      fetchResponse: response(),
      parsedDocument: createDetailDocument(),
    });

    const context = {
      linkUrl: albumUrl,
      pageUrl: globalThis.location.href,
    };
    const album = await contentScript.extractAlbumDataFromPage(context);
    await contentScript.extractAlbumDataFromPage(context);

    assert.strictEqual(globalThis.fetch.mock.calls.length, 1);
    assert.strictEqual(album.genre_1, 'Art Rock');
    assert.strictEqual(album.genre_2, 'Post-Rock');
    assert.deepStrictEqual(album.sourceObservation.taxonomy.descriptors, [
      'atmospheric',
      'melancholic',
    ]);
    assert.strictEqual(album.sourceObservation.taxonomy.complete, true);
    assert.strictEqual(album.sourceObservation.identity.numericId, null);
    assert.deepStrictEqual(Object.keys(album.sourceObservation).sort(), [
      'identity',
      'platformLinks',
      'schemaVersion',
      'taxonomy',
    ]);
  });

  it('preserves listing identity and legacy genres for challenge pages', async () => {
    const contentScript = loadContentScript({
      fetchResponse: response({
        html: '<html><title>Just a moment...</title><div>cf-chl-test</div></html>',
      }),
      parsedDocument: createDetailDocument(),
    });

    const album = await contentScript.extractAlbumDataFromPage({
      linkUrl: albumUrl,
    });

    assert.strictEqual(album.artist, 'Talk Talk');
    assert.strictEqual(album.album, 'Spirit Of Eden');
    assert.strictEqual(album.genre_1, 'Legacy Genre');
    assert.strictEqual(album.genre_2, 'Legacy Two');
    assert.deepStrictEqual(album.sourceObservation.taxonomy.primaryGenres, []);
    assert.strictEqual(album.sourceObservation.taxonomy.complete, false);
  });

  it('treats malformed detail HTML as a non-fatal observation failure', async () => {
    const malformedDocument = {
      querySelector: (selector) =>
        selector === 'parsererror' ? element({ text: 'invalid' }) : null,
      querySelectorAll: () => [],
    };
    const contentScript = loadContentScript({
      fetchResponse: response({ html: '<not-valid' }),
      parsedDocument: malformedDocument,
    });

    const album = await contentScript.extractAlbumDataFromPage({
      linkUrl: albumUrl,
    });

    assert.strictEqual(album.genre_1, 'Legacy Genre');
    assert.strictEqual(album.sourceObservation.identity.canonicalUrl, albumUrl);
    assert.deepStrictEqual(album.sourceObservation.taxonomy.primaryGenres, []);
  });

  it('retries detail extraction after a transient failure', async () => {
    let attempts = 0;
    const contentScript = loadContentScript({
      fetchResponse: () => {
        attempts++;
        return attempts === 1 ? response({ ok: false }) : response();
      },
      parsedDocument: createDetailDocument(),
    });
    const context = { linkUrl: albumUrl };

    const fallback = await contentScript.extractAlbumDataFromPage(context);
    const enriched = await contentScript.extractAlbumDataFromPage(context);

    assert.strictEqual(globalThis.fetch.mock.calls.length, 2);
    assert.strictEqual(fallback.sourceObservation.taxonomy.complete, false);
    assert.strictEqual(enriched.sourceObservation.taxonomy.complete, true);
  });

  it('falls through non-album context URLs without leaking RYM title metadata', async () => {
    const pageDocument = createDetailDocument({
      title:
        'Watching From a Distance by Warning (Album, Doom Metal): Reviews, Ratings, Credits, Song list - Rate Your Music',
      canonicalUrl: albumUrl,
    });
    const contentScript = loadContentScript({
      fetchResponse: response(),
      parsedDocument: createDetailDocument(),
      pageDocument,
      locationHref: 'https://rateyourmusic.com/artist/warning/',
    });

    const album = await contentScript.extractAlbumDataFromPage({
      linkUrl: 'https://rateyourmusic.com/artist/warning/',
      pageUrl: 'https://rateyourmusic.com/artist/warning/',
    });

    assert.strictEqual(album.artist, 'Talk Talk');
    assert.strictEqual(album.album, 'Spirit Of Eden');
    assert.strictEqual(album.sourceObservation.taxonomy.complete, true);
  });

  it('strips RYM release metadata from the last-resort page title identity', async () => {
    const contentScript = loadContentScript({
      fetchResponse: response(),
      parsedDocument: createDetailDocument(),
      pageDocument: createDetailDocument({
        title:
          'Watching From a Distance by Warning (Album, Doom Metal): Reviews, Ratings, Credits, Song list - Rate Your Music',
      }),
      locationHref: 'https://rateyourmusic.com/artist/warning/',
    });

    const album = await contentScript.extractAlbumDataFromPage({
      pageUrl: 'https://rateyourmusic.com/artist/warning/',
    });

    assert.strictEqual(album.artist, 'Warning');
    assert.strictEqual(album.album, 'Watching From a Distance');
  });
});
