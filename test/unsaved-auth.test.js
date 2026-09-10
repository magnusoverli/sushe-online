const { test } = require('node:test');
const assert = require('node:assert/strict');

test('an expired session does not navigate away from pending list edits', async () => {
  const { createAppApiClient } =
    await import('../src/js/modules/app-api-client.js');
  const { createAppListOperations } =
    await import('../src/js/modules/app-list-operations.js');
  const { markListUnsaved, hasUnsavedLists } =
    await import('../src/js/modules/unsaved-lists.js');
  const id = 'unsaved-auth-list';
  let unload;
  const win = {
    location: { href: '/app' },
    addEventListener: (_name, callback) => {
      unload = callback;
    },
  };
  const api = createAppApiClient({
    win,
    getRealtimeSyncModuleInstance: () => null,
    logger: { error() {} },
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
    }),
  });
  const lists = { [id]: { _data: [{ album_id: 'album' }] } };
  const snapshots = new Map();
  const ops = createAppListOperations({
    getLists: () => lists,
    apiCall: api.apiCall,
    markLocalSave() {},
    getLastSavedSnapshots: () => snapshots,
    computeListDiff: () => null,
    showToast() {},
  });
  try {
    await assert.rejects(ops.saveList(id, lists[id]._data), {
      code: 'SESSION_EXPIRED',
    });
    assert.equal(win.location.href, '/app');
    assert.equal(snapshots.has(id), false);
    assert.equal(ops.getListSaveState(id).dirty, true);
    assert.equal(hasUnsavedLists(), true);
    let warned = false;
    unload({
      preventDefault: () => {
        warned = true;
      },
    });
    assert.equal(warned, true);
  } finally {
    markListUnsaved(id, false);
  }
});

test('after reauthentication the client renews CSRF once before retrying a rejected mutation', async () => {
  const { createAppApiClient } =
    await import('../src/js/modules/app-api-client.js');
  const win = { location: { href: '/app' }, csrfToken: 'old' };
  let requests = 0;
  let mutations = 0;
  const api = createAppApiClient({
    win,
    getRealtimeSyncModuleInstance: () => null,
    logger: { error() {} },
    fetchImpl: async (url, options) => {
      requests++;
      if (url === '/api/auth/csrf')
        return { ok: true, json: async () => ({ csrfToken: 'fresh' }) };
      if (options.headers['X-CSRF-Token'] === 'fresh') {
        mutations++;
        return { ok: true, status: 200, json: async () => ({ success: true }) };
      }
      return {
        ok: false,
        status: 403,
        json: async () => ({
          code: 'CSRF_INVALID',
          error: { message: 'Invalid CSRF token' },
        }),
      };
    },
  });
  await api.apiCall('/api/lists/list', {
    method: 'PUT',
    body: JSON.stringify({ data: [] }),
  });
  assert.equal(requests, 3);
  assert.equal(mutations, 1);
});
