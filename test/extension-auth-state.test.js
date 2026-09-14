const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadAuthState(storage, { failRemove = false } = {}) {
  let removals = 0;
  const context = vm.createContext({
    console: { log() {} },
    chrome: {
      storage: {
        local: {
          get: async () => ({ ...storage }),
          set: async (updates) => Object.assign(storage, updates),
          remove: async (keys) => {
            removals++;
            if (failRemove && removals === 1)
              throw new Error('storage unavailable');
            for (const key of keys) delete storage[key];
          },
        },
      },
    },
  });
  for (const filename of ['extension-constants.js', 'auth-state.js']) {
    vm.runInContext(
      readFileSync(
        path.join(__dirname, '../browser-extension', filename),
        'utf8'
      ),
      context
    );
  }
  return { auth: context.AuthState, removals: () => removals };
}

function oldStorage() {
  return {
    apiUrl: 'https://sushe.test',
    authToken: 'token',
    tokenExpiresAt: Date.now() + 600000,
    hasEverAuthenticated: true,
    userLists: [{ _id: 'website-session-list' }],
    userListsByYear: { 2026: [{ _id: 'website-session-list' }] },
    listsLastFetched: Date.now(),
    lastUsedList: { id: 'website-session-list' },
    albumPresenceIndex: { version: 2, entries: { old: [] } },
    albumPresenceLastFetched: Date.now(),
  };
}

test('the first state load discards session-derived caches but retains extension credentials', async () => {
  const storage = oldStorage();
  const { auth, removals } = loadAuthState(storage);
  const states = await Promise.all([
    auth.loadFullState(),
    auth.loadFullState(),
  ]);
  assert.equal(removals(), 1);
  for (const state of states) {
    assert.equal(state.authToken, 'token');
    assert.equal(state.apiUrl, 'https://sushe.test');
    assert.equal(state.userLists.length, 0);
    assert.equal(Object.keys(state.userListsByYear).length, 0);
    assert.equal(state.listsLastFetched, 0);
    assert.equal(state.lastUsedList, null);
  }
  assert.equal(storage.apiCacheVersion, 1);
  assert.equal(storage.hasEverAuthenticated, true);
  assert.equal(storage.albumPresenceIndex, undefined);
  assert.equal(storage.albumPresenceLastFetched, undefined);
});

test('a migrated worker preserves newly fetched bearer-account caches across restarts', async () => {
  const storage = oldStorage();
  await loadAuthState(storage).auth.loadFullState();
  storage.userLists = [{ _id: 'bearer-list' }];
  storage.lastUsedList = { id: 'bearer-list' };
  const { auth, removals } = loadAuthState(storage);
  const state = await auth.loadFullState();
  assert.equal(state.userLists[0]._id, 'bearer-list');
  assert.equal(state.lastUsedList.id, 'bearer-list');
  assert.equal(removals(), 0);
});

test('a failed cache migration blocks stale reads and can retry', async () => {
  const storage = oldStorage();
  const { auth } = loadAuthState(storage, { failRemove: true });
  await assert.rejects(auth.loadFullState(), /storage unavailable/);
  assert.equal(storage.apiCacheVersion, undefined);
  const state = await auth.loadFullState();
  assert.equal(state.userLists.length, 0);
  assert.equal(storage.apiCacheVersion, 1);
});

test('unauthorized cleanup removes credentials and all account caches but preserves the configured server', async () => {
  const storage = { ...oldStorage(), apiCacheVersion: 1 };
  const { auth } = loadAuthState(storage);
  await auth.handleUnauthorized();
  assert.deepEqual(storage, {
    apiUrl: 'https://sushe.test',
    apiCacheVersion: 1,
  });
});
