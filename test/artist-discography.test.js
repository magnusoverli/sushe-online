const { before, describe, it } = require('node:test');
const assert = require('node:assert/strict');

let createArtistDiscography;
before(async () => {
  ({ createArtistDiscography } =
    await import('../src/js/modules/artist-discography.js'));
});

function harness(options) {
  const requests = [];
  const load = createArtistDiscography((endpoint, priority, signal) => {
    const deferred = Promise.withResolvers();
    requests.push({ endpoint, priority, signal, ...deferred });
    return deferred.promise;
  }, options);
  return { requests, load };
}

describe('artist discography indexed pages', () => {
  it('uses exact indexed identity, not browse, and preserves canonical groups', async () => {
    const h = harness();
    const controller = new AbortController();
    const id = '12345678-abcd-1234-abcd-123456789abc';
    const pending = h.load(id, controller.signal, 100);
    const request = h.requests[0];
    const url = new URL(request.endpoint, 'https://example.test/');
    assert.equal(url.pathname, '/release-group');
    assert.equal(
      url.searchParams.get('query'),
      `arid:${id} AND (primarytype:album OR primarytype:ep)`
    );
    assert.equal(url.searchParams.has('artist'), false);
    assert.equal(url.searchParams.get('limit'), '100');
    assert.equal(url.searchParams.get('offset'), '100');
    assert.equal(url.searchParams.get('fmt'), 'json');
    assert.equal(request.priority, 'high');
    assert.equal(request.signal, controller.signal);
    const groups = [{ id: 'canonical-release-group', title: 'Original' }];
    request.resolve({ 'release-groups': groups, count: 102 });
    const page = await pending;
    assert.equal(page.groups, groups);
    assert.equal(page.groups[0].id, 'canonical-release-group');
    assert.equal(page.nextOffset, 101);
    assert.deepEqual(await h.load(id, controller.signal, 100), page);
    assert.equal(h.requests.length, 1);
  });

  for (const [label, offset, length, count, next] of [
    ['full first page', 0, 100, 201, 100],
    ['second page', 100, 100, '201', 200],
    ['last page', 200, 1, 201, null],
    ['exact boundary', 0, 100, 100, null],
    ['empty despite remaining count', 100, 0, 201, null],
    ['zero results', 0, 0, 0, null],
    ['missing count', 100, 2, undefined, null],
  ]) {
    it(`calculates pagination for ${label}`, async () => {
      const h = harness();
      const pending = h.load('A', undefined, offset);
      h.requests[0].resolve({
        'release-groups': Array.from({ length }, (_, i) => ({
          id: `${offset + i}`,
        })),
        count,
      });
      const page = await pending;
      assert.equal(page.groups.length, length);
      assert.equal(page.nextOffset, next);
      await h.load('A', undefined, offset);
      assert.equal(h.requests.length, 1);
    });
  }

  it('expires at ten minutes without extending TTL on cache hits', async () => {
    let time = 0;
    const h = harness({ now: () => time });
    const first = h.load('A');
    h.requests[0].resolve({ 'release-groups': [] });
    await first;
    time = 599999;
    await h.load('A');
    assert.equal(h.requests.length, 1);
    time = 600000;
    const expired = h.load('A');
    assert.equal(h.requests.length, 2);
    h.requests[1].resolve({ 'release-groups': [{ id: 'fresh' }] });
    assert.equal((await expired).groups[0].id, 'fresh');
  });

  it('does not prolong a stale server response with a fresh client TTL', async () => {
    const h = harness();
    const first = h.load('A');
    h.requests[0].resolve({
      'release-groups': [{ id: 'old' }],
      _providerCache: 'STALE',
    });
    assert.equal((await first).groups[0].id, 'old');
    const refreshed = h.load('A');
    assert.equal(h.requests.length, 2);
    h.requests[1].resolve({ 'release-groups': [{ id: 'fresh' }] });
    await refreshed;
    assert.equal((await h.load('A')).groups[0].id, 'fresh');
    assert.equal(h.requests.length, 2);
  });

  it('bounds the default LRU to 50 pages and refreshes recency on hits', async () => {
    const h = harness();
    for (let i = 0; i < 50; i++) {
      const pending = h.load('A', undefined, i * 100);
      h.requests.at(-1).resolve({ 'release-groups': [] });
      await pending;
    }
    await h.load('A', undefined, 0);
    const other = h.load('B');
    h.requests.at(-1).resolve({ 'release-groups': [] });
    await other;
    await h.load('A', undefined, 0);
    assert.equal(h.requests.length, 51);
    const evicted = h.load('A', undefined, 100);
    assert.equal(h.requests.length, 52);
    h.requests.at(-1).resolve({ 'release-groups': [] });
    await evicted;
  });

  it('rejects cancellation before fetching and before serving a warm page', async () => {
    const h = harness();
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(h.load('A', controller.signal), {
      name: 'AbortError',
    });
    assert.equal(h.requests.length, 0);
    const pending = h.load('A');
    h.requests[0].resolve({ 'release-groups': [] });
    await pending;
    await assert.rejects(h.load('A', controller.signal), {
      name: 'AbortError',
    });
    assert.equal(h.requests.length, 1);
  });

  it('does not cache a late success from a canceled request', async () => {
    const h = harness();
    const controller = new AbortController();
    const old = h.load('A', controller.signal);
    controller.abort();
    const fresh = h.load('A');
    h.requests[1].resolve({ 'release-groups': [{ id: 'fresh' }] });
    await fresh;
    h.requests[0].resolve({ 'release-groups': [{ id: 'stale' }] });
    await assert.rejects(old, { name: 'AbortError' });
    assert.equal((await h.load('A')).groups[0].id, 'fresh');
    assert.equal(h.requests.length, 2);
  });

  for (const data of [
    null,
    {},
    [],
    { 'release-groups': null },
    { 'release-groups': {} },
    { error: 'Busy', 'release-groups': [] },
    { errors: ['Busy'], 'release-groups': [] },
  ]) {
    it(`rejects and does not cache malformed response ${JSON.stringify(data)}`, async () => {
      const h = harness();
      const pending = h.load('A');
      h.requests[0].resolve(data);
      await assert.rejects(pending, /Invalid MusicBrainz album response/);
      const retry = h.load('A');
      assert.equal(h.requests.length, 2);
      h.requests[1].resolve({ 'release-groups': [] });
      await retry;
    });
  }

  for (const abort of [false, true]) {
    it(`does not cache ${abort ? 'aborted' : 'failed'} in-flight requests`, async () => {
      const h = harness();
      const controller = new AbortController();
      const pending = h.load('A', controller.signal);
      if (abort) {
        controller.abort();
        h.requests[0].resolve({ 'release-groups': [] });
      } else h.requests[0].reject(new Error('Offline'));
      await assert.rejects(pending, abort ? { name: 'AbortError' } : /Offline/);
      const retry = h.load('A');
      assert.equal(h.requests.length, 2);
      h.requests[1].resolve({ 'release-groups': [] });
      await retry;
    });
  }

  it('rejects unsafe identities and invalid offsets without fetching', async () => {
    const h = harness();
    for (const [id, offset] of [
      ['', 0],
      ['A OR arid:B', 0],
      ['A', -1],
      ['A', 0.5],
      ['A', '100'],
    ]) {
      await assert.rejects(
        h.load(id, undefined, offset),
        /Invalid artist discography request/
      );
    }
    assert.equal(h.requests.length, 0);
  });
});
