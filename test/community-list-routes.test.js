const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const request = require('supertest');
const registerRoutes = require('../routes/api/community');
const { createMockLogger } = require('./helpers');

function createApp({ user = null, detail = null } = {}) {
  const app = express();
  const communityListService = {
    getMainListSummaries: mock.fn(async () => []),
    getMainListDetail: mock.fn(async () => detail),
  };
  registerRoutes(app, {
    logger: createMockLogger(),
    communityListService,
    ensureAuthAPI: (req, res, next) => {
      if (!user)
        return res.status(401).json({ error: 'Authentication required' });
      req.user = user;
      next();
    },
  });
  return { app, communityListService };
}

describe('community list routes', () => {
  it('requires authentication for summary and detail reads', async () => {
    const { app } = createApp();

    const summary = await request(app).get('/api/community/main-lists');
    const detail = await request(app).get('/api/community/main-lists/list-1');

    assert.strictEqual(summary.status, 401);
    assert.strictEqual(detail.status, 401);
  });

  it('does not give admins a visibility or ownership bypass', async () => {
    const { app, communityListService } = createApp({
      user: { _id: 'admin-1', role: 'admin' },
    });

    const response = await request(app).get(
      '/api/community/main-lists/private-list'
    );

    assert.strictEqual(response.status, 404);
    assert.deepStrictEqual(response.body, {
      error: 'Community list not found',
    });
    assert.deepStrictEqual(
      communityListService.getMainListDetail.mock.calls[0].arguments,
      ['private-list', 'admin-1']
    );
  });

  it('uses the same generic 404 for hidden, non-main, own, and missing lists', async () => {
    for (const listId of ['hidden', 'non-main', 'own', 'missing']) {
      const { app } = createApp({ user: { _id: 'viewer-1', role: 'user' } });
      const response = await request(app).get(
        `/api/community/main-lists/${listId}`
      );

      assert.strictEqual(response.status, 404);
      assert.deepStrictEqual(response.body, {
        error: 'Community list not found',
      });
    }
  });

  it('returns visible summaries and detail with response caching disabled', async () => {
    const detail = { id: 'list-1', items: [] };
    const { app, communityListService } = createApp({
      user: { _id: 'viewer-1', role: 'user' },
      detail,
    });
    communityListService.getMainListSummaries.mock.mockImplementation(
      async () => [{ id: 'list-1' }]
    );

    const summary = await request(app).get('/api/community/main-lists');
    const detailResponse = await request(app).get(
      '/api/community/main-lists/list-1'
    );

    assert.deepStrictEqual(summary.body, { lists: [{ id: 'list-1' }] });
    assert.deepStrictEqual(detailResponse.body, detail);
    assert.strictEqual(summary.headers['cache-control'], 'no-store');
    assert.strictEqual(detailResponse.headers['cache-control'], 'no-store');
  });
});
