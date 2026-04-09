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

describe('settings album image actions', () => {
  let createSettingsAlbumImageActions;

  beforeEach(async () => {
    const module =
      await import('../src/js/modules/settings-drawer/handlers/album-image-actions.js');
    createSettingsAlbumImageActions = module.createSettingsAlbumImageActions;
  });

  it('loads image stats and starts polling when refetch is running', async () => {
    const statsEl = createElement();
    const refetchBtn = createElement();
    const stopBtn = createElement({ classList: createClassList(['hidden']) });
    const progressContainer = createElement({
      classList: createClassList(['hidden']),
    });
    const progressBar = createElement({ style: {} });
    const progressPercent = createElement();
    const progressLabel = createElement();

    const intervalCalls = [];

    const actions = createSettingsAlbumImageActions({
      doc: createDoc({
        albumImageStats: statsEl,
        refetchAlbumImagesBtn: refetchBtn,
        stopRefetchImagesBtn: stopBtn,
        imageRefetchProgress: progressContainer,
        imageRefetchProgressBar: progressBar,
        imageRefetchProgressPercent: progressPercent,
        imageRefetchProgressLabel: progressLabel,
      }),
      apiCall: async (url) => {
        if (url === '/api/admin/images/stats') {
          return {
            stats: {
              totalAlbums: 10,
              withImage: 8,
              withoutImage: 2,
              avgSizeKb: 120,
              minSizeKb: 20,
              maxSizeKb: 400,
            },
            isRunning: true,
          };
        }

        return {
          progress: {
            percentComplete: 25,
            processed: 5,
            total: 20,
            skipped: 1,
          },
        };
      },
      showToast: () => {},
      showConfirmation: async () => true,
      setIntervalFn: (fn, delay) => {
        intervalCalls.push({ fn, delay });
        return 17;
      },
      clearIntervalFn: () => {},
    });

    await actions.loadAlbumImageStats();

    assert.match(statsEl.innerHTML, /Total Albums/);
    assert.strictEqual(refetchBtn.classList.has('hidden'), true);
    assert.strictEqual(stopBtn.classList.has('hidden'), false);
    assert.strictEqual(progressContainer.classList.has('hidden'), false);
    assert.strictEqual(progressBar.style.width, '25%');
    assert.strictEqual(progressPercent.textContent, '25%');
    assert.match(progressLabel.textContent, /Processing 5 of 20/);
    assert.strictEqual(intervalCalls.length, 1);
    assert.strictEqual(intervalCalls[0].delay, 1500);
  });

  it('does not start refetch when confirmation is cancelled', async () => {
    const refetchBtn = createElement({ textContent: 'Refetch Images' });
    const resultEl = createElement();
    const resultTextEl = createElement();
    const apiCalls = [];

    const actions = createSettingsAlbumImageActions({
      doc: createDoc({
        refetchAlbumImagesBtn: refetchBtn,
        imageRefetchResult: resultEl,
        imageRefetchResultText: resultTextEl,
      }),
      apiCall: async (...args) => {
        apiCalls.push(args);
        return { success: true };
      },
      showToast: () => {},
      showConfirmation: async () => false,
      setIntervalFn: () => 0,
      clearIntervalFn: () => {},
    });

    await actions.handleRefetchAlbumImages();

    assert.strictEqual(apiCalls.length, 0);
    assert.strictEqual(refetchBtn.textContent, 'Refetch Images');
  });

  it('runs refetch flow, shows result summary, and reloads stats', async () => {
    const statsEl = createElement();
    const refetchBtn = createElement({ textContent: 'Refetch Images' });
    const stopBtn = createElement();
    const progressContainer = createElement();
    const progressBar = createElement({ style: {} });
    const progressPercent = createElement();
    const progressLabel = createElement();
    const resultEl = createElement();
    const resultTextEl = createElement();

    const toasts = [];
    const apiCalls = [];
    const cleared = [];

    const actions = createSettingsAlbumImageActions({
      doc: createDoc({
        albumImageStats: statsEl,
        refetchAlbumImagesBtn: refetchBtn,
        stopRefetchImagesBtn: stopBtn,
        imageRefetchProgress: progressContainer,
        imageRefetchProgressBar: progressBar,
        imageRefetchProgressPercent: progressPercent,
        imageRefetchProgressLabel: progressLabel,
        imageRefetchResult: resultEl,
        imageRefetchResultText: resultTextEl,
      }),
      apiCall: async (url, options) => {
        apiCalls.push([url, options]);
        if (url === '/api/admin/images/refetch') {
          return {
            success: true,
            summary: {
              total: 12,
              success: 8,
              failed: 1,
              skipped: 3,
              durationSeconds: 75,
              stoppedEarly: false,
            },
          };
        }

        return {
          stats: {
            totalAlbums: 12,
            withImage: 11,
            withoutImage: 1,
            avgSizeKb: 128,
            minSizeKb: 20,
            maxSizeKb: 400,
          },
          isRunning: false,
        };
      },
      showToast: (...args) => toasts.push(args),
      showConfirmation: async () => true,
      setIntervalFn: () => 99,
      clearIntervalFn: (value) => {
        cleared.push(value);
      },
    });

    await actions.handleRefetchAlbumImages();

    assert.strictEqual(apiCalls[0][0], '/api/admin/images/refetch');
    assert.strictEqual(apiCalls[1][0], '/api/admin/images/stats');
    assert.match(resultTextEl.innerHTML, /Refetch Complete/);
    assert.match(resultTextEl.innerHTML, /1m 15s/);
    assert.strictEqual(resultEl.classList.has('hidden'), false);
    assert.deepStrictEqual(toasts[0], [
      'Image refetch started. This may take a while...',
      'info',
    ]);
    assert.deepStrictEqual(toasts[1], [
      'Image refetch completed: 8 updated, 1 failed, 3 skipped',
      'success',
    ]);
    assert.strictEqual(refetchBtn.disabled, false);
    assert.strictEqual(refetchBtn.textContent, 'Refetch Images');
    assert.deepStrictEqual(cleared, [99]);
  });

  it('stops refetch and shows stopping feedback', async () => {
    const stopBtn = createElement({ textContent: 'Stop' });
    const toasts = [];
    const apiCalls = [];

    const actions = createSettingsAlbumImageActions({
      doc: createDoc({
        stopRefetchImagesBtn: stopBtn,
      }),
      apiCall: async (...args) => {
        apiCalls.push(args);
        return { success: true };
      },
      showToast: (...args) => toasts.push(args),
      showConfirmation: async () => true,
      setIntervalFn: () => 0,
      clearIntervalFn: () => {},
    });

    await actions.handleStopRefetchImages();

    assert.deepStrictEqual(apiCalls[0], [
      '/api/admin/images/stop',
      { method: 'POST' },
    ]);
    assert.deepStrictEqual(toasts[0], ['Image refetch stopping...', 'info']);
    assert.strictEqual(stopBtn.disabled, false);
    assert.strictEqual(stopBtn.textContent, 'Stop');
  });
});
