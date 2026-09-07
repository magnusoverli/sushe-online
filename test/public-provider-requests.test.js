const { it } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  createPublicProviderRequests,
  providerKey,
} = require('../services/public-provider-requests');

const url = 'https://musicbrainz.org/ws/2/artist?query=Bj%C3%B6rk&fmt=json';
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function client(service, load, key = url, policy) {
  const req = new EventEmitter();
  const res = new EventEmitter();
  res.headers = {};
  res.setHeader = (name, value) => {
    res.headers[name] = value;
  };
  const promise = service.get(req, res, key, load, policy);
  return { req, res, promise };
}
function clean(c) {
  assert.equal(c.req.listenerCount('aborted'), 0);
  assert.equal(c.res.listenerCount('close'), 0);
}

it('canonicalizes parameter order/encoding without changing case, syntax, or duplicate value order', () => {
  assert.equal(
    providerKey(url),
    providerKey('https://musicbrainz.org/ws/2/artist?fmt=json&query=Bj%C3%B6rk')
  );
  assert.equal(
    providerKey('https://x.test/?q=a%20b'),
    providerKey('https://x.test/?q=a+b')
  );
  for (const other of ['?Q=a+b', '?q=A+b', '?q=a%2Bb', '?q=a%26b']) {
    assert.notEqual(
      providerKey('https://x.test/?q=a+b'),
      providerKey(`https://x.test/${other}`)
    );
  }
  assert.notEqual(
    providerKey('https://x.test/?q=a&q=b'),
    providerKey('https://x.test/?q=b&q=a')
  );
});

it('coalesces, ignores normal incoming close, and survives one consumer disconnect', async () => {
  const service = createPublicProviderRequests();
  const work = deferred();
  let calls = 0;
  let signal;
  const load = (s) => {
    calls++;
    signal = s;
    return work.promise;
  };
  const a = client(service, load);
  const b = client(service, load);
  await tick();
  a.req.emit('close');
  assert.equal(signal.aborted, false);
  const rejected = assert.rejects(a.promise, { name: 'AbortError' });
  a.res.emit('close');
  await rejected;
  assert.equal(signal.aborted, false);
  work.resolve({ artists: [] });
  assert.deepEqual(await b.promise, { artists: [] });
  assert.deepEqual(await client(service, load).promise, { artists: [] });
  assert.equal(calls, 1);
  clean(a);
  clean(b);
});

it('aborts when all consumers leave and never caches a late canceled result', async () => {
  const service = createPublicProviderRequests();
  const work = deferred();
  let signal;
  const load = (s) => {
    signal = s;
    return work.promise;
  };
  const a = client(service, load);
  const b = client(service, load);
  await tick();
  const errors = Promise.all([
    assert.rejects(a.promise),
    assert.rejects(b.promise),
  ]);
  a.req.emit('aborted');
  b.res.emit('close');
  await errors;
  assert.equal(signal.aborted, true);
  work.resolve({ stale: true });
  await tick();
  assert.deepEqual(
    await client(service, async () => ({ fresh: true })).promise,
    { fresh: true }
  );
  clean(a);
  clean(b);
});

it('expires positive entries and bounds cache size with LRU eviction', async () => {
  let now = 0;
  let calls = 0;
  const service = createPublicProviderRequests({
    now: () => now,
    ttlMs: 10,
    maxEntries: 1,
  });
  const load = async () => ({ call: ++calls });
  await client(service, load).promise;
  now = 9;
  assert.equal((await client(service, load).promise).call, 1);
  now = 10;
  assert.equal((await client(service, load).promise).call, 2);
  await client(service, load, 'https://x.test/').promise;
  assert.equal((await client(service, load).promise).call, 4);
});

it('does not retain logical errors, failed parsing, or failed requests', async () => {
  const service = createPublicProviderRequests();
  for (const data of [{ error: {} }, { errors: [] }, { errorMessage: 'bad' }]) {
    let calls = 0;
    const load = async () => {
      calls++;
      return data;
    };
    await client(service, load).promise;
    await client(service, load).promise;
    assert.equal(calls, 2);
  }
  for (const error of [
    new SyntaxError('JSON'),
    Object.assign(new Error('upstream'), { status: 503 }),
  ]) {
    await assert.rejects(
      client(service, async () => {
        throw error;
      }).promise
    );
  }
  assert.deepEqual(await client(service, async () => ({ ok: true })).promise, {
    ok: true,
  });
});

it('each consumer has its own timeout; the later consumer can still complete', async () => {
  const service = createPublicProviderRequests({ timeoutMs: 100 });
  const work = deferred();
  let signal;
  const load = (s) => {
    signal = s;
    return work.promise;
  };
  const a = client(service, load);
  const rejected = assert.rejects(a.promise, {
    name: 'TimeoutError',
    status: 504,
  });
  await new Promise((resolve) => setTimeout(resolve, 60));
  const b = client(service, load);
  await rejected;
  assert.equal(signal.aborted, false);
  work.resolve({ ok: true });
  await b.promise;
  clean(a);
  clean(b);
});

it('operation deadline bounds both stalled headers and stalled body, even if upstream ignores abort', async () => {
  for (const stage of ['headers', 'body']) {
    const service = createPublicProviderRequests({
      timeoutMs: 1000,
      operationTimeoutMs: 10,
    });
    let signal;
    const c = client(service, async (s) => {
      signal = s;
      if (stage === 'body') await Promise.resolve({ ok: true });
      return new Promise(() => {});
    });
    await assert.rejects(c.promise, { status: 504 });
    assert.equal(signal.aborted, true);
    clean(c);
    assert.deepEqual(
      await client(service, async () => ({ retry: true })).promise,
      { retry: true }
    );
  }
});

it('bounds retained bytes and in-flight admission without interrupting admitted consumers', async () => {
  const service = createPublicProviderRequests({ maxBytes: 5, maxInFlight: 1 });
  let calls = 0;
  const load = async () => {
    calls++;
    return { large: 'payload' };
  };
  await client(service, load).promise;
  await client(service, load).promise;
  assert.equal(calls, 2);
  const work = deferred();
  const a = client(service, () => work.promise);
  const b = client(service, load);
  await assert.rejects(client(service, load, 'https://x.test/other').promise, {
    status: 503,
  });
  work.resolve({ ok: true });
  assert.deepEqual(await a.promise, { ok: true });
  assert.deepEqual(await b.promise, { ok: true });
  clean(a);
  clean(b);
});

it('opt-in stale reads return immediately and own exactly one refresh independent of clients', async () => {
  let now = 0;
  const service = createPublicProviderRequests({ now: () => now });
  const policy = { ttlMs: 10, staleTtlMs: 100 };
  const original = { groups: [{ id: 'canonical' }] };
  const a = client(service, async () => original, url, policy);
  const b = client(service, async () => assert.fail('duplicate'), url, policy);
  (await a.promise).groups[0].id = 'mutated';
  assert.equal((await b.promise).groups[0].id, 'canonical');
  assert.equal(b.res.headers['X-Provider-Cache'], 'COALESCED');
  original.groups.length = 0;
  const hit = client(
    service,
    async () => assert.fail('fresh load'),
    url,
    policy
  );
  assert.equal((await hit.promise).groups[0].id, 'canonical');
  assert.equal(hit.res.headers['X-Provider-Cache'], 'HIT');
  now = 10;
  const work = deferred();
  let calls = 0;
  let signal;
  const load = (s, context) => {
    calls++;
    signal = s;
    assert.equal(context.background, true);
    return work.promise;
  };
  const stale = client(service, load, url, policy);
  assert.equal((await stale.promise).groups[0].id, 'canonical');
  stale.res.emit('close');
  stale.req.emit('aborted');
  await client(service, load, url, policy).promise;
  assert.equal(calls, 1);
  assert.equal(signal.aborted, false);
  assert.equal(stale.res.headers['X-Provider-Cache'], 'STALE');
  clean(stale);
  work.resolve({ groups: [{ id: 'refreshed' }] });
  await tick();
  assert.equal(
    (await client(service, load, url, policy).promise).groups[0].id,
    'refreshed'
  );
});

it('failed and logical-error refreshes preserve the old success only until hard expiry', async () => {
  for (const logical of [false, true]) {
    let now = 0;
    const service = createPublicProviderRequests({ now: () => now });
    const policy = { ttlMs: 10, staleTtlMs: 100 };
    await client(service, async () => ({ old: true }), url, policy).promise;
    const fail = async () => {
      if (logical) return { error: 'unavailable' };
      throw new Error('unavailable');
    };
    for (now of [10, 109]) {
      assert.deepEqual(await client(service, fail, url, policy).promise, {
        old: true,
      });
      await tick();
    }
    now = 110;
    const expired = client(service, fail, url, policy);
    if (logical)
      assert.deepEqual(await expired.promise, { error: 'unavailable' });
    else await assert.rejects(expired.promise);
    assert.equal(expired.res.headers['X-Provider-Cache'], 'MISS');
    assert.deepEqual(
      await client(service, async () => ({ new: true }), url, policy).promise,
      { new: true }
    );
  }
});

it('background deadline releases admission and ignores late results', async () => {
  let now = 0;
  const service = createPublicProviderRequests({
    now: () => now,
    operationTimeoutMs: 10,
    maxInFlight: 1,
  });
  const policy = { ttlMs: 10, staleTtlMs: 100 };
  await client(service, async () => ({ old: true }), url, policy).promise;
  now = 10;
  const work = deferred();
  let signal;
  await client(
    service,
    (s) => {
      signal = s;
      return work.promise;
    },
    url,
    policy
  ).promise;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(signal.aborted, true);
  await client(service, async () => ({ other: true }), 'https://x.test/other')
    .promise;
  work.resolve({ late: true });
  await tick();
  assert.deepEqual(
    await client(service, async () => ({ refreshed: true }), url, policy)
      .promise,
    { old: true }
  );
  await tick();
});

it('stale entries share byte/LRU bounds and still serve when refresh admission is full', async () => {
  let now = 0;
  const service = createPublicProviderRequests({
    now: () => now,
    maxBytes: 22,
    maxEntries: 2,
    maxInFlight: 1,
  });
  const policy = { ttlMs: 10, staleTtlMs: 100 };
  const load = async () => ({ ok: true });
  await client(service, load, url, policy).promise;
  now = 10;
  await client(service, load, 'https://x.test/second', policy).promise;
  const work = deferred();
  const busy = client(service, () => work.promise, 'https://x.test/busy');
  const stale = client(service, () => assert.fail('no admission'), url, policy);
  assert.deepEqual(await stale.promise, { ok: true });
  assert.equal(stale.res.headers['X-Provider-Cache'], 'STALE');
  work.resolve({ ok: true });
  await busy.promise;
  const evicted = client(service, load, 'https://x.test/second', policy);
  await evicted.promise;
  assert.equal(evicted.res.headers['X-Provider-Cache'], 'MISS');
});
