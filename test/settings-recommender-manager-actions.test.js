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
    parentElement: null,
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

describe('settings recommender manager actions', () => {
  let createSettingsRecommenderManagerActions;

  beforeEach(async () => {
    const module =
      await import('../src/js/modules/settings-drawer/handlers/recommender-manager-actions.js');
    createSettingsRecommenderManagerActions =
      module.createSettingsRecommenderManagerActions;
  });

  it('opens recommender modal and shows empty approved-user state', async () => {
    const cancelBtn = createElement();
    const saveBtn = createElement();
    const body = createElement();
    const selectAllBtn = createElement();
    const deselectAllBtn = createElement();
    const modal = createElement({
      querySelector(selector) {
        const map = {
          '#cancelRecommenderBtn-2024': cancelBtn,
          '#saveRecommenderBtn-2024': saveBtn,
          '#selectAllRecsBtn-2024': selectAllBtn,
          '#deselectAllRecsBtn-2024': deselectAllBtn,
          '.settings-modal-body': body,
        };
        return map[selector] || null;
      },
    });

    const appended = [];
    const apiCalls = [];

    const actions = createSettingsRecommenderManagerActions({
      apiCall: async (url) => {
        apiCalls.push(url);
        return { users: [] };
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

    await actions.handleShowRecommenderManager(2024);

    assert.deepStrictEqual(apiCalls, [
      '/api/recommendations/2024/eligible-users',
    ]);
    assert.strictEqual(appended[0], modal);
    assert.deepStrictEqual(modal.classList.removed, ['hidden']);
    assert.match(body.innerHTML, /No approved users found/);
    assert.strictEqual(saveBtn.disabled, true);
  });

  it('saves recommender updates and reloads admin data', async () => {
    const cancelBtn = createElement();
    const saveBtn = createElement();
    const selectAllBtn = createElement();
    const deselectAllBtn = createElement();
    const countContainer = createElement();
    const countEl = createElement({ parentElement: countContainer });
    const checkbox = createElement({
      dataset: { userId: 'u1' },
      checked: false,
    });

    const body = createElement();
    const modal = createElement({
      querySelector(selector) {
        const map = {
          '#cancelRecommenderBtn-2024': cancelBtn,
          '#saveRecommenderBtn-2024': saveBtn,
          '#selectAllRecsBtn-2024': selectAllBtn,
          '#deselectAllRecsBtn-2024': deselectAllBtn,
          '.settings-modal-body': body,
        };
        return map[selector] || null;
      },
      querySelectorAll(selector) {
        if (selector === '.recommender-checkbox') return [checkbox];
        return [];
      },
    });

    const apiCalls = [];
    const toasts = [];
    const loads = [];
    const categoryData = { admin: { stale: true } };
    let closeCalls = 0;

    const actions = createSettingsRecommenderManagerActions({
      apiCall: async (url, options) => {
        apiCalls.push([url, options]);
        if (url === '/api/recommendations/2024/eligible-users') {
          return {
            users: [
              {
                user_id: 'u1',
                has_access: false,
                username: 'alice',
                email: 'alice@example.com',
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
          if (id === 'recommender-count-2024') {
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

    await actions.handleShowRecommenderManager(2024);

    checkbox.checked = true;
    checkbox.listeners.change();
    assert.strictEqual(saveBtn.disabled, false);
    assert.strictEqual(saveBtn.textContent, 'Save Changes');
    assert.match(countContainer.innerHTML, /1<\/span> of 1 users selected/);

    await saveBtn.listeners.click();

    assert.deepStrictEqual(apiCalls[1], [
      '/api/recommendations/2024/access',
      { method: 'PUT', body: JSON.stringify({ userIds: ['u1'] }) },
    ]);
    assert.deepStrictEqual(toasts[0], [
      'Recommendation access updated for 2024',
      'success',
    ]);
    assert.strictEqual(categoryData.admin, null);
    assert.deepStrictEqual(loads, ['admin']);
    assert.strictEqual(closeCalls, 1);
  });

  it('shows load error state when recommender fetch fails', async () => {
    const cancelBtn = createElement();
    const saveBtn = createElement();
    const selectAllBtn = createElement();
    const deselectAllBtn = createElement();
    const body = createElement();
    const modal = createElement({
      querySelector(selector) {
        const map = {
          '#cancelRecommenderBtn-2024': cancelBtn,
          '#saveRecommenderBtn-2024': saveBtn,
          '#selectAllRecsBtn-2024': selectAllBtn,
          '#deselectAllRecsBtn-2024': deselectAllBtn,
          '.settings-modal-body': body,
        };
        return map[selector] || null;
      },
    });

    const actions = createSettingsRecommenderManagerActions({
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

    await actions.handleShowRecommenderManager(2024);

    assert.match(body.innerHTML, /Error loading users/);
    assert.strictEqual(saveBtn.disabled, true);
  });
});
