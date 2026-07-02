const { describe, it } = require('node:test');
const assert = require('node:assert');

function createClassList(initial = []) {
  const classes = new Set(initial);
  return {
    add: (...items) => items.forEach((item) => classes.add(item)),
    remove: (...items) => items.forEach((item) => classes.delete(item)),
    contains: (item) => classes.has(item),
    toggle(item, force) {
      const shouldAdd = force === undefined ? !classes.has(item) : force;
      if (shouldAdd) classes.add(item);
      else classes.delete(item);
      return shouldAdd;
    },
  };
}

function createElement(id, doc, options = {}) {
  return {
    id,
    value: '',
    scrollTop: 0,
    classList: createClassList(options.classes || []),
    style: {
      display: options.display || '',
      setProperty(key, value) {
        this[key] = value;
      },
    },
    attributes: new Map(),
    addEventListener() {},
    appendChild() {},
    setAttribute(name, value) {
      this.attributes.set(name, value);
    },
    removeAttribute(name) {
      this.attributes.delete(name);
    },
    getBoundingClientRect() {
      return { bottom: 48 };
    },
    closest(selector) {
      if (selector === 'header') return options.header || null;
      return null;
    },
    focus() {
      doc.activeElement = this;
    },
    blur() {
      if (doc.activeElement === this) doc.activeElement = null;
    },
  };
}

function createManualWin() {
  const frames = [];
  const timers = [];
  return {
    innerHeight: 800,
    visualViewport: null,
    frames,
    timers,
    requestAnimationFrame(callback) {
      frames.push(callback);
      return callback;
    },
    setTimeout(callback, delay) {
      const timer = { callback, delay };
      timers.push(timer);
      return timer;
    },
    clearTimeout(handle) {
      const index = timers.indexOf(handle);
      if (index !== -1) timers.splice(index, 1);
    },
    runFrames() {
      const pending = frames.splice(0);
      pending.forEach((callback) => callback());
    },
    runTimer(delay) {
      const index = timers.findIndex((timer) => timer.delay === delay);
      assert.notStrictEqual(index, -1, `Expected timer with ${delay}ms delay`);
      const [timer] = timers.splice(index, 1);
      timer.callback();
    },
    scrollTo() {},
  };
}

function createHarness() {
  const elements = {};
  const doc = {
    activeElement: null,
    body: {
      style: {},
      scrollTop: 0,
      appendChild() {},
    },
    addEventListener() {},
    createElement() {
      return createElement('mobileAlbumSearchResults', doc);
    },
    getElementById(id) {
      return elements[id] || null;
    },
  };
  const header = createElement('header', doc);
  elements.mobileAlbumSearchBar = createElement('mobileAlbumSearchBar', doc, {
    header,
  });
  elements.mobileAlbumSearchInput = createElement(
    'mobileAlbumSearchInput',
    doc
  );
  elements.mobileAlbumSearchClear = createElement(
    'mobileAlbumSearchClear',
    doc,
    {
      classes: ['hidden'],
    }
  );
  elements.mobileAlbumSearchBtn = createElement('mobileAlbumSearchBtn', doc);
  elements.addAlbumFAB = createElement('addAlbumFAB', doc);
  elements.albumContainer = createElement('albumContainer', doc);

  return { doc, elements, header, win: createManualWin() };
}

describe('mobile album search', () => {
  it('keeps typed text visible until the close animation finishes', async () => {
    const { createMobileAlbumSearch } =
      await import('../src/js/modules/mobile-album-search.js');
    const { doc, elements, header, win } = createHarness();
    const search = createMobileAlbumSearch({
      doc,
      win,
      apiCall: async () => ({ results: [] }),
    });

    search.open();
    elements.mobileAlbumSearchInput.value = 'kid a';
    elements.mobileAlbumSearchClear.classList.remove('hidden');

    const closePromise = search.close();

    assert.strictEqual(
      header.classList.contains('mobile-search-closing'),
      true
    );
    assert.strictEqual(elements.mobileAlbumSearchInput.value, 'kid a');
    assert.strictEqual(
      elements.mobileAlbumSearchClear.classList.contains('hidden'),
      false
    );

    win.runFrames();
    win.runTimer(370);
    await closePromise;

    assert.strictEqual(elements.mobileAlbumSearchInput.value, '');
    assert.strictEqual(
      elements.mobileAlbumSearchClear.classList.contains('hidden'),
      true
    );
    assert.strictEqual(
      header.classList.contains('mobile-search-closing'),
      false
    );
  });
});
