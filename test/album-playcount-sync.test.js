const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert');

function createElement() {
  return {
    innerHTML: '',
    title: '',
    className: '',
    dataset: {},
    classList: {
      remove: mock.fn(),
    },
  };
}

describe('album-display playcount-sync module', () => {
  let createPlaycountSync;

  beforeEach(async () => {
    const module =
      await import('../src/js/modules/album-display/playcount-sync.js');
    createPlaycountSync = module.createPlaycountSync;
  });

  it('fetches playcounts and updates desktop/mobile elements', async () => {
    const desktopEl = createElement();
    const mobileEl = createElement();
    const doc = {
      querySelector: (selector) => {
        if (selector === '[data-playcount="item-1"]') return desktopEl;
        if (selector === '[data-playcount-mobile="item-1"]') return mobileEl;
        return null;
      },
    };

    const apiCall = mock.fn(async () => ({
      playcounts: {
        'item-1': { playcount: 1250, status: 'success' },
      },
      refreshing: 0,
    }));

    const sync = createPlaycountSync({
      apiCall,
      formatPlaycount: (value) => `${(value / 1000).toFixed(1)}K`,
      doc,
    });

    await sync.fetchAndDisplayPlaycounts('list-1');

    assert.strictEqual(apiCall.mock.calls.length, 1);
    assert.strictEqual(sync.getPlaycountCacheEntry('item-1').playcount, 1250);
    assert.match(desktopEl.innerHTML, /fa-headphones/);
    assert.match(mobileEl.innerHTML, /1.3K/);
    assert.strictEqual(desktopEl.dataset.status, 'success');
    assert.strictEqual(mobileEl.dataset.status, 'success');
  });

  it('renders not-found state for both desktop and mobile badges', async () => {
    const desktopEl = createElement();
    const mobileEl = createElement();
    const doc = {
      querySelector: (selector) => {
        if (selector === '[data-playcount="item-2"]') return desktopEl;
        if (selector === '[data-playcount-mobile="item-2"]') return mobileEl;
        return null;
      },
    };

    const sync = createPlaycountSync({
      apiCall: async () => ({
        playcounts: {
          'item-2': { playcount: null, status: 'not_found' },
        },
        refreshing: 0,
      }),
      formatPlaycount: () => '',
      doc,
    });

    await sync.fetchAndDisplayPlaycounts('list-2');

    assert.match(desktopEl.innerHTML, /fa-times/);
    assert.match(mobileEl.innerHTML, /fa-times/);
    assert.strictEqual(desktopEl.title, 'Album not found on Last.fm');
    assert.strictEqual(mobileEl.title, 'Album not found on Last.fm');
    assert.strictEqual(desktopEl.dataset.status, 'not_found');
    assert.strictEqual(mobileEl.dataset.status, 'not_found');
  });

  it('only warns for actionable fetch errors', async () => {
    const logger = {
      warn: mock.fn(),
      log: mock.fn(),
    };

    let callCount = 0;
    const sync = createPlaycountSync({
      apiCall: async () => {
        callCount += 1;
        if (callCount === 1) {
          return { error: 'Last.fm not connected' };
        }
        return { error: 'Rate limit exceeded' };
      },
      formatPlaycount: () => '',
      logger,
    });

    await sync.fetchAndDisplayPlaycounts('list-a');
    await sync.fetchAndDisplayPlaycounts('list-a');

    assert.strictEqual(logger.warn.mock.calls.length, 1);
    assert.deepStrictEqual(logger.warn.mock.calls[0].arguments, [
      'Failed to fetch playcounts:',
      'Rate limit exceeded',
    ]);
  });

  it('aborts polling controllers when cache is cleared', async () => {
    const controllers = [];
    const createAbortController = () => {
      const signal = { aborted: false };
      const controller = {
        signal,
        abort: () => {
          signal.aborted = true;
        },
      };
      controllers.push(controller);
      return controller;
    };

    const scheduled = [];
    const schedule = (callback) => {
      scheduled.push(callback);
      return 0;
    };

    const sync = createPlaycountSync({
      apiCall: async () => ({ playcounts: {}, refreshing: 2 }),
      formatPlaycount: () => '',
      createAbortController,
      schedule,
    });

    await sync.fetchAndDisplayPlaycounts('list-refresh');
    sync.clearPlaycountCache();

    assert.strictEqual(controllers.length, 1);
    assert.strictEqual(controllers[0].signal.aborted, true);
    assert.strictEqual(scheduled.length, 1);
  });
});
