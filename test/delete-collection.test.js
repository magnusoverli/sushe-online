const { describe, it, mock } = require('node:test');
const assert = require('node:assert');

describe('deleteCollection', () => {
  async function load() {
    const mod = await import('../src/js/utils/delete-collection.js');
    return mod.deleteCollection;
  }

  it('does NOT fire a plain delete when the collection is known to be non-empty', async () => {
    const deleteCollection = await load();
    const apiCall = mock.fn(async () => ({ success: true }));
    const showConfirmation = mock.fn(async () => true);
    const showToast = mock.fn();
    const refresh = mock.fn(async () => {});

    const deleted = await deleteCollection({
      id: 'g1',
      name: 'Faves',
      listCount: 3,
      apiCall,
      showConfirmation,
      showToast,
      refresh,
    });

    assert.strictEqual(deleted, true);
    // Exactly one request, and it goes straight to force=true (no doomed probe).
    assert.strictEqual(apiCall.mock.calls.length, 1);
    assert.strictEqual(
      apiCall.mock.calls[0].arguments[0],
      '/api/groups/g1?force=true'
    );
    assert.strictEqual(apiCall.mock.calls[0].arguments[1].method, 'DELETE');
    assert.strictEqual(showConfirmation.mock.calls.length, 1);
    assert.strictEqual(refresh.mock.calls.length, 1);
  });

  it('does nothing when the confirmation is declined', async () => {
    const deleteCollection = await load();
    const apiCall = mock.fn(async () => ({ success: true }));
    const showConfirmation = mock.fn(async () => false);
    const showToast = mock.fn();
    const refresh = mock.fn(async () => {});

    const deleted = await deleteCollection({
      id: 'g1',
      name: 'Faves',
      listCount: 2,
      apiCall,
      showConfirmation,
      showToast,
      refresh,
    });

    assert.strictEqual(deleted, false);
    assert.strictEqual(apiCall.mock.calls.length, 0);
    assert.strictEqual(showToast.mock.calls.length, 0);
    assert.strictEqual(refresh.mock.calls.length, 0);
  });

  it('deletes directly (no force, no confirmation) when the collection is empty', async () => {
    const deleteCollection = await load();
    const apiCall = mock.fn(async () => ({ success: true }));
    const showConfirmation = mock.fn(async () => true);
    const showToast = mock.fn();
    const refresh = mock.fn(async () => {});

    const deleted = await deleteCollection({
      id: 'g2',
      name: 'Empty',
      listCount: 0,
      apiCall,
      showConfirmation,
      showToast,
      refresh,
    });

    assert.strictEqual(deleted, true);
    assert.strictEqual(apiCall.mock.calls.length, 1);
    assert.strictEqual(apiCall.mock.calls[0].arguments[0], '/api/groups/g2');
    assert.strictEqual(showConfirmation.mock.calls.length, 0);
    assert.strictEqual(refresh.mock.calls.length, 1);
  });

  it('falls back to confirm + force when a believed-empty collection 409s (stale state)', async () => {
    const deleteCollection = await load();
    const apiCall = mock.fn(async (url) => {
      if (url === '/api/groups/g3') {
        const err = new Error('Collection contains lists');
        err.status = 409;
        err.requiresConfirmation = true;
        err.listCount = 1;
        throw err;
      }
      return { success: true };
    });
    const showConfirmation = mock.fn(async () => true);
    const showToast = mock.fn();
    const refresh = mock.fn(async () => {});

    const deleted = await deleteCollection({
      id: 'g3',
      name: 'Stale',
      listCount: 0,
      apiCall,
      showConfirmation,
      showToast,
      refresh,
    });

    assert.strictEqual(deleted, true);
    assert.strictEqual(apiCall.mock.calls.length, 2);
    assert.strictEqual(apiCall.mock.calls[0].arguments[0], '/api/groups/g3');
    assert.strictEqual(
      apiCall.mock.calls[1].arguments[0],
      '/api/groups/g3?force=true'
    );
    assert.strictEqual(showConfirmation.mock.calls.length, 1);
    assert.strictEqual(refresh.mock.calls.length, 1);
  });

  it('reports an unexpected error via toast without deleting', async () => {
    const deleteCollection = await load();
    const apiCall = mock.fn(async () => {
      const err = new Error('Server exploded');
      err.status = 500;
      throw err;
    });
    const showConfirmation = mock.fn(async () => true);
    const showToast = mock.fn();
    const refresh = mock.fn(async () => {});
    const logger = { error: mock.fn() };

    const deleted = await deleteCollection({
      id: 'g4',
      name: 'Boom',
      listCount: 0,
      apiCall,
      showConfirmation,
      showToast,
      refresh,
      logger,
    });

    assert.strictEqual(deleted, false);
    assert.strictEqual(refresh.mock.calls.length, 0);
    assert.strictEqual(showToast.mock.calls.length, 1);
    assert.strictEqual(showToast.mock.calls[0].arguments[0], 'Server exploded');
    assert.strictEqual(logger.error.mock.calls.length, 1);
  });
});
