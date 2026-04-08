const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

function createElement(overrides = {}) {
  const listeners = {};
  return {
    dataset: {},
    disabled: false,
    textContent: '',
    innerHTML: '',
    style: {},
    listeners,
    addEventListener(event, handler) {
      listeners[event] = handler;
    },
    closest() {
      return null;
    },
    ...overrides,
  };
}

function createDocument({ ids = {}, selectors = {} } = {}) {
  return {
    getElementById(id) {
      return ids[id] || null;
    },
    querySelectorAll(selector) {
      return selectors[selector] || [];
    },
  };
}

function buildDeps(overrides = {}) {
  const calls = {
    toasts: [],
    api: [],
    adminEventAction: [],
    summaryLoads: 0,
    imageLoads: 0,
    intervals: [],
  };

  let pollRef = null;

  const deps = {
    showConfirmation: async () => false,
    apiCall: async (...args) => {
      calls.api.push(args);
      return { success: true };
    },
    showToast: (...args) => calls.toasts.push(args),
    loadAlbumSummaryStats: async () => {
      calls.summaryLoads += 1;
    },
    pollAlbumSummaryStatus: () => {},
    getAlbumSummaryPollInterval: () => pollRef,
    setAlbumSummaryPollInterval: (value) => {
      pollRef = value;
    },
    loadAlbumImageStats: async () => {
      calls.imageLoads += 1;
    },
    handleAdminEventAction: async (...args) =>
      calls.adminEventAction.push(args),
    handleConfigureTelegram: () => {},
    handleDisconnectTelegram: () => {},
    handleToggleTelegramRecommendations: () => {},
    handleTestTelegramRecommendations: () => {},
    handleRestoreDatabase: () => {},
    handleGrantAdmin: async () => {},
    handleRevokeAdmin: async () => {},
    handleViewUserLists: async () => {},
    handleDeleteUser: async () => {},
    handleConfirmAggregateReveal: async () => {},
    handleRevokeAggregateConfirm: async () => {},
    handleResetAggregateReveal: async () => {},
    handleRecomputeAggregateList: async () => {},
    handleAuditAggregateList: async () => {},
    handleShowContributorManager: async () => {},
    handleToggleYearLock: async () => {},
    handleToggleRecommendationLock: async () => {},
    handleShowRecommenderManager: async () => {},
    handleFetchAlbumSummaries: async () => {},
    handleStopAlbumSummaries: async () => {},
    handleRefetchAlbumImages: async () => {},
    handleStopRefetchImages: async () => {},
    handleScanDuplicates: async () => {},
    handleAuditManualAlbums: async () => {},
    setIntervalFn: (fn, delay) => {
      calls.intervals.push({ fn, delay });
      return 42;
    },
    ...overrides,
  };

  return { deps, calls, getPollRef: () => pollRef };
}

describe('settings admin handlers', () => {
  let createSettingsAdminHandlers;

  beforeEach(async () => {
    const module =
      await import('../src/js/modules/settings-drawer/handlers/admin-handlers.js');
    createSettingsAdminHandlers = module.createSettingsAdminHandlers;
  });

  it('loads album summary and image stats on attach', () => {
    const doc = createDocument();
    const { deps, calls } = buildDeps({ doc });

    const { attachAdminHandlers } = createSettingsAdminHandlers(deps);
    attachAdminHandlers();

    assert.strictEqual(calls.summaryLoads, 1);
    assert.strictEqual(calls.imageLoads, 1);
  });

  it('parses admin event payload and forwards action', async () => {
    const eventContainer = createElement({
      dataset: {
        eventData: JSON.stringify({ id: 'e1', type: 'review' }),
      },
    });
    const eventBtn = createElement({
      dataset: { eventId: 'e1', action: 'approve' },
      closest() {
        return eventContainer;
      },
    });
    const doc = createDocument({
      selectors: {
        '.admin-event-action': [eventBtn],
      },
    });
    const { deps, calls } = buildDeps({ doc });

    const { attachAdminHandlers } = createSettingsAdminHandlers(deps);
    attachAdminHandlers();
    await eventBtn.listeners.click();

    assert.deepStrictEqual(calls.adminEventAction, [
      ['e1', 'approve', { id: 'e1', type: 'review' }],
    ]);
  });

  it('does not call regenerate API when confirmation is rejected', async () => {
    const fetchBtn = createElement();
    const regenBtn = createElement();
    const doc = createDocument({
      ids: {
        fetchAlbumSummariesBtn: fetchBtn,
        regenerateAllSummariesBtn: regenBtn,
      },
    });

    const { deps, calls } = buildDeps({
      doc,
      showConfirmation: async () => false,
    });

    const { attachAdminHandlers } = createSettingsAdminHandlers(deps);
    attachAdminHandlers();
    await regenBtn.listeners.click();

    assert.strictEqual(calls.api.length, 0);
    assert.strictEqual(calls.toasts.length, 0);
  });

  it('starts summary polling once after successful regenerate-all', async () => {
    const fetchBtn = createElement();
    const regenBtn = createElement();
    const doc = createDocument({
      ids: {
        fetchAlbumSummariesBtn: fetchBtn,
        regenerateAllSummariesBtn: regenBtn,
      },
    });

    const { deps, calls, getPollRef } = buildDeps({
      doc,
      showConfirmation: async () => true,
      apiCall: async (...args) => {
        calls.api.push(args);
        return { success: true };
      },
    });

    const { attachAdminHandlers } = createSettingsAdminHandlers(deps);
    attachAdminHandlers();

    await regenBtn.listeners.click();
    await regenBtn.listeners.click();

    assert.deepStrictEqual(calls.api[0], [
      '/api/admin/album-summaries/fetch',
      {
        method: 'POST',
        body: JSON.stringify({ includeRetries: true, regenerateAll: true }),
      },
    ]);
    assert.deepStrictEqual(calls.toasts[0], [
      'Regenerating all album summaries...',
      'success',
    ]);
    assert.strictEqual(calls.summaryLoads, 3);
    assert.strictEqual(calls.intervals.length, 1);
    assert.strictEqual(calls.intervals[0].delay, 2000);
    assert.strictEqual(getPollRef(), 42);
    assert.strictEqual(regenBtn.disabled, false);
    assert.strictEqual(fetchBtn.disabled, false);
    assert.strictEqual(regenBtn.textContent, 'Regenerate All');
  });
});
