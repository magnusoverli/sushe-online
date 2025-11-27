/**
 * Integration Tests for Password Change & Admin Request
 * Tests change password and admin code validation endpoints
 */

const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const request = require('supertest');
const session = require('express-session');

// Mock logger
const mockLogger = {
  error: mock.fn(),
  warn: mock.fn(),
  info: mock.fn(),
  debug: mock.fn(),
};

require.cache[require.resolve('../utils/logger')] = {
  exports: mockLogger,
};

/**
 * Create a test Express app with password change routes
 */
function createTestApp(options = {}) {
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

  // Flash middleware
  app.use((req, res, next) => {
    if (!req.session.flash) {
      req.session.flash = {};
    }
    res.locals.flash = { ...req.session.flash };
    delete req.session.flash;

    req.flash = (type, message) => {
      if (!req.session.flash) req.session.flash = {};
      if (message === undefined) return req.session.flash[type] || [];
      if (!req.session.flash[type]) req.session.flash[type] = [];
      req.session.flash[type].push(message);
    };
    next();
  });

  // Mock user
  const mockUser = options.user || {
    _id: 'user-123',
    email: 'test@example.com',
    username: 'testuser',
    hash: 'existing-hash',
    role: options.isAdmin ? 'admin' : 'user',
  };

  // Auth middleware
  const ensureAuth = (req, res, next) => {
    if (options.authenticated === false) {
      return res.redirect('/login');
    }
    req.user = { ...mockUser };
    req.isAuthenticated = () => true;
    next();
  };

  const ensureAuthAPI = (req, res, next) => {
    if (options.authenticated === false) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = { ...mockUser };
    req.isAuthenticated = () => true;
    next();
  };

  // Mock users datastore
  const mockUsers = {
    findOne:
      options.usersFindOne ||
      mock.fn((query, callback) => {
        callback(null, null);
      }),
    update:
      options.usersUpdate ||
      mock.fn((query, update, opts, callback) => {
        callback(null, 1);
      }),
  };

  // Mock bcrypt
  const mockBcrypt = {
    hash: mock.fn(() => Promise.resolve('new-hashed-password')),
    compare: options.bcryptCompare || mock.fn(() => Promise.resolve(true)),
  };

  // Admin code tracking
  const mockAdminCodeAttempts = options.adminCodeAttempts || new Map();
  const mockAdminCode = options.adminCode || 'VALID123';
  const mockAdminCodeExpiry =
    options.adminCodeExpiry || new Date(Date.now() + 3600000);
  const mockGenerateAdminCode = mock.fn();

  // Rate limit admin request middleware
  const rateLimitAdminRequest = (req, res, next) => {
    const attempts = mockAdminCodeAttempts.get(req.user._id) || {
      count: 0,
      lastAttempt: Date.now(),
    };
    req.adminAttempts = attempts;
    next();
  };

  // Mock templates
  const mockHtmlTemplate = (content, title) =>
    `<html><head><title>${title}</title></head><body>${content}</body></html>`;
  const mockSettingsTemplate = () => '<div>Settings</div>';
  const mockRegisterTemplate = () => '<form>Register</form>';
  const mockLoginTemplate = () => '<form>Login</form>';
  const mockSpotifyTemplate = () => '<div>Spotify</div>';

  // CSRF mock
  const csrfProtection = (req, res, next) => {
    req.csrfToken = () => 'mock-csrf-token';
    next();
  };

  // Mock validators
  const {
    isValidEmail,
    isValidUsername,
    isValidPassword,
  } = require('../validators');

  // Mock async datastores
  const mockUsersAsync = {
    findOne: mock.fn(() => Promise.resolve(null)),
    insert: mock.fn(() => Promise.resolve({ _id: 'new-user' })),
  };

  const mockListsAsync = {
    find: mock.fn(() => Promise.resolve([])),
  };

  const mockListItemsAsync = {
    count: mock.fn(() => Promise.resolve(0)),
  };

  // Mock pool
  const mockPool = {
    query: mock.fn(() => Promise.resolve({ rows: [], rowCount: 0 })),
  };

  // Create deps object - mimics what auth routes expect
  const deps = {
    csrfProtection,
    ensureAuth,
    ensureAuthAPI,
    rateLimitAdminRequest,
    users: mockUsers,
    usersAsync: mockUsersAsync,
    listsAsync: mockListsAsync,
    listItemsAsync: mockListItemsAsync,
    pool: mockPool,
    passport: {
      authenticate: () => (req, res, next) => next(),
    },
    sanitizeUser: (user) => ({
      _id: user._id,
      username: user.username,
      email: user.email,
      role: user.role,
    }),
    crypto: require('crypto'),
    bcrypt: mockBcrypt,
    isValidEmail,
    isValidUsername,
    isValidPassword,
    htmlTemplate: mockHtmlTemplate,
    registerTemplate: mockRegisterTemplate,
    loginTemplate: mockLoginTemplate,
    spotifyTemplate: mockSpotifyTemplate,
    settingsTemplate: mockSettingsTemplate,
    isTokenValid: () => true,
    isTokenUsable: () => true,
    adminCodeAttempts: mockAdminCodeAttempts,
    adminCode: mockAdminCode,
    adminCodeExpiry: mockAdminCodeExpiry,
    generateAdminCode: mockGenerateAdminCode,
  };

  // Import and setup routes
  const authRoutes = require('../routes/auth');
  authRoutes(app, deps);

  // Error handler
  app.use((err, req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });

  return {
    app,
    mockUsers,
    mockBcrypt,
    mockAdminCodeAttempts,
    mockGenerateAdminCode,
  };
}

// ============ POST /settings/change-password TESTS ============

describe('POST /settings/change-password', () => {
  it('should change password with valid inputs', async () => {
    const { app, mockUsers, mockBcrypt } = createTestApp();

    const response = await request(app).post('/settings/change-password').send({
      currentPassword: 'oldpassword123',
      newPassword: 'newpassword123',
      confirmPassword: 'newpassword123',
    });

    assert.strictEqual(response.status, 302);
    assert.strictEqual(response.headers.location, '/settings');
    assert.strictEqual(mockBcrypt.compare.mock.calls.length, 1);
    assert.strictEqual(mockBcrypt.hash.mock.calls.length, 1);
    assert.strictEqual(mockUsers.update.mock.calls.length, 1);
  });

  it('should reject missing current password', async () => {
    const { app } = createTestApp();

    const response = await request(app).post('/settings/change-password').send({
      currentPassword: '',
      newPassword: 'newpassword123',
      confirmPassword: 'newpassword123',
    });

    assert.strictEqual(response.status, 302);
    assert.strictEqual(response.headers.location, '/settings');
  });

  it('should reject missing new password', async () => {
    const { app } = createTestApp();

    const response = await request(app).post('/settings/change-password').send({
      currentPassword: 'oldpassword123',
      newPassword: '',
      confirmPassword: 'newpassword123',
    });

    assert.strictEqual(response.status, 302);
    assert.strictEqual(response.headers.location, '/settings');
  });

  it('should reject missing confirm password', async () => {
    const { app } = createTestApp();

    const response = await request(app).post('/settings/change-password').send({
      currentPassword: 'oldpassword123',
      newPassword: 'newpassword123',
      confirmPassword: '',
    });

    assert.strictEqual(response.status, 302);
    assert.strictEqual(response.headers.location, '/settings');
  });

  it('should reject mismatched passwords', async () => {
    const { app } = createTestApp();

    const response = await request(app).post('/settings/change-password').send({
      currentPassword: 'oldpassword123',
      newPassword: 'newpassword123',
      confirmPassword: 'differentpassword',
    });

    assert.strictEqual(response.status, 302);
    assert.strictEqual(response.headers.location, '/settings');
  });

  it('should reject short new password (<8 chars)', async () => {
    const { app } = createTestApp();

    const response = await request(app).post('/settings/change-password').send({
      currentPassword: 'oldpassword123',
      newPassword: 'short',
      confirmPassword: 'short',
    });

    assert.strictEqual(response.status, 302);
    assert.strictEqual(response.headers.location, '/settings');
  });

  it('should reject incorrect current password', async () => {
    const { app } = createTestApp({
      bcryptCompare: mock.fn(() => Promise.resolve(false)),
    });

    const response = await request(app).post('/settings/change-password').send({
      currentPassword: 'wrongpassword',
      newPassword: 'newpassword123',
      confirmPassword: 'newpassword123',
    });

    assert.strictEqual(response.status, 302);
    assert.strictEqual(response.headers.location, '/settings');
    // The bcryptCompare mock was passed in options, not attached to mockBcrypt
  });

  it('should hash new password with bcrypt (cost 12)', async () => {
    const { app, mockBcrypt } = createTestApp();

    await request(app).post('/settings/change-password').send({
      currentPassword: 'oldpassword123',
      newPassword: 'newpassword123',
      confirmPassword: 'newpassword123',
    });

    assert.strictEqual(mockBcrypt.hash.mock.calls.length, 1);
    assert.strictEqual(
      mockBcrypt.hash.mock.calls[0].arguments[0],
      'newpassword123'
    );
    assert.strictEqual(mockBcrypt.hash.mock.calls[0].arguments[1], 12);
  });

  it('should require authentication', async () => {
    const { app } = createTestApp({ authenticated: false });

    const response = await request(app).post('/settings/change-password').send({
      currentPassword: 'oldpassword123',
      newPassword: 'newpassword123',
      confirmPassword: 'newpassword123',
    });

    assert.strictEqual(response.status, 302);
    assert.ok(response.headers.location.includes('/login'));
  });

  it('should handle database errors', async () => {
    const { app } = createTestApp({
      usersUpdate: mock.fn((q, u, o, callback) => {
        callback(new Error('Database error'));
      }),
    });

    const response = await request(app).post('/settings/change-password').send({
      currentPassword: 'oldpassword123',
      newPassword: 'newpassword123',
      confirmPassword: 'newpassword123',
    });

    assert.strictEqual(response.status, 302);
    assert.strictEqual(response.headers.location, '/settings');
  });
});

// ============ POST /settings/request-admin TESTS ============

describe('POST /settings/request-admin', () => {
  it('should grant admin with valid code', async () => {
    const { app, mockUsers, mockGenerateAdminCode } = createTestApp({
      adminCode: 'VALID123',
      adminCodeExpiry: new Date(Date.now() + 3600000),
    });

    const response = await request(app)
      .post('/settings/request-admin')
      .send({ code: 'VALID123' });

    assert.strictEqual(response.status, 302);
    assert.strictEqual(response.headers.location, '/settings');
    assert.strictEqual(mockUsers.update.mock.calls.length, 1);

    // Should grant admin role
    const updateCall = mockUsers.update.mock.calls[0];
    assert.strictEqual(updateCall.arguments[1].$set.role, 'admin');
    assert.ok(updateCall.arguments[1].$set.adminGrantedAt);

    // Should regenerate code
    assert.strictEqual(mockGenerateAdminCode.mock.calls.length, 1);
  });

  it('should accept code case-insensitively', async () => {
    const { app, mockUsers } = createTestApp({
      adminCode: 'VALID123',
      adminCodeExpiry: new Date(Date.now() + 3600000),
    });

    const response = await request(app)
      .post('/settings/request-admin')
      .send({ code: 'valid123' });

    assert.strictEqual(response.status, 302);
    assert.strictEqual(mockUsers.update.mock.calls.length, 1);
  });

  it('should reject invalid code', async () => {
    const { app, mockUsers, mockAdminCodeAttempts } = createTestApp({
      adminCode: 'VALID123',
      adminCodeExpiry: new Date(Date.now() + 3600000),
    });

    const response = await request(app)
      .post('/settings/request-admin')
      .send({ code: 'WRONGCODE' });

    assert.strictEqual(response.status, 302);
    assert.strictEqual(response.headers.location, '/settings');
    // Should NOT update user role
    assert.strictEqual(mockUsers.update.mock.calls.length, 0);
    // Should increment failed attempts
    assert.ok(mockAdminCodeAttempts.get('user-123'));
  });

  it('should reject expired code', async () => {
    const { app, mockUsers } = createTestApp({
      adminCode: 'VALID123',
      adminCodeExpiry: new Date(Date.now() - 60000), // Expired 1 minute ago
    });

    const response = await request(app)
      .post('/settings/request-admin')
      .send({ code: 'VALID123' });

    assert.strictEqual(response.status, 302);
    // Should NOT update user role
    assert.strictEqual(mockUsers.update.mock.calls.length, 0);
  });

  it('should reject empty code', async () => {
    const { app, mockUsers } = createTestApp();

    const response = await request(app)
      .post('/settings/request-admin')
      .send({ code: '' });

    assert.strictEqual(response.status, 302);
    assert.strictEqual(mockUsers.update.mock.calls.length, 0);
  });

  it('should track failed attempts', async () => {
    const mockAttempts = new Map();
    const { app } = createTestApp({
      adminCode: 'VALID123',
      adminCodeExpiry: new Date(Date.now() + 3600000),
      adminCodeAttempts: mockAttempts,
    });

    await request(app).post('/settings/request-admin').send({ code: 'WRONG1' });

    const attempts = mockAttempts.get('user-123');
    assert.ok(attempts);
    assert.strictEqual(attempts.count, 1);
  });

  it('should clear failed attempts on success', async () => {
    const mockAttempts = new Map();
    mockAttempts.set('user-123', { count: 3, lastAttempt: Date.now() });

    const { app } = createTestApp({
      adminCode: 'VALID123',
      adminCodeExpiry: new Date(Date.now() + 3600000),
      adminCodeAttempts: mockAttempts,
    });

    await request(app)
      .post('/settings/request-admin')
      .send({ code: 'VALID123' });

    assert.strictEqual(mockAttempts.has('user-123'), false);
  });

  it('should require authentication', async () => {
    const { app } = createTestApp({ authenticated: false });

    const response = await request(app)
      .post('/settings/request-admin')
      .send({ code: 'VALID123' });

    assert.strictEqual(response.status, 302);
    assert.ok(response.headers.location.includes('/login'));
  });

  it('should handle database errors', async () => {
    const { app } = createTestApp({
      adminCode: 'VALID123',
      adminCodeExpiry: new Date(Date.now() + 3600000),
      usersUpdate: mock.fn((q, u, o, callback) => {
        callback(new Error('Database error'));
      }),
    });

    const response = await request(app)
      .post('/settings/request-admin')
      .send({ code: 'VALID123' });

    assert.strictEqual(response.status, 302);
    assert.strictEqual(response.headers.location, '/settings');
  });
});
