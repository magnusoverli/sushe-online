const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

function createCell() {
  return {
    toggled: [],
    classList: {
      toggle(name, state) {
        this._owner.toggled.push([name, state]);
      },
      _owner: null,
    },
  };
}

describe('album-display-shared module', () => {
  let createAlbumDisplayShared;

  beforeEach(async () => {
    const module = await import('../src/js/modules/album-display-shared.js');
    createAlbumDisplayShared = module.createAlbumDisplayShared;
  });

  it('applies in-place visibility updates to header, rows, and cells', () => {
    const header = { style: {} };
    const rowA = { style: {} };
    const rowB = { style: {} };
    const hiddenCell = createCell();
    hiddenCell.classList._owner = hiddenCell;
    const shownCell = createCell();
    shownCell.classList._owner = shownCell;

    const container = {
      querySelector(selector) {
        if (selector === '.album-header') return header;
        return null;
      },
      querySelectorAll(selector) {
        if (selector === '.album-row') return [rowA, rowB];
        if (selector === '.country-cell') return [shownCell];
        if (selector === '.genre-1-cell') return [hiddenCell];
        return [];
      },
    };

    const utils = createAlbumDisplayShared({
      doc: {
        getElementById(id) {
          if (id === 'albumContainer') return container;
          return null;
        },
      },
      computeGridTemplate: () => '1fr 2fr',
      getVisibleColumns: () => [{ id: 'country' }],
      getToggleableColumns: () => [
        { id: 'country', cellClass: 'country-cell' },
        { id: 'genre_1', cellClass: 'genre-1-cell' },
      ],
      isColumnVisible: (id) => id === 'country',
    });

    utils.applyVisibilityInPlace();

    assert.strictEqual(header.style.gridTemplateColumns, '1fr 2fr');
    assert.strictEqual(rowA.style.gridTemplateColumns, '1fr 2fr');
    assert.deepStrictEqual(shownCell.toggled[0], ['column-hidden', false]);
    assert.deepStrictEqual(hiddenCell.toggled[0], ['column-hidden', true]);
  });

  it('loads every cover up front by swapping in the real src immediately', () => {
    const img = { dataset: { lazySrc: '/cover.jpg' }, src: '' };
    const utils = createAlbumDisplayShared({
      doc: {
        getElementById() {
          return null;
        },
      },
      computeGridTemplate: () => '',
      getVisibleColumns: () => [],
      getToggleableColumns: () => [],
      isColumnVisible: () => true,
    });

    const container = {
      querySelectorAll(selector) {
        if (selector === 'img[data-cover-src]') return [];
        if (selector === 'img[data-lazy-src]') return [img];
        return [];
      },
    };

    utils.loadCoverImages(container);
    // No intersection needed: the real src is in place right after the call.
    assert.strictEqual(img.src, '/cover.jpg');
    assert.strictEqual(img.dataset.coverSrc, '/cover.jpg');
    assert.strictEqual(img.dataset.lazySrc, undefined);
  });

  it('drains off-screen covers with a concurrency cap', () => {
    const makeImg = (id) => {
      const handlers = {};
      return {
        dataset: { lazySrc: `/cover-${id}.jpg` },
        src: '',
        addEventListener(event, handler) {
          handlers[event] = handler;
        },
        fire(event) {
          handlers[event]?.();
        },
      };
    };
    // 15 covers, cap is 12, so 3 wait behind the first wave.
    const images = Array.from({ length: 15 }, (_, i) => makeImg(i));
    const utils = createAlbumDisplayShared({
      doc: { getElementById: () => null },
      computeGridTemplate: () => '',
      getVisibleColumns: () => [],
      getToggleableColumns: () => [],
      isColumnVisible: () => true,
    });
    const container = {
      querySelectorAll(selector) {
        if (selector === 'img[data-cover-src]') return [];
        return selector === 'img[data-lazy-src]' ? images : [];
      },
    };

    const loadedCount = () => images.filter((i) => i.src !== '').length;

    utils.loadCoverImages(container);
    assert.strictEqual(loadedCount(), 12);

    // Each settled cover (load or error) frees a slot for the next.
    images[0].fire('load');
    assert.strictEqual(loadedCount(), 13);
    images[1].fire('error');
    assert.strictEqual(loadedCount(), 14);
    images[2].fire('load');
    assert.strictEqual(loadedCount(), 15);
  });

  it('retries cover images after a load error then falls back to a placeholder', () => {
    const timers = [];
    let errorHandler = null;
    const parent = { innerHTML: '' };
    const img = {
      dataset: {
        lazySrc: '/api/albums/album1/cover',
        coverSrc: '/api/albums/album1/cover',
      },
      src: '',
      parentElement: parent,
      isConnected: true,
      addEventListener(event, handler) {
        // The retry handler is attached first; the drain-release listener is
        // attached after it, so capture the first 'error' handler.
        if (event === 'error' && !errorHandler) errorHandler = handler;
      },
    };

    const utils = createAlbumDisplayShared({
      doc: { getElementById: () => null },
      computeGridTemplate: () => '',
      getVisibleColumns: () => [],
      getToggleableColumns: () => [],
      isColumnVisible: () => true,
      setTimeout(callback) {
        timers.push(callback);
      },
    });

    const container = {
      querySelectorAll(selector) {
        if (selector === 'img[data-cover-src]') return [img];
        if (selector === 'img[data-lazy-src]') return [img];
        return [];
      },
    };

    // The error handler is attached before the real src is swapped in.
    utils.loadCoverImages(container);
    assert.strictEqual(img.src, '/api/albums/album1/cover');
    assert.strictEqual(img.dataset.coverSrc, '/api/albums/album1/cover');

    errorHandler();
    assert.match(img.src, /^data:image\/gif;base64,/);
    assert.strictEqual(timers.length, 1);

    timers[0]();
    assert.match(img.src, /^\/api\/albums\/album1\/cover\?coverRetry=/);

    errorHandler();
    timers[1]();
    errorHandler();
    assert.match(parent.innerHTML, /album-cover-placeholder/);
  });

  it('caches row element lookups and supports reset', () => {
    let queries = 0;
    const span = {};
    const cell = {
      querySelector() {
        return span;
      },
    };
    const row = {
      querySelector(selector) {
        queries += 1;
        if (selector === '.country-cell') return cell;
        return null;
      },
    };

    const utils = createAlbumDisplayShared({
      doc: { getElementById: () => null },
      computeGridTemplate: () => '',
      getVisibleColumns: () => [],
      getToggleableColumns: () => [],
      isColumnVisible: () => true,
    });

    const first = utils.getCachedElements(row, false);
    const second = utils.getCachedElements(row, false);
    assert.strictEqual(first, second);
    assert.ok(queries > 0);
    const queryCountAfterCache = queries;

    utils.resetRowElementsCache();
    const third = utils.getCachedElements(row, false);
    assert.notStrictEqual(third, second);
    assert.ok(queries > queryCountAfterCache);
  });

  it('updates an existing cover image without replacing its node', () => {
    const handlers = {};
    const image = {
      dataset: { coverSrc: '/cover?v=1', coverRetryCount: '2' },
      src: '/cover?v=1',
      addEventListener(event, handler) {
        handlers[event] = handler;
      },
    };
    const media = {
      dataset: { coverImageClass: 'album-cover' },
      querySelector(selector) {
        return selector === 'img' ? image : null;
      },
    };
    const utils = createAlbumDisplayShared({
      doc: { getElementById: () => null },
      computeGridTemplate: () => '',
      getVisibleColumns: () => [],
      getToggleableColumns: () => [],
      isColumnVisible: () => true,
    });

    const updated = utils.updateCoverInPlace(media, {
      src: '/cover?v=2',
      fullSrc: '/cover/full?v=2',
      alt: 'Updated cover',
    });

    assert.strictEqual(updated, image);
    assert.strictEqual(image.src, '/cover?v=2');
    assert.strictEqual(image.dataset.fullSrc, '/cover/full?v=2');
    assert.strictEqual(image.dataset.coverRetryCount, undefined);
    assert.strictEqual(typeof handlers.error, 'function');
  });

  it('creates fingerprints from visible mutable album fields', () => {
    const utils = createAlbumDisplayShared({
      doc: { getElementById: () => null },
      computeGridTemplate: () => '',
      getVisibleColumns: () => [],
      getToggleableColumns: () => [],
      isColumnVisible: () => true,
    });

    const albums = [
      {
        _id: '1',
        artist: 'A',
        album: 'B',
        release_date: '2024-01-01',
        primary_track: 'Song',
        availability: ['qobuz', 'spotify'],
      },
    ];

    const first = utils.generateAlbumFingerprint(albums);
    const second = utils.generateAlbumFingerprint(albums);
    assert.strictEqual(first, second);

    albums[0].album = 'New title';
    const titleUpdated = utils.generateAlbumFingerprint(albums);
    assert.notStrictEqual(titleUpdated, first);

    albums[0].album = 'B';
    albums[0].availability = ['spotify', 'qobuz'];
    const reorderedAvailability = utils.generateAlbumFingerprint(albums);
    assert.strictEqual(reorderedAvailability, first);

    albums[0].availability = ['spotify'];
    const updated = utils.generateAlbumFingerprint(albums);
    assert.notStrictEqual(updated, first);

    albums[0].cover_thumb_url = '/cover?v=2';
    const coverUpdated = utils.generateAlbumFingerprint(albums);
    assert.notStrictEqual(coverUpdated, updated);

    albums[0].summary = 'Hydrated summary';
    const hydrated = utils.generateAlbumFingerprint(albums);
    assert.notStrictEqual(hydrated, coverUpdated);

    const mutable = utils.extractMutableFingerprints(albums);
    assert.strictEqual(Array.isArray(mutable), true);
    assert.strictEqual(utils.extractMutableFingerprints(null), null);
  });
});
