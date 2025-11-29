/**
 * Tests for middleware/auth.js
 * Tests authentication and authorization middleware
 */

const { describe, it, mock, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  sanitizeUser,
  recordActivity,
  ensureAuth,
  createEnsureAuthAPI,
  ensureAdmin,
  createRateLimitAdminRequest,
} = require('../middleware/auth.js');

// =============================================================================
// sanitizeUser tests
// =============================================================================

describe('sanitizeUser', () => {
  it('should return null for null input', () => {
    assert.strictEqual(sanitizeUser(null), null);
  });

  it('should return null for undefined input', () => {
    assert.strictEqual(sanitizeUser(undefined), null);
  });

  it('should return only safe user fields', () => {
    const user = {
      _id: 'user123',
      email: 'test@example.com',
      username: 'testuser',
      hash: 'secret_password_hash', // Should NOT be included
      accentColor: '#ff0000',
      lastSelectedList: 'mylist',
      role: 'admin',
      spotifyAuth: { access_token: 'secret' },
      tidalAuth: { access_token: 'secret' },
      musicService: 'spotify',
      timeFormat: '12h',
      dateFormat: 'DD/MM/YYYY',
      secretField: 'should not appear', // Should NOT be included
    };

    const sanitized = sanitizeUser(user);

    assert.strictEqual(sanitized._id, 'user123');
    assert.strictEqual(sanitized.email, 'test@example.com');
    assert.strictEqual(sanitized.username, 'testuser');
    assert.strictEqual(sanitized.accentColor, '#ff0000');
    assert.strictEqual(sanitized.lastSelectedList, 'mylist');
    assert.strictEqual(sanitized.role, 'admin');
    assert.strictEqual(sanitized.timeFormat, '12h');
    assert.strictEqual(sanitized.dateFormat, 'DD/MM/YYYY');
    assert.strictEqual(sanitized.musicService, 'spotify');

    // Should NOT include sensitive fields
    assert.strictEqual(sanitized.hash, undefined);
    assert.strictEqual(sanitized.secretField, undefined);
  });

  it('should convert spotifyAuth to boolean', () => {
    const userWithSpotify = { spotifyAuth: { access_token: 'abc' } };
    const userWithoutSpotify = { spotifyAuth: null };

    assert.strictEqual(sanitizeUser(userWithSpotify).spotifyAuth, true);
    assert.strictEqual(sanitizeUser(userWithoutSpotify).spotifyAuth, false);
  });

  it('should convert tidalAuth to boolean', () => {
    const userWithTidal = { tidalAuth: { access_token: 'abc' } };
    const userWithoutTidal = { tidalAuth: null };

    assert.strictEqual(sanitizeUser(userWithTidal).tidalAuth, true);
    assert.strictEqual(sanitizeUser(userWithoutTidal).tidalAuth, false);
  });

  it('should apply default timeFormat of 24h', () => {
    const user = { _id: 'user123' };
    const sanitized = sanitizeUser(user);

    assert.strictEqual(sanitized.timeFormat, '24h');
  });

  it('should apply default dateFormat of MM/DD/YYYY', () => {
    const user = { _id: 'user123' };
    const sanitized = sanitizeUser(user);

    assert.strictEqual(sanitized.dateFormat, 'MM/DD/YYYY');
  });

  it('should preserve custom timeFormat', () => {
    const user = { _id: 'user123', timeFormat: '12h' };
    const sanitized = sanitizeUser(user);

    assert.strictEqual(sanitized.timeFormat, '12h');
  });

  it('should preserve custom dateFormat', () => {
    const user = { _id: 'user123', dateFormat: 'DD/MM/YYYY' };
    const sanitized = sanitizeUser(user);

    assert.strictEqual(sanitized.dateFormat, 'DD/MM/YYYY');
  });

  it('should return null musicService when not set', () => {
    const user = { _id: 'user123' };
    const sanitized = sanitizeUser(user);

    assert.strictEqual(sanitized.musicService, null);
  });
});

// =============================================================================
// recordActivity tests
// =============================================================================

describe('recordActivity', () => {
  it('should update user lastActivity when user exists', () => {
    const mockUsers = {
      update: mock.fn(),
    };
    const req = {
      user: { _id: 'user123' },
    };

    const beforeTime = Date.now();
    recordActivity(req, mockUsers);
    const afterTime = Date.now();

    // Check that lastActivity was set on req.user
    assert.ok(req.user.lastActivity instanceof Date);
    assert.ok(req.user.lastActivity.getTime() >= beforeTime);
    assert.ok(req.user.lastActivity.getTime() <= afterTime);

    // Check that update was called
    assert.strictEqual(mockUsers.update.mock.calls.length, 1);
    const updateArgs = mockUsers.update.mock.calls[0].arguments;
    assert.deepStrictEqual(updateArgs[0], { _id: 'user123' });
    assert.ok(updateArgs[1].$set.lastActivity instanceof Date);
  });

  it('should not update when no user on request', () => {
    const mockUsers = {
      update: mock.fn(),
    };
    const req = {};

    recordActivity(req, mockUsers);

    assert.strictEqual(mockUsers.update.mock.calls.length, 0);
  });

  it('should not throw when user is null', () => {
    const mockUsers = {
      update: mock.fn(),
    };
    const req = { user: null };

    // Should not throw
    recordActivity(req, mockUsers);

    assert.strictEqual(mockUsers.update.mock.calls.length, 0);
  });
});

// =============================================================================
// ensureAuth tests
// =============================================================================

describe('ensureAuth', () => {
  it('should call next() when req.user exists', () => {
    const req = { user: { _id: 'user123' } };
    const res = { redirect: mock.fn() };
    const next = mock.fn();

    ensureAuth(req, res, next);

    assert.strictEqual(next.mock.calls.length, 1);
    assert.strictEqual(res.redirect.mock.calls.length, 0);
  });

  it('should call next() when isAuthenticated() returns true', () => {
    const req = {
      user: null,
      isAuthenticated: mock.fn(() => true),
    };
    const res = { redirect: mock.fn() };
    const next = mock.fn();

    ensureAuth(req, res, next);

    assert.strictEqual(next.mock.calls.length, 1);
    assert.strictEqual(res.redirect.mock.calls.length, 0);
  });

  it('should redirect to /login when not authenticated', () => {
    const req = {
      user: null,
      isAuthenticated: mock.fn(() => false),
    };
    const res = { redirect: mock.fn() };
    const next = mock.fn();

    ensureAuth(req, res, next);

    assert.strictEqual(next.mock.calls.length, 0);
    assert.strictEqual(res.redirect.mock.calls.length, 1);
    assert.strictEqual(res.redirect.mock.calls[0].arguments[0], '/login');
  });

  it('should redirect when no user and no isAuthenticated function', () => {
    const req = {};
    const res = { redirect: mock.fn() };
    const next = mock.fn();

    ensureAuth(req, res, next);

    assert.strictEqual(next.mock.calls.length, 0);
    assert.strictEqual(res.redirect.mock.calls.length, 1);
    assert.strictEqual(res.redirect.mock.calls[0].arguments[0], '/login');
  });

  it('should prioritize req.user over isAuthenticated', () => {
    const req = {
      user: { _id: 'user123' },
      isAuthenticated: mock.fn(() => false), // This should not be called
    };
    const res = { redirect: mock.fn() };
    const next = mock.fn();

    ensureAuth(req, res, next);

    assert.strictEqual(next.mock.calls.length, 1);
    // isAuthenticated should not be called when user exists
    assert.strictEqual(req.isAuthenticated.mock.calls.length, 0);
  });
});

// =============================================================================
// createEnsureAuthAPI tests
// =============================================================================

describe('createEnsureAuthAPI', () => {
  let mockUsersAsync;
  let mockPool;
  let mockValidateExtensionToken;
  let mockRecordActivity;
  let mockLogger;
  let ensureAuthAPI;

  beforeEach(() => {
    mockUsersAsync = {
      findOne: mock.fn(() =>
        Promise.resolve({ _id: 'user123', email: 'test@example.com' })
      ),
    };
    mockPool = {};
    mockValidateExtensionToken = mock.fn(() => Promise.resolve('user123'));
    mockRecordActivity = mock.fn();
    mockLogger = {
      error: mock.fn(),
      warn: mock.fn(),
      info: mock.fn(),
    };

    ensureAuthAPI = createEnsureAuthAPI({
      usersAsync: mockUsersAsync,
      pool: mockPool,
      validateExtensionToken: mockValidateExtensionToken,
      recordActivity: mockRecordActivity,
      logger: mockLogger,
    });
  });

  it('should call next() when session authenticated', async () => {
    const req = {
      isAuthenticated: mock.fn(() => true),
      get: mock.fn(),
    };
    const res = { status: mock.fn(() => ({ json: mock.fn() })) };
    const next = mock.fn();

    await ensureAuthAPI(req, res, next);

    assert.strictEqual(next.mock.calls.length, 1);
    assert.strictEqual(mockRecordActivity.mock.calls.length, 1);
  });

  it('should validate bearer token and load user', async () => {
    const req = {
      isAuthenticated: mock.fn(() => false),
      get: mock.fn((header) => {
        if (header === 'Authorization') return 'Bearer valid_token_here';
        return null;
      }),
    };
    const res = { status: mock.fn(() => ({ json: mock.fn() })) };
    const next = mock.fn();

    await ensureAuthAPI(req, res, next);

    assert.strictEqual(next.mock.calls.length, 1);
    assert.strictEqual(mockValidateExtensionToken.mock.calls.length, 1);
    assert.strictEqual(
      mockValidateExtensionToken.mock.calls[0].arguments[0],
      'valid_token_here'
    );
    assert.strictEqual(req.user._id, 'user123');
    assert.strictEqual(req.authMethod, 'token');
  });

  it('should return 401 for invalid token', async () => {
    mockValidateExtensionToken = mock.fn(() => Promise.resolve(null));
    ensureAuthAPI = createEnsureAuthAPI({
      usersAsync: mockUsersAsync,
      pool: mockPool,
      validateExtensionToken: mockValidateExtensionToken,
      recordActivity: mockRecordActivity,
      logger: mockLogger,
    });

    const jsonMock = mock.fn();
    const req = {
      isAuthenticated: mock.fn(() => false),
      get: mock.fn((header) => {
        if (header === 'Authorization') return 'Bearer invalid_token';
        return null;
      }),
    };
    const res = { status: mock.fn(() => ({ json: jsonMock })) };
    const next = mock.fn();

    await ensureAuthAPI(req, res, next);

    assert.strictEqual(next.mock.calls.length, 0);
    assert.strictEqual(res.status.mock.calls.length, 1);
    assert.strictEqual(res.status.mock.calls[0].arguments[0], 401);
    assert.deepStrictEqual(jsonMock.mock.calls[0].arguments[0], {
      error: 'Unauthorized',
    });
  });

  it('should return 401 when user not found for valid token', async () => {
    mockUsersAsync.findOne = mock.fn(() => Promise.resolve(null));

    const jsonMock = mock.fn();
    const req = {
      isAuthenticated: mock.fn(() => false),
      get: mock.fn((header) => {
        if (header === 'Authorization') return 'Bearer valid_token';
        return null;
      }),
    };
    const res = { status: mock.fn(() => ({ json: jsonMock })) };
    const next = mock.fn();

    await ensureAuthAPI(req, res, next);

    assert.strictEqual(next.mock.calls.length, 0);
    assert.strictEqual(res.status.mock.calls[0].arguments[0], 401);
  });

  it('should return 401 when no Authorization header', async () => {
    const jsonMock = mock.fn();
    const req = {
      isAuthenticated: mock.fn(() => false),
      get: mock.fn(() => null),
    };
    const res = { status: mock.fn(() => ({ json: jsonMock })) };
    const next = mock.fn();

    await ensureAuthAPI(req, res, next);

    assert.strictEqual(next.mock.calls.length, 0);
    assert.strictEqual(res.status.mock.calls[0].arguments[0], 401);
  });

  it('should return 401 when Authorization header is not Bearer', async () => {
    const jsonMock = mock.fn();
    const req = {
      isAuthenticated: mock.fn(() => false),
      get: mock.fn((header) => {
        if (header === 'Authorization') return 'Basic credentials';
        return null;
      }),
    };
    const res = { status: mock.fn(() => ({ json: jsonMock })) };
    const next = mock.fn();

    await ensureAuthAPI(req, res, next);

    assert.strictEqual(next.mock.calls.length, 0);
    assert.strictEqual(res.status.mock.calls[0].arguments[0], 401);
  });

  it('should log and return 401 on token validation error', async () => {
    mockValidateExtensionToken = mock.fn(() =>
      Promise.reject(new Error('Validation failed'))
    );
    ensureAuthAPI = createEnsureAuthAPI({
      usersAsync: mockUsersAsync,
      pool: mockPool,
      validateExtensionToken: mockValidateExtensionToken,
      recordActivity: mockRecordActivity,
      logger: mockLogger,
    });

    const jsonMock = mock.fn();
    const req = {
      isAuthenticated: mock.fn(() => false),
      get: mock.fn((header) => {
        if (header === 'Authorization') return 'Bearer some_token';
        return null;
      }),
    };
    const res = { status: mock.fn(() => ({ json: jsonMock })) };
    const next = mock.fn();

    await ensureAuthAPI(req, res, next);

    assert.strictEqual(next.mock.calls.length, 0);
    assert.strictEqual(res.status.mock.calls[0].arguments[0], 401);
    assert.strictEqual(mockLogger.error.mock.calls.length, 1);
  });

  it('should handle missing isAuthenticated function', async () => {
    const jsonMock = mock.fn();
    const req = {
      // No isAuthenticated function
      get: mock.fn(() => null),
    };
    const res = { status: mock.fn(() => ({ json: jsonMock })) };
    const next = mock.fn();

    await ensureAuthAPI(req, res, next);

    // Should not throw and should return 401
    assert.strictEqual(next.mock.calls.length, 0);
    assert.strictEqual(res.status.mock.calls[0].arguments[0], 401);
  });
});

// =============================================================================
// ensureAdmin tests
// =============================================================================

describe('ensureAdmin', () => {
  it('should call next() when user is admin', () => {
    const req = { user: { _id: 'user123', role: 'admin' } };
    const res = { status: mock.fn(() => ({ send: mock.fn() })) };
    const next = mock.fn();

    ensureAdmin(req, res, next);

    assert.strictEqual(next.mock.calls.length, 1);
  });

  it('should return 403 when user is not admin', () => {
    const sendMock = mock.fn();
    const req = { user: { _id: 'user123', role: 'user' } };
    const res = { status: mock.fn(() => ({ send: sendMock })) };
    const next = mock.fn();

    ensureAdmin(req, res, next);

    assert.strictEqual(next.mock.calls.length, 0);
    assert.strictEqual(res.status.mock.calls.length, 1);
    assert.strictEqual(res.status.mock.calls[0].arguments[0], 403);
    assert.strictEqual(sendMock.mock.calls[0].arguments[0], 'Access denied');
  });

  it('should return 403 when no user', () => {
    const sendMock = mock.fn();
    const req = {};
    const res = { status: mock.fn(() => ({ send: sendMock })) };
    const next = mock.fn();

    ensureAdmin(req, res, next);

    assert.strictEqual(next.mock.calls.length, 0);
    assert.strictEqual(res.status.mock.calls[0].arguments[0], 403);
  });

  it('should return 403 when user has no role', () => {
    const sendMock = mock.fn();
    const req = { user: { _id: 'user123' } };
    const res = { status: mock.fn(() => ({ send: sendMock })) };
    const next = mock.fn();

    ensureAdmin(req, res, next);

    assert.strictEqual(next.mock.calls.length, 0);
    assert.strictEqual(res.status.mock.calls[0].arguments[0], 403);
  });

  it('should return 403 for null user', () => {
    const sendMock = mock.fn();
    const req = { user: null };
    const res = { status: mock.fn(() => ({ send: sendMock })) };
    const next = mock.fn();

    ensureAdmin(req, res, next);

    assert.strictEqual(next.mock.calls.length, 0);
    assert.strictEqual(res.status.mock.calls[0].arguments[0], 403);
  });
});

// =============================================================================
// createRateLimitAdminRequest tests
// =============================================================================

describe('createRateLimitAdminRequest', () => {
  let adminCodeAttempts;
  let mockLogger;
  let rateLimitAdminRequest;

  beforeEach(() => {
    adminCodeAttempts = new Map();
    mockLogger = {
      warn: mock.fn(),
      error: mock.fn(),
      info: mock.fn(),
    };
    rateLimitAdminRequest = createRateLimitAdminRequest({
      adminCodeAttempts,
      logger: mockLogger,
    });
  });

  it('should allow request when under limit', () => {
    const req = {
      user: { _id: 'user123', email: 'test@example.com' },
      flash: mock.fn(),
    };
    const res = { redirect: mock.fn() };
    const next = mock.fn();

    rateLimitAdminRequest(req, res, next);

    assert.strictEqual(next.mock.calls.length, 1);
    assert.strictEqual(res.redirect.mock.calls.length, 0);
    assert.ok(req.adminAttempts);
    assert.strictEqual(req.adminAttempts.count, 0);
  });

  it('should allow request at count 4 (under limit of 5)', () => {
    adminCodeAttempts.set('user123', {
      count: 4,
      firstAttempt: Date.now(),
    });

    const req = {
      user: { _id: 'user123', email: 'test@example.com' },
      flash: mock.fn(),
    };
    const res = { redirect: mock.fn() };
    const next = mock.fn();

    rateLimitAdminRequest(req, res, next);

    assert.strictEqual(next.mock.calls.length, 1);
    assert.strictEqual(req.adminAttempts.count, 4);
  });

  it('should block request at count 5', () => {
    adminCodeAttempts.set('user123', {
      count: 5,
      firstAttempt: Date.now(),
    });

    const req = {
      user: { _id: 'user123', email: 'test@example.com' },
      flash: mock.fn(),
    };
    const res = { redirect: mock.fn() };
    const next = mock.fn();

    rateLimitAdminRequest(req, res, next);

    assert.strictEqual(next.mock.calls.length, 0);
    assert.strictEqual(res.redirect.mock.calls.length, 1);
    assert.strictEqual(res.redirect.mock.calls[0].arguments[0], '/settings');
    assert.strictEqual(req.flash.mock.calls.length, 1);
    assert.strictEqual(req.flash.mock.calls[0].arguments[0], 'error');
    assert.ok(req.flash.mock.calls[0].arguments[1].includes('30 minutes'));
    assert.strictEqual(mockLogger.warn.mock.calls.length, 1);
  });

  it('should block request at count > 5', () => {
    adminCodeAttempts.set('user123', {
      count: 10,
      firstAttempt: Date.now(),
    });

    const req = {
      user: { _id: 'user123', email: 'test@example.com' },
      flash: mock.fn(),
    };
    const res = { redirect: mock.fn() };
    const next = mock.fn();

    rateLimitAdminRequest(req, res, next);

    assert.strictEqual(next.mock.calls.length, 0);
    assert.strictEqual(res.redirect.mock.calls.length, 1);
  });

  it('should reset count after 30 minutes', () => {
    const thirtyOneMinutesAgo = Date.now() - 31 * 60 * 1000;
    adminCodeAttempts.set('user123', {
      count: 10,
      firstAttempt: thirtyOneMinutesAgo,
    });

    const req = {
      user: { _id: 'user123', email: 'test@example.com' },
      flash: mock.fn(),
    };
    const res = { redirect: mock.fn() };
    const next = mock.fn();

    rateLimitAdminRequest(req, res, next);

    assert.strictEqual(next.mock.calls.length, 1);
    assert.strictEqual(req.adminAttempts.count, 0);
    assert.ok(req.adminAttempts.firstAttempt > thirtyOneMinutesAgo);
  });

  it('should not reset count at exactly 30 minutes', () => {
    // Use 29 minutes 59 seconds to avoid race condition with test execution time
    const justUnderThirtyMinutesAgo = Date.now() - (30 * 60 * 1000 - 1000);
    adminCodeAttempts.set('user123', {
      count: 5,
      firstAttempt: justUnderThirtyMinutesAgo,
    });

    const req = {
      user: { _id: 'user123', email: 'test@example.com' },
      flash: mock.fn(),
    };
    const res = { redirect: mock.fn() };
    const next = mock.fn();

    rateLimitAdminRequest(req, res, next);

    // Count should still be 5, so blocked (30 min window not exceeded)
    assert.strictEqual(next.mock.calls.length, 0);
  });

  it('should not reset count at 29 minutes', () => {
    const twentyNineMinutesAgo = Date.now() - 29 * 60 * 1000;
    adminCodeAttempts.set('user123', {
      count: 5,
      firstAttempt: twentyNineMinutesAgo,
    });

    const req = {
      user: { _id: 'user123', email: 'test@example.com' },
      flash: mock.fn(),
    };
    const res = { redirect: mock.fn() };
    const next = mock.fn();

    rateLimitAdminRequest(req, res, next);

    // Should still be blocked
    assert.strictEqual(next.mock.calls.length, 0);
    assert.strictEqual(res.redirect.mock.calls.length, 1);
  });

  it('should create new attempt tracking for new user', () => {
    const req = {
      user: { _id: 'newuser', email: 'new@example.com' },
      flash: mock.fn(),
    };
    const res = { redirect: mock.fn() };
    const next = mock.fn();

    rateLimitAdminRequest(req, res, next);

    assert.strictEqual(next.mock.calls.length, 1);
    assert.ok(req.adminAttempts);
    assert.strictEqual(req.adminAttempts.count, 0);
    assert.ok(req.adminAttempts.firstAttempt);
  });

  it('should pass attempts to request for route to use', () => {
    adminCodeAttempts.set('user123', {
      count: 2,
      firstAttempt: Date.now(),
    });

    const req = {
      user: { _id: 'user123', email: 'test@example.com' },
      flash: mock.fn(),
    };
    const res = { redirect: mock.fn() };
    const next = mock.fn();

    rateLimitAdminRequest(req, res, next);

    assert.strictEqual(req.adminAttempts.count, 2);
  });
});
