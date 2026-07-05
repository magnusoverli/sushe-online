const { describe, it, mock } = require('node:test');
const assert = require('node:assert');

function createClassList(initial = []) {
  const classes = new Set(initial);
  return {
    add: (...items) => items.forEach((item) => classes.add(item)),
    remove: (...items) => items.forEach((item) => classes.delete(item)),
    contains: (item) => classes.has(item),
  };
}

function createElement(tagName = 'div') {
  const element = {
    tagName,
    className: '',
    style: {},
    parentNode: null,
    _removed: false,
    _innerHTML: '',
    classList: createClassList(),
    addEventListener: mock.fn(),
    removeEventListener: mock.fn(),
    querySelector(selector) {
      if (selector === '[data-backdrop]') return this._backdrop || null;
      if (selector === '[data-action="cancel"]') return this._cancel || null;
      if (selector === '[data-sheet-panel]') return this._panel || null;
      return null;
    },
    remove: mock.fn(function remove() {
      this._removed = true;
      if (this.parentNode?.children) {
        this.parentNode.children = this.parentNode.children.filter(
          (child) => child !== this
        );
      }
      this.parentNode = null;
    }),
  };

  Object.defineProperty(element, 'innerHTML', {
    get() {
      return this._innerHTML;
    },
    set(value) {
      this._innerHTML = value;
      this._backdrop = createElement('div');
      this._panel = createElement('div');
      this._cancel = value.includes('data-action="cancel"')
        ? createElement('button')
        : null;
    },
  });

  return element;
}

function createDocument() {
  const fab = createElement('button');
  return {
    addEventListener: mock.fn(),
    removeEventListener: mock.fn(),
    body: {
      style: {},
      children: [],
      appendChild(node) {
        node.parentNode = this;
        this.children.push(node);
      },
      contains(node) {
        return this.children.includes(node);
      },
    },
    createElement,
    getElementById(id) {
      return id === 'addAlbumFAB' ? fab : null;
    },
    querySelector(selector) {
      if (!selector.includes('z-50')) return null;
      return this.body.children.find((node) => {
        return (
          node.className.includes('fixed') &&
          node.className.includes('inset-0') &&
          node.className.includes('z-50') &&
          node.className.includes('lg:hidden')
        );
      });
    },
    _fab: fab,
  };
}

describe('ui-factories', async () => {
  const { createActionSheet } =
    await import('../src/js/modules/ui-factories.js');

  it('destroys an existing action sheet through its controller when replacing it', () => {
    const originalDocument = globalThis.document;
    const doc = createDocument();
    globalThis.document = doc;

    try {
      createActionSheet({
        contentHtml: '<button data-action="cancel">Cancel</button>',
        checkCurrentList: false,
      });
      const firstSheet = doc.body.children[0];

      createActionSheet({
        contentHtml: '<button data-action="cancel">Cancel</button>',
        checkCurrentList: false,
      });

      assert.strictEqual(firstSheet._removed, true);
      assert.strictEqual(doc.body.contains(firstSheet), false);
      assert.strictEqual(doc.body.children.length, 1);
      assert.strictEqual(doc._fab.style.display, 'none');

      const keydownRemove = doc.removeEventListener.mock.calls.find(
        (call) => call.arguments[0] === 'keydown'
      );
      assert.ok(keydownRemove, 'replacing sheet removes document key listener');

      const backdropRemove =
        firstSheet._backdrop.removeEventListener.mock.calls.find(
          (call) => call.arguments[0] === 'click'
        );
      assert.ok(backdropRemove, 'replacing sheet removes backdrop listener');
    } finally {
      globalThis.document = originalDocument;
    }
  });
});
