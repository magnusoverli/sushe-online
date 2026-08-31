const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const request = require('supertest');
const registerRoutes = require('../routes/admin/user-list-visibility');

function createApp({ authenticated = true, admin = true } = {}) {
  const app = express();
  app.use(express.json());
  const raw = mock.fn(async (_sql, params) => ({
    rows: [
      {
        year: params[0],
        revealed: params[1],
        revealed_at: params[1] ? '2025-01-01T00:00:00.000Z' : null,
        revealed_by: params[1] ? params[2] : null,
        updated_at: '2025-01-01T00:00:00.000Z',
      },
    ],
  }));
  const csrfProtection = mock.fn((_req, _res, next) => next());
  registerRoutes(app, {
    db: { raw },
    csrfProtection,
    ensureAuth: (req, res, next) => {
      if (!authenticated) return res.status(401).send('Unauthorized');
      req.user = { _id: 'admin-1', role: admin ? 'admin' : 'user' };
      next();
    },
    ensureAdmin: (req, res, next) =>
      req.user.role === 'admin' ? next() : res.status(403).send('Forbidden'),
  });
  return { app, raw, csrfProtection };
}

describe('admin user-list visibility routes', () => {
  it('requires authentication, admin role, and CSRF', async () => {
    const unauthenticated = createApp({ authenticated: false });
    const forbidden = createApp({ admin: false });
    const allowed = createApp();

    assert.strictEqual(
      (
        await request(unauthenticated.app)
          .put('/api/admin/user-list-visibility/2024')
          .send({ revealed: true })
      ).status,
      401
    );
    assert.strictEqual(
      (
        await request(forbidden.app)
          .patch('/api/admin/user-list-visibility/2024')
          .send({ revealed: true })
      ).status,
      403
    );
    assert.strictEqual(
      (
        await request(allowed.app)
          .put('/api/admin/user-list-visibility/2024')
          .send({ revealed: true })
      ).status,
      200
    );
    assert.strictEqual(allowed.csrfProtection.mock.calls.length, 1);
  });

  it('validates the full year and boolean body', async () => {
    const { app, raw } = createApp();

    const badYear = await request(app)
      .patch('/api/admin/user-list-visibility/2024x')
      .send({ revealed: true });
    const badBody = await request(app)
      .patch('/api/admin/user-list-visibility/2024')
      .send({ revealed: 'true' });

    assert.strictEqual(badYear.status, 400);
    assert.strictEqual(badBody.status, 400);
    assert.strictEqual(raw.mock.calls.length, 0);
  });

  it('supports reveal and hide without touching aggregate rows', async () => {
    const { app, raw } = createApp();

    const reveal = await request(app)
      .put('/api/admin/user-list-visibility/2024')
      .send({ revealed: true });
    const hide = await request(app)
      .patch('/api/admin/user-list-visibility/2024')
      .send({ revealed: false });

    assert.strictEqual(reveal.body.revealed, true);
    assert.strictEqual(hide.body.revealed, false);
    for (const call of raw.mock.calls) {
      assert.match(call.arguments[0], /user_list_year_visibility/);
      assert.doesNotMatch(call.arguments[0], /master_lists/);
    }
  });
});
