const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const request = require('supertest');
const registerRoutes = require('../routes/admin/historical-list-import');

function createApp({ admin = true } = {}) {
  const app = express();
  app.use(express.json());
  const raw = mock.fn(async (sql) => {
    if (sql.includes('FROM users')) {
      return { rows: [{ _id: 'user-1', username: 'alice' }] };
    }
    return { rows: [] };
  });
  registerRoutes(app, {
    db: { raw },
    listService: {
      createList: mock.fn(async () => ({ listId: 'list-1' })),
    },
    invalidateListCaches: mock.fn(),
    ensureAuthAPI: (req, _res, next) => {
      req.user = { _id: 'admin-1', role: admin ? 'admin' : 'user' };
      next();
    },
    ensureAdmin: (req, res, next) =>
      req.user.role === 'admin' ? next() : res.status(403).send('Forbidden'),
  });
  return app;
}

const body = {
  imports: [
    {
      clientId: 'file-1',
      fileName: '2017.json',
      targetUserId: 'user-1',
      payload: {
        version: 1,
        list: { name: 'Best of 2017', year: 2017 },
        albums: [{ position: 1, artist: 'Artist', album: 'Album' }],
      },
    },
  ],
};

describe('admin historical list import routes', () => {
  it('returns an authoritative preview for an admin', async () => {
    const response = await request(createApp())
      .post('/api/admin/historical-list-import/preview')
      .send(body);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.canCommit, true);
    assert.strictEqual(response.body.imports[0].targetUsername, 'alice');
  });

  it('rejects non-admin users', async () => {
    const response = await request(createApp({ admin: false }))
      .post('/api/admin/historical-list-import/preview')
      .send(body);

    assert.strictEqual(response.status, 403);
  });

  it('returns structured validation errors for malformed batches', async () => {
    const response = await request(createApp())
      .post('/api/admin/historical-list-import/preview')
      .send({ imports: [] });

    assert.strictEqual(response.status, 400);
    assert.strictEqual(
      response.body.error,
      'imports must contain at least one file'
    );
  });
});
