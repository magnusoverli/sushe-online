const { describe, it, mock } = require('node:test');
const assert = require('node:assert');

let mod;
async function load() {
  if (!mod) mod = await import('../src/js/modules/modal-a11y.js');
  return mod;
}

function focusableMock(name) {
  return { name, focus: mock.fn(), offsetParent: {} };
}

function scopeMock(items) {
  return {
    querySelectorAll: () => items,
    querySelector: (sel) => items.find((i) => i.name === sel) || null,
    contains: (el) => items.includes(el),
  };
}

describe('modal-a11y', () => {
  it('getFocusable returns matching descendants and tolerates non-DOM scopes', async () => {
    const { getFocusable } = await load();
    const items = [focusableMock('a'), focusableMock('b')];
    assert.strictEqual(getFocusable(scopeMock(items)).length, 2);
    assert.deepStrictEqual(getFocusable(null), []);
    assert.deepStrictEqual(getFocusable({}), []);
  });

  it('activate focuses the first focusable and records the opener', async () => {
    const { createFocusManager } = await load();
    const first = focusableMock('first');
    const scope = scopeMock([first, focusableMock('second')]);
    const opener = { focus: mock.fn() };
    const doc = { activeElement: opener, contains: () => true };
    const fm = createFocusManager(scope, { doc });
    fm.activate();
    assert.strictEqual(first.focus.mock.callCount(), 1);
    assert.deepStrictEqual(first.focus.mock.calls[0].arguments[0], {
      preventScroll: true,
    });
  });

  it('activate honors an explicit initialFocus element', async () => {
    const { createFocusManager } = await load();
    const first = focusableMock('first');
    const target = focusableMock('target');
    const scope = scopeMock([first, target]);
    const doc = { activeElement: null, contains: () => true };
    createFocusManager(scope, { initialFocus: target, doc }).activate();
    assert.strictEqual(target.focus.mock.callCount(), 1);
    assert.strictEqual(first.focus.mock.callCount(), 0);
  });

  it('handleTab wraps from last to first and first to last', async () => {
    const { createFocusManager } = await load();
    const first = focusableMock('first');
    const last = focusableMock('last');
    const scope = scopeMock([first, last]);
    const doc = { activeElement: last, contains: () => true };
    const fm = createFocusManager(scope, { doc });

    let prevented = false;
    fm.handleTab({
      key: 'Tab',
      shiftKey: false,
      preventDefault: () => (prevented = true),
    });
    assert.ok(prevented, 'Tab at last should preventDefault');
    assert.strictEqual(first.focus.mock.callCount(), 1, 'wraps to first');

    doc.activeElement = first;
    fm.handleTab({ key: 'Tab', shiftKey: true, preventDefault: () => {} });
    assert.strictEqual(
      last.focus.mock.callCount(),
      1,
      'Shift+Tab wraps to last'
    );
  });

  it('handleTab ignores non-Tab keys', async () => {
    const { createFocusManager } = await load();
    const first = focusableMock('first');
    const scope = scopeMock([first]);
    const fm = createFocusManager(scope, {
      doc: { activeElement: first, contains: () => true },
    });
    fm.handleTab({
      key: 'Enter',
      preventDefault: () => assert.fail('should not run'),
    });
  });

  it('deactivate restores focus to the opener', async () => {
    const { createFocusManager } = await load();
    const opener = { focus: mock.fn() };
    const scope = scopeMock([focusableMock('a')]);
    const doc = { activeElement: opener, contains: () => true };
    const fm = createFocusManager(scope, { doc });
    fm.activate();
    fm.deactivate();
    assert.strictEqual(opener.focus.mock.callCount(), 1);
    assert.deepStrictEqual(opener.focus.mock.calls[0].arguments[0], {
      preventScroll: true,
    });
  });

  it('deactivate skips a detached opener', async () => {
    const { createFocusManager } = await load();
    const opener = { focus: mock.fn() };
    const scope = scopeMock([focusableMock('a')]);
    const doc = { activeElement: opener, contains: () => false };
    const fm = createFocusManager(scope, { doc });
    fm.activate();
    fm.deactivate();
    assert.strictEqual(opener.focus.mock.callCount(), 0);
  });

  it('applyInert / releaseInert toggle the inert property', async () => {
    const { applyInert, releaseInert } = await load();
    const a = { inert: false };
    const b = { inert: false };
    applyInert([a, b]);
    assert.strictEqual(a.inert, true);
    assert.strictEqual(b.inert, true);
    releaseInert([a, b]);
    assert.strictEqual(a.inert, false);
    applyInert(null); // no-op, no throw
  });
});
