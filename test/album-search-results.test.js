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
});
