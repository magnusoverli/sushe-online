const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const request = require('supertest');

const registerProxyRoutes = require('../routes/api/proxies');
const { createMockLogger } = require('./helpers');

const passThrough = (_req, _res, next) => next();

function jsonResponse({
  status = 200,
  contentType = 'application/json',
  body,
}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (h) => (h.toLowerCase() === 'content-type' ? contentType : null),
    },
    json: async () => {
      if (body instanceof Error) throw body;
      return body;
    },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function createApp({ mbFetch, fetch: fetchDep }) {
  const app = express();
  app.use(express.json());
  const logger = createMockLogger();

  registerProxyRoutes(app, {
    ensureAuthAPI: (req, _res, next) => {
      req.user = { _id: 'user-1' };
      next();
    },
    logger,
    fetch: fetchDep || mock.fn(),
    sharp: mock.fn(),
    mbFetch: mbFetch || mock.fn(),
    imageProxyQueue: { add: (fn) => fn() },
    itunesProxyQueue: { add: (fn) => fn() },
    cacheConfigs: {
      public: passThrough,
      images: passThrough,
      static: passThrough,
    },
  });

  return { app, logger };
}

describe('proxy routes: upstream failures', () => {
  it('passes a MusicBrainz 503 through to the client', async () => {
    const { app } = createApp({
      mbFetch: async () => jsonResponse({ status: 503, body: {} }),
    });

    const res = await request(app).get(
      '/api/proxy/musicbrainz?endpoint=artist/1'
    );

    assert.strictEqual(res.status, 503);
    assert.strictEqual(res.body.upstreamStatus, 503);
  });

  it('passes a MusicBrainz 429 through so callers can distinguish throttling', async () => {
    const { app } = createApp({
      mbFetch: async () => jsonResponse({ status: 429, body: {} }),
    });

    const res = await request(app).get(
      '/api/proxy/musicbrainz?endpoint=artist/1'
    );

    assert.strictEqual(res.status, 429);
  });

  it('answers 500 when the upstream returns 200 with an unusable body', async () => {
    // A 200 carrying HTML says nothing a client could act on, so it stays a
    // server-side failure rather than being reported as an upstream status.
    const { app, logger } = createApp({
      mbFetch: async () =>
        jsonResponse({ status: 200, contentType: 'text/html', body: '<html>' }),
    });

    const res = await request(app).get(
      '/api/proxy/musicbrainz?endpoint=artist/1'
    );

    assert.strictEqual(res.status, 500);
    // The diagnostics collected at the throw site must still reach the log.
    const warned = logger.warn.mock.calls.map((c) => c.arguments[1] || {});
    assert.ok(
      warned.some((meta) => meta.contentType === 'text/html'),
      'expected the offending content-type to be logged'
    );
  });

  it('still returns data on a healthy upstream response', async () => {
    const { app } = createApp({
      mbFetch: async () => jsonResponse({ status: 200, body: { artists: [] } }),
    });

    const res = await request(app).get(
      '/api/proxy/musicbrainz?endpoint=artist/1'
    );

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { artists: [] });
  });
});
