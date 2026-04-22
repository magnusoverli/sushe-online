const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

function createElement(overrides = {}) {
  const listeners = {};
  return {
    innerHTML: '',
    textContent: '',
    disabled: false,
    className: '',
    title: '',
    dataset: {},
    listeners,
    replacedWith: null,
    appended: [],
    classList: {
      add() {},
      remove() {},
    },
    addEventListener(event, handler) {
      listeners[event] = handler;
    },
    querySelector() {
      return null;
    },
    appendChild(node) {
      this.appended.push(node);
      return node;
    },
    replaceWith(node) {
      this.replacedWith = node;
    },
    remove() {
      this.removed = true;
    },
    ...overrides,
  };
}

describe('settings aggregate actions', () => {
  let createSettingsAggregateActions;

  beforeEach(async () => {
    const module =
      await import('../src/js/modules/settings-drawer/handlers/aggregate-actions.js');
    createSettingsAggregateActions = module.createSettingsAggregateActions;
  });

  it('confirms aggregate reveal and reloads admin data', async () => {
    const confirmations = [];
    const apiCalls = [];
    const toasts = [];
    const loads = [];
    const categoryData = { admin: { stale: true } };

    const actions = createSettingsAggregateActions({
      showConfirmation: async (...args) => {
        confirmations.push(args);
        return true;
      },
      apiCall: async (...args) => {
        apiCalls.push(args);
        return { success: true, revealed: false };
      },
      showToast: (...args) => toasts.push(args),
      categoryData,
      loadCategoryData: async (categoryId) => loads.push(categoryId),
      handleShowContributorManager: async () => {},
      handleShowRecommenderManager: async () => {},
      createSettingsModalBase: () => ({ modal: createElement(), close() {} }),
      doc: {
        querySelector() {
          return null;
        },
        getElementById() {
          return null;
        },
        createElement() {
          return createElement();
        },
        addEventListener() {},
        removeEventListener() {},
      },
      win: {},
    });

    await actions.handleConfirmAggregateReveal(2025);

    assert.match(confirmations[0][0], /Confirm Reveal/);
    assert.deepStrictEqual(apiCalls[0], [
      '/api/aggregate-list/2025/confirm',
      { method: 'POST' },
    ]);
    assert.deepStrictEqual(toasts[0], [
      'Confirmation added. Waiting for more confirmations.',
      'success',
    ]);
    assert.strictEqual(categoryData.admin, null);
    assert.deepStrictEqual(loads, ['admin']);
  });

  it('does not revoke aggregate confirmation when user cancels', async () => {
    const apiCalls = [];

    const actions = createSettingsAggregateActions({
      showConfirmation: async () => false,
      apiCall: async (...args) => {
        apiCalls.push(args);
        return { success: true };
      },
      showToast: () => {},
      categoryData: {},
      loadCategoryData: async () => {},
      handleShowContributorManager: async () => {},
      handleShowRecommenderManager: async () => {},
      createSettingsModalBase: () => ({ modal: createElement(), close() {} }),
      doc: {
        querySelector() {
          return null;
        },
        getElementById() {
          return null;
        },
        createElement() {
          return createElement();
        },
        addEventListener() {},
        removeEventListener() {},
      },
      win: {},
    });

    await actions.handleRevokeAggregateConfirm(2025);

    assert.strictEqual(apiCalls.length, 0);
  });

  it('locks a year and updates lock controls without full reload', async () => {
    const apiCalls = [];
    const refreshCalls = [];
    const categoryData = {
      admin: {
        aggregateStatus: [{ year: 2024, locked: false }],
      },
    };

    const lockButton = createElement({
      dataset: { year: '2024', locked: false },
    });

    const yearHeader = createElement({
      lockIcon: null,
      querySelector(selector) {
        if (selector === '.fa-lock') return this.lockIcon;
        return null;
      },
      appendChild(node) {
        this.lockIcon = node;
        return node;
      },
    });

    const contributorsButton = createElement();

    const createdNodes = [];
    const doc = {
      querySelector(selector) {
        if (selector === '.aggregate-toggle-lock[data-year="2024"]') {
          return lockButton;
        }
        if (selector === '.aggregate-year-toggle[data-year="2024"]') {
          return yearHeader;
        }
        if (selector === '.aggregate-manage-contributors[data-year="2024"]') {
          return contributorsButton;
        }
        if (
          selector === 'button[disabled][data-year="2024"][title*="Unlock"]'
        ) {
          return null;
        }
        return null;
      },
      getElementById() {
        return null;
      },
      createElement() {
        const el = createElement();
        createdNodes.push(el);
        return el;
      },
      addEventListener() {},
      removeEventListener() {},
    };

    const actions = createSettingsAggregateActions({
      showConfirmation: async () => true,
      apiCall: async (...args) => {
        apiCalls.push(args);
        return { success: true };
      },
      showToast: () => {},
      categoryData,
      loadCategoryData: async () => {},
      handleShowContributorManager: async () => {},
      handleShowRecommenderManager: async () => {},
      createSettingsModalBase: () => ({ modal: createElement(), close() {} }),
      doc,
      win: {},
      async refreshLockedYearStatus(year) {
        refreshCalls.push(year);
      },
    });

    await actions.handleToggleYearLock(2024, false);

    assert.deepStrictEqual(apiCalls[0], [
      '/api/aggregate-list/2024/lock',
      { method: 'POST' },
    ]);
    assert.match(lockButton.innerHTML, /Unlock Year/);
    assert.strictEqual(lockButton.dataset.locked, true);
    assert.ok(yearHeader.lockIcon);
    assert.strictEqual(yearHeader.lockIcon.className.includes('fa-lock'), true);
    assert.strictEqual(contributorsButton.replacedWith?.disabled, true);
    assert.strictEqual(categoryData.admin.aggregateStatus[0].locked, true);
    assert.deepStrictEqual(refreshCalls, [2024]);
    assert.strictEqual(createdNodes.length >= 2, true);
  });

  it('unlocks recommendations and re-enables manage button', async () => {
    const apiCalls = [];
    const toasts = [];
    const invalidateCalls = [];
    const managerCalls = [];

    const lockButton = createElement({
      dataset: { year: '2023', locked: true },
    });
    const disabledManageButton = createElement({
      dataset: { year: '2023' },
      disabled: true,
    });

    const doc = {
      querySelector(selector) {
        if (selector === '.recommendation-toggle-lock[data-year="2023"]') {
          return lockButton;
        }
        if (selector === '.recommendation-manage-access[data-year="2023"]') {
          return null;
        }
        if (
          selector ===
          'button[disabled][data-year="2023"][title*="Unlock recommendations"]'
        ) {
          return disabledManageButton;
        }
        return null;
      },
      getElementById() {
        return null;
      },
      createElement() {
        return createElement();
      },
      addEventListener() {},
      removeEventListener() {},
    };

    const actions = createSettingsAggregateActions({
      showConfirmation: async () => true,
      apiCall: async (...args) => {
        apiCalls.push(args);
        return { success: true };
      },
      showToast: (...args) => toasts.push(args),
      categoryData: {},
      loadCategoryData: async () => {},
      handleShowContributorManager: async () => {},
      handleShowRecommenderManager: async (year) => managerCalls.push(year),
      createSettingsModalBase: () => ({ modal: createElement(), close() {} }),
      doc,
      win: {
        invalidateLockedRecommendationYearsCache() {
          invalidateCalls.push(true);
        },
      },
    });

    await actions.handleToggleRecommendationLock(2023, true);

    assert.deepStrictEqual(apiCalls[0], [
      '/api/recommendations/2023/unlock',
      { method: 'POST' },
    ]);
    assert.match(lockButton.innerHTML, /Lock Recommendations/);
    assert.strictEqual(lockButton.dataset.locked, false);
    assert.deepStrictEqual(toasts[0], [
      'Recommendations for 2023 have been unlocked successfully',
      'success',
    ]);
    assert.ok(disabledManageButton.replacedWith);
    assert.strictEqual(
      disabledManageButton.replacedWith.className,
      'settings-button recommendation-manage-access'
    );
    await disabledManageButton.replacedWith.listeners.click();
    assert.deepStrictEqual(managerCalls, [2023]);
    assert.strictEqual(invalidateCalls.length, 1);
  });

  it('recomputes aggregate list and refreshes stats grid content', async () => {
    const toasts = [];
    const status = {
      year: 2022,
      stats: {
        participantCount: 7,
        totalAlbums: 20,
        albumsWith3PlusVoters: 6,
        albumsWith2Voters: 3,
      },
    };
    const categoryData = {
      admin: {
        aggregateStatus: [{ year: 2022, stats: { totalAlbums: 1 } }],
      },
    };

    const statsGrid = createElement();
    const yearContent = createElement({
      querySelector(selector) {
        if (selector === '.grid.grid-cols-2.sm\\:grid-cols-4') {
          return statsGrid;
        }
        return null;
      },
    });

    const actions = createSettingsAggregateActions({
      showConfirmation: async () => true,
      apiCall: async (url) => {
        if (url === '/api/aggregate-list/2022/recompute') {
          return { success: true, status };
        }
        throw new Error('unexpected url');
      },
      showToast: (...args) => toasts.push(args),
      categoryData,
      loadCategoryData: async () => {},
      handleShowContributorManager: async () => {},
      handleShowRecommenderManager: async () => {},
      createSettingsModalBase: () => ({ modal: createElement(), close() {} }),
      doc: {
        querySelector() {
          return null;
        },
        getElementById(id) {
          if (id === 'aggregate-year-content-2022') {
            return yearContent;
          }
          return null;
        },
        createElement() {
          return createElement();
        },
        addEventListener() {},
        removeEventListener() {},
      },
      win: {},
    });

    await actions.handleRecomputeAggregateList(2022);

    assert.deepStrictEqual(toasts[0], [
      'Aggregate list for 2022 recomputed successfully',
      'success',
    ]);
    assert.deepStrictEqual(categoryData.admin.aggregateStatus[0], status);
    assert.match(statsGrid.innerHTML, /Contributors/);
    assert.match(statsGrid.innerHTML, />20</);
  });

  it('runs audit, opens results modal, and reports endpoint errors', async () => {
    const toasts = [];
    const apiCalls = [];
    let modalOptions = null;

    const modal = createElement({
      querySelector() {
        return null;
      },
    });

    const actions = createSettingsAggregateActions({
      showConfirmation: async () => true,
      apiCall: async (url) => {
        apiCalls.push(url);
        if (url === '/api/admin/aggregate-audit/2021') {
          return {
            summary: {
              totalAlbumsScanned: 10,
              uniqueAlbums: 8,
              albumsWithMultipleIds: 1,
              totalChangesNeeded: 1,
            },
            duplicates: [{ key: 'x' }],
          };
        }
        if (url === '/api/admin/aggregate-audit/2021/diagnose') {
          return {
            overlapStats: {
              distribution: {
                appearsOn1List: 2,
                appearsOn2PlusLists: 6,
                appearsOn3PlusLists: 4,
                appearsOn5PlusLists: 1,
              },
            },
            missedByBasic: [{ id: 'a' }],
          };
        }
        throw new Error('audit failed');
      },
      showToast: (...args) => toasts.push(args),
      categoryData: {},
      loadCategoryData: async () => {},
      handleShowContributorManager: async () => {},
      handleShowRecommenderManager: async () => {},
      createSettingsModalBase: (options) => {
        modalOptions = options;
        return { modal, close() {} };
      },
      doc: {
        querySelector() {
          return null;
        },
        getElementById() {
          return null;
        },
        createElement() {
          return createElement();
        },
        addEventListener() {},
        removeEventListener() {},
      },
      win: {},
    });

    await actions.handleAuditAggregateList(2021);

    assert.deepStrictEqual(toasts[0], ['Running audit...', 'info']);
    assert.deepStrictEqual(apiCalls.slice(0, 2), [
      '/api/admin/aggregate-audit/2021',
      '/api/admin/aggregate-audit/2021/diagnose',
    ]);
    assert.strictEqual(modalOptions.id, 'audit-modal-2021');
    assert.match(modalOptions.bodyHtml, /Overlap Statistics/);

    await actions.handleAuditAggregateList(2020);
    assert.deepStrictEqual(toasts[toasts.length - 1], [
      'audit failed',
      'error',
    ]);
  });
});
