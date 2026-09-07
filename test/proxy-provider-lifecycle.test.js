const { it } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const register = require('../routes/api/proxies');
const { createMockLogger } = require('./helpers');

function appFor(fetch, options = {}) {
  const app = express();
  const pass = (_req, _res, next) => next();
  register(app, {
    ensureAuthAPI: (req, res, next) =>
      req.headers.authorization ? next() : res.sendStatus(401),
    logger: createMockLogger(),
    fetch,
    mbFetch: fetch,
    itunesProxyQueue: { add: (fn) => fn() },
    cacheConfigs: {
      public: () => {
        throw new Error('Generic cache must not run');
      },
      images: pass,
      static: pass,
    },
    ...options,
  });
  return app;
}
const get = (app, path) => request(app).get(path).set('Authorization', 'test');
const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => body,
});

it('only stable artist-bound discography endpoints serve stale and refresh at low priority', async () => {
  const id = '12345678-1234-1234-1234-123456789abc';
  const query = `arid:${id} AND (primarytype:album OR primarytype:ep)`;
  for (const [endpoint, qualified] of [
    [
      `release-group?query=${encodeURIComponent(query)}&fmt=json&limit=100&offset=0`,
      true,
    ],
    [
      `release-group?artist=${id}&type=album|ep&inc=artist-credits&fmt=json`,
      true,
    ],
    ['artist?query=Bjork&fmt=json', false],
    ['release-group?query=artist:Bjork&fmt=json', false],
    [
      `release-group?query=${encodeURIComponent(query + ' OR artist:Other')}&fmt=json`,
      false,
    ],
    [`release-group?artist=${id}&artist=other&fmt=json`, false],
    [`release-group?artist=${id}&fmt=json&unknown=1`, false],
    [`release?artist=${id}&fmt=json`, false],
  ]) {
    let now = 0;
    let calls = 0;
    let release;
    const priorities = [];
    const app = appFor(
      async (_url, _options, priority) => {
        priorities.push(priority);
        calls++;
        if (qualified && calls === 2)
          await new Promise((resolve) => {
            release = resolve;
          });
        return json({ 'release-groups': [{ id }], call: calls });
      },
      { providerRequestOptions: { now: () => now } }
    );
    const send = () =>
      get(app, '/api/proxy/musicbrainz').query({ endpoint, priority: 'high' });
    assert.equal((await send()).headers['x-provider-cache'], 'MISS');
    assert.equal((await send()).headers['x-provider-cache'], 'HIT');
    now = 10 * 60 * 1000;
    const result = await send();
    assert.equal(
      result.headers['x-provider-cache'],
      qualified ? 'STALE' : 'MISS'
    );
    if (qualified) {
      assert.equal(result.body.call, 1);
      assert.equal(result.body['release-groups'][0].id, id);
      assert.equal((await send()).headers['x-provider-cache'], 'STALE');
      assert.equal(calls, 2);
      release();
    }
    assert.deepEqual(priorities, ['high', qualified ? 'low' : 'high']);
  }
});

it('invalid discography responses never cache or replace stale success, including at hard expiry', async () => {
  const id = '12345678-1234-1234-1234-123456789abc';
  const query = `arid:${id} AND (primarytype:album OR primarytype:ep)`;
  const freshTtl = 10 * 60 * 1000;
  const hardExpiry = freshTtl + 24 * 60 * 60 * 1000;
  for (const endpoint of [
    `release-group?query=${encodeURIComponent(query)}&fmt=json&limit=100&offset=0`,
    `release-group?artist=${id}&fmt=json`,
  ]) {
    for (const invalid of [
      {},
      null,
      'invalid',
      { 'release-groups': null },
      { 'release-groups': {} },
      { 'release-groups': [], error: 'unavailable' },
      { 'release-groups': [], errors: [] },
      { 'release-groups': [], errorMessage: 'unavailable' },
    ]) {
      let now = 0;
      let calls = 0;
      let body = invalid;
      const app = appFor(
        async () => {
          calls++;
          return json(body);
        },
        { providerRequestOptions: { now: () => now } }
      );
      const send = () => get(app, '/api/proxy/musicbrainz').query({ endpoint });
      for (let attempt = 0; attempt < 2; attempt++) {
        const cold = await send();
        assert.equal(cold.status, 502);
        assert.equal(cold.headers['x-provider-cache'], 'MISS');
      }
      assert.equal(calls, 2);
      const valid = { 'release-groups': [{ id }] };
      body = valid;
      assert.deepEqual((await send()).body, valid);
      body = invalid;
      for (now of [freshTtl, hardExpiry - 1]) {
        const stale = await send();
        assert.equal(stale.status, 200);
        assert.equal(stale.headers['x-provider-cache'], 'STALE');
        assert.deepEqual(stale.body, valid);
        await new Promise((resolve) => setImmediate(resolve));
      }
      assert.equal(calls, 5);
      now = hardExpiry;
      const expired = await send();
      assert.equal(expired.status, 502);
      assert.equal(expired.headers['x-provider-cache'], 'MISS');
      body = { 'release-groups': [] };
      assert.deepEqual((await send()).body, body);
      assert.equal((await send()).headers['x-provider-cache'], 'HIT');
      assert.equal(calls, 7);
    }
  }
});

it('MusicBrainz shares semantic URLs across scheduling priorities, with authentication before cache', async () => {
  let calls = 0;
  let release;
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const app = appFor(async (_url, options, priority) => {
    calls++;
    assert.ok(options.signal instanceof globalThis.AbortSignal);
    assert.equal(priority, 'low');
    started();
    await new Promise((resolve) => {
      release = resolve;
    });
    return json({ artists: [] });
  });
  const a = get(app, '/api/proxy/musicbrainz')
    .query({ endpoint: 'artist?query=A%26B&fmt=json', priority: 'low' })
    .then((res) => res);
  await ready;
  const b = get(app, '/api/proxy/musicbrainz')
    .query({ priority: 'high', endpoint: 'artist?fmt=json&query=A%26B' })
    .then((res) => res);
  await new Promise((resolve) => setTimeout(resolve, 30));
  release();
  assert.equal((await a).status, 200);
  assert.equal((await b).status, 200);
  assert.equal(calls, 1);
  assert.equal(
    (
      await request(app)
        .get('/api/proxy/musicbrainz')
        .query({ endpoint: 'artist?fmt=json&query=A%26B' })
    ).status,
    401
  );
});

it('metadata providers cache positives but not logical errors or non-2xx responses', async () => {
  for (const path of [
    '/api/proxy/deezer/artist?q=Bjork',
    '/api/proxy/wikidata?entity=Q42&property=P18',
    '/api/proxy/itunes?term=Bjork',
  ]) {
    let calls = 0;
    const app = appFor(async () => {
      calls++;
      if (calls === 1) return json({}, 503);
      if (calls === 2) return json({ error: 'bad' });
      return json({ results: [] });
    });
    assert.ok((await get(app, path)).status >= 500);
    await get(app, path);
    await get(app, path);
    await get(app, path);
    assert.equal(calls, 3);
  }
});

it('direct fetch deadlines include body consumption', async () => {
  for (const stage of ['headers', 'body']) {
    let signal;
    const app = appFor(
      async (_url, options) => {
        signal = options.signal;
        if (stage === 'headers') return new Promise(() => {});
        return { ...json({}), json: () => new Promise(() => {}) };
      },
      { providerRequestOptions: { timeoutMs: 20 } }
    );
    assert.equal((await get(app, '/api/proxy/itunes?term=test')).status, 504);
    assert.equal(signal.aborted, true);
  }
});

it('canceled iTunes queue work checks the signal before outbound fetch', async () => {
  let queued;
  let queueSignal;
  let calls = 0;
  const app = appFor(
    async () => {
      calls++;
      return json({});
    },
    {
      providerRequestOptions: { timeoutMs: 10 },
      itunesProxyQueue: {
        add: (fn, options) => {
          queued = fn;
          queueSignal = options.signal;
          return new Promise(() => {});
        },
      },
    }
  );
  assert.equal((await get(app, '/api/proxy/itunes?term=test')).status, 504);
  assert.equal(queueSignal.aborted, true);
  await assert.rejects(queued(), { name: 'AbortError' });
  assert.equal(calls, 0);
});

it('malformed JSON is retried rather than cached and unsafe query shapes never fetch', async () => {
  let calls = 0;
  const app = appFor(async () => {
    calls++;
    return {
      ...json({}),
      json: async () => {
        throw new SyntaxError('Invalid JSON');
      },
      text: async () => 'invalid',
    };
  });
  for (let i = 0; i < 2; i++) {
    assert.equal(
      (await get(app, '/api/proxy/musicbrainz?endpoint=artist')).status,
      500
    );
  }
  assert.equal(calls, 2);
  for (const path of [
    '/api/proxy/musicbrainz?endpoint=../test',
    '/api/proxy/musicbrainz?endpoint=.%0A./.%09./oauth2/token',
    '/api/proxy/musicbrainz?endpoint=artist%00',
    '/api/proxy/musicbrainz?endpoint=artist/../../oauth2/token',
    '/api/proxy/musicbrainz?endpoint=artist&endpoint=release',
    '/api/proxy/deezer/artist?q=a&q=b',
    '/api/proxy/wikidata?entity=Q42&property=P18%26other=value',
    '/api/proxy/itunes?term=a&limit=10%26other=value',
  ]) {
    assert.equal((await get(app, path)).status, 400);
  }
  assert.equal(calls, 2);
});
