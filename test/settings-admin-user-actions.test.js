const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

function createElement(overrides = {}) {
  const listeners = {};
  return {
    classList: {
      removed: [],
      remove(...classes) {
        this.removed.push(...classes);
      },
    },
    listeners,
    addEventListener(event, handler) {
      listeners[event] = handler;
    },
    querySelector() {
      return null;
    },
    ...overrides,
  };
}

describe('settings admin user actions', () => {
  let createSettingsAdminUserActions;

  beforeEach(async () => {
    const module =
      await import('../src/js/modules/settings-drawer/handlers/admin-user-actions.js');
    createSettingsAdminUserActions = module.createSettingsAdminUserActions;
  });

  it('grants admin and reloads admin category', async () => {
    const confirmations = [];
    const apiCalls = [];
    const toasts = [];
    const loads = [];
    const categoryData = { admin: { stale: true } };

    const actions = createSettingsAdminUserActions({
      showConfirmation: async (...args) => {
        confirmations.push(args);
        return true;
      },
      apiCall: async (...args) => {
        apiCalls.push(args);
        return { success: true };
      },
      showToast: (...args) => toasts.push(args),
      categoryData,
      loadCategoryData: async (categoryId) => loads.push(categoryId),
      createSettingsModalBase: () => ({ modal: createElement(), close() {} }),
      doc: { body: { appendChild() {} } },
    });

    await actions.handleGrantAdmin('u1');

    assert.match(confirmations[0][0], /Grant Admin Access/);
    assert.deepStrictEqual(apiCalls[0], [
      '/admin/make-admin',
      { method: 'POST', body: JSON.stringify({ userId: 'u1' }) },
    ]);
    assert.deepStrictEqual(toasts[0], [
      'Admin access granted successfully',
      'success',
    ]);
    assert.strictEqual(categoryData.admin, null);
    assert.deepStrictEqual(loads, ['admin']);
  });

  it('does not revoke admin when confirmation is cancelled', async () => {
    const apiCalls = [];

    const actions = createSettingsAdminUserActions({
      showConfirmation: async () => false,
      apiCall: async (...args) => {
        apiCalls.push(args);
        return { success: true };
      },
      showToast: () => {},
      categoryData: {},
      loadCategoryData: async () => {},
      createSettingsModalBase: () => ({ modal: createElement(), close() {} }),
      doc: { body: { appendChild() {} } },
    });

    await actions.handleRevokeAdmin('u2');

    assert.strictEqual(apiCalls.length, 0);
  });

  it('opens user-lists modal when list data exists', async () => {
    const appended = [];
    const closeBtn = createElement();
    const modal = createElement({
      querySelector(selector) {
        if (selector === '#closeUserListsBtn') return closeBtn;
        return null;
      },
    });
    let modalOptions = null;

    const actions = createSettingsAdminUserActions({
      showConfirmation: async () => true,
      apiCall: async () => ({
        lists: [
          {
            name: 'Top Albums',
            albumCount: 12,
            createdAt: '2024-01-01T00:00:00Z',
          },
        ],
      }),
      showToast: () => {},
      categoryData: {},
      loadCategoryData: async () => {},
      createSettingsModalBase: (options) => {
        modalOptions = options;
        return { modal, close() {} };
      },
      doc: {
        body: {
          appendChild(node) {
            appended.push(node);
          },
        },
      },
    });

    await actions.handleViewUserLists('u3');

    assert.strictEqual(appended.length, 1);
    assert.strictEqual(appended[0], modal);
    assert.deepStrictEqual(modal.classList.removed, ['hidden']);
    assert.ok(typeof closeBtn.listeners.click === 'function');
    assert.match(modalOptions.bodyHtml, /Top Albums/);
  });

  it('deletes user and reloads admin category', async () => {
    const toasts = [];
    const loads = [];
    const categoryData = { admin: { stale: true } };
    const apiCalls = [];

    const actions = createSettingsAdminUserActions({
      showConfirmation: async () => true,
      apiCall: async (...args) => {
        apiCalls.push(args);
        return { success: true };
      },
      showToast: (...args) => toasts.push(args),
      categoryData,
      loadCategoryData: async (categoryId) => loads.push(categoryId),
      createSettingsModalBase: () => ({ modal: createElement(), close() {} }),
      doc: { body: { appendChild() {} } },
    });

    await actions.handleDeleteUser('u9');

    assert.deepStrictEqual(apiCalls[0], [
      '/admin/delete-user',
      { method: 'POST', body: JSON.stringify({ userId: 'u9' }) },
    ]);
    assert.deepStrictEqual(toasts[0], ['User deleted successfully', 'success']);
    assert.strictEqual(categoryData.admin, null);
    assert.deepStrictEqual(loads, ['admin']);
  });
});
