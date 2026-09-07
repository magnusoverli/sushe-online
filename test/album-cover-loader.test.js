const { before, it } = require('node:test');
const assert = require('node:assert/strict');
let createAlbumCoverLoader,
  createAlbumCoverObserver,
  qualifiedAlbumCandidates,
  createCoverProviders;
before(async () => {
  ({
    createAlbumCoverLoader,
    createAlbumCoverObserver,
    qualifiedAlbumCandidates,
    createCoverProviders,
  } = await import('../src/js/modules/album-cover-loader.js'));
});
const album = { artist: 'Bjork', title: 'Debut', id: 'one' };
const flush = () => new Promise(setImmediate);

it('coalesces same-signal active and queued album searches, including rebuilt rows', async () => {
  const request = new AbortController();
  const started = [],
    finishes = new Map();
  const loader = createAlbumCoverLoader({
    concurrency: 1,
    providers: [
      ({ id }) =>
        new Promise((resolve) => {
          started.push(id);
          finishes.set(id, resolve);
        }),
      async () => null,
    ],
  });
  const active = loader.search(album, request.signal);
  const activeCopy = loader.search({ ...album }, request.signal);
  const second = { ...album, id: 'second' };
  const queued = loader.search(second, request.signal);
  const queuedCopy = loader.search({ ...second }, request.signal);
  assert.equal(active, activeCopy);
  assert.equal(queued, queuedCopy);
  await flush();
  assert.deepEqual(started, ['one']);
  finishes.get('one')('first-cover');
  assert.equal(await active, 'first-cover');
  await flush();
  assert.deepEqual(started, ['one', 'second']);
  finishes.get('second')('second-cover');
  assert.equal(await queued, 'second-cover');
  assert.equal(await queuedCopy, 'second-cover');
});

it('keeps different exclusions independent but coalesces equivalent exclusion sets', async () => {
  const request = new AbortController();
  const seen = [];
  const loader = createAlbumCoverLoader({
    providers: [
      (_album, _signal, excluded) => {
        seen.push([...excluded]);
        return new Promise(() => {});
      },
      async () => null,
    ],
  });
  const original = loader.search(album, request.signal);
  const retry = loader.search(album, request.signal, new Set(['bad', 'other']));
  const sameRetry = loader.search(
    album,
    request.signal,
    new Set(['other', 'bad'])
  );
  assert.notEqual(original, retry);
  assert.equal(retry, sameRetry);
  await flush();
  assert.equal(seen.length, 2);
  request.abort();
  assert.deepEqual(await Promise.all([original, retry, sameRetry]), [
    null,
    null,
    null,
  ]);
});

it('never reuses cancelled active or queued promises for a new view', async () => {
  const oldView = new AbortController(),
    newView = new AbortController();
  const starts = [];
  const loader = createAlbumCoverLoader({
    concurrency: 1,
    providers: [
      ({ id }, signal) => {
        starts.push({ id, signal });
        return starts.length === 1
          ? new Promise(() => {})
          : Promise.resolve(`${id}-new`);
      },
      async () => null,
    ],
  });
  const oldActive = loader.search(album, oldView.signal);
  const second = { ...album, id: 'second' };
  const oldQueued = loader.search(second, oldView.signal);
  await flush();
  oldView.abort();
  const fresh = loader.search(album, newView.signal);
  const freshQueued = loader.search(second, newView.signal);
  assert.notEqual(fresh, oldActive);
  assert.notEqual(freshQueued, oldQueued);
  assert.deepEqual(
    await Promise.all([oldActive, oldQueued, fresh, freshQueued]),
    [null, null, 'one-new', 'second-new']
  );
  assert.equal(starts[0].signal.aborted, true);
  assert.deepEqual(
    starts.map((s) => s.id),
    ['one', 'one', 'second']
  );
});

for (const warmed of ['seeded-cover', null]) {
  it(`rechecks a queued album's ${warmed ? 'positive' : 'negative'} cache before taking a slot`, async () => {
    const request = new AbortController();
    let finish,
      starts = 0;
    const loader = createAlbumCoverLoader({
      concurrency: 1,
      providers: [
        () => {
          starts++;
          return new Promise((resolve) => {
            finish = resolve;
          });
        },
        async () => null,
      ],
    });
    const active = loader.search({ id: 'blocker' }, request.signal);
    const queued = loader.search(album, request.signal);
    const duplicate = loader.search(album, request.signal);
    await flush();
    loader.seed(album, warmed);
    finish('blocker-cover');
    await active;
    assert.deepEqual(await Promise.all([queued, duplicate]), [warmed, warmed]);
    assert.equal(starts, 1);
  });
}

it('does not accept an excluded URL filled into cache while its retry is queued', async () => {
  const request = new AbortController();
  let release;
  const starts = [];
  const loader = createAlbumCoverLoader({
    concurrency: 1,
    providers: [
      ({ id }) => {
        starts.push(id);
        return id === 'blocker'
          ? new Promise((resolve) => {
              release = resolve;
            })
          : Promise.resolve('alternative');
      },
      async () => null,
    ],
  });
  const active = loader.search({ id: 'blocker' }, request.signal);
  const retry = loader.search(album, request.signal, new Set(['broken']));
  await flush();
  loader.seed(album, 'broken');
  release('done');
  await active;
  assert.equal(await retry, 'alternative');
  assert.deepEqual(starts, ['blocker', 'one']);
});

it('hedges a stalled CAA and aborts the loser when verified fallback wins', async () => {
  let caaSignal;
  const loader = createAlbumCoverLoader({
    hedgeMs: 10,
    providers: [
      (_album, signal) => {
        caaSignal = signal;
        return new Promise(() => {});
      },
      async () => 'verified',
    ],
  });
  assert.equal(await loader.search(album), 'verified');
  assert.equal(caaSignal.aborted, true);
  assert.equal(loader.peek(album), 'verified');
});

it('starts fallback immediately on a CAA miss, not after the hedge', async () => {
  const loader = createAlbumCoverLoader({
    hedgeMs: 60000,
    providers: [async () => null, async () => 'cover'],
  });
  assert.equal(await loader.search(album), 'cover');
});

it('aborts active and queued searches and releases concurrency slots', async () => {
  const signals = [];
  const controller = new AbortController();
  const loader = createAlbumCoverLoader({
    concurrency: 1,
    providers: [
      (_album, signal) => {
        signals.push(signal);
        return new Promise(() => {});
      },
      async () => 'fallback',
    ],
  });
  const active = loader.search(album, controller.signal);
  const queued = loader.search({ ...album, id: 'two' }, controller.signal);
  await flush();
  controller.abort();
  assert.deepEqual(await Promise.all([active, queued]), [null, null]);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].aborted, true);
  assert.equal(loader.peek(album), null);
});

it('bounds cache entries and applies positive and genuine-negative TTLs', async () => {
  let now = 0,
    calls = 0;
  const loader = createAlbumCoverLoader({
    now: () => now,
    maxEntries: 2,
    providers: [
      async () => {
        calls++;
        return null;
      },
      async () => null,
    ],
  });
  await loader.search(album);
  await loader.search(album);
  assert.equal(calls, 1);
  now = 60001;
  await loader.search(album);
  assert.equal(calls, 2);
  loader.seed(album, 'warm');
  now += 1800001;
  assert.equal(loader.peek(album), null);
  loader.seed(album, 'warm');
  loader.seed({ id: 'two' }, 'two');
  loader.seed({ id: 'three' }, 'three');
  assert.equal(loader.peek(album), null);
});

it('does not cache temporary failures, timeouts, or excluded broken URLs', async () => {
  let calls = 0;
  const loader = createAlbumCoverLoader({
    providerTimeoutMs: 10,
    providers: [
      async () => {
        calls++;
        throw new Error('offline');
      },
      async () => null,
    ],
  });
  await loader.search(album);
  await loader.search(album);
  assert.equal(calls, 2);
  loader.seed(album, 'broken');
  assert.equal(await loader.search(album, null, new Set(['broken'])), null);
  const timeout = createAlbumCoverLoader({
    timeoutMs: 10,
    providers: [() => new Promise(() => {}), () => new Promise(() => {})],
  });
  assert.equal(await timeout.search(album), null);
});

it('requires independently matching artists and edition-equivalent album keys', () => {
  const candidate = {
    artistName: 'Bj\u00f6rk',
    collectionName: 'Debut (Deluxe Edition)',
    artistId: 1,
  };
  assert.equal(
    qualifiedAlbumCandidates('Bjork', 'Debut', [candidate]).length,
    1
  );
  assert.equal(
    qualifiedAlbumCandidates('Other', 'Debut', [candidate]).length,
    0
  );
  assert.equal(
    qualifiedAlbumCandidates('Bjork', 'Other', [candidate]).length,
    0
  );
  assert.equal(
    qualifiedAlbumCandidates('!!!', '???', [
      { artistName: '???', collectionName: '!!!' },
    ]).length,
    0
  );
});

it('verifies bounded thumbnail alternatives instead of returning an unverified URL', async () => {
  const tried = [];
  const providers = createCoverProviders({
    fetcher: async () => ({
      ok: true,
      json: async () => ({
        results: [
          {
            artistName: 'Bjork',
            collectionName: 'Debut',
            artworkUrl100: 'https://image/100x100bb.jpg',
          },
        ],
      }),
    }),
    verify: async (url) => {
      tried.push(url);
      if (url.includes('200x200')) throw new Error('broken');
      return url;
    },
  });
  assert.equal(
    await providers[1](album, null, new Set()),
    'https://image/100x100bb.jpg'
  );
  assert.equal(tried.length, 2);
});

it('renders warm covers immediately, gates cold rows, and ignores callbacks after disconnect', () => {
  let callback,
    observations = 0;
  class Observer {
    constructor(fn) {
      callback = fn;
    }
    observe() {
      observations++;
    }
    unobserve() {}
    disconnect() {}
  }
  const loaded = [];
  const observer = createAlbumCoverObserver(
    (ctx) => loaded.push(ctx),
    (ctx) => ctx.warm,
    null,
    Observer
  );
  const warm = { warm: true },
    cold = {},
    el = {};
  observer.observe({}, warm);
  observer.observe(el, cold);
  assert.deepEqual(loaded, [warm]);
  assert.equal(observations, 1);
  callback([{ target: el, isIntersecting: false }]);
  assert.equal(loaded.length, 1);
  callback([{ target: el, isIntersecting: true }]);
  callback([{ target: el, isIntersecting: true }]);
  assert.deepEqual(loaded, [warm, cold]);
  const stale = {};
  observer.observe(stale, {});
  observer.disconnect();
  callback([{ target: stale, isIntersecting: true }]);
  observer.observe({}, warm);
  assert.equal(loaded.length, 2);
});

it('does not start observer jobs belonging to an aborted search', () => {
  let callback;
  class Observer {
    constructor(fn) {
      callback = fn;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const request = new AbortController();
  let loads = 0;
  const observer = createAlbumCoverObserver(
    () => loads++,
    () => false,
    null,
    Observer
  );
  const el = {};
  observer.observe(el, { request });
  request.abort();
  callback([{ target: el, isIntersecting: true }]);
  assert.equal(loads, 0);
});

it('caps active work at eight while warm hits bypass a saturated queue', async () => {
  let starts = 0;
  const request = new AbortController();
  const loader = createAlbumCoverLoader({
    providers: [
      () => {
        starts++;
        return new Promise(() => {});
      },
      async () => null,
    ],
  });
  const pending = Array.from({ length: 20 }, (_, i) =>
    loader.search({ ...album, id: String(i) }, request.signal)
  );
  await flush();
  assert.equal(starts, 8);
  loader.seed(album, 'warm');
  assert.equal(await loader.search(album), 'warm');
  request.abort();
  await Promise.all(pending);
  assert.equal(starts, 8);
});
