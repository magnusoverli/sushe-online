const { test, mock } = require('node:test');
const assert = require('node:assert');
const registerLastfmApiRoutes = require('../routes/api/lastfm');
const { createMockLogger, createMockDb } = require('./helpers');

function createAppRecorder() {
  const routes = [];
  return {
    get(path, ...handlers) {
      routes.push({ method: 'GET', path, handlers });
    },
    post(path, ...handlers) {
      routes.push({ method: 'POST', path, handlers });
    },
    find(method, path) {
      return routes.find(
        (route) => route.method === method && route.path === path
      );
    },
  };
}

async function runHandlers(handlers, req, res) {
  let index = 0;
  async function next() {
    const handler = handlers[index++];
    if (!handler) return;
    if (handler.length >= 3) {
      return handler(req, res, next);
    }
    return handler(req, res);
  }
  await next();
}

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
    },
  };
}

function registerRoutes(overrides = {}) {
  const app = createAppRecorder();
  const deps = {
    ensureAuthAPI: (_req, _res, next) => next(),
    requireLastfmAuth: (_req, _res, next) => next(),
    requireLastfmSessionKey: (_req, _res, next) => next(),
    db: createMockDb(),
    logger: createMockLogger(),
    normalizeAlbumKey: (artist, album) => `${artist}::${album}`,
    refreshPlaycountsInBackground: mock.fn(async () => ({})),
    getLastfmTopAlbums: mock.fn(async () => []),
    getLastfmAlbumInfo: mock.fn(async () => ({})),
    lastfmScrobble: mock.fn(async () => ({
      scrobbles: { '@attr': { accepted: 1 } },
    })),
    lastfmUpdateNowPlaying: mock.fn(async () => ({ nowplaying: {} })),
    getLastfmSimilarArtists: mock.fn(async () => []),
    getLastfmRecentTracks: mock.fn(async () => []),
    ...overrides,
  };
  registerLastfmApiRoutes(app, deps);
  return { app, deps };
}

function createLastfmReq(body = {}) {
  return {
    body,
    user: {
      _id: 'user1',
      lastfmUsername: 'listener',
      lastfmAuth: { session_key: 'session-key' },
    },
  };
}

test('Last.fm scrobble returns structured 503 when server credentials are missing', async () => {
  const previousApiKey = process.env.LASTFM_API_KEY;
  const previousSecret = process.env.LASTFM_SECRET;
  delete process.env.LASTFM_API_KEY;
  delete process.env.LASTFM_SECRET;

  try {
    const { app, deps } = registerRoutes();
    const res = createResponse();

    await runHandlers(
      app.find('POST', '/api/lastfm/scrobble').handlers,
      createLastfmReq({ artist: 'A', track: 'T' }),
      res
    );

    assert.strictEqual(res.statusCode, 503);
    assert.deepStrictEqual(res.body, {
      error: 'Last.fm is not configured on this server',
      code: 'SERVICE_NOT_CONFIGURED',
      service: 'lastfm',
      retryable: false,
    });
    assert.strictEqual(deps.lastfmScrobble.mock.calls.length, 0);
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.LASTFM_API_KEY;
    } else {
      process.env.LASTFM_API_KEY = previousApiKey;
    }
    if (previousSecret === undefined) {
      delete process.env.LASTFM_SECRET;
    } else {
      process.env.LASTFM_SECRET = previousSecret;
    }
  }
});

test('Last.fm now-playing maps invalid API key errors to non-retryable 503', async () => {
  const previousApiKey = process.env.LASTFM_API_KEY;
  const previousSecret = process.env.LASTFM_SECRET;
  process.env.LASTFM_API_KEY = 'bad-key';
  process.env.LASTFM_SECRET = 'bad-secret';

  try {
    const error = new Error('Invalid API key');
    error.lastfmCode = 10;
    const { app } = registerRoutes({
      lastfmUpdateNowPlaying: mock.fn(async () => {
        throw error;
      }),
    });
    const res = createResponse();

    await runHandlers(
      app.find('POST', '/api/lastfm/now-playing').handlers,
      createLastfmReq({ artist: 'A', track: 'T' }),
      res
    );

    assert.strictEqual(res.statusCode, 503);
    assert.deepStrictEqual(res.body, {
      error: 'Last.fm server credentials are invalid',
      code: 'LASTFM_INVALID_API_KEY',
      service: 'lastfm',
      retryable: false,
    });
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.LASTFM_API_KEY;
    } else {
      process.env.LASTFM_API_KEY = previousApiKey;
    }
    if (previousSecret === undefined) {
      delete process.env.LASTFM_SECRET;
    } else {
      process.env.LASTFM_SECRET = previousSecret;
    }
  }
});
