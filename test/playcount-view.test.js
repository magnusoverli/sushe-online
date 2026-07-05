const { describe, it } = require('node:test');
const assert = require('node:assert');

function createPlaycountElement() {
  return {
    className: '',
    innerHTML: '',
    title: '',
    dataset: {},
    removedAttributes: [],
    classList: {
      removed: [],
      remove(name) {
        this.removed.push(name);
      },
    },
    removeAttribute(name) {
      this.removedAttributes.push(name);
      if (name === 'title') this.title = '';
    },
  };
}

describe('playcount-view', async () => {
  const { applyMobilePlaycount } =
    await import('../src/js/modules/album-display/playcount-view.js');

  it('clears stale mobile not-found title when a playcount succeeds', () => {
    const el = createPlaycountElement();

    applyMobilePlaycount(el, 'not_found');
    assert.strictEqual(el.title, 'Album not found on Last.fm');

    applyMobilePlaycount(el, 'success', '42');

    assert.strictEqual(el.title, '');
    assert.deepStrictEqual(el.removedAttributes, ['title']);
    assert.strictEqual(el.dataset.status, 'success');
    assert.match(el.innerHTML, /42/);
  });
});
