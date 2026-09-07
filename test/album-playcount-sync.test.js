const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert');

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

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

  it('primes cached playcounts without needing a fetch', () => {
    const apiCall = mock.fn(async () => {
      throw new Error('should not fetch while priming cache');
    });

    const sync = createPlaycountSync({
      apiCall,
      formatPlaycount: (value) => String(value),
    });

    sync.primePlaycountCache({
      'item-1': { playcount: 42, status: 'success' },
    });

    assert.deepStrictEqual(sync.getPlaycountCacheEntry('item-1'), {
      playcount: 42,
      status: 'success',
    });
    assert.strictEqual(apiCall.mock.calls.length, 0);
  });

  it('prefetches playcounts for render and updates existing elements if present', async () => {
    const desktopEl = createElement();
    const doc = {
      querySelector: (selector) =>
        selector === '[data-playcount="item-1"]' ? desktopEl : null,
    };
    const apiCall = mock.fn(async () => ({
      playcounts: {
        'item-1': { playcount: 77, status: 'success' },
      },
      refreshing: 0,
    }));

    const sync = createPlaycountSync({
      apiCall,
      formatPlaycount: (value) => String(value),
      doc,
    });

    const response = await sync.prefetchPlaycountsForRender('list-1');

    assert.strictEqual(apiCall.mock.calls.length, 1);
    assert.strictEqual(
      apiCall.mock.calls[0].arguments[0],
      '/api/lastfm/list-playcounts/list-1'
    );
    assert.strictEqual(response.refreshing, 0);
    assert.strictEqual(sync.getPlaycountCacheEntry('item-1').playcount, 77);
    assert.match(desktopEl.innerHTML, /77/);
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

  it('skips playcount fetches when Last.fm is disconnected', async () => {
    const logger = {
      warn: mock.fn(),
      log: mock.fn(),
    };
    const apiCall = mock.fn(async () => {
      throw new Error('should not call api');
    });

    const sync = createPlaycountSync({
      apiCall,
      formatPlaycount: () => '',
      logger,
      win: { currentUser: { lastfmUsername: null } },
    });

    await sync.fetchAndDisplayPlaycounts('list-disconnected');

    assert.strictEqual(apiCall.mock.calls.length, 0);
    assert.strictEqual(logger.warn.mock.calls.length, 0);
  });

  it('silences expected Last.fm disconnected fetch errors', async () => {
    const logger = {
      warn: mock.fn(),
      log: mock.fn(),
    };
    const error = new Error('Last.fm not connected');
    error.data = {
      code: 'NOT_AUTHENTICATED',
      service: 'lastfm',
      error: 'Last.fm not connected',
    };

    const sync = createPlaycountSync({
      apiCall: async () => {
        throw error;
      },
      formatPlaycount: () => '',
      logger,
      win: { currentUser: { lastfmUsername: 'listener' } },
    });

    await sync.fetchAndDisplayPlaycounts('list-disconnected');

    assert.strictEqual(logger.warn.mock.calls.length, 0);
  });

  it('applies playcount updates from Last.fm scrobble events', () => {
    const desktopEl = createElement();
    const mobileEl = createElement();
    let updateHandler = null;
    const win = {
      currentUser: { lastfmUsername: 'listener' },
      addEventListener: (eventName, handler) => {
        if (eventName === 'lastfm-playcounts-updated') {
          updateHandler = handler;
        }
      },
    };
    const doc = {
      querySelector: (selector) => {
        if (selector === '[data-playcount="item-1"]') return desktopEl;
        if (selector === '[data-playcount-mobile="item-1"]') return mobileEl;
        return null;
      },
    };

    const sync = createPlaycountSync({
      apiCall: async () => ({}),
      formatPlaycount: (value) => String(value),
      doc,
      win,
    });

    updateHandler({
      detail: {
        playcounts: {
          'item-1': { playcount: 116, status: 'success' },
        },
      },
    });

    assert.strictEqual(sync.getPlaycountCacheEntry('item-1').playcount, 116);
    assert.match(desktopEl.innerHTML, /116/);
    assert.match(mobileEl.innerHTML, /116/);
  });

  it('stops scheduled playcount polling after Last.fm disconnects', async () => {
    const win = { currentUser: { lastfmUsername: 'listener' } };
    const scheduled = [];
    const apiCall = mock.fn(async () => ({ playcounts: {}, refreshing: 1 }));

    const sync = createPlaycountSync({
      apiCall,
      formatPlaycount: () => '',
      win,
      schedule: (callback) => {
        scheduled.push(callback);
        return 0;
      },
    });

    await sync.fetchAndDisplayPlaycounts('list-refresh');
    win.currentUser.lastfmUsername = null;
    await scheduled[0]();

    assert.strictEqual(apiCall.mock.calls.length, 1);
  });

  it('keeps polling past MIN_POLLS while refreshing > 0, then shows the fresh value', async () => {
    const desktopEl = createElement();
    const doc = {
      querySelector: (selector) =>
        selector === '[data-playcount="item-1"]' ? desktopEl : null,
    };

    // Stale value displays first and stays stale across several polls (server
    // still reports refreshing:1), then the fresh value lands with refreshing:0.
    const responses = [
      {
        playcounts: { 'item-1': { playcount: 93, status: 'success' } },
        refreshing: 1,
      }, // initial fetch
      {
        playcounts: { 'item-1': { playcount: 93, status: 'success' } },
        refreshing: 1,
      }, // poll 1
      {
        playcounts: { 'item-1': { playcount: 93, status: 'success' } },
        refreshing: 1,
      }, // poll 2
      {
        playcounts: { 'item-1': { playcount: 93, status: 'success' } },
        refreshing: 1,
      }, // poll 3 (>= MIN_POLLS, unchanged)
      {
        playcounts: { 'item-1': { playcount: 116, status: 'success' } },
        refreshing: 0,
      }, // poll 4: fresh
      {
        playcounts: { 'item-1': { playcount: 116, status: 'success' } },
        refreshing: 0,
      }, // poll 5: stop
    ];
    let call = 0;
    const apiCall = mock.fn(
      async () => responses[Math.min(call++, responses.length - 1)]
    );

    const scheduled = [];
    const sync = createPlaycountSync({
      apiCall,
      formatPlaycount: (value) => String(value),
      doc,
      win: { currentUser: { lastfmUsername: 'listener' } },
      schedule: (callback) => {
        scheduled.push(callback);
        return scheduled.length;
      },
    });

    await sync.fetchAndDisplayPlaycounts('list-1');

    // Drive each scheduled poll callback in order (the array grows as polls
    // schedule their successor).
    let i = 0;
    while (i < scheduled.length && i < 10) {
      await scheduled[i]();
      i++;
    }

    // The old stop heuristic (no nulls + no change + pollCount>=MIN_POLLS)
    // would have stopped at poll 3 and frozen on 93. With the refreshing-aware
    // condition it keeps polling and picks up 116.
    assert.strictEqual(sync.getPlaycountCacheEntry('item-1').playcount, 116);
    assert.match(desktopEl.innerHTML, /116/);
    assert.ok(
      apiCall.mock.calls.length >= 5,
      `expected >=5 poll calls, got ${apiCall.mock.calls.length}`
    );
  });

  for (const fetchMethod of [
    'prefetchPlaycountsForRender',
    'fetchAndDisplayPlaycounts',
  ]) {
    it(`cancels the pending initial ${fetchMethod} request without late updates or polling`, async () => {
      const request = deferred();
      const desktopEl = createElement();
      const mobileEl = createElement();
      const querySelector = mock.fn((selector) =>
        selector === '[data-playcount="item-1"]' ? desktopEl : mobileEl
      );
      // Deliberately ignore abort so the response still arrives after cancellation.
      const apiCall = mock.fn(() => request.promise);
      const schedule = mock.fn();
      const sync = createPlaycountSync({
        apiCall,
        formatPlaycount: String,
        doc: { querySelector },
        schedule,
      });

      const pending = sync[fetchMethod]('list-1');
      assert.strictEqual(apiCall.mock.calls.length, 1);
      const { signal } = apiCall.mock.calls[0].arguments[1];
      assert.strictEqual(signal.aborted, false);

      sync.cancelPollingForList('other-list');
      assert.strictEqual(signal.aborted, false);
      sync.cancelPollingForList('list-1');
      assert.strictEqual(signal.aborted, true);

      request.resolve({
        playcounts: { 'item-1': { playcount: 77, status: 'success' } },
        refreshing: 1,
      });
      await pending;

      assert.strictEqual(sync.getPlaycountCacheEntry('item-1'), undefined);
      assert.strictEqual(querySelector.mock.calls.length, 0);
      assert.strictEqual(desktopEl.innerHTML, '');
      assert.strictEqual(mobileEl.innerHTML, '');
      assert.strictEqual(schedule.mock.calls.length, 0);
      assert.strictEqual(apiCall.mock.calls.length, 1);
    });

    it(`clearing cache releases ${fetchMethod} without letting its late finally clear a newer request`, async () => {
      const oldRequest = deferred();
      const newRequest = deferred();
      const apiCall = mock.fn((url) =>
        url.endsWith('/old-list') ? oldRequest.promise : newRequest.promise
      );
      const querySelector = mock.fn(() => null);
      const schedule = mock.fn();
      const sync = createPlaycountSync({
        apiCall,
        formatPlaycount: String,
        doc: { querySelector },
        schedule,
      });
      sync.primePlaycountCache({
        'cached-item': { playcount: 42, status: 'success' },
      });

      const oldPending = sync[fetchMethod]('old-list');
      const oldSignal = apiCall.mock.calls[0].arguments[1].signal;
      sync.clearPlaycountCache();
      assert.strictEqual(oldSignal.aborted, true);
      assert.strictEqual(sync.getPlaycountCacheEntry('cached-item'), undefined);

      const newPending = sync[fetchMethod]('new-list');
      assert.strictEqual(apiCall.mock.calls.length, 2);
      assert.strictEqual(
        apiCall.mock.calls[1].arguments[0],
        '/api/lastfm/list-playcounts/new-list'
      );
      const newSignal = apiCall.mock.calls[1].arguments[1].signal;
      assert.strictEqual(newSignal.aborted, false);

      oldRequest.resolve({
        playcounts: { 'old-item': { playcount: 99, status: 'success' } },
        refreshing: 1,
      });
      await oldPending;
      assert.strictEqual(sync.getPlaycountCacheEntry('old-item'), undefined);
      assert.strictEqual(querySelector.mock.calls.length, 0);
      assert.strictEqual(schedule.mock.calls.length, 0);

      // The newer request must still own the single-fetch guard after old finally.
      const thirdPending = sync[fetchMethod]('third-list');
      assert.strictEqual(apiCall.mock.calls.length, 2);
      assert.strictEqual(newSignal.aborted, false);

      newRequest.resolve({
        playcounts: { 'new-item': { playcount: 123, status: 'success' } },
        refreshing: 1,
      });
      await newPending;
      await thirdPending;
      assert.deepStrictEqual(sync.getPlaycountCacheEntry('new-item'), {
        playcount: 123,
        status: 'success',
      });
      assert.strictEqual(schedule.mock.calls.length, 1);
      sync.clearPlaycountCache();
    });
  }

  for (const cancelMethod of ['cancelPollingForList', 'clearPlaycountCache']) {
    it(`${cancelMethod} ignores an in-flight poll response even when transport ignores abort`, async () => {
      const pollRequest = deferred();
      const desktopEl = createElement();
      const mobileEl = createElement();
      const querySelector = mock.fn((selector) =>
        selector === '[data-playcount="item-1"]' ? desktopEl : mobileEl
      );
      const initialEntry = { playcount: 42, status: 'success' };
      const apiCall = mock.fn(() => {
        if (apiCall.mock.calls.length === 0) {
          return Promise.resolve({
            playcounts: { 'item-1': initialEntry },
            refreshing: 1,
          });
        }
        return pollRequest.promise;
      });
      const scheduled = [];
      const sync = createPlaycountSync({
        apiCall,
        formatPlaycount: String,
        doc: { querySelector },
        schedule: (callback) => {
          scheduled.push(callback);
          return scheduled.length;
        },
      });

      await sync.fetchAndDisplayPlaycounts('list-1');
      assert.strictEqual(scheduled.length, 1);
      const desktopHtml = desktopEl.innerHTML;
      const mobileHtml = mobileEl.innerHTML;
      assert.match(desktopHtml, /42/);
      assert.match(mobileHtml, /42/);
      const domQueries = querySelector.mock.calls.length;
      const pendingPoll = scheduled.shift()();
      assert.strictEqual(apiCall.mock.calls.length, 2);
      const { signal } = apiCall.mock.calls[1].arguments[1];
      assert.strictEqual(signal.aborted, false);

      sync[cancelMethod]('list-1');
      assert.strictEqual(signal.aborted, true);
      pollRequest.resolve({
        playcounts: { 'item-1': { playcount: 999, status: 'success' } },
        refreshing: 1,
      });
      await pendingPoll;

      assert.deepStrictEqual(
        sync.getPlaycountCacheEntry('item-1'),
        cancelMethod === 'clearPlaycountCache' ? undefined : initialEntry
      );
      assert.strictEqual(querySelector.mock.calls.length, domQueries);
      assert.strictEqual(desktopEl.innerHTML, desktopHtml);
      assert.strictEqual(mobileEl.innerHTML, mobileHtml);
      assert.strictEqual(scheduled.length, 0);
      assert.strictEqual(apiCall.mock.calls.length, 2);
    });
  }

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

    assert.strictEqual(controllers.length, 2);
    assert.strictEqual(controllers[0].signal.aborted, false);
    assert.strictEqual(controllers[1].signal.aborted, true);
    assert.strictEqual(scheduled.length, 1);
    await scheduled[0]();
    assert.strictEqual(scheduled.length, 1);
  });
});
