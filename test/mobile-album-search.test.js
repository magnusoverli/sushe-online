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
    querySelector(selector) {
      return options.selectors?.[selector] || null;
    },
    closest(selector) {
      if (selector === 'header') return options.header || null;
      if (selector === `#${id}`) return this;
      return null;
    },
    contains(node) {
      return node === this || (options.children || []).includes(node);
    },
    focus() {
      doc.activeElement = this;
    },
    blur() {
      if (doc.activeElement === this) doc.activeElement = null;
    },
  };
}

function createManualWin(options = {}) {
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
    addEventListener() {},
    matchMedia(query) {
      return {
        matches:
          query === '(prefers-reduced-motion: reduce)' &&
          options.reducedMotion === true,
        addEventListener() {},
      };
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

function createHarness(options = {}) {
  const elements = {};
  const listeners = {};
  const doc = {
    activeElement: null,
    body: {
      style: {},
      scrollTop: 0,
      appendChild() {},
    },
    addEventListener(type, handler) {
      listeners[type] = handler;
    },
    createElement() {
      return createElement('mobileAlbumSearchResults', doc);
    },
    getElementById(id) {
      return elements[id] || null;
    },
  };
  const headerSelectors = {};
  const header = createElement('header', doc, { selectors: headerSelectors });
  elements.mobileHeaderLeft = createElement('mobileHeaderLeft', doc);
  elements.mobileHeaderActions = createElement('mobileHeaderActions', doc);
  elements.mobileCurrentListName = createElement('mobileCurrentListName', doc);
  headerSelectors['.mobile-header-left'] = elements.mobileHeaderLeft;
  headerSelectors['.mobile-header-actions'] = elements.mobileHeaderActions;
  headerSelectors['#mobileCurrentListName'] = elements.mobileCurrentListName;
  const searchBarChildren = [];
  elements.mobileAlbumSearchBar = createElement('mobileAlbumSearchBar', doc, {
    header,
    children: searchBarChildren,
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
  searchBarChildren.push(
    elements.mobileAlbumSearchInput,
    elements.mobileAlbumSearchClear
  );

  return { doc, elements, header, listeners, win: createManualWin(options) };
}

describe('mobile album search', () => {
  it('opens from the delegated header trigger and hides inactive chrome from assistive tech', async () => {
    const { createMobileAlbumSearch } =
      await import('../src/js/modules/mobile-album-search.js');
    const { doc, elements, header, listeners, win } = createHarness();
    const search = createMobileAlbumSearch({
      doc,
      win,
      apiCall: async () => ({ results: [] }),
    });
    search.initialize();

    let prevented = false;
    listeners.click({
      target: elements.mobileAlbumSearchBtn,
      preventDefault() {
        prevented = true;
      },
    });

    assert.strictEqual(prevented, true);
    assert.strictEqual(doc.activeElement, elements.mobileAlbumSearchInput);
    assert.strictEqual(header.classList.contains('mobile-search-active'), true);
    assert.strictEqual(
      header.classList.contains('mobile-search-opening'),
      true
    );
    assert.strictEqual(
      elements.mobileAlbumSearchBtn.attributes.get('aria-expanded'),
      'true'
    );
    assert.strictEqual(
      win.timers.some((timer) => timer.delay === 80),
      true
    );
    for (const el of [
      elements.mobileHeaderLeft,
      elements.mobileHeaderActions,
      elements.mobileCurrentListName,
    ]) {
      assert.strictEqual(el.attributes.get('aria-hidden'), 'true');
      assert.strictEqual(el.attributes.has('inert'), true);
    }

    win.runTimer(370);

    assert.strictEqual(
      header.classList.contains('mobile-search-opening'),
      false
    );
    assert.strictEqual(header.classList.contains('mobile-search-open'), true);
  });

  it('settles the open phase immediately when reduced motion is requested', async () => {
    const { createMobileAlbumSearch } =
      await import('../src/js/modules/mobile-album-search.js');
    const { doc, header, win } = createHarness({ reducedMotion: true });
    const search = createMobileAlbumSearch({
      doc,
      win,
      apiCall: async () => ({ results: [] }),
    });

    search.open();

    assert.strictEqual(
      header.classList.contains('mobile-search-opening'),
      false
    );
    assert.strictEqual(header.classList.contains('mobile-search-open'), true);
    assert.strictEqual(
      win.timers.some((timer) => timer.delay === 370),
      false
    );
    assert.strictEqual(
      win.timers.some((timer) => timer.delay === 80),
      false
    );
  });

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
      win.timers.some((timer) => timer.delay === 80),
      false
    );
    assert.strictEqual(
      header.classList.contains('mobile-search-closing'),
      true
    );
    assert.strictEqual(
      elements.mobileHeaderLeft.attributes.has('aria-hidden'),
      false
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
