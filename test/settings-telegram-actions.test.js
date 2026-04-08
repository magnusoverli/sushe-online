const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

function createClassList() {
  return {
    removed: [],
    added: [],
    remove(...classes) {
      this.removed.push(...classes);
    },
    add(...classes) {
      this.added.push(...classes);
    },
  };
}

function createElement(overrides = {}) {
  const listeners = {};
  return {
    value: '',
    textContent: '',
    innerHTML: '',
    disabled: false,
    dataset: {},
    classList: createClassList(),
    listeners,
    focusCalls: 0,
    addEventListener(event, handler) {
      listeners[event] = handler;
    },
    focus() {
      this.focusCalls += 1;
    },
    querySelector() {
      return null;
    },
    ...overrides,
  };
}

describe('settings telegram actions', () => {
  let createSettingsTelegramActions;

  beforeEach(async () => {
    const module =
      await import('../src/js/modules/settings-drawer/handlers/telegram-actions.js');
    createSettingsTelegramActions = module.createSettingsTelegramActions;
  });

  it('opens configure modal and focuses token input', async () => {
    const tokenInput = createElement();
    const closeBtn = createElement();
    const validateBtn = createElement();
    const detectBtn = createElement();
    const groupSelect = createElement();
    const topicSelect = createElement();
    const testBtn = createElement();
    const saveBtn = createElement();
    const stepEls = {
      '#telegramStep1': createElement(),
      '#telegramStep2': createElement(),
      '#telegramStep3': createElement(),
      '#telegramStep4': createElement(),
    };

    const modal = createElement({
      querySelector(selector) {
        const map = {
          '#closeTelegramModalBtn': closeBtn,
          '#validateTelegramTokenBtn': validateBtn,
          '#detectTelegramGroupsBtn': detectBtn,
          '#telegramGroupSelect': groupSelect,
          '#telegramTopicSelect': topicSelect,
          '#sendTelegramTestBtn': testBtn,
          '#saveTelegramConfigBtn': saveBtn,
          '#telegramBotToken': tokenInput,
        };
        return map[selector] || null;
      },
    });

    const doc = {
      body: {
        appended: [],
        appendChild(node) {
          this.appended.push(node);
        },
        contains() {
          return false;
        },
        removeChild() {},
      },
      querySelector(selector) {
        return stepEls[selector] || null;
      },
      createElement() {
        return createElement();
      },
    };

    const actions = createSettingsTelegramActions({
      doc,
      setTimeoutFn: (fn) => fn(),
      createSettingsModalBase: () => ({ modal, close() {} }),
      showToast: () => {},
      apiCall: async () => ({ success: true }),
      categoryData: {},
      loadCategoryData: async () => {},
      showConfirmation: async () => true,
    });

    await actions.handleConfigureTelegram();

    assert.strictEqual(doc.body.appended.length, 1);
    assert.strictEqual(doc.body.appended[0], modal);
    assert.deepStrictEqual(modal.classList.removed, ['hidden']);
    assert.strictEqual(tokenInput.focusCalls, 1);
    assert.ok(typeof closeBtn.listeners.click === 'function');
    assert.ok(typeof validateBtn.listeners.click === 'function');
  });

  it('disconnects telegram and reloads admin data on success', async () => {
    const categoryData = { admin: { configured: true } };
    const toasts = [];
    const loads = [];
    const apiCalls = [];

    const actions = createSettingsTelegramActions({
      doc: {
        body: {
          appendChild() {},
          contains() {
            return false;
          },
          removeChild() {},
        },
        querySelector() {
          return null;
        },
        createElement() {
          return createElement();
        },
      },
      createSettingsModalBase: () => ({ modal: createElement(), close() {} }),
      showToast: (...args) => toasts.push(args),
      apiCall: async (...args) => {
        apiCalls.push(args);
        return { success: true };
      },
      categoryData,
      loadCategoryData: async (categoryId) => loads.push(categoryId),
      showConfirmation: async () => true,
    });

    await actions.handleDisconnectTelegram();

    assert.deepStrictEqual(apiCalls[0], [
      '/api/admin/telegram/disconnect',
      { method: 'DELETE' },
    ]);
    assert.deepStrictEqual(toasts[0], [
      'Telegram disconnected successfully',
      'success',
    ]);
    assert.strictEqual(categoryData.admin, null);
    assert.deepStrictEqual(loads, ['admin']);
  });

  it('toggles telegram recommendations and reloads admin data', async () => {
    const categoryData = { admin: { telegram: true } };
    const toasts = [];
    const apiCalls = [];
    const loads = [];

    const actions = createSettingsTelegramActions({
      doc: {
        body: {
          appendChild() {},
          contains() {
            return false;
          },
          removeChild() {},
        },
        querySelector() {
          return null;
        },
        createElement() {
          return createElement();
        },
      },
      createSettingsModalBase: () => ({ modal: createElement(), close() {} }),
      showToast: (...args) => toasts.push(args),
      apiCall: async (...args) => {
        apiCalls.push(args);
        if (args[0].includes('/status')) {
          return { recommendationsEnabled: false };
        }
        return { success: true };
      },
      categoryData,
      loadCategoryData: async (categoryId) => loads.push(categoryId),
      showConfirmation: async () => true,
    });

    await actions.handleToggleTelegramRecommendations();

    assert.deepStrictEqual(apiCalls[0], [
      '/api/admin/telegram/recommendations/status',
    ]);
    assert.deepStrictEqual(apiCalls[1], [
      '/api/admin/telegram/recommendations/toggle',
      { method: 'POST', body: JSON.stringify({ enabled: true }) },
    ]);
    assert.deepStrictEqual(toasts[0], [
      'Recommendation notifications enabled',
      'success',
    ]);
    assert.strictEqual(categoryData.admin, null);
    assert.deepStrictEqual(loads, ['admin']);
  });

  it('sends telegram recommendation test notification', async () => {
    const toasts = [];
    const apiCalls = [];

    const actions = createSettingsTelegramActions({
      doc: {
        body: {
          appendChild() {},
          contains() {
            return false;
          },
          removeChild() {},
        },
        querySelector() {
          return null;
        },
        createElement() {
          return createElement();
        },
      },
      createSettingsModalBase: () => ({ modal: createElement(), close() {} }),
      showToast: (...args) => toasts.push(args),
      apiCall: async (...args) => {
        apiCalls.push(args);
        return { success: true, year: 2025 };
      },
      categoryData: {},
      loadCategoryData: async () => {},
      showConfirmation: async () => true,
    });

    await actions.handleTestTelegramRecommendations();

    assert.deepStrictEqual(apiCalls[0], [
      '/api/admin/telegram/recommendations/test',
      { method: 'POST' },
    ]);
    assert.deepStrictEqual(toasts[0], [
      'Test notification sent for year 2025',
      'success',
    ]);
  });
});
