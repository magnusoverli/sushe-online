const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

let createArtistImageLoader;
let qualifiedArtistCandidates;
let firstWorkingArtistImage;
let verifyImageLoads;
before(async () => {
  ({
    createArtistImageLoader,
    qualifiedArtistCandidates,
    firstWorkingArtistImage,
    verifyImageLoads,
  } = await import('../src/js/modules/artist-image-loader.js'));
});

describe('artist image matching and verification', () => {
  it('uses Unicode-safe, nonempty exact keys rather than substrings', () => {
    for (const [name, candidate] of [
      ['Bj\u00f6rk', 'Bjork'],
      ['Earth & Fire', 'Earth and Fire'],
      ['\u6771\u4eac', '\u6771\u4eac'],
    ]) {
      assert.equal(
        qualifiedArtistCandidates(name, [candidate], (a) => a).length,
        1
      );
    }
    for (const [name, candidate] of [
      ['!!!', '???'],
      ['Cher', 'Cherry'],
      ['\u6771\u4eac', '\u5317\u4eac'],
      ['', ''],
    ]) {
      assert.deepEqual(
        qualifiedArtistCandidates(name, [candidate], (a) => a),
        []
      );
    }
  });

  it('bounds alternatives and declines ambiguous homonyms', () => {
    const candidates = Array.from({ length: 8 }, () => ({
      name: 'Artist',
      id: 1,
    }));
    assert.equal(
      qualifiedArtistCandidates(
        'Artist',
        candidates,
        (a) => a.name,
        (a) => a.id
      ).length,
      3
    );
    candidates[7].id = 2;
    assert.deepEqual(
      qualifiedArtistCandidates(
        'Artist',
        candidates,
        (a) => a.name,
        (a) => a.id
      ),
      []
    );
  });

  it('tries smaller sizes and alternative qualified images after broken URLs', async () => {
    const tried = [];
    const result = await firstWorkingArtistImage(
      [null, 'broken', 'broken', 'small'],
      null,
      async (url) => {
        tried.push(url);
        if (url === 'broken') throw new Error('404');
        return url;
      }
    );
    assert.equal(result, 'small');
    assert.deepEqual(tried, ['broken', 'small']);
    await assert.rejects(
      firstWorkingArtistImage(['bad'], null, async () => {
        throw new Error('offline');
      })
    );
  });

  for (const outcome of ['abort', 'timeout', 'error', 'success', 'invalid']) {
    it(`cleans image handlers and cancellation on ${outcome}`, async () => {
      let img;
      class FakeImage {
        constructor() {
          img = this;
          this.naturalWidth = this.naturalHeight = 64;
        }
      }
      const controller = new AbortController();
      const result = verifyImageLoads(
        'image',
        controller.signal,
        10,
        FakeImage
      );
      const checked = outcome === 'success' ? result : assert.rejects(result);
      if (outcome === 'abort') controller.abort();
      else if (outcome === 'error') img.onerror();
      else if (outcome !== 'timeout') {
        if (outcome === 'invalid') img.naturalWidth = 1;
        img.onload();
      }
      await checked;
      assert.equal(img.onload, null);
      assert.equal(img.onerror, null);
      assert.equal(img.src, outcome === 'success' ? 'image' : '');
      controller.abort();
      assert.equal(img.src, outcome === 'success' ? 'image' : '');
    });
  }

  it('does not start a pre-aborted image', async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      verifyImageLoads(
        'image',
        controller.signal,
        10,
        class {
          constructor() {
            assert.fail('must not construct');
          }
        }
      ),
      { name: 'AbortError' }
    );
  });
});

describe('artist image scheduling and cache', () => {
  it('allows an ID-only fallback for punctuation-only names without empty name matches', async () => {
    const id = '0d1ee40c-8975-4c4a-8e83-6e2983e2fe73';
    const calls = [];
    const loader = createArtistImageLoader([
      {
        search: async (name) => {
          assert.deepEqual(
            qualifiedArtistCandidates(name, ['!!!', '???'], (a) => a),
            []
          );
          return null;
        },
      },
      {
        lastResort: true,
        search: async (name, artistId) => {
          calls.push({ name, id: artistId });
          return 'wikidata-image';
        },
      },
    ]);
    assert.equal(await loader.search('!!!'), null);
    assert.deepEqual(calls, []);
    assert.equal(await loader.search('!!!', id), 'wikidata-image');
    assert.deepEqual(calls, [{ name: '!!!', id }]);
  });

  for (const outcome of ['image', null]) {
    it(`serves warm ${outcome} cache hits while all three slots are busy`, async () => {
      let now = 0;
      const calls = [];
      const controller = new AbortController();
      const loader = createArtistImageLoader(
        [
          {
            search: (name) => {
              calls.push(name);
              return name === 'Warm'
                ? Promise.resolve(outcome)
                : new Promise(() => {});
            },
          },
        ],
        { now: () => now, positiveTtl: 10, negativeTtl: 10 }
      );
      await loader.search('Warm');
      await new Promise((resolve) => setImmediate(resolve));
      const busy = ['A', 'B', 'C'].map((name) =>
        loader.search(name, null, controller.signal)
      );
      try {
        assert.deepEqual(calls, ['Warm', 'A', 'B', 'C']);
        let resolved = false;
        const hit = loader
          .search('Warm', null, controller.signal)
          .then((url) => {
            resolved = true;
            assert.equal(url, outcome);
          });
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(resolved, true, 'cache hits must bypass saturated slots');
        await hit;
        now = 10;
        let expiredResolved = false;
        const expired = loader
          .search('Warm', null, controller.signal)
          .then(() => {
            expiredResolved = true;
          });
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(
          expiredResolved,
          false,
          'expired entries must not bypass the queue'
        );
        controller.abort();
        await expired;
      } finally {
        controller.abort();
        await Promise.all(busy);
      }
    });
  }

  it('does not use excluded cached URLs in either the fast or queued path', async () => {
    const calls = [];
    let release;
    const loader = createArtistImageLoader(
      [
        {
          search: async (name, _id, _signal, excluded) => {
            calls.push(name);
            if (name === 'Busy')
              return new Promise((resolve) => {
                release = resolve;
              });
            return excluded.has('image') ? 'alternative' : 'image';
          },
        },
      ],
      { concurrency: 1 }
    );
    await loader.search('Warm');
    await new Promise((resolve) => setImmediate(resolve));
    const busy = loader.search('Busy');
    let resolved = false;
    const retry = loader
      .search('Warm', null, null, new Set(['image']))
      .then((url) => {
        resolved = true;
        return url;
      });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(resolved, false);
    release(null);
    await busy;
    assert.equal(await retry, 'alternative');
    assert.deepEqual(calls, ['Warm', 'Busy', 'Warm']);
    assert.equal(await loader.search('Warm'), 'alternative');
  });

  for (const fallbackUrl of ['fallback-image', null]) {
    it(`reserves fallback time after a hanging fast provider (${fallbackUrl})`, async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      let hungSignal;
      let fallbackCalls = 0;
      const loader = createArtistImageLoader(
        [
          {
            search: (_name, _id, signal) => {
              hungSignal = signal;
              return new Promise(() => {});
            },
          },
          { search: async () => null },
          {
            lastResort: true,
            search: async (_name, _id, signal) => {
              assert.equal(hungSignal.aborted, true);
              assert.equal(signal.aborted, false);
              fallbackCalls++;
              return fallbackUrl;
            },
          },
        ],
        { timeoutMs: 100, fastProviderTimeoutMs: 40 }
      );
      const pending = loader.search('Artist');
      t.mock.timers.tick(39);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(fallbackCalls, 0);
      assert.equal(hungSignal.aborted, false);
      t.mock.timers.tick(1);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(fallbackCalls, 1);
      assert.equal(await pending, fallbackUrl);
      if (!fallbackUrl) {
        const retry = loader.search('Artist');
        t.mock.timers.tick(40);
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(await retry, null);
        assert.equal(
          fallbackCalls,
          2,
          'timeouts must not become negative cache entries'
        );
      }
    });
  }

  it('expires positive and genuine negative results, but retries temporary failures', async () => {
    let now = 0;
    let calls = 0;
    let outcome = 'url';
    const loader = createArtistImageLoader(
      [
        {
          search: async () => {
            calls++;
            if (outcome === 'error') throw new Error('503');
            return outcome;
          },
        },
      ],
      { now: () => now, positiveTtl: 20, negativeTtl: 5 }
    );
    assert.equal(await loader.search('Artist'), 'url');
    await loader.search('Artist');
    assert.equal(calls, 1);
    now = 21;
    outcome = null;
    await loader.search('Artist');
    await loader.search('Artist');
    assert.equal(calls, 2);
    now = 27;
    outcome = 'error';
    await loader.search('Artist');
    await loader.search('Artist');
    assert.equal(calls, 4);
  });

  it('bounds cache entries and evicts failed render URLs for excluded retry', async () => {
    let calls = 0;
    const loader = createArtistImageLoader(
      [
        {
          search: async (_name, _id, _signal, excluded) => {
            calls++;
            return excluded.has('url') ? 'small' : 'url';
          },
        },
      ],
      { maxEntries: 1 }
    );
    await loader.search('A');
    await loader.search('B');
    await loader.search('A');
    assert.equal(calls, 3);
    loader.evict('A');
    assert.equal(
      await loader.search('A', null, null, new Set(['url'])),
      'small'
    );
  });

  it('aborts losing providers and avoids the MusicBrainz fallback after success', async () => {
    let loser;
    const loader = createArtistImageLoader([
      { search: async () => 'url' },
      {
        search: (_name, _id, signal) => {
          loser = signal;
          return new Promise(() => {});
        },
      },
      { lastResort: true, search: () => assert.fail('unneeded fallback') },
    ]);
    assert.equal(await loader.search('Artist'), 'url');
    assert.equal(loser.aborted, true);
  });

  it('uses fallback only after fast misses', async () => {
    const calls = [];
    const loader = createArtistImageLoader([
      {
        search: async () => {
          calls.push('fast');
          return null;
        },
      },
      {
        lastResort: true,
        search: async () => {
          calls.push('fallback');
          return 'url';
        },
      },
    ]);
    assert.equal(await loader.search('Artist'), 'url');
    assert.deepEqual(calls, ['fast', 'fallback']);
  });

  it('caps work, removes aborted queued work, bounds hung metadata and retries it', async () => {
    const signals = [];
    const loader = createArtistImageLoader(
      [
        {
          search: (_name, _id, signal) => {
            signals.push(signal);
            return new Promise(() => {});
          },
        },
      ],
      { concurrency: 1, timeoutMs: 10 }
    );
    const first = loader.search('A');
    const controller = new AbortController();
    const queued = loader.search('B', null, controller.signal);
    assert.equal(signals.length, 1);
    controller.abort();
    assert.equal(await queued, null);
    assert.equal(await first, null);
    assert.equal(signals[0].aborted, true);
    await loader.search('A');
    assert.equal(signals.length, 2);
    assert.equal(signals[1].aborted, true);
  });

  it('does not cache results arriving after parent cancellation', async () => {
    let resolve;
    let calls = 0;
    const loader = createArtistImageLoader([
      {
        search: () => {
          calls++;
          return new Promise((r) => {
            resolve = r;
          });
        },
      },
    ]);
    const controller = new AbortController();
    const pending = loader.search('A', null, controller.signal);
    controller.abort();
    assert.equal(await pending, null);
    resolve('stale');
    await new Promise((r) => setImmediate(r));
    const fresh = loader.search('A');
    resolve('fresh');
    assert.equal(await fresh, 'fresh');
    assert.equal(calls, 2);
  });
});
