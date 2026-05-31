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

describe('settings availability actions', () => {
  let createSettingsAvailabilityActions;

  beforeEach(async () => {
    const module =
      await import('../src/js/modules/settings-drawer/handlers/availability-actions.js');
    createSettingsAvailabilityActions =
      module.createSettingsAvailabilityActions;
  });

  it('keeps polling after the async start endpoint returns', async () => {
    const resolveBtn = createElement();
    const reresolveBtn = createElement();
    const stopBtn = createElement({ classList: createClassList(['hidden']) });
    const progressContainer = createElement({
      classList: createClassList(['hidden']),
    });
    const progressBar = createElement({ style: {} });
    const progressPercent = createElement();
    const progressLabel = createElement();
    const resultEl = createElement({ classList: createClassList(['hidden']) });
    const resultTextEl = createElement();
    const statsEl = createElement();
    const intervalCalls = [];
    const toasts = [];

    const actions = createSettingsAvailabilityActions({
      doc: createDoc({
        resolveAvailabilityBtn: resolveBtn,
        reresolveAvailabilityBtn: reresolveBtn,
        stopAvailabilityBtn: stopBtn,
        availabilityProgress: progressContainer,
        availabilityProgressBar: progressBar,
        availabilityProgressPercent: progressPercent,
        availabilityProgressLabel: progressLabel,
        availabilityResult: resultEl,
        availabilityResultText: resultTextEl,
        availabilityStats: statsEl,
      }),
      apiCall: async (url) => {
        if (url === '/api/admin/availability/resolve') {
          return { success: true, started: true };
        }
        if (url === '/api/admin/availability/progress') {
          return {
            isRunning: false,
            progress: null,
            lastSummary: {
              total: 2,
              resolved: 1,
              skipped: 1,
              failed: 0,
              durationSeconds: 3,
              stoppedEarly: false,
            },
          };
        }
        if (url === '/api/admin/availability/stats') {
          return {
            stats: { totalAlbums: 2, resolved: 1, unresolved: 1 },
            isRunning: false,
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
      showToast: (message, type) => toasts.push({ message, type }),
      showConfirmation: async () => true,
      setIntervalFn: (fn, delay) => {
        intervalCalls.push({ fn, delay });
        return 23;
      },
      clearIntervalFn: () => {},
    });

    await actions.handleResolveAvailability();

    assert.strictEqual(progressContainer.classList.has('hidden'), false);
    assert.strictEqual(stopBtn.classList.has('hidden'), false);
    assert.strictEqual(intervalCalls.length, 1);
    assert.strictEqual(intervalCalls[0].delay, 1500);

    await intervalCalls[0].fn();

    assert.strictEqual(progressContainer.classList.has('hidden'), true);
    assert.strictEqual(resultEl.classList.has('hidden'), false);
    assert.match(resultTextEl.innerHTML, /Resolution Complete/);
    assert.match(resultTextEl.innerHTML, /Resolved:<\/span> 1/);
    assert.strictEqual(toasts.at(-1).type, 'success');
  });
});
