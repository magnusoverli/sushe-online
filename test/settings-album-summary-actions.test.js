const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

function createClassList(initial = []) {
  const classes = new Set(initial);
  return {
    add(...toAdd) {
      toAdd.forEach((c) => classes.add(c));
    },
    remove(...toRemove) {
      toRemove.forEach((c) => classes.delete(c));
    },
    has(className) {
      return classes.has(className);
    },
  };
}

function createElement(overrides = {}) {
  return {
    innerHTML: '',
    textContent: '',
    disabled: false,
    style: {},
    classList: createClassList(),
    ...overrides,
  };
}

function createDoc(ids = {}) {
  return {
    getElementById(id) {
      return ids[id] || null;
    },
  };
}

describe('settings album summary actions', () => {
  let createSettingsAlbumSummaryActions;

  beforeEach(async () => {
    const module =
      await import('../src/js/modules/settings-drawer/handlers/album-summary-actions.js');
    createSettingsAlbumSummaryActions =
      module.createSettingsAlbumSummaryActions;
  });

  it('loads summary stats and starts polling when batch is running', async () => {
    const statsEl = createElement();
    const fetchBtn = createElement();
    const regenerateBtn = createElement();
    const stopBtn = createElement({ classList: createClassList(['hidden']) });
    const progressEl = createElement({
      classList: createClassList(['hidden']),
    });
    const progressBar = createElement({ style: {} });
    const progressText = createElement();

    let pollRef = null;
    const intervalCalls = [];

    const actions = createSettingsAlbumSummaryActions({
      doc: createDoc({
        albumSummaryStats: statsEl,
        fetchAlbumSummariesBtn: fetchBtn,
        regenerateAllSummariesBtn: regenerateBtn,
        stopAlbumSummariesBtn: stopBtn,
        albumSummaryProgress: progressEl,
        albumSummaryProgressBar: progressBar,
        albumSummaryProgressText: progressText,
      }),
      apiCall: async () => ({
        stats: {
          totalAlbums: 10,
          withSummary: 5,
          attemptedNoSummary: 2,
          neverAttempted: 3,
          fromClaude: 4,
        },
        batchStatus: {
          running: true,
          progress: 33,
          processed: 1,
          total: 3,
          found: 1,
          notFound: 0,
          errors: 0,
        },
      }),
      showToast: () => {},
      getAlbumSummaryPollInterval: () => pollRef,
      setAlbumSummaryPollInterval: (value) => {
        pollRef = value;
      },
      setIntervalFn: (_fn, delay) => {
        intervalCalls.push(delay);
        return 42;
      },
      clearIntervalFn: () => {},
    });

    await actions.loadAlbumSummaryStats();

    assert.match(statsEl.innerHTML, /Total Albums/);
    assert.strictEqual(fetchBtn.classList.has('hidden'), true);
    assert.strictEqual(stopBtn.classList.has('hidden'), false);
    assert.strictEqual(progressEl.classList.has('hidden'), false);
    assert.strictEqual(progressBar.style.width, '33%');
    assert.match(progressText.textContent, /Processing: 1\/3/);
    assert.deepStrictEqual(intervalCalls, [2000]);
    assert.strictEqual(pollRef, 42);
  });

  it('starts summary fetch and resets button state', async () => {
    const fetchBtn = createElement({ textContent: 'Fetch Missing' });
    const stopBtn = createElement();
    const progressEl = createElement();
    const toasts = [];
    const apiCalls = [];

    const actions = createSettingsAlbumSummaryActions({
      doc: createDoc({
        fetchAlbumSummariesBtn: fetchBtn,
        stopAlbumSummariesBtn: stopBtn,
        albumSummaryProgress: progressEl,
      }),
      apiCall: async (...args) => {
        apiCalls.push(args);
        return { success: true, status: { running: false } };
      },
      showToast: (...args) => toasts.push(args),
      getAlbumSummaryPollInterval: () => null,
      setAlbumSummaryPollInterval: () => {},
      setIntervalFn: () => 0,
      clearIntervalFn: () => {},
    });

    await actions.handleFetchAlbumSummaries();

    assert.deepStrictEqual(apiCalls[0], [
      '/api/admin/album-summaries/fetch',
      {
        method: 'POST',
        body: JSON.stringify({ includeRetries: true, regenerateAll: false }),
      },
    ]);
    assert.deepStrictEqual(toasts[0], [
      'Album summary fetch started',
      'success',
    ]);
    assert.strictEqual(fetchBtn.disabled, false);
    assert.strictEqual(fetchBtn.textContent, 'Fetch Missing');
  });

  it('stops summary fetch and reloads stats', async () => {
    const stopBtn = createElement({ textContent: 'Stop' });
    const fetchBtn = createElement({ classList: createClassList(['hidden']) });
    const progressEl = createElement();
    const statsEl = createElement();
    const toasts = [];
    const calls = [];

    const actions = createSettingsAlbumSummaryActions({
      doc: createDoc({
        stopAlbumSummariesBtn: stopBtn,
        fetchAlbumSummariesBtn: fetchBtn,
        albumSummaryProgress: progressEl,
        albumSummaryStats: statsEl,
      }),
      apiCall: async (url, options) => {
        calls.push([url, options]);
        if (url === '/api/admin/album-summaries/stop') {
          return { success: true, status: { running: false } };
        }
        return {
          stats: { totalAlbums: 1 },
          batchStatus: { running: false },
        };
      },
      showToast: (...args) => toasts.push(args),
      getAlbumSummaryPollInterval: () => null,
      setAlbumSummaryPollInterval: () => {},
      setIntervalFn: () => 0,
      clearIntervalFn: () => {},
    });

    await actions.handleStopAlbumSummaries();

    assert.strictEqual(calls[0][0], '/api/admin/album-summaries/stop');
    assert.strictEqual(calls[1][0], '/api/admin/album-summaries/stats');
    assert.deepStrictEqual(toasts[0], [
      'Album summary fetch stopped',
      'success',
    ]);
    assert.strictEqual(stopBtn.disabled, false);
    assert.strictEqual(stopBtn.textContent, 'Stop');
  });

  it('polls status, clears interval, and reloads stats when job is finished', async () => {
    const fetchBtn = createElement({ classList: createClassList(['hidden']) });
    const stopBtn = createElement();
    const progressEl = createElement();
    const statsEl = createElement();

    let pollRef = 99;
    const cleared = [];
    const calls = [];

    const actions = createSettingsAlbumSummaryActions({
      doc: createDoc({
        fetchAlbumSummariesBtn: fetchBtn,
        stopAlbumSummariesBtn: stopBtn,
        albumSummaryProgress: progressEl,
        albumSummaryStats: statsEl,
      }),
      apiCall: async (url) => {
        calls.push(url);
        if (url === '/api/admin/album-summaries/status') {
          return { status: { running: false } };
        }
        return {
          stats: { totalAlbums: 1 },
          batchStatus: { running: false },
        };
      },
      showToast: () => {},
      getAlbumSummaryPollInterval: () => pollRef,
      setAlbumSummaryPollInterval: (value) => {
        pollRef = value;
      },
      setIntervalFn: () => 0,
      clearIntervalFn: (value) => {
        cleared.push(value);
      },
    });

    await actions.pollAlbumSummaryStatus();

    assert.deepStrictEqual(calls, [
      '/api/admin/album-summaries/status',
      '/api/admin/album-summaries/stats',
    ]);
    assert.deepStrictEqual(cleared, [99]);
    assert.strictEqual(pollRef, null);
  });
});
