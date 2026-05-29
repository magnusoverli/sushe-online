const test = require('node:test');
const assert = require('node:assert');
const registerLastfmRoutes = require('../routes/oauth/lastfm');

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
    redirectedTo: null,
    jsonBody: null,
    redirect(url) {
      this.redirectedTo = url;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.jsonBody = body;
    },
  };
}

test('Last.fm auth start stores state and includes it in callback URL', async () => {
  const previousApiKey = process.env.LASTFM_API_KEY;
  const previousBaseUrl = process.env.BASE_URL;
  process.env.LASTFM_API_KEY = 'api-key';
  process.env.BASE_URL = 'https://example.test';

  try {
    const app = createAppRecorder();
    registerLastfmRoutes(app, {
      ensureAuth: (_req, _res, next) => next(),
      userService: {
        setLastfmAuth: async () => {},
        clearLastfmAuth: async () => {},
      },
    });

    const route = app.find('GET', '/auth/lastfm');
    const req = {
      session: {},
      user: { _id: 'user1', email: 'user@example.test' },
      flash: () => {},
    };
    const res = createResponse();

    await runHandlers(route.handlers, req, res);

    assert.match(req.session.lastfmAuthState, /^[a-f0-9]{32}$/);
    assert.ok(res.redirectedTo.includes('https://www.last.fm/api/auth/'));
    assert.ok(
      decodeURIComponent(res.redirectedTo).includes(
        `/auth/lastfm/callback/${req.session.lastfmAuthState}`
      )
    );
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.LASTFM_API_KEY;
    } else {
      process.env.LASTFM_API_KEY = previousApiKey;
    }
    if (previousBaseUrl === undefined) {
      delete process.env.BASE_URL;
    } else {
      process.env.BASE_URL = previousBaseUrl;
    }
  }
});

test('Last.fm callback rejects invalid auth state', async () => {
  const app = createAppRecorder();
  let setAuthCalled = false;
  const flashes = [];
  registerLastfmRoutes(app, {
    ensureAuth: (_req, _res, next) => next(),
    userService: {
      setLastfmAuth: async () => {
        setAuthCalled = true;
      },
      clearLastfmAuth: async () => {},
    },
  });

  const route = app.find('GET', '/auth/lastfm/callback/:state');
  const req = {
    params: { state: 'bad-state' },
    query: { token: 'token' },
    session: { lastfmAuthState: 'expected-state' },
    user: { _id: 'user1' },
    flash: (...args) => flashes.push(args),
  };
  const res = createResponse();

  await runHandlers(route.handlers, req, res);

  assert.strictEqual(setAuthCalled, false);
  assert.strictEqual(req.session.lastfmAuthState, undefined);
  assert.strictEqual(res.redirectedTo, '/');
  assert.match(flashes[0][1], /invalid state/);
});

test('Last.fm callback starts a full playcount refresh without wiping the cache', async () => {
  const app = createAppRecorder();
  const calls = [];
  const flashes = [];
  let invalidateCalls = 0;
  registerLastfmRoutes(app, {
    ensureAuth: (_req, _res, next) => next(),
    db: {},
    getLastfmSession: async () => ({
      session_key: 'session-key',
      username: 'listener',
    }),
    invalidateUserPlaycounts: async () => {
      invalidateCalls++;
      return 2;
    },
    syncUserPlaycounts: async (_db, _logger, user) => {
      calls.push(['sync', user]);
      return { synced: 2 };
    },
    userService: {
      setLastfmAuth: async (userId, auth, username) => {
        calls.push(['setAuth', userId, auth.session_key, username]);
      },
      clearLastfmAuth: async () => {},
    },
  });

  const route = app.find('GET', '/auth/lastfm/callback/:state');
  const req = {
    params: { state: 'expected-state' },
    query: { token: 'token' },
    session: { lastfmAuthState: 'expected-state' },
    user: { _id: 'user1', email: 'user@example.test' },
    flash: (...args) => flashes.push(args),
  };
  const res = createResponse();

  await runHandlers(route.handlers, req, res);

  assert.strictEqual(res.redirectedTo, '/');
  // Reconnect must NOT delete cached playcounts (that caused a blank gap).
  assert.strictEqual(invalidateCalls, 0);
  assert.deepStrictEqual(calls[0], [
    'setAuth',
    'user1',
    'session-key',
    'listener',
  ]);
  assert.deepStrictEqual(calls[1], [
    'sync',
    {
      _id: 'user1',
      username: 'listener',
      lastfm_username: 'listener',
    },
  ]);
  assert.match(flashes[0][1], /Connected to Last\.fm/);
});

test('Last.fm disconnect uses POST and GET does not mutate auth', async () => {
  const app = createAppRecorder();
  let clearCalls = 0;
  let csrfCalls = 0;
  let invalidateCalls = 0;
  registerLastfmRoutes(app, {
    ensureAuth: (_req, _res, next) => next(),
    csrfProtection: (_req, _res, next) => {
      csrfCalls++;
      next();
    },
    db: {},
    invalidateUserPlaycounts: async () => {
      invalidateCalls++;
    },
    userService: {
      setLastfmAuth: async () => {},
      clearLastfmAuth: async () => {
        clearCalls++;
      },
    },
  });

  const req = {
    user: { _id: 'user1', email: 'user@example.test' },
    flash: () => {},
  };
  const getRes = createResponse();
  await runHandlers(
    app.find('GET', '/auth/lastfm/disconnect').handlers,
    req,
    getRes
  );

  assert.strictEqual(clearCalls, 0);
  assert.strictEqual(getRes.redirectedTo, '/');

  const postRes = createResponse();
  await runHandlers(
    app.find('POST', '/auth/lastfm/disconnect').handlers,
    req,
    postRes
  );

  assert.strictEqual(csrfCalls, 1);
  assert.strictEqual(clearCalls, 1);
  assert.strictEqual(invalidateCalls, 1);
  assert.deepStrictEqual(postRes.jsonBody, { success: true });
});
