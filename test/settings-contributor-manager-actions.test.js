const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

function createElement(overrides = {}) {
  const listeners = {};
  return {
    innerHTML: '',
    textContent: '',
    disabled: false,
    checked: false,
    dataset: {},
    listeners,
    classList: {
      removed: [],
      remove(...classes) {
        this.removed.push(...classes);
      },
      add() {},
    },
    addEventListener(event, handler) {
      listeners[event] = handler;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    ...overrides,
  };
}

describe('settings contributor manager actions', () => {
  let createSettingsContributorManagerActions;

  beforeEach(async () => {
    const module =
      await import('../src/js/modules/settings-drawer/handlers/contributor-manager-actions.js');
    createSettingsContributorManagerActions =
      module.createSettingsContributorManagerActions;
  });

  it('opens contributor modal and shows empty eligible-user state', async () => {
    const cancelBtn = createElement();
    const saveBtn = createElement();
    const body = createElement();
    const modal = createElement({
      querySelector(selector) {
        const map = {
          '#cancelContributorBtn-2024': cancelBtn,
          '#saveContributorBtn-2024': saveBtn,
          '.settings-modal-body': body,
        };
        return map[selector] || null;
      },
    });

    const appended = [];
    const apiCalls = [];

    const actions = createSettingsContributorManagerActions({
      apiCall: async (url) => {
        apiCalls.push(url);
        return { eligibleUsers: [] };
      },
      showToast: () => {},
      categoryData: {},
      loadCategoryData: async () => {},
      createSettingsModalBase: () => ({ modal, close() {} }),
      doc: {
        body: {
          appendChild(node) {
            appended.push(node);
          },
        },
        getElementById() {
          return null;
        },
      },
      setTimeoutFn: (fn) => {
        fn();
        return 0;
      },
    });

    await actions.handleShowContributorManager(2024);

    assert.deepStrictEqual(apiCalls, [
      '/api/aggregate-list/2024/eligible-users',
    ]);
    assert.strictEqual(appended[0], modal);
    assert.deepStrictEqual(modal.classList.removed, ['hidden']);
    assert.match(body.innerHTML, /No users have main lists for this year/);
    assert.strictEqual(saveBtn.disabled, true);
  });

  it('saves contributor updates and reloads admin data', async () => {
    const cancelBtn = createElement();
    const saveBtn = createElement();
    const countEl = createElement();
    const checkbox = createElement({
      dataset: { userId: 'u1' },
      checked: false,
    });
    const selectAllBtn = createElement();
    const deselectAllBtn = createElement();

    const body = createElement({
      querySelector(selector) {
        if (selector === '#selectAllBtn-2024') return selectAllBtn;
        if (selector === '#deselectAllBtn-2024') return deselectAllBtn;
        return null;
      },
      querySelectorAll(selector) {
        if (selector === '.contributor-checkbox') return [checkbox];
        return [];
      },
    });

    const modal = createElement({
      querySelector(selector) {
        const map = {
          '#cancelContributorBtn-2024': cancelBtn,
          '#saveContributorBtn-2024': saveBtn,
          '.settings-modal-body': body,
        };
        return map[selector] || null;
      },
    });

    const apiCalls = [];
    const toasts = [];
    const loads = [];
    const categoryData = { admin: { stale: true } };
    let closeCalls = 0;

    const actions = createSettingsContributorManagerActions({
      apiCall: async (url, options) => {
        apiCalls.push([url, options]);
        if (url === '/api/aggregate-list/2024/eligible-users') {
          return {
            eligibleUsers: [
              {
                user_id: 'u1',
                is_contributor: false,
                username: 'alice',
                album_count: 5,
                list_name: 'Main',
              },
            ],
          };
        }

        return { success: true };
      },
      showToast: (...args) => toasts.push(args),
      categoryData,
      loadCategoryData: async (categoryId) => loads.push(categoryId),
      createSettingsModalBase: () => ({
        modal,
        close() {
          closeCalls += 1;
        },
      }),
      doc: {
        body: {
          appendChild() {},
        },
        getElementById(id) {
          if (id === 'contributor-count-2024') {
            return countEl;
          }
          return null;
        },
      },
      setTimeoutFn: (fn) => {
        fn();
        return 0;
      },
    });

    await actions.handleShowContributorManager(2024);

    checkbox.checked = true;
    checkbox.listeners.change({ target: checkbox });
    assert.strictEqual(saveBtn.disabled, false);
    assert.strictEqual(saveBtn.textContent, 'Save Changes');
    assert.strictEqual(countEl.textContent, 1);

    await saveBtn.listeners.click();

    assert.deepStrictEqual(apiCalls[1], [
      '/api/aggregate-list/2024/contributors',
      { method: 'PUT', body: JSON.stringify({ userIds: ['u1'] }) },
    ]);
    assert.deepStrictEqual(toasts[0], ['Updated 1 contributor', 'success']);
    assert.strictEqual(categoryData.admin, null);
    assert.deepStrictEqual(loads, ['admin']);
    assert.strictEqual(closeCalls, 1);
  });

  it('shows load error state when eligible-user fetch fails', async () => {
    const cancelBtn = createElement();
    const saveBtn = createElement();
    const body = createElement();
    const modal = createElement({
      querySelector(selector) {
        const map = {
          '#cancelContributorBtn-2024': cancelBtn,
          '#saveContributorBtn-2024': saveBtn,
          '.settings-modal-body': body,
        };
        return map[selector] || null;
      },
    });

    const actions = createSettingsContributorManagerActions({
      apiCall: async () => {
        throw new Error('load failed');
      },
      showToast: () => {},
      categoryData: {},
      loadCategoryData: async () => {},
      createSettingsModalBase: () => ({ modal, close() {} }),
      doc: {
        body: {
          appendChild() {},
        },
        getElementById() {
          return null;
        },
      },
      setTimeoutFn: (fn) => {
        fn();
        return 0;
      },
    });

    await actions.handleShowContributorManager(2024);

    assert.match(body.innerHTML, /Error loading users/);
    assert.strictEqual(saveBtn.disabled, true);
  });
});
