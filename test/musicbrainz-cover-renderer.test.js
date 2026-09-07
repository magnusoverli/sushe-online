const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Exercise the actual renderer hook without importing the application's DOM bootstrap.
const source = fs.readFileSync(
  path.join(__dirname, '../src/js/musicbrainz.js'),
  'utf8'
);
const start = source.indexOf('const albumCoverRenders =');
const end = source.indexOf(
  '// =============================================================================',
  start
);
function clock() {
  const timers = new Map();
  let next = 0;
  return {
    timers,
    setTimeout(fn, ms) {
      assert.equal(ms, 3000);
      timers.set(++next, fn);
      return next;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    expire() {
      for (const fn of [...timers.values()]) fn();
    },
  };
}
function renderer(loader, current, placeholder = () => {}, time = clock()) {
  return new Function(
    'albumCoverLoader',
    'isSearchRequestCurrent',
    'showCoverPlaceholder',
    'setTimeout',
    'clearTimeout',
    `${source.slice(start, end)}; return loadAlbumCover;`
  )(loader, current, placeholder, time.setTimeout, time.clearTimeout);
}
const image = () => ({
  isConnected: true,
  parentElement: { classList: { remove() {} } },
  removeAttribute(name) {
    delete this[name];
  },
});

for (const queued of [false, true]) {
  it(`reuses ${queued ? 'queued' : 'active'} work when paging detaches and rebuilds an album row`, async () => {
    const { createAlbumCoverLoader } =
      await import('../src/js/modules/album-cover-loader.js');
    const request = new AbortController();
    const finishes = new Map(),
      starts = [];
    const loader = createAlbumCoverLoader({
      concurrency: 1,
      providers: [
        ({ id }) =>
          new Promise((resolve) => {
            starts.push(id);
            finishes.set(id, resolve);
          }),
        async () => null,
      ],
    });
    const blocker = queued
      ? loader.search({ id: 'blocker' }, request.signal)
      : null;
    const time = clock(),
      oldImg = image(),
      newImg = image();
    const oldAlbum = {},
      newAlbum = {};
    const load = renderer(
      loader,
      () => true,
      () => {},
      time
    );
    const oldWork = load(oldImg, 'Artist', 'Album', 'id', oldAlbum, request);
    await new Promise(setImmediate);
    oldImg.isConnected = false;
    const newWork = load(newImg, 'Artist', 'Album', 'id', newAlbum, request);
    if (queued) {
      finishes.get('blocker')('blocker-cover');
      await blocker;
    }
    await new Promise(setImmediate);
    assert.equal(starts.filter((id) => id === 'id').length, 1);
    finishes.get('id')('cover');
    await Promise.all([oldWork, newWork]);
    assert.equal(oldImg.src, undefined);
    assert.equal(oldAlbum.coverArt, undefined);
    assert.equal(newImg.src, 'cover');
    assert.equal(newAlbum.coverArt, 'cover');
    newImg.onload();
    assert.equal(time.timers.size, 0);
  });
}

it('sets a warm cache URL synchronously without queue or observer delay', async () => {
  const img = image(),
    album = {},
    request = new AbortController();
  let searches = 0;
  const load = renderer(
    {
      peek: () => 'warm',
      search: () => {
        searches++;
      },
      seed() {},
    },
    () => true
  );
  const work = load(img, 'Artist', 'Album', 'id', album, request);
  assert.equal(img.src, 'warm');
  assert.equal(album.coverArt, 'warm');
  assert.equal(searches, 0);
  img.onload();
  await work;
});

it('evicts a broken actual render and retries once excluding that URL', async () => {
  const img = image(),
    album = { coverArt: 'broken' },
    request = new AbortController();
  let searches = 0,
    evictions = 0,
    placeholders = 0;
  const load = renderer(
    {
      peek: () => null,
      seed() {},
      evict() {
        evictions++;
      },
      async search(identity, signal, excluded) {
        searches++;
        assert.deepEqual(identity, {
          artist: 'Artist',
          title: 'Album',
          id: 'id',
        });
        assert.equal(signal, request.signal);
        assert.deepEqual([...excluded], ['broken']);
        return 'alternative';
      },
    },
    () => true,
    () => {
      placeholders++;
    }
  );
  await load(img, 'Artist', 'Album', 'id', album, request);
  img.onerror();
  await new Promise(setImmediate);
  assert.equal(img.src, 'alternative');
  img.onerror();
  assert.equal(searches, 1);
  assert.equal(evictions, 2);
  assert.equal(placeholders, 1);
  assert.equal(album.coverArt, undefined);
});

for (const reason of ['request replaced', 'element detached']) {
  it(`does not mutate an album instance after ${reason}`, async () => {
    const img = image(),
      album = {},
      request = new AbortController();
    let current = true,
      finish;
    const load = renderer(
      {
        peek: () => null,
        search: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      },
      () => current
    );
    const work = load(img, 'Artist', 'Album', 'id', album, request);
    if (reason === 'request replaced') current = false;
    else img.isConnected = false;
    finish('late');
    await work;
    assert.equal(img.src, undefined);
    assert.equal(album.coverArt, undefined);
  });
}

it('times out actual rendering, retries once with exclusions, and cleans up both deadlines', async () => {
  const time = clock(),
    img = image(),
    album = { coverArt: 'hang' };
  const request = new AbortController();
  const { getEventListeners } = require('node:events');
  const calls = [];
  let placeholders = 0;
  const load = renderer(
    {
      seed() {},
      evict() {},
      peek: () => null,
      async search(_identity, signal, excluded) {
        assert.equal(signal, request.signal);
        calls.push([...excluded]);
        return 'second-hang';
      },
    },
    () => true,
    () => placeholders++,
    time
  );
  await load(img, 'Artist', 'Album', 'id', album, request);
  const staleLoad = img.onload;
  assert.equal(time.timers.size, 1);
  time.expire();
  assert.equal(time.timers.size, 0);
  await new Promise(setImmediate);
  assert.deepEqual(calls, [['hang']]);
  assert.equal(img.src, 'second-hang');
  staleLoad();
  assert.equal(time.timers.size, 1);
  time.expire();
  assert.equal(placeholders, 1);
  assert.equal(time.timers.size, 0);
  assert.equal(img.onload, null);
  assert.equal(img.onerror, null);
  assert.equal(getEventListeners(request.signal, 'abort').length, 0);
  assert.equal(album.coverArt, undefined);
});

for (const outcome of ['load', 'error', 'abort', 'detached timeout']) {
  it(`cleans actual-render timers and abort listeners after ${outcome}`, async () => {
    const { getEventListeners } = require('node:events');
    const time = clock(),
      img = image(),
      album = { coverArt: 'warm' };
    const request = new AbortController();
    let seeds = 0,
      retries = 0;
    const load = renderer(
      {
        seed() {
          seeds++;
        },
        evict() {},
        peek: () => null,
        async search() {
          retries++;
          return null;
        },
      },
      () => true,
      () => {},
      time
    );
    await load(img, 'Artist', 'Album', 'id', album, request);
    const lateLoad = img.onload,
      lateError = img.onerror;
    assert.equal(getEventListeners(request.signal, 'abort').length, 1);
    if (outcome === 'load') img.onload();
    if (outcome === 'error') img.onerror();
    if (outcome === 'abort') request.abort();
    if (outcome === 'detached timeout') {
      img.isConnected = false;
      time.expire();
    }
    await new Promise(setImmediate);
    lateLoad();
    lateError();
    assert.equal(time.timers.size, 0);
    assert.equal(img.onload, null);
    assert.equal(img.onerror, null);
    assert.equal(getEventListeners(request.signal, 'abort').length, 0);
    assert.equal(seeds, outcome === 'load' ? 1 : 0);
    assert.equal(retries, outcome === 'error' ? 1 : 0);
    if (outcome !== 'error') assert.equal(album.coverArt, 'warm');
  });
}

it('replacing the same image cancels its old render without stale callbacks changing the replacement', async () => {
  const { getEventListeners } = require('node:events');
  const time = clock(),
    img = image();
  const oldRequest = new AbortController(),
    newRequest = new AbortController();
  const oldAlbum = { coverArt: 'old' },
    newAlbum = { coverArt: 'new' };
  const seeded = [];
  const load = renderer(
    {
      seed(_identity, url) {
        seeded.push(url);
      },
    },
    () => true,
    () => {},
    time
  );
  await load(img, 'Artist', 'Old', 'old-id', oldAlbum, oldRequest);
  const lateLoad = img.onload,
    lateError = img.onerror;
  await load(img, 'Artist', 'New', 'new-id', newAlbum, newRequest);
  assert.equal(time.timers.size, 1);
  assert.equal(getEventListeners(oldRequest.signal, 'abort').length, 0);
  lateLoad();
  lateError();
  oldRequest.abort();
  assert.equal(img.src, 'new');
  assert.deepEqual(seeded, []);
  img.onload();
  assert.deepEqual(seeded, ['new']);
  assert.equal(time.timers.size, 0);
  assert.equal(getEventListeners(newRequest.signal, 'abort').length, 0);
});
