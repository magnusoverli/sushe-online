const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { escapeHtml } = require('../utils/escape-html');

// Execute the real browser module without its app-wide import side effects.
// The DOM stub retains emitted HTML; render assertions exercise the production
// templates, not a test-only reimplementation of the escaping or lifecycle.
const source = fs
  .readFileSync(path.join(__dirname, '../src/js/musicbrainz.js'), 'utf8')
  .replace(/^import\s[\s\S]*?from '[^']+';\r?\n/gm, '')
  .replace(/^export \{[^}]+\};/gm, '');

function element() {
  const classes = new Set();
  let html = '';
  return {
    children: [],
    dataset: {},
    style: {},
    options: [{}],
    value: '',
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
      toggle: (name, active) =>
        active ? classes.add(name) : classes.delete(name),
    },
    set innerHTML(value) {
      html = value;
      this.children = [];
    },
    get innerHTML() {
      return html;
    },
    set textContent(value) {
      this.innerHTML = escapeHtml(value);
    },
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
    },
    querySelector(selector) {
      if (selector === '.artist-image-container') {
        this.imageContainer ||= element();
        return this.imageContainer;
      }
      if (selector === '.album-cover-container') {
        this.coverContainer ||= element();
        return this.coverContainer;
      }
      return null;
    },
    reset() {},
  };
}

async function harness() {
  const artistNames =
    await import('../src/js/modules/musicbrainz-artist-name.js');
  const artistImages = await import('../src/js/modules/artist-image-loader.js');
  const covers = await import('../src/js/modules/album-cover-loader.js');
  const { createArtistDiscography } =
    await import('../src/js/modules/artist-discography.js');
  const normalization = await import('../src/js/modules/normalization.js');
  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  const requests = [];
  const toasts = [];
  const additions = [];
  const observers = [];
  const context = vm.createContext({
    ...artistNames,
    ...artistImages,
    ...normalization,
    createArtistDiscography,
    createAlbumCoverLoader: () =>
      covers.createAlbumCoverLoader({
        providers: covers.createCoverProviders({
          fetcher: (...args) => context.fetch(...args),
          verify: async (url) => url,
        }),
      }),
    createAlbumCoverObserver: (load, peek, root) =>
      covers.createAlbumCoverObserver(
        load,
        peek,
        root,
        context.IntersectionObserver
      ),
    escapeHtml,
    escapeHtmlAttr: escapeHtml,
    AbortController,
    DOMException,
    setTimeout,
    clearTimeout,
    console: { log() {}, debug() {}, warn() {}, error() {} },
    window: { addEventListener() {} },
    document: {
      readyState: 'loading',
      addEventListener() {},
      getElementById: getElement,
      createElement: element,
      querySelector: () => null,
      querySelectorAll: () => [],
      head: element(),
    },
    IntersectionObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.rows = [];
        observers.push(this);
      }
      observe(row) {
        this.rows.push(row);
      }
      unobserve() {}
      disconnect() {
        this.disconnected = true;
      }
    },
    createModal: ({ element: modal, onClose }) => ({
      open: () => modal.classList.remove('hidden'),
      close: () => {
        modal.classList.add('hidden');
        onClose();
      },
    }),
    isMobileViewport: () => false,
    getCurrentListId: () => 'list-1',
    getCurrentRecommendationsYear: () => null,
    getAvailableCountries: () => [],
    showToast: (...args) => toasts.push(args),
    recordAddition: (album, artist) => additions.push({ album, artist }),
    fetch: (url, options) =>
      new Promise((resolve, reject) => {
        requests.push({
          endpoint: new URL(url, 'https://example.test').searchParams.get(
            'endpoint'
          ),
          signal: options.signal,
          resolve: (data) => resolve({ ok: true, json: async () => data }),
          reject,
        });
      }),
  });
  vm.runInContext(source, context);
  vm.runInContext(
    `initializeAddAlbumFeature();
     addAlbumToList = (album) => recordAddition(album, currentArtist);`,
    context
  );
  context.window.openAddAlbumModal();
  return {
    context,
    requests,
    toasts,
    additions,
    observers,
    getElement,
    run: (code) => vm.runInContext(code, context),
    search(query, mode = 'artist') {
      context.updateSearchMode(mode);
      getElement('artistSearchInput').value = query;
      return context.performSearch();
    },
  };
}

function release(title = 'Album', artist = 'Artist') {
  return {
    id: title,
    title,
    'primary-type': 'Album',
    'first-release-date': '2000-01-01',
    'artist-credit': [{ name: artist, artist: { id: artist, name: artist } }],
  };
}

function response(mode, name) {
  return mode === 'artist'
    ? { artists: name ? [{ id: name, name }] : [] }
    : { 'release-groups': name ? [release(name)] : [] };
}

function settle(request, mode, outcome) {
  if (outcome === 'error') request.reject(new Error('Late failure'));
  else request.resolve(response(mode, outcome === 'empty' ? null : 'Old A'));
}

describe('MusicBrainz search ownership', () => {
  it('passes provider freshness to the discography cache without altering JSON fields', async () => {
    const h = await harness();
    h.context.fetch = async () => ({
      ok: true,
      headers: new Headers({ 'X-Provider-Cache': 'STALE' }),
      json: async () => ({ 'release-groups': [] }),
    });
    const data = await h.context.rateLimitedFetch('release-group?query=test');
    assert.equal(data._providerCache, 'STALE');
    assert.deepEqual(Object.keys(data), ['release-groups']);
  });
  for (const outcome of ['error', 'malformed', 'logical', 'empty']) {
    it(`distinguishes artist album ${outcome} from missing albums and restores images after failure`, async () => {
      const h = await harness();
      const artist = { id: 'A', name: 'Artist A' };
      await h.context.displayArtistResults([artist]);
      const observer = h.observers.at(-1);
      const selection = h.context.selectArtist(artist);
      if (outcome === 'error')
        h.requests[0].reject(new Error('Upstream failed'));
      else if (outcome === 'malformed') h.requests[0].resolve({});
      else if (outcome === 'logical')
        h.requests[0].resolve({ error: 'Busy', 'release-groups': [] });
      else h.requests[0].resolve({ 'release-groups': [] });
      await selection;
      const message = h.toasts.at(-1)[0];
      assert.match(
        message,
        outcome === 'empty' ? /No albums/ : /Could not load albums/
      );
      if (outcome !== 'empty') {
        assert.notEqual(h.observers.at(-1), observer);
        assert.equal(h.observers.at(-1).rows.length, 1);
        assert.equal(
          h.getElement('artistResults').classList.contains('hidden'),
          false
        );
      }
    });
  }

  for (const mode of ['artist', 'album']) {
    it(`${mode} malformed responses are failures, not empty search results`, async () => {
      const h = await harness();
      const search = h.search('query', mode);
      h.requests[0].resolve({ error: 'Service temporarily unavailable' });
      await search;
      assert.match(h.toasts.at(-1)[0], /Error searching/);
    });
  }
  it('retries provider logical errors even when empty result fields are present', async () => {
    for (const [index, data] of [
      [0, { error: { code: 4, message: 'Quota exceeded' }, data: [] }],
      [1, { errorMessage: 'Service unavailable', results: [] }],
    ]) {
      const h = await harness();
      let calls = 0;
      h.context.fetch = async () => {
        calls++;
        return { ok: true, json: async () => data };
      };
      h.run(
        `artistImageProviders.splice(0, artistImageProviders.length, artistImageProviders[${index}])`
      );
      await h.run("artistImageLoader.search('Artist')");
      await h.run("artistImageLoader.search('Artist')");
      assert.equal(calls, 2);
    }
  });

  it('rejects MusicBrainz and Wikidata logical errors instead of caching misses', async () => {
    const h = await harness();
    h.context.rateLimitedFetch = async () => ({
      error: 'unavailable',
      relations: [],
    });
    await assert.rejects(
      h.run("artistImageProviders[2].search('Artist', 'id', null, new Set())"),
      /MusicBrainz provider error/
    );
    h.context.rateLimitedFetch = async (_endpoint, priority) => {
      assert.equal(priority, 'low');
      return {
        relations: [
          {
            type: 'wikidata',
            url: { resource: 'https://wikidata.org/wiki/Q1' },
          },
        ],
      };
    };
    h.context.fetch = async () => ({
      ok: true,
      json: async () => ({ error: { code: 'maxlag' }, claims: {} }),
    });
    await assert.rejects(
      h.run("artistImageProviders[2].search('Artist', 'id', null, new Set())"),
      /Wikidata provider error/
    );
  });

  it('artist providers preserve normalized matching, smaller images, and album-art alternatives', async () => {
    const h = await harness();
    const verified = [];
    h.context.firstWorkingArtistImage = async (urls) => {
      verified.push([...urls]);
      return urls[0];
    };
    h.context.fetch = async () => ({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 1,
            name: 'Bjork',
            picture_medium: 'medium',
            picture_small: 'small',
          },
          { id: 2, name: 'Bjork Tribute', picture_medium: 'unrelated' },
        ],
      }),
    });
    assert.equal(
      await h.run(
        "artistImageProviders[0].search('Bj\u00f6rk', 'mb-id', null, new Set())"
      ),
      'medium'
    );
    assert.deepEqual(verified[0].filter(Boolean), ['medium', 'small']);
    h.context.fetch = async () => ({
      ok: true,
      json: async () => ({
        results: [
          {
            artistId: 1,
            artistName: 'Bjork',
            artworkUrl100: 'https://img/100x100bb.jpg',
          },
          {
            artistId: 1,
            artistName: 'Bjork',
            artworkUrl100: 'https://other/100x100bb.jpg',
          },
          {
            artistId: 2,
            artistName: 'Tribute to Bjork',
            artworkUrl100: 'unrelated',
          },
        ],
      }),
    });
    assert.equal(
      await h.run(
        "artistImageProviders[1].search('Bj\u00f6rk', 'mb-id', null, new Set())"
      ),
      'https://img/300x300bb.jpg'
    );
    assert.deepEqual(verified[1], [
      'https://img/300x300bb.jpg',
      'https://img/100x100bb.jpg',
      'https://other/300x300bb.jpg',
      'https://other/100x100bb.jpg',
    ]);
  });

  it('artist providers surface HTTP and malformed response failures rather than misses', async () => {
    const h = await harness();
    for (const provider of [0, 1]) {
      h.context.fetch = async () => ({ ok: false, status: 429 });
      await assert.rejects(
        h.run(
          `artistImageProviders[${provider}].search('Artist', null, null, new Set())`
        ),
        /429/
      );
      h.context.fetch = async () => ({
        ok: true,
        json: async () => ({ unexpected: 'unavailable' }),
      });
      await assert.rejects(
        h.run(
          `artistImageProviders[${provider}].search('Artist', null, null, new Set())`
        ),
        /Invalid/
      );
    }
  });

  it('re-arms unfinished and unseen artist images on Back without eager requests', async () => {
    const h = await harness();
    await h.context.displayArtistResults([
      { id: 'A', name: 'A' },
      { id: 'B', name: 'B' },
    ]);
    const observer = h.observers.at(-1);
    assert.equal(observer.rows.length, 2);
    assert.equal(h.requests.length, 0);
    const oldSignal = h.run('artistImageAbortController.signal');
    h.run('invalidateSearchWork()');
    h.getElement('backToArtists').onclick();
    assert.equal(oldSignal.aborted, true);
    assert.equal(observer.disconnected, true);
    assert.equal(h.observers.at(-1).rows.length, 2);
    assert.notEqual(h.observers.at(-1).rows[0], observer.rows[0]);
    assert.equal(h.run('artistImageAbortController.signal.aborted'), false);
    assert.equal(h.requests.length, 0);
  });

  it('evicts failed rendered images, retries once, and excludes broken URLs', async () => {
    const h = await harness();
    const exclusions = [];
    h.context.imageSearch = async (_name, _id, _signal, excluded) => {
      exclusions.push([...excluded]);
      return excluded.size ? 'small' : 'large';
    };
    h.run(
      'artistImageProviders.splice(0, artistImageProviders.length, { search: imageSearch })'
    );
    await h.context.displayArtistResults([{ id: 'A', name: 'A' }]);
    const row = h.getElement('artistList').children[0];
    const observer = h.observers.at(-1);
    observer.callback([{ isIntersecting: true, target: row }], observer);
    await new Promise((resolve) => setImmediate(resolve));
    const container = row.imageContainer;
    assert.equal(container.children[0].src, 'large');
    container.children[0].onerror();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(container.children[0].src, 'small');
    container.children[0].onerror();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(exclusions, [[], ['large']]);
    assert.equal(container.children.length, 0);
    h.context.closeAddAlbumModal();
  });

  it('does not render late artist images into an invalidated view', async () => {
    const h = await harness();
    let resolveImage;
    h.context.imageSearch = () =>
      new Promise((resolve) => {
        resolveImage = resolve;
      });
    h.run(
      'artistImageProviders.splice(0, artistImageProviders.length, { search: imageSearch })'
    );
    await h.context.displayArtistResults([{ id: 'A', name: 'A' }]);
    const row = h.getElement('artistList').children[0];
    const observer = h.observers.at(-1);
    observer.callback([{ isIntersecting: true, target: row }], observer);
    h.context.closeAddAlbumModal();
    resolveImage('stale');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(row.imageContainer.children.length, 0);
  });

  for (const mode of ['artist', 'album']) {
    for (const outcome of ['success', 'empty', 'error']) {
      for (const first of ['old', 'new']) {
        it(`${mode}: ignores stale ${outcome} when ${first} response arrives first`, async () => {
          const h = await harness();
          const a = h.search('A', mode);
          // Start another query without relying on the mode-change invalidation.
          h.getElement('artistSearchInput').value = 'B';
          const b = h.context.performSearch();
          assert.equal(h.requests.length, 2);
          assert.ok(h.requests[0].signal instanceof globalThis.AbortSignal);
          assert.equal(h.requests[0].signal.aborted, true);
          assert.equal(h.requests[1].signal.aborted, false);

          if (first === 'old') {
            settle(h.requests[0], mode, outcome);
            await a;
            assert.equal(
              h.getElement('searchLoading').classList.contains('hidden'),
              false
            );
          }
          h.requests[1].resolve(response(mode, 'New B'));
          await b;
          if (first === 'new') {
            settle(h.requests[0], mode, outcome);
            await a;
          }
          const rows = h.getElement(
            mode === 'artist' ? 'artistList' : 'albumList'
          ).children;
          assert.equal(rows.length, 1);
          assert.ok(rows[0].innerHTML.includes('New B'));
          assert.ok(!rows[0].innerHTML.includes('Old A'));
          assert.equal(
            h.getElement('searchEmpty').classList.contains('hidden'),
            true
          );
          assert.deepEqual(h.toasts, []);
        });
      }
    }
  }

  for (const mode of ['artist', 'album']) {
    it(`${mode}: shows errors and empty results for the current request only`, async () => {
      const h = await harness();
      const failed = h.search('broken', mode);
      h.requests[0].reject(new Error('Offline'));
      await failed;
      assert.equal(h.toasts[0][0], `Error searching ${mode}s`);
      assert.ok(h.getElement('searchEmpty').innerHTML.includes('Try again.'));
      const empty = h.search('empty', mode);
      h.requests[1].resolve(response(mode, null));
      await empty;
      assert.ok(
        h.getElement('searchEmpty').innerHTML.includes(`No ${mode}s found`)
      );
    });
  }

  for (const navigation of [
    'close/reopen',
    'mode',
    'manual',
    'back',
    'blank search',
  ]) {
    for (const outcome of ['success', 'empty', 'error']) {
      it(`${navigation}: invalidates a pending artist selection (${outcome})`, async () => {
        const h = await harness();
        const pending = h.context.selectArtist({ id: 'A', name: 'Old A' });
        const request = h.requests[0];
        if (navigation === 'close/reopen') {
          h.context.closeAddAlbumModal();
          h.context.window.openAddAlbumModal();
        } else if (navigation === 'mode') h.context.updateSearchMode('album');
        else if (navigation === 'manual') h.context.showManualEntryForm();
        else if (navigation === 'back') h.getElement('backToArtists').onclick();
        else await h.context.performSearch();
        assert.equal(request.signal.aborted, true);
        const toastCount = h.toasts.length;
        settle(request, 'album', outcome);
        await pending;
        assert.equal(h.getElement('albumList').children.length, 0);
        assert.equal(
          h.getElement('albumResults').classList.contains('hidden'),
          true
        );
        assert.equal(h.run('currentArtist'), null);
        assert.equal(h.toasts.length, toastCount);
      });
    }
  }

  it('does not allow a search from a closed session to replace reopened results', async () => {
    const h = await harness();
    const old = h.search('old');
    h.context.closeAddAlbumModal();
    h.context.window.openAddAlbumModal();
    const fresh = h.search('fresh');
    h.requests[1].resolve(response('artist', 'Fresh'));
    await fresh;
    h.requests[0].resolve(response('artist', 'Old'));
    await old;
    assert.equal(h.requests[0].signal.aborted, true);
    assert.ok(
      h.getElement('artistList').children[0].innerHTML.includes('Fresh')
    );
  });

  it('captures selected artist metadata across out-of-order album responses', async () => {
    const h = await harness();
    const a = h.context.selectArtist({
      id: 'A',
      name: 'Artist A',
      country: 'US',
    });
    const b = h.context.selectArtist({
      id: 'B',
      name: 'Artist B',
      country: 'GB',
    });
    assert.equal(h.requests[0].signal.aborted, true);
    assert.equal(h.requests[1].signal.aborted, false);
    h.requests[1].resolve({ 'release-groups': [release('Album B')] });
    await b;
    h.requests[0].resolve({ 'release-groups': [release('Album A')] });
    await a;
    const row = h.getElement('albumList').children[0];
    assert.ok(row.innerHTML.includes('Artist B'));
    assert.ok(row.innerHTML.includes('Album B'));
    assert.ok(!row.innerHTML.includes('Artist A'));
    await row.onclick();
    assert.equal(h.additions[0].artist.name, 'Artist B');
    assert.equal(h.additions[0].artist.country, 'GB');
    assert.equal(h.additions[0].album.title, 'Album B');
    h.context.updateSearchMode('album');
    await row.onclick();
    assert.equal(h.additions.length, 1);
  });

  it('allows back-to-artists selection but rejects rows retained from an old search', async () => {
    const h = await harness();
    const search = h.search('artists');
    h.requests[0].resolve({
      artists: [
        { id: 'A', name: 'A' },
        { id: 'B', name: 'B' },
      ],
    });
    await search;
    const [a, b] = h.getElement('artistList').children;
    const selectedA = a.onclick();
    h.getElement('backToArtists').onclick();
    const selectedB = b.onclick();
    h.requests[2].resolve({ 'release-groups': [release('B album')] });
    await selectedB;
    h.requests[1].resolve({ 'release-groups': [release('A album')] });
    await selectedA;
    assert.ok(
      h.getElement('albumList').children[0].innerHTML.includes('B album')
    );
    h.context.updateSearchMode('album');
    await a.onclick();
    assert.equal(h.requests.length, 3);
  });

  for (const dismissal of ['close', 'mode', 'manual', 'new search']) {
    it(`cancels direct-album country lookup on ${dismissal}`, async () => {
      const h = await harness();
      const search = h.search('album', 'album');
      h.requests[0].resolve({ 'release-groups': [release()] });
      await search;
      const selection = h.getElement('albumList').children[0].onclick();
      assert.ok(h.requests[1].endpoint.startsWith('artist/'));
      if (dismissal === 'close') h.context.closeAddAlbumModal();
      else if (dismissal === 'mode') h.context.updateSearchMode('artist');
      else if (dismissal === 'manual') h.context.showManualEntryForm();
      else {
        const next = h.search('next');
        h.requests[2].resolve({});
        await next;
      }
      assert.equal(h.requests[1].signal.aborted, true);
      h.requests[1].resolve({ country: 'US' });
      await selection;
      assert.deepEqual(h.additions, []);
      assert.equal(h.run('currentArtist'), null);
    });
  }

  it('only adds the latest direct album when country responses cross', async () => {
    const h = await harness();
    const search = h.search('album', 'album');
    h.requests[0].resolve({
      'release-groups': [
        release('Album A', 'Artist A'),
        release('Album B', 'Artist B'),
      ],
    });
    await search;
    const [a, b] = h.getElement('albumList').children;
    const first = a.onclick();
    const second = b.onclick();
    assert.equal(h.requests[1].signal.aborted, true);
    h.requests[2].resolve({ country: 'GB' });
    await second;
    h.requests[1].resolve({ country: 'US' });
    await first;
    assert.equal(h.additions.length, 1);
    assert.equal(h.additions[0].album.title, 'Album B');
    assert.equal(h.additions[0].artist.name, 'Artist B');
    assert.equal(h.additions[0].artist.country, 'GB');
  });

  it('never writes a late cover into the same index of a different result set', async () => {
    const h = await harness();
    let resolveCover;
    h.context.coverSearch = () =>
      new Promise((resolve) => {
        resolveCover = resolve;
      });
    h.run('albumCoverLoader.search = coverSearch');
    h.context.coverImage = element();
    h.context.coverImage.isConnected = true;
    h.context.coverImage.parentElement = element();
    const loading = h.run(`
      const oldRequest = beginSearchRequest();
      const oldAlbum = { title: 'Old' };
      currentReleaseGroups = [oldAlbum];
      loadAlbumCover(coverImage, 'Old artist', 'Old', 'old-id', oldAlbum, oldRequest);
    `);
    h.run("beginSearchRequest(); currentReleaseGroups = [{ title: 'New' }];");
    resolveCover('https://example.test/old.jpg');
    await loading;
    assert.equal(h.run('currentReleaseGroups[0].coverArt'), undefined);
    assert.equal(h.context.coverImage.src, undefined);
  });
});

describe('MusicBrainz discography pagination', () => {
  async function firstPage(groups = [release('First')], count = 2) {
    const h = await harness();
    const artist = { id: 'A', name: 'Artist A' };
    const selection = h.context.selectArtist(artist);
    h.requests[0].resolve({ 'release-groups': groups, count });
    await selection;
    return { ...h, artist };
  }

  it('reselects warm raw groups without requests and maps the current artist name', async () => {
    const h = await firstPage(undefined, 1);
    h.getElement('backToArtists').onclick();
    await h.context.selectArtist({ ...h.artist, name: 'Renamed artist' });
    assert.equal(h.requests.length, 1);
    const rows = h.getElement('albumList').children;
    assert.equal(rows.length, 1);
    assert.match(rows[0].innerHTML, /Renamed artist/);
    await rows[0].onclick();
    assert.equal(h.additions[0].album.id, 'First');
  });

  it('remaps cached groups against the current date and keeps raw pagination offsets', async () => {
    const h = await harness();
    let today = '2020-01-01';
    h.context.Date = class extends Date {
      constructor(...args) {
        super(...(args.length ? args : [today]));
      }
    };
    const future = { ...release('Future'), 'first-release-date': '2020-01-02' };
    const pending = h.context.searchArtistAlbums('Old', 'A');
    h.requests[0].resolve({ 'release-groups': [future], count: 101 });
    const first = await pending;
    assert.equal(first.albums.length, 0);
    assert.equal(first.nextOffset, 1);
    today = '2020-01-02';
    const warm = await h.context.searchArtistAlbums('New', 'A');
    assert.equal(h.requests.length, 1);
    assert.equal(warm.albums.length, 1);
    assert.equal(warm.albums[0].artistName, 'New');
    assert.equal(warm.albums[0].releaseGroupId, 'Future');
    assert.equal(warm.nextOffset, 1);
  });

  it('loads beyond 100 only on explicit serial clicks without blocking first-page rows or covers', async () => {
    const groups = Array.from({ length: 100 }, (_, i) => release(`Album-${i}`));
    const h = await firstPage(groups, 102);
    const list = h.getElement('albumList');
    assert.equal(list.children.length, 101);
    assert.equal(h.requests.length, 1);
    assert.equal(
      h.getElement('searchLoading').classList.contains('hidden'),
      true
    );
    assert.equal(
      h.getElement('albumResults').classList.contains('hidden'),
      false
    );
    const button = list.children.at(-1);
    assert.equal(button.innerHTML, 'Load more albums');
    const loading = button.onclick();
    assert.equal(button.disabled, true);
    await button.onclick();
    assert.equal(h.requests.length, 2);
    assert.equal(list.children.length, 101);
    assert.equal(
      h.getElement('searchLoading').classList.contains('hidden'),
      true
    );
    assert.equal(
      new URL(h.requests[1].endpoint, 'https://example.test').searchParams.get(
        'offset'
      ),
      '100'
    );
    h.requests[1].resolve({
      'release-groups': [release('Album-100'), release('Album-101')],
      count: 102,
    });
    await loading;
    assert.equal(list.children.length, 102);
    assert.ok(list.children.some((row) => row.innerHTML.includes('Album-101')));
    assert.ok(list.children.every((row) => row.type !== 'button'));
    assert.equal(h.requests.length, 2);
  });

  it('retains prior rows after later failure and retries the same uncached offset', async () => {
    const h = await firstPage();
    const list = h.getElement('albumList');
    const row = list.children[0];
    const button = list.children[1];
    const failed = button.onclick();
    h.requests[1].reject(new Error('Offline'));
    await failed;
    assert.equal(list.children[0], row);
    assert.equal(list.children[1], button);
    assert.equal(button.disabled, false);
    assert.match(button.innerHTML, /Retry/);
    assert.match(h.toasts.at(-1)[0], /Could not load more albums/);
    const retry = button.onclick();
    assert.equal(h.requests[2].endpoint, h.requests[1].endpoint);
    h.requests[2].resolve({ 'release-groups': [release('Second')], count: 2 });
    await retry;
    assert.equal(list.children.length, 2);
    assert.match(list.children[0].innerHTML, /First/);
    assert.match(list.children[1].innerHTML, /Second/);
  });

  it('merges duplicate canonical IDs across pages without collapsing distinct same-title albums', async () => {
    const h = await firstPage();
    const loading = h.getElement('albumList').children.at(-1).onclick();
    h.requests[1].resolve({
      'release-groups': [
        release('First'),
        { ...release('First'), id: 'distinct' },
      ],
      count: 3,
    });
    await loading;
    const rows = h.getElement('albumList').children;
    assert.equal(rows.length, 2);
    await rows[0].onclick();
    await rows[1].onclick();
    assert.deepEqual(
      h.additions.map(({ album }) => album.id),
      ['First', 'distinct']
    );
  });

  it('offers pagination when every first-page group is filtered out', async () => {
    const h = await firstPage([{ ...release(), 'secondary-types': ['Live'] }]);
    const list = h.getElement('albumList');
    assert.equal(list.children.length, 1);
    assert.equal(list.children[0].type, 'button');
    assert.deepEqual(h.toasts, []);
    const loading = list.children[0].onclick();
    h.requests[1].resolve({ 'release-groups': [release('Studio')], count: 2 });
    await loading;
    assert.equal(list.children.length, 1);
    assert.match(list.children[0].innerHTML, /Studio/);
  });

  for (const navigation of ['back', 'close', 'mode', 'manual', 'new artist']) {
    for (const outcome of ['success', 'error']) {
      it(`cancels pagination on ${navigation} and ignores late ${outcome}`, async () => {
        const h = await firstPage();
        const button = h.getElement('albumList').children.at(-1);
        const loading = button.onclick();
        const request = h.requests[1];
        if (navigation === 'back') h.getElement('backToArtists').onclick();
        else if (navigation === 'close') h.context.closeAddAlbumModal();
        else if (navigation === 'mode') h.context.updateSearchMode('album');
        else if (navigation === 'manual') h.context.showManualEntryForm();
        else {
          const fresh = h.context.selectArtist({ id: 'B', name: 'B' });
          h.requests[2].resolve({ 'release-groups': [release('Replacement')] });
          await fresh;
        }
        assert.equal(request.signal.aborted, true);
        const rows = [...h.getElement('albumList').children];
        const toasts = [...h.toasts];
        if (outcome === 'error') request.reject(new Error('Late failure'));
        else
          request.resolve({ 'release-groups': [release('Stale')], count: 2 });
        await loading;
        assert.deepEqual(h.getElement('albumList').children, rows);
        assert.deepEqual(h.toasts, toasts);
        const requestCount = h.requests.length;
        await button.onclick();
        assert.equal(h.requests.length, requestCount);
        if (navigation === 'close') h.context.window.openAddAlbumModal();
        await h.context.selectArtist(h.artist);
        assert.equal(h.requests.length, requestCount);
        const retry = h.getElement('albumList').children.at(-1).onclick();
        assert.equal(h.requests.length, requestCount + 1);
        h.requests.at(-1).resolve({ 'release-groups': [], count: 2 });
        await retry;
      });
    }
  }
});

describe('MusicBrainz manual-add context', () => {
  const album = { album_id: 'manual-test', album: 'Album', artist: 'Artist' };

  async function manualHarness() {
    const h = await harness();
    const { createAlbumListAdder } =
      await import('../src/js/modules/album-list-add.js');
    const dedup = Promise.withResolvers();
    const started = Promise.withResolvers();
    const saves = [];
    const attempts = [];
    let data = [];
    Object.assign(h.context, {
      getListData: () => data,
      setListData: (_listId, albums) => {
        data = albums;
      },
      isAlbumInList: () => false,
      saveList: async (listId, albums) => {
        saves.push({ listId, albums });
      },
      getListSaveState: () => ({ pending: true, version: 0 }),
      apiCall: async () => {
        assert.fail('No reconciliation expected while saves are pending');
      },
      displayAlbums() {},
      fetchAndDisplayPlaycounts: async () => {},
      createAlbumListAdder: (deps) => {
        const adder = createAlbumListAdder({
          ...deps,
          resolveAndDedup: async (resolved) => {
            started.resolve();
            await dedup.promise;
            return { resolved };
          },
        });
        return {
          add(candidate, context) {
            attempts.push({ album: candidate, context });
            return adder.add(candidate, context);
          },
        };
      },
    });
    h.context.showManualEntryForm();
    return { ...h, dedup, started, saves, attempts, data: () => data };
  }

  function navigate(h, action) {
    if (action === 'cancel') h.getElement('cancelManualEntry').onclick();
    else if (action === 'back') h.getElement('backToSearch').onclick();
    else if (action === 'reentry') {
      h.getElement('backToSearch').onclick();
      h.getElement('manualEntryBtn').onclick();
    } else if (action === 'manual restart')
      h.getElement('manualEntryBtn').onclick();
    else if (action === 'close') h.context.closeAddAlbumModal();
    else if (action === 'close/reopen') {
      h.context.closeAddAlbumModal();
      h.context.window.openAddAlbumModal();
      h.getElement('manualEntryBtn').onclick();
    }
  }

  it('keeps a normal null-request manual context valid through delayed completion', async () => {
    const h = await manualHarness();
    const context = h.context.captureAlbumAddContext();
    assert.equal(h.run('currentLoadingController'), null);
    assert.equal(context.isCurrent(), true);
    const adding = h.context.finishManualAdd(album, context);
    await h.started.promise;
    assert.equal(context.isCurrent(), true);
    assert.equal(h.saves.length, 0);
    h.dedup.resolve();
    await adding;
    assert.equal(h.attempts[0].context.manual, true);
    assert.equal(h.attempts[0].context.isCurrent, context.isCurrent);
    assert.equal(h.saves.length, 1);
    assert.equal(h.saves[0].listId, 'list-1');
    assert.equal(h.saves[0].albums[0], album);
    assert.equal(
      h.getElement('addAlbumModal').classList.contains('hidden'),
      true
    );
  });

  for (const action of [
    'cancel',
    'back',
    'reentry',
    'manual restart',
    'close',
    'close/reopen',
  ]) {
    it(`${action} invalidates a null-request context while finishManualAdd is pending`, async () => {
      const h = await manualHarness();
      const context = h.context.captureAlbumAddContext();
      assert.equal(h.run('currentLoadingController'), null);
      assert.equal(context.isCurrent(), true);
      const adding = h.context.finishManualAdd(album, context);
      await h.started.promise;
      navigate(h, action);
      // The request is null before AND after navigation: session ownership,
      // rather than request identity alone, must invalidate this context.
      assert.equal(h.run('currentLoadingController'), null);
      assert.equal(context.isCurrent(), false);
      const freshContext = h.context.captureAlbumAddContext();
      assert.equal(freshContext.isCurrent(), action !== 'close');
      h.dedup.resolve();
      await adding;
      assert.equal(h.saves.length, 0);
      assert.equal(h.data().length, 0);
      assert.deepEqual(h.toasts, []);
      assert.equal(freshContext.isCurrent(), action !== 'close');
    });
  }

  for (const stage of ['file read', 'image decode']) {
    for (const action of [
      'unchanged',
      'cancel',
      'back',
      'reentry',
      'close/reopen',
    ]) {
      it(`captures submit context before ${stage}: ${action}`, async () => {
        const h = await manualHarness();
        const readers = [];
        const images = [];
        const file = { size: 100, type: 'image/png' };
        const fields = {
          artist: 'Original artist',
          album: 'Original album',
          cover_art: file,
        };
        Object.assign(h.context, {
          crypto: { randomUUID: () => 'test-uuid' },
          FormData: class {
            get(name) {
              return fields[name] || '';
            }
          },
          FileReader: class {
            readAsDataURL(input) {
              assert.equal(input, file);
              readers.push(this);
            }
          },
          Image: class {
            constructor() {
              this.width = 1024;
              this.height = 512;
              images.push(this);
            }
          },
        });
        const createElement = h.context.document.createElement;
        h.context.document.createElement = (tag) =>
          tag === 'canvas'
            ? {
                getContext: () => ({ drawImage() {} }),
                toDataURL: () => 'data:image/jpeg;base64,processed-cover',
              }
            : createElement(tag);

        await h.getElement('manualAlbumForm').onsubmit({ preventDefault() {} });
        assert.equal(readers.length, 1);
        assert.equal(h.attempts.length, 0);
        assert.equal(h.run('currentLoadingController'), null);
        if (stage === 'file read') navigate(h, action);
        readers[0].onload({
          target: { result: 'data:image/png;base64,original-cover' },
        });
        if (stage === 'image decode') navigate(h, action);
        fields.artist = 'Replacement artist';
        fields.album = 'Replacement album';
        h.dedup.resolve();
        await images[0].onload();

        assert.equal(h.attempts.length, 1);
        const attempt = h.attempts[0];
        assert.equal(attempt.album.artist, 'Original artist');
        assert.equal(attempt.album.album, 'Original album');
        assert.equal(attempt.album.cover_image, 'processed-cover');
        assert.equal(attempt.context.manual, true);
        assert.equal(attempt.context.listId, 'list-1');
        assert.equal(h.saves.length, action === 'unchanged' ? 1 : 0);
        if (action !== 'unchanged') {
          assert.equal(attempt.context.isCurrent(), false);
          assert.equal(h.data().length, 0);
          assert.deepEqual(h.toasts, [['Processing cover art...', 'info']]);
        }
      });
    }
  }
});

describe('MusicBrainz result HTML', () => {
  const unsafe = `<img src=x onerror="alert('x')"> & &#34;`;

  it('escapes artist name, secondary text, type, and country without changing markup', async () => {
    const h = await harness();
    await h.context.displayArtistResults([
      {
        id: 'id',
        name: unsafe,
        disambiguation: unsafe,
        type: unsafe,
        country: unsafe,
      },
    ]);
    const html = h.getElement('artistList').children[0].innerHTML;
    assert.ok(!html.includes(unsafe));
    assert.equal(html.split(escapeHtml(unsafe)).length - 1, 4);
    assert.ok(html.includes('class="font-medium text-white"'));
    assert.ok(html.includes('class="artist-image-container shrink-0"'));
  });

  it('escapes non-Latin secondary names and Latin aliases', async () => {
    const h = await harness();
    const name = '\u65e5\u672c\u8a9e'.repeat(40) + unsafe;
    await h.context.displayArtistResults([{ name, 'sort-name': unsafe }]);
    const html = h.getElement('artistList').children[0].innerHTML;
    assert.ok(html.includes(escapeHtml(name)));
    assert.ok(html.includes(escapeHtml(unsafe)));
    assert.ok(!html.includes(unsafe));
  });

  for (const coverUrl of [null, `https://example.test/" onerror="alert('x')`]) {
    it(`escapes all provider album text and attributes (${coverUrl ? 'cover' : 'placeholder'})`, async () => {
      const h = await harness();
      h.context.unsafeAlbum = {
        title: unsafe,
        releaseGroupId: unsafe,
        releaseDate: unsafe,
        type: unsafe,
        coverUrl,
      };
      h.context.unsafeArtist = { name: unsafe };
      h.run(
        "displayAlbumResultsWithProvider([unsafeAlbum], 'MusicBrainz', unsafeArtist, beginSearchRequest())"
      );
      const html = h.getElement('albumList').children[0].innerHTML;
      assert.ok(!html.includes(unsafe));
      assert.ok(html.includes(`title="${escapeHtml(unsafe)}"`));
      assert.ok(html.includes(`>${escapeHtml(unsafe)}</div>`));
      if (coverUrl) assert.ok(html.includes(`src="${escapeHtml(coverUrl)}"`));
      else
        assert.ok(
          html.includes(`data-release-group-id="${escapeHtml(unsafe)}"`)
        );
    });
  }

  it('escapes direct album identifiers as well as title and artist credits', async () => {
    const h = await harness();
    h.context.unsafeRelease = release(unsafe, unsafe);
    await h.run(
      'displayDirectAlbumResults([unsafeRelease], beginSearchRequest())'
    );
    const html = h.getElement('albumList').children[0].innerHTML;
    assert.ok(!html.includes(unsafe));
    assert.ok(html.includes(`data-release-group-id="${escapeHtml(unsafe)}"`));
    assert.ok(html.includes(`data-artist="${escapeHtml(unsafe)}"`));
    assert.ok(html.includes(`title="${escapeHtml(unsafe)}"`));
  });
});
