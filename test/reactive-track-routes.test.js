const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const registerRoutes = require('../routes/api/track-picks');
const {
  createListMutationPublisher,
} = require('../services/list/mutation-publisher');

describe('absolute track selection contract', () => {
  function setup(replaceTrackPicks) {
    const app = express();
    app.use(express.json());
    registerRoutes(app, {
      ensureAuthAPI: (req, _res, next) => {
        req.user = { _id: 'owner' };
        next();
      },
      logger: { error() {} },
      listService: { replaceTrackPicks },
      helpers: { invalidateListCaches() {} },
    });
    return app;
  }

  it('persists explicit selections and returns their parent revision', async () => {
    const calls = [];
    const app = setup(async (...args) => {
      calls.push(args);
      return {
        status: 'ok',
        primary: '1979',
        secondary: null,
        listId: 'list',
        revision: '19',
      };
    });
    const response = await request(app)
      .put('/api/track-picks/item')
      .set('If-Match', '"18"')
      .set('X-Socket-ID', 'origin-tab')
      .send({ primary_track: '1979', secondary_track: null })
      .expect(200);
    assert.deepEqual(calls[0], [
      'owner',
      'item',
      { primary: '1979', secondary: null },
      '18',
    ]);
    assert.equal(response.body.revision, '19');
    assert.equal(response.body.listId, 'list');
  });

  it('rejects incomplete and duplicate picks before calling persistence', async () => {
    let writes = 0;
    const app = setup(async () => {
      writes++;
    });
    await request(app)
      .put('/api/track-picks/item')
      .send({ primary_track: 'Track' })
      .expect(400);
    await request(app)
      .put('/api/track-picks/item')
      .send({ primary_track: 'Track', secondary_track: 'Track' })
      .expect(400);
    assert.equal(writes, 0);
  });

  it('returns forbidden when a list item belongs to another user', async () => {
    await request(setup(async () => ({ status: 'forbidden' })))
      .put('/api/track-picks/item')
      .send({ primary_track: null, secondary_track: null })
      .expect(403);
  });

  it('publishes content changes to their list instead of refreshing the library', async () => {
    const events = [];
    const publish = createListMutationPublisher({
      responseCache: { invalidate() {} },
      aggregateList: { scheduleRecompute() {} },
      getBroadcast: () => ({
        listUpdated: (...args) => events.push(args),
        libraryUpdated: () => {
          throw new Error('Unexpected library refresh');
        },
      }),
      logger: {
        error: (message) => {
          throw new Error(message);
        },
      },
    });
    await publish({
      userId: 'owner',
      years: [],
      changes: [{ listId: 'list', revision: '19' }],
    });
    assert.deepEqual(events, [['owner', 'list', { revision: '19' }]]);
  });
});
