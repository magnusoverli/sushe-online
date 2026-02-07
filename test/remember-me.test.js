const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const request = require('supertest');
const session = require('express-session');

// Mock logger to avoid file operations
const mockLogger = {
  error: mock.fn(),
  warn: mock.fn(),
  info: mock.fn(),
  debug: mock.fn(),
};

require.cache[require.resolve('../utils/logger')] = {
  exports: mockLogger,
};

// Mock metrics to prevent prom-client timers from keeping process alive
require.cache[require.resolve('../utils/metrics')] = {
  exports: {
    recordAuthAttempt: mock.fn(),
    observeExternalApiCall: mock.fn(),
    recordExternalApiError: mock.fn(),
    observeDbQuery: mock.fn(),
    incWebsocketConnections: mock.fn(),
    decWebsocketConnections: mock.fn(),
    updateDbPoolMetrics: mock.fn(),
    metricsMiddleware: () => (req, res, next) => next(),
  },
};

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Mirror production default: 24h session cookie
  app.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: true,
      cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 },
    })
  );

  // Flash shim (auth routes use req.flash)
  app.use((req, res, next) => {
    if (!req.session.flash) req.session.flash = {};
    res.locals.flash = { ...req.session.flash };
    delete req.session.flash;
    req.flash = (type, message) => {
      if (!req.session.flash) req.session.flash = {};
      if (!req.session.flash[type]) req.session.flash[type] = [];
      req.session.flash[type].push(message);
    };
    next();
  });

  // Passport shims (in the real app these are provided by passport middleware)
  app.use((req, _res, next) => {
    req.isAuthenticated = () => !!req.session.userId;
    req.logIn = (user, cb) => {
      req.session.userId = user._id;
      req.user = user;
      cb();
    };
    req.logout = (cb) => {
      delete req.session.userId;
      delete req.user;
      cb();
    };
    next();
  });

  const testUser = { _id: 'user-1', email: 'test@example.com' };

  const mockUsers = { update: mock.fn((_q, _u, _o, cb) => cb(null, 1)) };
  const mockUsersAsync = {
    update: mock.fn(async () => 1),
    findOne: mock.fn(async () => testUser),
    insert: mock.fn(async () => ({ _id: 'new-user' })),
  };
  const mockBcrypt = { hash: mock.fn(), compare: mock.fn() };

  // Create service instances
  const { createAuthService } = require('../services/auth-service');
  const { createUserService } = require('../services/user-service');

  const authService = createAuthService({
    usersAsync: mockUsersAsync,
    bcrypt: mockBcrypt,
    logger: mockLogger,
  });
  const userService = createUserService({
    users: mockUsers,
    usersAsync: mockUsersAsync,
    logger: mockLogger,
  });

  const deps = {
    csrfProtection: (req, res, next) => next(),
    ensureAuth: (req, res, next) => {
      if (!req.isAuthenticated()) return res.redirect('/login');
      next();
    },
    ensureAuthAPI: (req, res, next) => next(),
    rateLimitAdminRequest: (req, res, next) => next(),
    htmlTemplate: (content) => content,
    registerTemplate: () => '<div>register</div>',
    loginTemplate: () => '<div>login</div>',
    spotifyTemplate: () => '<div>home</div>',
    extensionAuthTemplate: () => '<html>Extension Auth</html>',
    isTokenValid: () => true,
    isTokenUsable: () => true,
    users: mockUsers,
    usersAsync: mockUsersAsync,
    listsAsync: {
      find: mock.fn(async () => []),
      count: mock.fn(async () => 0),
    },
    listItemsAsync: {
      count: mock.fn(async () => 0),
      find: mock.fn(async () => []),
    },
    bcrypt: mockBcrypt,
    isValidEmail: () => true,
    isValidUsername: () => true,
    isValidPassword: () => true,
    sanitizeUser: (u) => u,
    authService,
    userService,
    adminCodeState: {
      adminCodeAttempts: new Map(),
      get adminCode() {
        return 'TESTCODE';
      },
      get adminCodeExpiry() {
        return new Date(Date.now() + 60_000);
      },
      generateAdminCode: mock.fn(),
      lastCodeUsedBy: null,
      lastCodeUsedAt: null,
    },
    pool: { query: mock.fn(async () => ({ rows: [], rowCount: 0 })) },
    passport: {
      authenticate: (_strategy, callback) => (req, _res, _next) => {
        const { email, password } = req.body;
        if (email === 'test@example.com' && password === 'password123') {
          return callback(null, testUser, null);
        }
        return callback(null, false, { message: 'Invalid email or password' });
      },
    },
  };

  require('../routes/auth')(app, deps);

  return { app };
}

function parseSetCookieMaxAgeSeconds(setCookieValue) {
  const maxAgeMatch = setCookieValue.match(/Max-Age=(\d+)/i);
  if (maxAgeMatch) return parseInt(maxAgeMatch[1], 10);

  const expiresMatch = setCookieValue.match(/Expires=([^;]+)/i);
  if (expiresMatch) {
    const expiresAt = Date.parse(expiresMatch[1]);
    if (!Number.isNaN(expiresAt)) {
      return Math.round((expiresAt - Date.now()) / 1000);
    }
  }

  return null;
}

describe('Remember me (session cookie lifetime)', () => {
  it('should extend cookie lifetime when remember is checked', async () => {
    const { app } = createTestApp();
    const agent = request.agent(app);

    const res = await agent.post('/login').send({
      email: 'test@example.com',
      password: 'password123',
      remember: 'on',
    });

    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, '/');
    assert.ok(Array.isArray(res.headers['set-cookie']));

    const maxAgeSeconds = parseSetCookieMaxAgeSeconds(
      res.headers['set-cookie'][0]
    );
    assert.ok(maxAgeSeconds !== null);
    // Expect ~30 days (allow a little drift for timing and rounding)
    assert.ok(maxAgeSeconds > 25 * 24 * 60 * 60);
  });

  it('should keep default cookie lifetime when remember is not checked', async () => {
    const { app } = createTestApp();
    const agent = request.agent(app);

    const res = await agent.post('/login').send({
      email: 'test@example.com',
      password: 'password123',
    });

    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, '/');
    assert.ok(Array.isArray(res.headers['set-cookie']));

    const maxAgeSeconds = parseSetCookieMaxAgeSeconds(
      res.headers['set-cookie'][0]
    );
    assert.ok(maxAgeSeconds !== null);
    // Expect ~24 hours
    assert.ok(maxAgeSeconds > 20 * 60 * 60);
    assert.ok(maxAgeSeconds < 36 * 60 * 60);
  });
});
