const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const request = require('supertest');
const session = require('express-session');

const mockLogger = {
  error: mock.fn(),
  warn: mock.fn(),
  info: mock.fn(),
  debug: mock.fn(),
};

require.cache[require.resolve('../utils/logger')] = {
  exports: mockLogger,
};

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
  app.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: true,
      cookie: { secure: false },
    })
  );

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

  const testUser = {
    _id: 'user-1',
    email: 'test@example.com',
    username: 'testuser',
    hash: 'hashed-password123',
    role: 'user',
  };

  app.use((req, _res, next) => {
    req.isAuthenticated = () => !!req.session.userId;
    if (req.session.userId === testUser._id) {
      req.user = { ...testUser };
    }
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

  const mockUsers = {
    update: mock.fn((_query, _update, _opts, cb) => cb(null, 1)),
  };
  const mockUsersAsync = {
    findOne: mock.fn(async (query) => {
      if (query.email === testUser.email) return testUser;
      return null;
    }),
    insert: mock.fn(async (doc) => ({ ...doc, _id: 'new-user' })),
    update: mock.fn(async () => 1),
  };
  const mockBcrypt = {
    hash: mock.fn(async (password) => `hashed-${password}`),
    compare: mock.fn(async () => true),
  };
  const mockPool = {
    query: mock.fn(async () => ({ rows: [], rowCount: 1 })),
  };

  const { createAuthService } = require('../services/auth-service');
  const { createUserService } = require('../services/user-service');

  const authService = createAuthService({
    db: mockPool,
    bcrypt: mockBcrypt,
    logger: mockLogger,
  });
  const userService = createUserService({
    db: mockPool,
    logger: mockLogger,
  });

  const deps = {
    csrfProtection: (req, _res, next) => {
      req.csrfToken = () => 'test-csrf-token';
      next();
    },
    ensureAuth: (req, res, next) => {
      if (!req.isAuthenticated()) return res.redirect('/login');
      return next();
    },
    ensureAuthAPI: (req, res, next) => {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      return next();
    },
    rateLimitAdminRequest: (_req, _res, next) => next(),
    users: mockUsers,
    usersAsync: mockUsersAsync,
    listsAsync: {
      find: mock.fn(async () => []),
      count: mock.fn(async () => 0),
    },
    listItemsAsync: {
      count: mock.fn(async () => 0),
    },
    pool: mockPool,
    passport: {
      authenticate: (_strategy, callback) => (req, _res, _next) => {
        const { email, password } = req.body;
        if (email === testUser.email && password === 'password123') {
          return callback(null, testUser, null);
        }
        return callback(null, false, { message: 'Invalid email or password' });
      },
    },
    sanitizeUser: (user) => user,
    crypto: require('crypto'),
    bcrypt: mockBcrypt,
    isValidEmail: () => true,
    isValidUsername: () => true,
    isValidPassword: () => true,
    htmlTemplate: (content) => content,
    registerTemplate: () => '<form>Register</form>',
    loginTemplate: () => '<form>Login</form>',
    spotifyTemplate: () => '<div>Home</div>',
    extensionAuthTemplate: () => '<div>Extension auth</div>',
    isTokenValid: () => true,
    isTokenUsable: () => true,
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
  };

  require('../routes/auth')(app, deps);
  return { app };
}

describe('auth routes no longer redirect to /mobile', () => {
  it('serves /register on mobile user-agent', async () => {
    const { app } = createTestApp();
    const response = await request(app)
      .get('/register')
      .set('User-Agent', 'iPhone');

    assert.strictEqual(response.status, 200);
    assert.ok(response.text.includes('Register'));
  });

  it('serves /login on mobile user-agent', async () => {
    const { app } = createTestApp();
    const response = await request(app)
      .get('/login')
      .set('User-Agent', 'iPhone');

    assert.strictEqual(response.status, 200);
    assert.ok(response.text.includes('Login'));
  });

  it('redirects login success to / for mobile user-agent', async () => {
    const { app } = createTestApp();
    const response = await request(app)
      .post('/login')
      .set('User-Agent', 'iPhone')
      .send({
        email: 'test@example.com',
        password: 'password123',
      });

    assert.strictEqual(response.status, 302);
    assert.strictEqual(response.headers.location, '/');
  });

  it('serves authenticated home on mobile user-agent', async () => {
    const { app } = createTestApp();
    const agent = request.agent(app);

    await agent.post('/login').set('User-Agent', 'iPhone').send({
      email: 'test@example.com',
      password: 'password123',
    });

    const response = await agent.get('/').set('User-Agent', 'iPhone');
    assert.strictEqual(response.status, 200);
    assert.ok(response.text.includes('Home'));
  });
});
