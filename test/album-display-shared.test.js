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

  it('observes lazy images and swaps src when intersecting', () => {
    const observed = [];
    const unobserved = [];
    let observerCallback = null;

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
      createObserver(callback) {
        observerCallback = callback;
        return {
          observe(node) {
            observed.push(node);
          },
          unobserve(node) {
            unobserved.push(node);
          },
        };
      },
    });

    const container = {
      querySelectorAll(selector) {
        if (selector === 'img[data-lazy-src]') return [img];
        return [];
      },
    };

    utils.observeLazyImages(container);
    assert.strictEqual(observed[0], img);

    observerCallback([{ isIntersecting: true, target: img }]);
    assert.strictEqual(img.src, '/cover.jpg');
    assert.strictEqual(img.dataset.lazySrc, undefined);
    assert.strictEqual(unobserved[0], img);
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

  it('creates and invalidates album fingerprints and mutable fingerprints', () => {
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
        track_pick: 'Song',
      },
    ];

    const first = utils.generateAlbumFingerprint(albums);
    const second = utils.generateAlbumFingerprint(albums);
    assert.strictEqual(first, second);

    albums[0].track_pick = 'New';
    const stale = utils.generateAlbumFingerprint(albums);
    assert.strictEqual(stale, first);

    utils.invalidateFingerprint(albums);
    const updated = utils.generateAlbumFingerprint(albums);
    assert.notStrictEqual(updated, first);

    const mutable = utils.extractMutableFingerprints(albums);
    assert.strictEqual(Array.isArray(mutable), true);
    assert.strictEqual(utils.extractMutableFingerprints(null), null);
  });
});
