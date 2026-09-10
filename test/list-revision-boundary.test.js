const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { cacheConfigs, responseCache } = require('../middleware/response-cache');
const { checkRevision } = require('../services/list/revision');
const { createMockLogger } = require('./helpers');

after(() => responseCache.shutdown());

test('real list route/cache/client/state preserve revisions and reject stale replacement', async (t) => {
  const { createAppApiClient } =
    await import('../src/js/modules/app-api-client.js');
  const { getListRevision } =
    await import('../src/js/modules/list-revisions.js');
  const state = await import('../src/js/modules/app-state.js');
  t.mock.method(console, 'warn', () => {});
  const id = 'revision-boundary-list';
  let revision = '7';
  let writes = 0;
  const app = express();
  app.use(express.json());
  require('../routes/api/lists')(app, {
    ensureAuthAPI: (req, _res, next) => {
      req.user = { _id: 'owner' };
      next();
    },
    logger: createMockLogger(),
    cacheConfigs,
    helpers: {
      invalidateListCaches: () => responseCache.clear(),
      triggerAggregateListRecompute() {},
    },
    listService: {
      getListById: async () => ({
        list: { _id: id, revision },
        items: [
          { _id: 'item', album_id: 'album', album: 'Album', artist: 'Artist' },
        ],
      }),
      replaceListItems: async (_id, _userId, _items, expected) => {
        checkRevision({ revision }, expected);
        writes++;
        return { list: { _id: id, revision: String(++revision) }, count: 1 };
      },
    },
  });
  const client = createAppApiClient({
    getRealtimeSyncModuleInstance: () => null,
    logger: createMockLogger(),
    fetchImpl: async (url, options) => {
      let call = request(app)
        [(options.method || 'GET').toLowerCase()](url)
        .set(options.headers);
      if (options.body) call = call.send(options.body);
      const response = await call;
      return {
        ok: response.status < 400,
        status: response.status,
        headers: new Headers(response.headers),
        json: async () => response.body,
      };
    },
  });
  const first = await client.apiCall(`/api/lists/${id}`);
  const cached = await client.apiCall(`/api/lists/${id}`);
  assert.equal(first._listRevision, '7');
  assert.equal(cached._listRevision, '7');
  assert.equal(getListRevision(id), undefined);
  state.setLists({ [id]: { name: 'List', count: 1 } });
  state.setListData(id, first);
  assert.equal(getListRevision(id), '7');

  revision = '8';
  responseCache.invalidate(':owner');
  await assert.rejects(
    client.apiCall(`/api/lists/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ data: first }),
    }),
    { code: 'LIST_CONFLICT' }
  );
  assert.equal(writes, 0);
  const fresh = await client.apiCall(`/api/lists/${id}`);
  assert.equal(
    getListRevision(id),
    '7',
    'a read cannot advance the edit base before its data is accepted'
  );
  state.setListData(id, fresh);
  await client.apiCall(`/api/lists/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ data: fresh }),
  });
  assert.equal(writes, 1);
  assert.equal(getListRevision(id), '9');
});
