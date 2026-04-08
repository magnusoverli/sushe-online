const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

function createElement(overrides = {}) {
  const listeners = {};
  return {
    value: '',
    textContent: '',
    innerHTML: '',
    disabled: false,
    files: null,
    listeners,
    classList: {
      removed: [],
      added: [],
      remove(...classes) {
        this.removed.push(...classes);
      },
      add(...classes) {
        this.added.push(...classes);
      },
    },
    addEventListener(event, handler) {
      listeners[event] = handler;
    },
    ...overrides,
  };
}

describe('settings admin actions', () => {
  let createSettingsAdminActions;

  beforeEach(async () => {
    const module =
      await import('../src/js/modules/settings-drawer/handlers/admin-actions.js');
    createSettingsAdminActions = module.createSettingsAdminActions;
  });

  it('handles account approval event action and reloads admin data', async () => {
    const confirmations = [];
    const apiCalls = [];
    const toasts = [];
    const loads = [];
    const categoryData = { admin: { stale: true } };

    const actions = createSettingsAdminActions({
      showConfirmation: async (...args) => {
        confirmations.push(args);
        return true;
      },
      apiCall: async (...args) => {
        apiCalls.push(args);
        return { success: true, message: 'Approved' };
      },
      showToast: (...args) => toasts.push(args),
      categoryData,
      loadCategoryData: async (categoryId) => loads.push(categoryId),
      createSettingsModalBase: () => ({ modal: createElement(), close() {} }),
    });

    await actions.handleAdminEventAction('evt1', 'approve', {
      event_type: 'account_approval',
      data: { username: 'alice', email: 'alice@example.com' },
    });

    assert.match(confirmations[0][0], /Approve User Registration/);
    assert.match(confirmations[0][1], /alice/);
    assert.deepStrictEqual(apiCalls[0], [
      '/api/admin/events/evt1/action/approve',
      { method: 'POST' },
    ]);
    assert.deepStrictEqual(toasts[0], ['Approved', 'success']);
    assert.strictEqual(categoryData.admin, null);
    assert.deepStrictEqual(loads, ['admin']);
  });

  it('does not execute admin event action when confirmation is cancelled', async () => {
    const apiCalls = [];

    const actions = createSettingsAdminActions({
      showConfirmation: async () => false,
      apiCall: async (...args) => {
        apiCalls.push(args);
        return { success: true };
      },
      showToast: () => {},
      categoryData: {},
      loadCategoryData: async () => {},
      createSettingsModalBase: () => ({ modal: createElement(), close() {} }),
    });

    await actions.handleAdminEventAction('evt1', 'reject', {
      event_type: 'account_approval',
      data: { username: 'alice' },
    });

    assert.strictEqual(apiCalls.length, 0);
  });

  it('opens restore modal and executes restore submit flow', async () => {
    const originalFormData = global.FormData;
    const formDataEntries = [];
    global.FormData = class MockFormData {
      append(key, value) {
        formDataEntries.push([key, value]);
      }
    };

    try {
      const cancelBtn = createElement();
      const confirmBtn = createElement();
      const form = createElement();
      const fileInput = createElement({ files: [{ name: 'backup.dump' }] });
      const errorEl = createElement();
      const progressEl = createElement();
      const progressText = createElement();
      const modal = createElement({
        querySelector(selector) {
          const map = {
            '#cancelRestoreBtn': cancelBtn,
            '#confirmRestoreBtn': confirmBtn,
            '#restoreDatabaseForm': form,
            '#backupFileInput': fileInput,
            '#restoreError': errorEl,
            '#restoreProgress': progressEl,
            '#restoreProgressText': progressText,
          };
          return map[selector] || null;
        },
      });

      const appended = [];
      const removed = [];
      const toasts = [];
      const apiCalls = [];

      const actions = createSettingsAdminActions({
        doc: {
          body: {
            appendChild(node) {
              appended.push(node);
            },
            contains(node) {
              return appended.includes(node) && !removed.includes(node);
            },
            removeChild(node) {
              removed.push(node);
            },
          },
        },
        setTimeoutFn: (fn) => {
          fn();
          return 0;
        },
        showConfirmation: async () => true,
        apiCall: async (...args) => {
          apiCalls.push(args);
          return { message: 'Restore done' };
        },
        showToast: (...args) => toasts.push(args),
        categoryData: {},
        loadCategoryData: async () => {},
        createSettingsModalBase: () => ({ modal, close() {} }),
      });

      await actions.handleRestoreDatabase();
      assert.strictEqual(appended.length, 1);
      assert.strictEqual(appended[0], modal);
      assert.deepStrictEqual(modal.classList.removed, ['hidden']);

      await confirmBtn.listeners.click();

      assert.deepStrictEqual(formDataEntries, [['backup', fileInput.files[0]]]);
      assert.strictEqual(apiCalls[0][0], '/admin/restore');
      assert.deepStrictEqual(toasts[0], [
        'Database restored successfully. Server will restart...',
        'success',
      ]);
      assert.ok(removed.includes(modal));
    } finally {
      global.FormData = originalFormData;
    }
  });
});
