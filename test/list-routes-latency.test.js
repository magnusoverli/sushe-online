const { describe, it, mock } = require('node:test');
const assert = require('node:assert');

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('list write route latency', () => {
  it('responds to an incremental add without awaiting taxonomy broadcasts', async () => {
    let incrementalHandler;
    const app = {
      get: () => {},
      post: () => {},
      put: () => {},
      patch(path, ...handlers) {
        if (path === '/api/lists/:id/items') {
          incrementalHandler = handlers.at(-1);
        }
      },
      delete: () => {},
    };
    const taxonomyNotification = deferred();
    const notifyTaxonomyUpdated = mock.fn(() => taxonomyNotification.promise);
    const listUpdated = mock.fn();
    const res = {
      json: mock.fn(),
      status: mock.fn(function status() {
        return this;
      }),
    };

    require('../routes/api/lists')(app, {
      ensureAuthAPI: () => {},
      logger: { warn: mock.fn(), error: mock.fn() },
      cacheConfigs: { userSpecific: () => {} },
      listService: {
        incrementalUpdate: mock.fn(async () => ({
          list: { _id: 'list-1', year: null },
          changeCount: 1,
          addedItems: [{ album_id: 'album-1' }],
          duplicateAlbums: [],
          sourceObservationResults: [
            {
              albumId: 'album-1',
              taxonomyUpdatedAt: '2026-08-18T00:00:00.000Z',
            },
          ],
          warnings: [],
        })),
      },
      albumService: { notifyTaxonomyUpdated },
      helpers: {
        triggerAggregateListRecompute: mock.fn(),
        invalidateListCaches: mock.fn(),
      },
    });

    await incrementalHandler(
      {
        params: { id: 'list-1' },
        body: { added: [{ album_id: 'album-1' }] },
        user: { _id: 'user-1' },
        headers: {},
        app: { locals: { broadcast: { listUpdated } } },
      },
      res
    );

    assert.strictEqual(notifyTaxonomyUpdated.mock.calls.length, 1);
    assert.strictEqual(res.json.mock.calls.length, 1);
    assert.strictEqual(listUpdated.mock.calls.length, 1);

    taxonomyNotification.resolve();
    await taxonomyNotification.promise;
  });
});
