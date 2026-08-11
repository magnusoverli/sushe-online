const { describe, it } = require('node:test');
const assert = require('node:assert');

function createClassList(initial = []) {
  const classes = new Set(initial);
  return {
    add: (...items) => items.forEach((item) => classes.add(item)),
    remove: (...items) => items.forEach((item) => classes.delete(item)),
    contains: (item) => classes.has(item),
  };
}

function createElement(id) {
  return {
    id,
    value: '',
    offsetWidth: 240,
    style: {},
    classList: createClassList(['hidden']),
    attributes: new Map(),
    innerHTML: '',
    setAttribute(name, value) {
      this.attributes.set(name, value);
    },
    removeAttribute(name) {
      this.attributes.delete(name);
    },
    getAttribute(name) {
      return this.attributes.get(name) || null;
    },
    getBoundingClientRect() {
      return { bottom: 40, right: 300 };
    },
    querySelectorAll() {
      return [];
    },
    contains(node) {
      return node === this;
    },
    closest(selector) {
      return selector === `#${id}` ? this : null;
    },
  };
}

function createHarness() {
  const listeners = {};
  const elements = {
    albumSearchInput: createElement('albumSearchInput'),
    albumSearchOptionsBtn: createElement('albumSearchOptionsBtn'),
    albumSearchContainer: createElement('albumSearchContainer'),
  };
  const doc = {
    body: {
      appendChild(element) {
        this.appended = element;
      },
    },
    addEventListener(type, handler) {
      listeners[type] = handler;
    },
    createElement() {
      return createElement('albumSearchOptions');
    },
    getElementById(id) {
      return elements[id] || null;
    },
  };
  const win = {
    addEventListener() {},
    requestAnimationFrame(callback) {
      callback();
    },
  };

  return { doc, elements, listeners, win };
}

describe('desktop album search', () => {
  it('closes the field-options popover when the search input is clicked', async () => {
    const { createAlbumSearch } =
      await import('../src/js/modules/album-search.js');
    const { doc, elements, listeners, win } = createHarness();
    const search = createAlbumSearch({
      doc,
      win,
      apiCall: async () => ({ results: [] }),
    });
    search.initialize();

    listeners.click({
      target: elements.albumSearchOptionsBtn,
      preventDefault() {},
    });

    assert.strictEqual(doc.body.appended.classList.contains('hidden'), false);
    assert.strictEqual(
      elements.albumSearchOptionsBtn.attributes.get('aria-expanded'),
      'true'
    );

    listeners.click({ target: elements.albumSearchInput });

    assert.strictEqual(
      elements.albumSearchOptionsBtn.attributes.get('aria-expanded'),
      'false'
    );
    assert.strictEqual(doc.body.appended.classList.contains('hidden'), true);
  });
});
