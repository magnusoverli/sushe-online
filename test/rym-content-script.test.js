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
        : selector === 'a[href*="/release/"]'
          ? [albumLink]
          : [],
  };
  const albumLink = {
    href: albumUrl,
    closest: () => container,
  };

  return {
    title: 'Charts - Rate Your Music',
    querySelector: () => null,
    querySelectorAll: (selector) =>
      selector === 'a[href*="/release/album/"]' ? [albumLink] : [],
  };
}

function createListingDocumentWithCover() {
  const document = createListingDocument();
  const albumLink = document.querySelectorAll('a[href*="/release/album/"]')[0];
  const row = albumLink.closest();
  const image = {
    src: 'https://images.test/cover.jpg',
    currentSrc: 'https://images.test/cover.jpg',
    closest: (selector) =>
      selector === 'a' ? { href: 'https://images.test/full.jpg' } : row,
  };
  const querySelectorAll = document.querySelectorAll;
  document.querySelectorAll = (selector) =>
    selector.startsWith('img.coverart_img')
      ? [image]
      : querySelectorAll(selector);
  return { document, image, row };
}

function response({ html = '<html></html>', url = albumUrl, ok = true } = {}) {
  const result = new globalThis.Response(html, {
    status: ok ? 200 : 503,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
  Object.defineProperty(result, 'url', { value: url });
  return result;
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
  require('../browser-extension/shared-utils.js');
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
  it('retries an incomplete detail page rather than returning the cached incomplete observation', async () => {
    const partial = { querySelector: () => null, querySelectorAll: () => [] };
    const script = loadContentScript({
      fetchResponse: () => response(),
      parsedDocument: partial,
    });
    assert.equal(
      (await script.fetchDetailObservation(albumUrl)).taxonomy.complete,
      false
    );
    Object.assign(partial, createDetailDocument());
    assert.equal(
      (await script.fetchDetailObservation(albumUrl)).taxonomy.complete,
      true
    );
    assert.equal(globalThis.fetch.mock.calls.length, 2);
  });

  it('can be reinjected without redeclaration errors or replacing its installed handler', () => {
    const script = loadContentScript({
      fetchResponse: response(),
      parsedDocument: createDetailDocument(),
    });
    delete require.cache[
      require.resolve('../browser-extension/content-script.js')
    ];
    require('../browser-extension/content-script.js');
    assert.equal(globalThis.RymContentScript, script);
  });
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

  it('resolves a listing cover image from its single album row, not the listing URL', async () => {
    const { document, image } = createListingDocumentWithCover();
    const script = loadContentScript({
      fetchResponse: response(),
      parsedDocument: createDetailDocument(),
      pageDocument: document,
    });
    const album = await script.extractAlbumDataFromPage({
      pageUrl: globalThis.location.href,
      srcUrl: image.src,
      linkUrl: 'https://images.test/full.jpg',
    });

    assert.equal(album.albumUrl, albumUrl);
    assert.equal(album.genre_1, 'Art Rock');
    assert.equal(album.sourceObservation.taxonomy.complete, true);
  });

  it('rejects unrelated and ambiguous listing images instead of guessing an album', async () => {
    const { document, image, row } = createListingDocumentWithCover();
    const script = loadContentScript({
      fetchResponse: response(),
      parsedDocument: createDetailDocument(),
      pageDocument: document,
    });
    const context = {
      pageUrl: globalThis.location.href,
      srcUrl: image.src,
      linkUrl: 'https://images.test/full.jpg',
    };
    for (const overrides of [
      { srcUrl: 'https://images.test/unrelated.jpg' },
      { linkUrl: 'https://images.test/other.jpg' },
      { linkUrl: albumUrl.replace('/album/', '/ep/') },
    ]) {
      await assert.rejects(
        script.extractAlbumDataFromPage({ ...context, ...overrides }),
        /Only album releases/
      );
    }
    const querySelectorAll = row.querySelectorAll;
    row.querySelectorAll = (selector) =>
      selector === 'a[href*="/release/"]'
        ? [
            { href: albumUrl },
            { href: albumUrl.replace('spirit-of-eden', 'another-album') },
          ]
        : querySelectorAll(selector);
    await assert.rejects(
      script.extractAlbumDataFromPage(context),
      /Only album releases/
    );
    assert.equal(globalThis.fetch.mock.calls.length, 0);
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

  it('rejects unsupported selections instead of substituting the current album or document title', async () => {
    const contentScript = loadContentScript({
      fetchResponse: response(),
      parsedDocument: createDetailDocument(),
      pageDocument: createDetailDocument({
        title: 'Spirit of Eden by Talk Talk - Rate Your Music',
        canonicalUrl: albumUrl,
      }),
      locationHref: albumUrl,
    });
    for (const linkUrl of [
      albumUrl.replace('/album/', '/ep/'),
      albumUrl.replace('/album/', '/single/'),
      'https://rateyourmusic.com/artist/talk-talk/',
      'https://example.com/album',
    ]) {
      await assert.rejects(
        contentScript.extractAlbumDataFromPage({ linkUrl, pageUrl: albumUrl }),
        /Only album releases/
      );
    }
    assert.equal(globalThis.fetch.mock.calls.length, 0);
  });

  it('uses a supported detail page title without its RYM release metadata', async () => {
    const url =
      'https://rateyourmusic.com/release/album/warning/watching-from-a-distance/';
    const contentScript = loadContentScript({
      fetchResponse: response(),
      parsedDocument: createDetailDocument(),
      pageDocument: createDetailDocument({
        title:
          'Watching From a Distance by Warning (Album, Doom Metal): Reviews, Ratings, Credits, Song list - Rate Your Music',
      }),
      locationHref: url,
    });

    const album = await contentScript.extractAlbumDataFromPage({
      pageUrl: url,
    });

    assert.strictEqual(album.artist, 'Warning');
    assert.strictEqual(album.album, 'Watching From a Distance');
  });

  it('does not copy the current album genres when a linked detail page is unavailable', async () => {
    const selectedUrl =
      'https://rateyourmusic.com/release/album/other-artist/other-album/';
    const script = loadContentScript({
      fetchResponse: response({ ok: false }),
      pageDocument: createDetailDocument(),
      locationHref: albumUrl,
    });
    const selected = await script.extractAlbumDataFromPage({
      linkUrl: selectedUrl,
      pageUrl: albumUrl,
    });
    assert.equal(selected.albumUrl, selectedUrl);
    assert.equal(selected.genre_1, '');
    assert.equal(selected.genre_2, '');
    assert.equal(selected.sourceObservation.taxonomy.complete, false);
    const current = await script.extractAlbumDataFromPage({
      pageUrl: albumUrl,
    });
    assert.equal(current.genre_1, 'Art Rock');
  });

  it('does not accept a listing row belonging to a different release or multiple releases', async () => {
    const pageDocument = createListingDocument();
    const script = loadContentScript({
      fetchResponse: () => response({ ok: false }),
      pageDocument,
    });
    const selectedUrl = albumUrl.replace('spirit-of-eden', 'spirit-of-eden-2');
    const unrelated = await script.extractAlbumDataFromPage({
      linkUrl: selectedUrl,
    });
    assert.equal(unrelated.genre_1, '');
    const [link] = pageDocument.querySelectorAll('a[href*="/release/album/"]');
    const row = link.closest();
    const query = row.querySelectorAll;
    for (const href of [selectedUrl, selectedUrl.replace('/album/', '/ep/')]) {
      row.querySelectorAll = (selector) =>
        selector === 'a[href*="/release/"]'
          ? [link, { href }]
          : query(selector);
      const ambiguous = await script.extractAlbumDataFromPage({
        linkUrl: albumUrl,
      });
      assert.equal(ambiguous.genre_1, '');
    }
  });

  for (const local of [true, false]) {
    it(`uses display names with punctuation for MusicBrainz on ${local ? 'local' : 'fetched'} detail pages`, async () => {
      const url =
        'https://rateyourmusic.com/release/album/marvin-gaye/whats-going-on-43/';
      const document = createDetailDocument({
        title: "What's Going On by Marvin Gaye (Album, Soul) - Rate Your Music",
        canonicalUrl: url,
      });
      const script = loadContentScript({
        fetchResponse: response({ url }),
        parsedDocument: document,
        ...(local ? { pageDocument: document, locationHref: url } : {}),
      });
      const album = await script.extractAlbumDataFromPage({ linkUrl: url });
      assert.equal(album.album, "What's Going On");
      assert.equal(album.sourceObservation.identity.title, "What's Going On");
      require('../browser-extension/album-api-service');
      const api = globalThis.AlbumApiService.createAlbumApiService({
        getAuthHeaders: () => ({}),
        fetchWithTimeout: async () => ({
          ok: true,
          json: async () => ({
            'release-groups': [
              {
                id: 'matching-album',
                title: "What's Going On",
                'artist-credit': [{ name: 'Marvin Gaye' }],
              },
            ],
          }),
        }),
      });
      assert.equal(
        (await api.searchMusicBrainz('https://sushe.test', album)).id,
        'matching-album'
      );
    });
  }

  it('rejects a fetched document whose canonical identity disagrees with the selected URL', async () => {
    const script = loadContentScript({
      fetchResponse: response(),
      parsedDocument: createDetailDocument({
        canonicalUrl: albumUrl.replace('spirit-of-eden', 'another-album'),
      }),
      pageDocument: { querySelector: () => null, querySelectorAll: () => [] },
    });
    const album = await script.extractAlbumDataFromPage({ linkUrl: albumUrl });
    assert.equal(album.genre_1, '');
    assert.equal(album.sourceObservation.taxonomy.complete, false);
  });
});
