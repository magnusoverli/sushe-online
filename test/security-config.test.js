const { describe, it } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const request = require('supertest');
const { createCorsMiddleware } = require('../config/security.js');

function restoreEnv(originalEnv) {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }

  for (const [key, value] of Object.entries(originalEnv)) {
    process.env[key] = value;
  }
}

function createCorsTestApp() {
  const app = express();
  app.use(createCorsMiddleware());
  app.get('/ok', (_req, res) => {
    res.json({ ok: true });
  });
  app.use((err, _req, res, _next) => {
    res.status(403).json({ error: err.message });
  });
  return app;
}

describe('config/security createCorsMiddleware', () => {
  it('allows unknown https origin by default for backwards compatibility', async () => {
    const originalEnv = { ...process.env };
    delete process.env.CORS_STRICT_MODE;
    delete process.env.ALLOWED_ORIGINS;

    const app = createCorsTestApp();
    const response = await request(app)
      .get('/ok')
      .set('Origin', 'https://random.example.com')
      .expect(200);

    assert.strictEqual(
      response.headers['access-control-allow-origin'],
      'https://random.example.com'
    );

    restoreEnv(originalEnv);
  });

  it('blocks unknown https origin in strict mode', async () => {
    const originalEnv = { ...process.env };
    process.env.CORS_STRICT_MODE = 'true';
    delete process.env.ALLOWED_ORIGINS;

    const app = createCorsTestApp();
    const response = await request(app)
      .get('/ok')
      .set('Origin', 'https://random.example.com')
      .expect(403);

    assert.match(response.body.error, /Not allowed by CORS/);

    restoreEnv(originalEnv);
  });

  it('allows allowlisted origin in strict mode', async () => {
    const originalEnv = { ...process.env };
    process.env.CORS_STRICT_MODE = 'true';
    process.env.ALLOWED_ORIGINS = 'https://admin.example.com';

    const app = createCorsTestApp();
    const response = await request(app)
      .get('/ok')
      .set('Origin', 'https://admin.example.com')
      .expect(200);

    assert.strictEqual(
      response.headers['access-control-allow-origin'],
      'https://admin.example.com'
    );

    restoreEnv(originalEnv);
  });
});
