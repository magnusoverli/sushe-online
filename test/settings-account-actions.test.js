const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

function createElement(overrides = {}) {
  const listeners = {};
  return {
    value: '',
    disabled: false,
    textContent: '',
    innerHTML: '',
    dataset: {},
    listeners,
    focusCalls: 0,
    selectCalls: 0,
    classList: {
      add() {},
      remove() {},
    },
    addEventListener(event, handler) {
      listeners[event] = handler;
    },
    focus() {
      this.focusCalls += 1;
    },
    select() {
      this.selectCalls += 1;
    },
    querySelector() {
      return null;
    },
    ...overrides,
  };
}

function createDocument(elementsById = {}) {
  return {
    body: {
      appended: [],
      removed: [],
      appendChild(node) {
        this.appended.push(node);
      },
      removeChild(node) {
        this.removed.push(node);
      },
    },
    getElementById(id) {
      return elementsById[id] || null;
    },
  };
}

describe('settings account actions', () => {
  let createSettingsAccountActions;

  beforeEach(async () => {
    const module =
      await import('../src/js/modules/settings-drawer/handlers/account-actions.js');
    createSettingsAccountActions = module.createSettingsAccountActions;
  });

  it('enters email edit state and focuses email input', () => {
    const emailInput = createElement();
    const doc = createDocument({ emailInput });
    const categoryData = { account: { email: 'old@example.com' } };
    const renderCalls = [];
    let reattachCalls = 0;

    const { handleEditEmail } = createSettingsAccountActions({
      doc,
      win: { currentUser: { email: 'fallback@example.com' } },
      setTimeoutFn: (fn) => {
        fn();
      },
      categoryData,
      renderCategoryContent: (categoryId) => renderCalls.push(categoryId),
      reattachAccountHandlers: () => {
        reattachCalls += 1;
      },
      showToast: () => {},
      showConfirmation: async () => true,
      apiCall: async () => ({ success: true }),
      loadCategoryData: async () => {},
      createSettingsModalBase: () => ({ modal: createElement(), close() {} }),
    });

    handleEditEmail();

    assert.strictEqual(categoryData.account.editingEmail, true);
    assert.strictEqual(categoryData.account.tempEmail, 'old@example.com');
    assert.deepStrictEqual(renderCalls, ['account']);
    assert.strictEqual(reattachCalls, 1);
    assert.strictEqual(emailInput.focusCalls, 1);
    assert.strictEqual(emailInput.selectCalls, 1);
  });

  it('saves email and updates cached/current user state', async () => {
    const emailInput = createElement({ value: 'new@example.com' });
    const doc = createDocument({ emailInput });
    const categoryData = {
      account: {
        email: 'old@example.com',
        editingEmail: true,
        tempEmail: 'old@example.com',
      },
    };
    const toasts = [];
    const apiCalls = [];
    const renderCalls = [];
    let reattachCalls = 0;
    const win = { currentUser: { email: 'old@example.com' } };

    const { handleSaveEmail } = createSettingsAccountActions({
      doc,
      win,
      setTimeoutFn: (fn) => fn(),
      categoryData,
      renderCategoryContent: (categoryId) => renderCalls.push(categoryId),
      reattachAccountHandlers: () => {
        reattachCalls += 1;
      },
      showToast: (...args) => toasts.push(args),
      showConfirmation: async () => true,
      apiCall: async (...args) => {
        apiCalls.push(args);
        return { success: true };
      },
      loadCategoryData: async () => {},
      createSettingsModalBase: () => ({ modal: createElement(), close() {} }),
    });

    await handleSaveEmail();

    assert.deepStrictEqual(apiCalls[0], [
      '/settings/update-email',
      { method: 'POST', body: JSON.stringify({ email: 'new@example.com' }) },
    ]);
    assert.strictEqual(categoryData.account.email, 'new@example.com');
    assert.strictEqual(categoryData.account.editingEmail, false);
    assert.strictEqual(categoryData.account.tempEmail, undefined);
    assert.strictEqual(win.currentUser.email, 'new@example.com');
    assert.deepStrictEqual(toasts[0], [
      'Email updated successfully',
      'success',
    ]);
    assert.deepStrictEqual(renderCalls, ['account']);
    assert.strictEqual(reattachCalls, 1);
  });

  it('blocks invalid username values without API call', async () => {
    const usernameInput = createElement({ value: 'bad name' });
    const doc = createDocument({ usernameInput });
    const toasts = [];
    const apiCalls = [];

    const { handleSaveUsername } = createSettingsAccountActions({
      doc,
      win: { currentUser: { username: 'old' } },
      setTimeoutFn: (fn) => fn(),
      categoryData: { account: { username: 'old' } },
      renderCategoryContent: () => {},
      reattachAccountHandlers: () => {},
      showToast: (...args) => toasts.push(args),
      showConfirmation: async () => true,
      apiCall: async (...args) => {
        apiCalls.push(args);
        return { success: true };
      },
      loadCategoryData: async () => {},
      createSettingsModalBase: () => ({ modal: createElement(), close() {} }),
    });

    await handleSaveUsername();

    assert.strictEqual(apiCalls.length, 0);
    assert.deepStrictEqual(toasts[0], [
      'Username can only contain letters, numbers, and underscores',
      'error',
    ]);
  });

  it('submits admin request and reloads account data on success', async () => {
    const adminCodeInput = createElement({ value: 'abc123' });
    const requestAdminBtn = createElement({ textContent: 'Submit' });
    const doc = createDocument({ adminCodeInput, requestAdminBtn });
    const categoryData = { account: { role: 'user' } };
    const win = { currentUser: { role: 'user' } };
    const toasts = [];
    const apiCalls = [];
    const loaded = [];

    const { handleRequestAdmin } = createSettingsAccountActions({
      doc,
      win,
      setTimeoutFn: (fn) => fn(),
      categoryData,
      renderCategoryContent: () => {},
      reattachAccountHandlers: () => {},
      showToast: (...args) => toasts.push(args),
      showConfirmation: async () => true,
      apiCall: async (...args) => {
        apiCalls.push(args);
        return { success: true };
      },
      loadCategoryData: async (categoryId) => loaded.push(categoryId),
      createSettingsModalBase: () => ({ modal: createElement(), close() {} }),
    });

    await handleRequestAdmin();

    assert.deepStrictEqual(apiCalls[0], [
      '/settings/request-admin',
      { method: 'POST', body: JSON.stringify({ code: 'ABC123' }) },
    ]);
    assert.strictEqual(win.currentUser.role, 'admin');
    assert.strictEqual(categoryData.account, null);
    assert.deepStrictEqual(loaded, ['account']);
    assert.deepStrictEqual(toasts[0], ['Admin access granted!', 'success']);
  });

  it('creates password modal, appends to body, and focuses first field', async () => {
    const cancelBtn = createElement();
    const saveBtn = createElement();
    const form = createElement();
    const currentPasswordInput = createElement();
    const modal = createElement({
      classList: {
        removed: [],
        added: [],
        remove(className) {
          this.removed.push(className);
        },
        add(className) {
          this.added.push(className);
        },
      },
      querySelector(selector) {
        const map = {
          '#cancelPasswordBtn': cancelBtn,
          '#savePasswordBtn': saveBtn,
          '#passwordChangeForm': form,
          '#currentPasswordInput': currentPasswordInput,
        };
        return map[selector] || null;
      },
    });
    const doc = createDocument();

    const { handleChangePassword } = createSettingsAccountActions({
      doc,
      win: { currentUser: {} },
      setTimeoutFn: (fn) => fn(),
      categoryData: { account: {} },
      renderCategoryContent: () => {},
      reattachAccountHandlers: () => {},
      showToast: () => {},
      showConfirmation: async () => true,
      apiCall: async () => ({ success: true }),
      loadCategoryData: async () => {},
      createSettingsModalBase: () => ({
        modal,
        close() {},
      }),
    });

    await handleChangePassword();

    assert.strictEqual(doc.body.appended.length, 1);
    assert.strictEqual(doc.body.appended[0], modal);
    assert.deepStrictEqual(modal.classList.removed, ['hidden']);
    assert.strictEqual(currentPasswordInput.focusCalls, 1);
    assert.ok(typeof cancelBtn.listeners.click === 'function');
    assert.ok(typeof saveBtn.listeners.click === 'function');
    assert.ok(typeof form.listeners.submit === 'function');
  });
});
