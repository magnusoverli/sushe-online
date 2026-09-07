const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function node(classes = [], parent = null) {
  const names = new Set(classes);
  const listeners = new Map();
  const element = {
    parent,
    children: [],
    readOnly: false,
    classList: {
      add: (name) => names.add(name),
      remove: (name) => names.delete(name),
      contains: (name) => names.has(name),
    },
    matches(selector) {
      return selector === '[data-read-only="true"]'
        ? this.readOnly
        : names.has(selector.slice(1));
    },
    querySelector(selector) {
      for (const child of this.children) {
        const found = child.matches(selector)
          ? child
          : child.querySelector(selector);
        if (found) return found;
      }
      return null;
    },
    closest(selector) {
      return this.matches(selector) ? this : this.parent?.closest(selector);
    },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener: (type, handler) =>
      listeners.get(type)?.delete(handler),
    emit: (type, event) => listeners.get(type)?.forEach((fn) => fn(event)),
    listenerCount: () =>
      [...listeners.values()].reduce((n, s) => n + s.size, 0),
  };
  parent?.children.push(element);
  return element;
}

describe('sorting lifecycle', () => {
  let createSorting;
  before(async () => {
    ({ createSorting } = await import('../src/js/modules/sorting.js'));
  });

  function setup(t, { mobile = false, fallback = false } = {}) {
    const container = node();
    const rows = node(
      [mobile ? 'mobile-album-list' : 'album-rows-container'],
      container
    );
    const item = node(['album-card-wrapper'], rows);
    const loads = [];
    const instances = [];
    const lists = { owner: ['a', 'b', 'c'], other: ['x', 'y', 'z'] };
    const state = { listId: 'owner' };
    const body = node();
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
    globalThis.document = { body };
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
      else delete globalThis.document;
    });
    class Sortable {
      constructor(target, options) {
        this.target = target;
        this.options = options;
        this.destroy = t.mock.fn();
        instances.push(this);
      }
    }
    const deps = {
      getCurrentList: () => state.listId,
      getListData: t.mock.fn((id) => lists[id]),
      saveReorder: fallback ? undefined : t.mock.fn(async () => {}),
      debouncedSaveList: t.mock.fn(),
      updatePositionNumbers: t.mock.fn(),
      showToast: t.mock.fn(),
      loadSortable: () => {
        const load = deferred();
        loads.push(load);
        return load.promise;
      },
    };
    const sorting = createSorting(deps);
    t.after(() => sorting.destroySorting(container));
    return {
      ...sorting,
      container,
      rows,
      item,
      body,
      loads,
      instances,
      lists,
      state,
      deps,
      Sortable,
      event: { item, to: rows, oldIndex: 0, newIndex: 2 },
      initialize: () => sorting.initializeUnifiedSorting(container, mobile),
      async activate() {
        const pending = this.initialize();
        loads.at(-1).resolve(Sortable);
        await pending;
        return instances.at(-1).options;
      },
    };
  }

  it('destroy cancels a deferred load before any instance exists', async (t) => {
    const h = setup(t);
    const pending = h.initialize();
    h.destroySorting(h.container);
    h.rows.children = []; // Shared community rows reuse the same classes.
    h.loads[0].resolve(h.Sortable);
    await pending;
    assert.equal(h.instances.length, 0);
  });

  it('only the latest initialization can create an instance', async (t) => {
    const h = setup(t);
    const older = h.initialize();
    const latest = h.initialize();
    h.loads[1].resolve(h.Sortable);
    await latest;
    h.loads[0].resolve(h.Sortable);
    await older;
    assert.equal(h.instances.length, 1);
    assert.equal(h.instances[0].destroy.mock.callCount(), 0);
    assert.equal(h.container._sortable, h.instances[0]);
  });

  it('invalidates pending work only for the destroyed container', async (t) => {
    const h = setup(t);
    const otherContainer = node();
    t.after(() => h.destroySorting(otherContainer));
    const pending = h.initialize();
    const other = h.initializeUnifiedSorting(otherContainer, false);
    h.destroySorting(h.container);
    h.loads.forEach((load) => load.resolve(h.Sortable));
    await Promise.all([pending, other]);
    assert.equal(h.instances.length, 1);
    assert.equal(h.instances[0].target, otherContainer);
  });

  for (const [initial, current] of [
    ['owner', 'other'],
    ['owner', ''],
    ['', ''],
  ]) {
    it(`rejects a pending load with list ${initial} -> ${current}`, async (t) => {
      const h = setup(t);
      h.state.listId = initial;
      const pending = h.initialize();
      h.state.listId = current;
      h.loads[0].resolve(h.Sortable);
      await pending;
      assert.equal(h.instances.length, 0);
    });
  }

  for (const location of ['container', 'rows']) {
    it(`refuses an explicit read-only marker on ${location}`, async (t) => {
      const h = setup(t);
      const pending = h.initialize();
      h[location].readOnly = true;
      h.loads[0].resolve(h.Sortable);
      await pending;
      assert.equal(h.instances.length, 0);
    });
  }

  it('keeps owner dragging and batches rapid reorders for the captured list', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const h = setup(t);
    const options = await h.activate();
    assert.equal(h.instances[0].target, h.rows);
    options.onStart(h.event);
    assert.equal(h.body.classList.contains('desktop-dragging'), true);
    void options.onEnd(h.event);
    t.mock.timers.tick(250);
    const saved = options.onEnd(h.event);
    assert.deepEqual(h.lists.owner, ['c', 'a', 'b']);
    assert.equal(h.body.classList.contains('desktop-dragging'), false);
    assert.equal(h.deps.updatePositionNumbers.mock.callCount(), 2);
    t.mock.timers.tick(499);
    assert.equal(h.deps.saveReorder.mock.callCount(), 0);
    // Navigation must not discard an already accepted owner reorder.
    h.destroySorting(h.container);
    h.state.listId = 'other';
    t.mock.timers.tick(1);
    await saved;
    assert.equal(h.deps.saveReorder.mock.callCount(), 1);
    assert.deepEqual(h.deps.saveReorder.mock.calls[0].arguments, [
      'owner',
      ['c', 'a', 'b'],
    ]);
    assert.deepEqual(h.lists.other, ['x', 'y', 'z']);
  });

  it('preserves the full-save fallback for owner reorders', async (t) => {
    const h = setup(t, { fallback: true });
    const options = await h.activate();
    await options.onEnd(h.event);
    assert.deepEqual(h.deps.debouncedSaveList.mock.calls[0].arguments, [
      'owner',
      ['b', 'c', 'a'],
    ]);
  });

  for (const change of ['destroy', 'list', 'readonly', 'reinit']) {
    it(`ignores stale drag callbacks after ${change}`, async (t) => {
      const h = setup(t);
      const options = await h.activate();
      if (change === 'destroy') h.destroySorting(h.container);
      if (change === 'list') h.state.listId = 'other';
      if (change === 'readonly') h.rows.readOnly = true;
      if (change === 'reinit') await h.activate();
      options.onStart(h.event);
      assert.equal(h.body.classList.contains('desktop-dragging'), false);
      h.body.classList.add('desktop-dragging'); // Feedback owned by the new view.
      await options.onEnd(h.event);
      assert.equal(h.body.classList.contains('desktop-dragging'), true);
      assert.equal(h.deps.getListData.mock.callCount(), 0);
      assert.equal(h.deps.updatePositionNumbers.mock.callCount(), 0);
      assert.equal(h.deps.saveReorder.mock.callCount(), 0);
      assert.equal(h.deps.debouncedSaveList.mock.callCount(), 0);
      assert.deepEqual(h.lists.owner, ['a', 'b', 'c']);
      assert.deepEqual(h.lists.other, ['x', 'y', 'z']);
    });
  }

  for (const newerEdit of [false, true]) {
    it(`rolls back only the captured owner after navigation (newer edit: ${newerEdit})`, async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      t.mock.method(console, 'error', () => {});
      const h = setup(t);
      const saving = deferred();
      h.deps.saveReorder.mock.mockImplementation(() => saving.promise);
      const options = await h.activate();
      const ended = options.onEnd(h.event);
      t.mock.timers.tick(500);
      h.destroySorting(h.container);
      h.state.listId = 'other';
      if (newerEdit) h.lists.owner.push('new');
      h.rows.insertBefore = t.mock.fn();
      saving.reject(new Error('save failed'));
      await ended;
      assert.equal(h.rows.insertBefore.mock.callCount(), 0);
      assert.equal(h.deps.updatePositionNumbers.mock.callCount(), 1);
      assert.equal(h.deps.showToast.mock.callCount(), 0);
      assert.deepEqual(
        h.lists.owner,
        newerEdit ? ['b', 'c', 'a', 'new'] : ['a', 'b', 'c']
      );
      assert.deepEqual(h.lists.other, ['x', 'y', 'z']);
    });
  }

  it('invalidates callbacks before destroying and clears desktop feedback', async (t) => {
    const h = setup(t);
    const options = await h.activate();
    options.onStart(h.event);
    h.instances[0].destroy.mock.mockImplementation(() => {
      options.onStart(h.event);
      void options.onEnd(h.event);
    });
    h.destroySorting(h.container);
    assert.equal(h.body.classList.contains('desktop-dragging'), false);
    assert.equal(h.deps.getListData.mock.callCount(), 0);
    assert.equal(h.container._sortable, null);
  });

  it('cleans mobile touch listeners and hold state on destroy and reinit', async (t) => {
    const h = setup(t, { mobile: true });
    let now = 0;
    t.mock.method(Date, 'now', () => now);
    const options = await h.activate();
    assert.equal(options.delay, 300);
    const touch = { target: h.item, preventDefault: t.mock.fn() };
    h.rows.emit('touchstart', touch);
    h.rows.emit('touchmove', touch);
    assert.equal(touch.preventDefault.mock.callCount(), 0);
    now = 200;
    h.rows.emit('touchmove', touch);
    assert.equal(touch.preventDefault.mock.callCount(), 1);
    options.onStart(h.event);
    assert.equal(h.item.classList.contains('dragging-mobile'), true);
    const pending = h.initialize();
    assert.equal(h.item.classList.contains('dragging-mobile'), false);
    assert.equal(h.rows.listenerCount(), 0);
    assert.equal(h.instances[0].destroy.mock.callCount(), 1);
    h.loads.at(-1).resolve(h.Sortable);
    await pending;
    options.onStart(h.event);
    assert.equal(h.item.classList.contains('dragging-mobile'), false);
    h.instances[1].options.onStart(h.event);
    await options.onEnd(h.event);
    assert.equal(h.item.classList.contains('dragging-mobile'), true);
    assert.equal(h.deps.getListData.mock.callCount(), 0);
    assert.equal(h.rows.listenerCount(), 4);
    h.rows.emit('touchmove', touch);
    assert.equal(touch.preventDefault.mock.callCount(), 1);
    h.rows.emit('touchstart', touch);
    now = 400;
    h.rows.emit('touchcancel', touch);
    h.rows.emit('touchmove', touch);
    assert.equal(touch.preventDefault.mock.callCount(), 1);
    h.destroySorting(h.container);
    h.destroySorting(h.container);
    assert.equal(h.item.classList.contains('dragging-mobile'), false);
    assert.equal(h.rows.listenerCount(), 0);
    assert.equal(h.instances[1].destroy.mock.callCount(), 1);
    h.rows.emit('touchstart', touch);
    now = 600;
    h.rows.emit('touchmove', touch);
    assert.equal(touch.preventDefault.mock.callCount(), 1);
  });
});
