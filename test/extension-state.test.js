const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function harness() {
  const storage = {
    apiCacheVersion: 1,
    apiUrl: 'https://old.test',
    authToken: 'old',
    tokenExpiresAt: Date.now() + 600000,
  };
  const chrome = {
    storage: {
      local: {
        get: async () => ({ ...storage }),
        set: async (updates) =>
          Object.assign(storage, globalThis.structuredClone(updates)),
        remove: async (keys) => {
          for (const key of [keys].flat()) delete storage[key];
        },
      },
    },
  };
  const context = vm.createContext({
    chrome,
    crypto: globalThis.crypto,
    TextEncoder: globalThis.TextEncoder,
    URL,
    AbortController,
    console,
    setTimeout,
    clearTimeout,
  });
  for (const name of [
    'extension-constants',
    'shared-utils',
    'auth-state',
    'extension-state',
    'list-cache-service',
  ]) {
    vm.runInContext(
      fs.readFileSync(
        path.join(__dirname, '../browser-extension', `${name}.js`),
        'utf8'
      ),
      context
    );
  }
  const state = context.ExtensionState.createExtensionState({ chrome });
  return { storage, chrome, context, state };
}

test('startup storage snapshots cannot restore a token after logout', async () => {
  const { state, context, storage } = harness();
  const read = deferred();
  context.AuthState.loadFullState = () => read.promise;
  const loading = state.ensureLoaded();
  await state.logout();
  read.resolve({
    apiUrl: 'https://old.test',
    authToken: 'old',
    tokenExpiresAt: Date.now() + 600000,
  });
  await loading;
  assert.equal(state.get().authToken, null);
  assert.equal(storage.authToken, undefined);
});

test('account changes invalidate scopes and both persistent and memory caches', async () => {
  const { state, storage } = harness();
  await state.ensureLoaded();
  const old = state.capture();
  state.get().userLists = [{ _id: 'old-list' }];
  await state.persist(old, {
    userLists: [{ _id: 'old-list' }],
    listsLastFetched: Date.now(),
  });
  await state.setAuth('new', Date.now() + 600000);
  assert.equal(old.isCurrent(), false);
  assert.equal(old.signal.aborted, true);
  await old.unauthorized();
  assert.equal(state.get().authToken, 'new');
  assert.equal(storage.userLists, undefined);
  assert.equal(
    await state.persist(old, { userLists: [{ _id: 'late' }] }),
    false
  );
  await state.ensureLoaded(true);
  assert.equal(state.get().userLists.length, 0);
});

test('cache owner guards a worker restart after an external token replacement', async () => {
  const { state, storage } = harness();
  await state.ensureLoaded();
  await state.persist(state.capture(), {
    userLists: [{ _id: 'old-list' }],
    listsLastFetched: Date.now(),
  });
  storage.authToken = 'replacement';
  await state.ensureLoaded(true);
  assert.equal(state.get().userLists.length, 0);
  assert.equal(storage.userLists, undefined);
});

test('late storage events cannot invalidate a newer account whose write is pending', async () => {
  const { state, chrome, storage } = harness();
  await state.ensureLoaded();
  await state.setAuth('first', Date.now() + 600000);
  const saving = deferred();
  const started = deferred();
  const set = chrome.storage.local.set;
  chrome.storage.local.set = async (updates) => {
    if (updates.authToken === 'second') {
      started.resolve();
      await saving.promise;
    }
    return set(updates);
  };
  const replacement = state.setAuth('second', Date.now() + 600000);
  await started.promise;
  const scope = state.capture();
  const changed = state.storageChanged({
    authToken: { oldValue: 'old', newValue: 'first' },
  });
  saving.resolve();
  await replacement;
  assert.equal(await changed, false);
  assert.equal(scope.isCurrent(), true);
  assert.equal(state.get().authToken, 'second');
  assert.equal(storage.authToken, 'second');
});

test('externally replaced credentials invalidate the scope and cached account', async () => {
  const { state, storage } = harness();
  await state.ensureLoaded();
  const old = state.capture();
  await state.persist(old, { userLists: [{ _id: 'old-list' }] });
  storage.authToken = 'replacement';
  assert.equal(
    await state.storageChanged({ authToken: { newValue: 'replacement' } }),
    true
  );
  assert.equal(old.isCurrent(), false);
  assert.equal(state.get().authToken, 'replacement');
  assert.equal(state.get().userLists.length, 0);
});

test('account-scoped requests cannot send new credentials to an old server', async () => {
  const { state } = harness();
  await state.ensureLoaded();
  const old = state.capture();
  await state.setApiUrl('https://new.test');
  await state.setAuth('new', Date.now() + 600000);
  await assert.rejects(
    old.request('https://old.test/api/lists'),
    /Account changed/
  );
  await assert.rejects(
    state.capture().request('https://old.test/api/lists'),
    /server/
  );
});

test('empty lists stay fresh and failed manual refresh retains cached lists', async () => {
  const { state, context } = harness();
  await state.ensureLoaded();
  let calls = 0;
  let fail = false;
  const capture = state.capture;
  state.capture = () => ({
    ...capture(),
    request: async () => {
      calls++;
      if (fail) throw new Error('offline');
      return { ok: true, json: async () => ({}) };
    },
  });
  const lists = context.ListCacheService.createListCacheService({
    state,
    render: async () => {},
    logger: { warn() {} },
  });
  await lists.refresh();
  await lists.refresh();
  assert.equal(calls, 1);
  state.get().userLists = [{ _id: 'cached', name: 'Cached' }];
  fail = true;
  assert.equal((await lists.refresh(true)).fromCache, true);
  assert.equal(lists.response().count, 1);
});

test('forced refresh callers waiting on one passive request share one follow-up', async () => {
  const { state, context } = harness();
  await state.ensureLoaded();
  const first = deferred();
  let calls = 0;
  const capture = state.capture;
  state.capture = () => ({
    ...capture(),
    request: async () => {
      if (++calls === 1) await first.promise;
      return { ok: true, json: async () => ({}) };
    },
  });
  const lists = context.ListCacheService.createListCacheService({
    state,
    render: async () => {},
  });
  const passive = lists.refresh();
  while (!calls) await Promise.resolve();
  const forces = [lists.refresh(true), lists.refresh(true)];
  first.resolve();
  await Promise.all([passive, ...forces]);
  assert.equal(calls, 2);
});

test('replacement account fetch does not join an old request or accept its late response', async () => {
  const { state, context, storage } = harness();
  await state.ensureLoaded();
  const old = deferred();
  let calls = 0;
  const capture = state.capture;
  state.capture = () => ({
    ...capture(),
    request: async () => {
      if (++calls === 1) return old.promise;
      return { ok: true, json: async () => ({ new: { name: 'New account' } }) };
    },
  });
  const lists = context.ListCacheService.createListCacheService({
    state,
    render: async () => {},
    logger: { warn() {} },
  });
  const oldRead = lists.refresh();
  while (!calls) await Promise.resolve();
  await state.setAuth('replacement', Date.now() + 600000);
  await lists.refresh();
  old.resolve({
    ok: true,
    json: async () => ({ old: { name: 'Previous account' } }),
  });
  await oldRead;
  assert.equal(calls, 2);
  assert.equal(lists.response().flatLists[0]._id, 'new');
  assert.equal(storage.userLists[0]._id, 'new');
});

test('an addition during a forced list refresh requires a newer count snapshot', async () => {
  const { state, context } = harness();
  await state.ensureLoaded();
  const first = deferred();
  let calls = 0;
  const capture = state.capture;
  state.capture = () => ({
    ...capture(),
    request: async () => {
      const count = ++calls === 1 ? 0 : 1;
      if (count === 0) await first.promise;
      return {
        ok: true,
        json: async () => ({ list: { name: 'List', count } }),
      };
    },
  });
  const lists = context.ListCacheService.createListCacheService({
    state,
    render: async () => {},
  });
  const refreshing = lists.refresh(true);
  while (!calls) await Promise.resolve();
  await lists.rememberList(
    { _id: 'list', name: 'List' },
    true,
    state.capture()
  );
  const afterAdd = lists.refresh(true);
  first.resolve();
  await Promise.all([refreshing, afterAdd]);
  assert.equal(calls, 2);
  assert.equal(lists.find('list').count, 1);
});
