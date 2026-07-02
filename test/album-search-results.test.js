const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

function createClassList(initial = []) {
  const classes = new Set(initial);
  return {
    add: (...items) => items.forEach((item) => classes.add(item)),
    remove: (...items) => items.forEach((item) => classes.delete(item)),
    contains: (item) => classes.has(item),
  };
}

function createElement() {
  return {
    classList: createClassList(['hidden']),
    innerHTML: '',
    scrollTop: 0,
    style: {
      setProperty(key, value) {
        this[key] = value;
      },
    },
    addEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    getBoundingClientRect() {
      return { bottom: 20, left: 10, width: 240 };
    },
    querySelectorAll() {
      return [];
    },
  };
}

function createDoc(panel) {
  const input = createElement();
  const container = createElement();
  return {
    body: {
      appendChild() {},
    },
    createElement() {
      return panel;
    },
    getElementById(id) {
      if (id === 'albumSearchInput') return input;
      if (id === 'albumSearchContainer') return container;
      return null;
    },
  };
}

function createManualWin() {
  const frames = [];
  const timers = [];
  return {
    frames,
    timers,
    requestAnimationFrame(callback) {
      frames.push(callback);
      return callback;
    },
    setTimeout(callback) {
      timers.push(callback);
      return callback;
    },
    clearTimeout(handle) {
      const index = timers.indexOf(handle);
      if (index !== -1) timers.splice(index, 1);
    },
  };
}

describe('album search result surfaces', () => {
  let createResultsPanel;
  let createMobileResults;

  beforeEach(async () => {
    ({ createResultsPanel } =
      await import('../src/js/modules/album-search-results.js'));
    ({ createMobileResults } =
      await import('../src/js/modules/mobile-album-search-results.js'));
  });

  it('tracks the rendered desktop query for reopening cached results', () => {
    const panelEl = createElement();
    const panel = createResultsPanel({ doc: createDoc(panelEl) });

    panel.render({ results: [] }, 'kid a');

    assert.strictEqual(panel.hasRenderedQuery('kid a'), true);
    assert.strictEqual(panel.hasRenderedQuery('kid b'), false);
  });

  it('tracks the rendered mobile query for reopening cached results', () => {
    const panelEl = createElement();
    const panel = createMobileResults({ doc: createDoc(panelEl) });

    panel.render({ results: [] }, 'kid a');

    assert.strictEqual(panel.hasRenderedQuery('kid a'), true);
    assert.strictEqual(panel.hasRenderedQuery('kid b'), false);
  });

  it('ignores a stale mobile open frame after close starts', () => {
    const panelEl = createElement();
    const win = createManualWin();
    const panel = createMobileResults({ doc: createDoc(panelEl), win });

    panel.render({ results: [] }, 'kid a');
    panel.close();
    win.frames.forEach((callback) => callback());
    win.timers.forEach((callback) => callback());

    assert.strictEqual(panelEl.classList.contains('is-open'), false);
    assert.strictEqual(panelEl.classList.contains('hidden'), true);
  });
});
