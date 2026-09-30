const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const register = require('../routes/admin/backup');

function app(control, overrides = {}) {
  const instance = express();
  const auth = (req, _res, next) => {
    req.user = { _id: 'admin', role: 'admin' };
    next();
  };
  register(instance, {
    ensureAuth: auth,
    ensureAdmin: (_req, _res, next) => next(),
    recoveryControl: control,
    ...overrides,
  });
  return instance;
}
test('restore is unavailable without the separate recovery service', async () => {
  await request(app()).post('/admin/restore').expect(503);
});
test('exclusive admission is acquired before consuming an upload', async () => {
  let admission = 0;
  const server = app({
    begin: async () => {
      admission++;
      return null;
    },
  });
  const result = await request(server)
    .post('/admin/restore')
    .attach('backup', Buffer.from('PGDMP'), 'test.dump')
    .expect(409);
  assert.equal(result.body.code, 'RESTORE_IN_PROGRESS');
  assert.equal(admission, 1);
});
test('status exposes durable terminal state without credential material', async () => {
  const server = app({
    get: async () => ({
      id: 'job',
      status: 'completed',
      status_key: 'PRIVATE',
    }),
  });
  const result = await request(server)
    .get('/admin/restore/job/status')
    .expect(200);
  assert.equal(result.body.status, 'completed');
  assert.ok(!JSON.stringify(result.body).includes('PRIVATE'));
  const rollback = app({
    get: async () => ({
      id: 'job',
      status: 'rolled-back',
      error_code: 'RESTORE_PROCESS_FAILED',
    }),
  });
  const restored = await request(rollback)
    .get('/admin/restore/job/status')
    .expect(200);
  assert.equal(restored.body.errorCode, 'RESTORE_ROLLED_BACK');
  assert.match(restored.body.errorMessage, /original database is back online/);
});

test('multipart size, corrupt content and interrupted uploads release admission and remove partial files', async () => {
  const fs = require('node:fs/promises');
  const os = require('node:os');
  const path = require('node:path');
  const http = require('node:http');
  const { randomUUID } = require('node:crypto');
  const {
    createAdminBackupService,
  } = require('../services/admin-backup-service');
  const { until } = require('../services/recovery/worker');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'restore-upload-test-'));
  let failures = 0;
  const control = {
    begin: async () => ({ id: randomUUID() }),
    failUpload: async () => {
      failures++;
    },
  };
  const instance = app(control, {
    recoveryUploadRoot: root,
    backupService: createAdminBackupService({
      env: { RESTORE_MAX_FILE_BYTES: '64' },
    }),
  });
  let server;
  try {
    await request(instance)
      .post('/admin/restore')
      .attach('backup', Buffer.from('not a dump'), 'file.dump')
      .expect(400);
    await request(instance)
      .post('/admin/restore')
      .attach('backup', Buffer.alloc(65), 'file.dump')
      .expect(400);
    assert.equal(failures, 2);
    assert.deepEqual(await fs.readdir(root), []);
    await new Promise((resolve) => {
      server = instance.listen(0, resolve);
    });
    const req = http.request({
      host: '127.0.0.1',
      port: server.address().port,
      method: 'POST',
      path: '/admin/restore',
      headers: {
        'content-type': 'multipart/form-data; boundary=test-boundary',
      },
    });
    req.on('error', () => {});
    req.write(
      '--test-boundary\r\nContent-Disposition: form-data; name="backup"; filename="file.dump"\r\nContent-Type: application/octet-stream\r\n\r\nPGDMP'
    );
    await until(async () => (await fs.readdir(root)).length > 0);
    req.destroy();
    await until(
      async () => failures === 3 && (await fs.readdir(root)).length === 0
    );
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
});
