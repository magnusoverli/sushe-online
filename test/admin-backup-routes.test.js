const { describe, it } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const request = require('supertest');

const registerBackupRoutes = require('../routes/admin/backup');

function createTestApp(options = {}) {
  const app = express();
  app.use(express.json());

  const upload = options.upload || {
    single: () => (req, _res, next) => {
      req.file = { path: '/tmp/fake.dump', size: 10 };
      next();
    },
  };

  const deps = {
    ensureAuth: (req, _res, next) => {
      req.user = { username: 'admin' };
      next();
    },
    ensureAdmin: (_req, _res, next) => next(),
    upload,
    db: { raw: async () => ({ rows: [] }) },
    restoreOperationService: options.restoreOperationService,
  };

  registerBackupRoutes(app, deps);

  return app;
}

describe('admin backup restore routes', () => {
  it('returns 409 when a restore is already in progress', async () => {
    let uploadCalled = false;

    const app = createTestApp({
      upload: {
        single: () => (_req, _res, next) => {
          uploadCalled = true;
          next();
        },
      },
      restoreOperationService: {
        hasActiveRestore: () => true,
        getOperation: () => null,
      },
    });

    const response = await request(app).post('/admin/restore');

    assert.strictEqual(response.status, 409);
    assert.strictEqual(response.body.code, 'RESTORE_IN_PROGRESS');
    assert.strictEqual(uploadCalled, false);
  });

  it('returns 404 for unknown restore status id', async () => {
    const app = createTestApp({
      restoreOperationService: {
        hasActiveRestore: () => false,
        getOperation: () => null,
      },
    });

    const response = await request(app).get('/admin/restore/unknown/status');

    assert.strictEqual(response.status, 404);
    assert.strictEqual(response.body.code, 'RESTORE_OPERATION_NOT_FOUND');
  });

  it('returns restore status payload for known id', async () => {
    const app = createTestApp({
      restoreOperationService: {
        hasActiveRestore: () => false,
        getOperation: () => ({
          restoreId: 'restore_123',
          status: 'restoring',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:01.000Z',
          completedAt: null,
          errorCode: null,
          errorMessage: null,
        }),
      },
    });

    const response = await request(app).get(
      '/admin/restore/restore_123/status'
    );

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.restoreId, 'restore_123');
    assert.strictEqual(response.body.status, 'restoring');
  });
});
