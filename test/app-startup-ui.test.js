const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

function createClassList(initial = []) {
  const state = new Set(initial);
  return {
    state,
    added: [],
    removed: [],
    add(...classes) {
      classes.forEach((cls) => {
        state.add(cls);
        this.added.push(cls);
      });
    },
    remove(...classes) {
      classes.forEach((cls) => {
        state.delete(cls);
        this.removed.push(cls);
      });
    },
    contains(cls) {
      return state.has(cls);
    },
  };
}

describe('app-startup-ui module', () => {
  let createAppStartupUi;

  beforeEach(async () => {
    const module = await import('../src/js/modules/app-startup-ui.js');
    createAppStartupUi = module.createAppStartupUi;
  });

  it('converts flash elements to toasts and marks body as js-enabled', () => {
    const toasts = [];
    const logs = [];

    const flashA = {
      dataset: { flash: 'error', flashContent: 'Invalid login' },
      textContent: '',
    };
    const flashB = {
      dataset: { flash: 'success' },
      textContent: 'Saved successfully',
    };

    const doc = {
      body: {
        classList: createClassList(),
      },
      querySelectorAll(selector) {
        if (selector === '[data-flash]') return [flashA, flashB];
        return [];
      },
      getElementById() {
        return null;
      },
      querySelector() {
        return null;
      },
      documentElement: {
        classList: createClassList(),
      },
    };

    const ui = createAppStartupUi({
      doc,
      showToast: (...args) => toasts.push(args),
      logger: { log: (...args) => logs.push(args), warn: () => {} },
      storage: null,
      win: null,
    });

    ui.convertFlashToToast();

    assert.strictEqual(doc.body.classList.contains('js-enabled'), true);
    assert.deepStrictEqual(toasts, [
      ['Invalid login', 'error'],
      ['Saved successfully', 'success'],
    ]);
    assert.strictEqual(logs[0][0], 'Flash messages found:');
  });

  it('initializes sidebar collapse and toggles persisted state', () => {
    const listeners = {};
    const sidebar = { classList: createClassList(['collapsed']) };
    const mainContent = { classList: createClassList(['sidebar-collapsed']) };
    const sidebarToggle = {
      addEventListener(event, handler) {
        listeners[event] = handler;
      },
    };

    const doc = {
      body: { classList: createClassList() },
      documentElement: { classList: createClassList(['sidebar-is-collapsed']) },
      getElementById(id) {
        if (id === 'sidebar') return sidebar;
        if (id === 'sidebarToggle') return sidebarToggle;
        return null;
      },
      querySelector(selector) {
        if (selector === '.main-content') return mainContent;
        return null;
      },
      querySelectorAll() {
        return [];
      },
    };

    const writes = [];
    const storage = {
      getItem(key) {
        if (key === 'sidebarCollapsed') return 'true';
        return null;
      },
      setItem(key, value) {
        writes.push([key, value]);
      },
    };

    const ui = createAppStartupUi({
      doc,
      storage,
      logger: { log: () => {}, warn: () => {} },
      win: null,
      showToast: () => {},
    });

    ui.initializeSidebarCollapse();
    assert.strictEqual(
      doc.documentElement.classList.contains('sidebar-is-collapsed'),
      false
    );

    listeners.click();
    assert.strictEqual(sidebar.classList.contains('collapsed'), false);
    assert.strictEqual(
      mainContent.classList.contains('sidebar-collapsed'),
      false
    );
    assert.deepStrictEqual(writes[0], ['sidebarCollapsed', 'false']);

    listeners.click();
    assert.strictEqual(sidebar.classList.contains('collapsed'), true);
    assert.strictEqual(
      mainContent.classList.contains('sidebar-collapsed'),
      true
    );
    assert.deepStrictEqual(writes[1], ['sidebarCollapsed', 'true']);
  });

  it('registers beforeunload list saver and warns on storage errors', () => {
    const listeners = {};
    const warnings = [];

    const win = {
      addEventListener(event, handler) {
        listeners[event] = handler;
      },
    };

    const storage = {
      setItem() {
        const error = new Error('quota');
        error.name = 'QuotaExceededError';
        throw error;
      },
      getItem() {
        return null;
      },
    };

    const ui = createAppStartupUi({
      win,
      storage,
      doc: {
        body: { classList: createClassList() },
        querySelectorAll() {
          return [];
        },
        getElementById() {
          return null;
        },
        querySelector() {
          return null;
        },
        documentElement: { classList: createClassList() },
      },
      showToast: () => {},
      logger: { log: () => {}, warn: (...args) => warnings.push(args) },
    });

    ui.registerBeforeUnloadListSaver(() => 'list-123');
    listeners.beforeunload();

    assert.deepStrictEqual(warnings[0], [
      'Failed to save last selected list on unload:',
      'QuotaExceededError',
    ]);
  });

  it('cleans up legacy list cache keys safely', () => {
    const removed = [];
    const warnings = [];
    const keys = [
      'foo',
      'lastSelectedListData_alpha',
      'lastSelectedListData_beta',
      'cachedListNames',
    ];

    const storage = {
      get length() {
        return keys.length;
      },
      key(index) {
        return keys[index] || null;
      },
      removeItem(key) {
        removed.push(key);
      },
      getItem() {
        return null;
      },
      setItem() {},
    };

    const ui = createAppStartupUi({
      storage,
      logger: { log: () => {}, warn: (...args) => warnings.push(args) },
      showToast: () => {},
      doc: {
        body: { classList: createClassList() },
        querySelectorAll() {
          return [];
        },
        getElementById() {
          return null;
        },
        querySelector() {
          return null;
        },
        documentElement: { classList: createClassList() },
      },
      win: null,
    });

    ui.cleanupLegacyListCache();

    assert.ok(removed.includes('lists_cache'));
    assert.ok(removed.includes('lists_cache_timestamp'));
    assert.ok(removed.includes('lastSelectedListData_alpha'));
    assert.ok(removed.includes('lastSelectedListData_beta'));
    assert.strictEqual(warnings.length, 0);
  });

  it('hydrates sidebar list names from cache and updates nav', () => {
    const warnings = [];
    const lists = {};
    let navUpdated = 0;

    const storage = {
      getItem(key) {
        if (key === 'cachedListNames') {
          return JSON.stringify(['list-one', 'list-two']);
        }
        return null;
      },
      setItem() {},
      removeItem() {},
      key() {
        return null;
      },
      length: 0,
    };

    const ui = createAppStartupUi({
      storage,
      logger: { log: () => {}, warn: (...args) => warnings.push(args) },
      showToast: () => {},
      doc: {
        body: { classList: createClassList() },
        querySelectorAll() {
          return [];
        },
        getElementById() {
          return null;
        },
        querySelector() {
          return null;
        },
        documentElement: { classList: createClassList() },
      },
      win: null,
    });

    ui.hydrateSidebarFromCachedNames(
      () => lists,
      () => {
        navUpdated += 1;
      }
    );

    assert.ok(lists['list-one']);
    assert.ok(lists['list-two']);
    assert.strictEqual(lists['list-one'].name, 'list-one');
    assert.strictEqual(navUpdated, 1);
    assert.strictEqual(warnings.length, 0);
  });
});
