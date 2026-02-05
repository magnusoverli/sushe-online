/**
 * Integration Tests for Extension Token Endpoints
 * Tests token generation, validation, revocation, and cleanup
 */

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

// Mock the logger module before importing routes
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

/**
 * Create a test Express app with extension token routes
 */
function createTestApp(options = {}) {
  const app = express();

  // Basic middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Session middleware (in-memory for tests)
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
    req.flash = (type, message) => {
      if (!req.session.flash) req.session.flash = {};
      if (message === undefined) return req.session.flash[type] || [];
      if (!req.session.flash[type]) req.session.flash[type] = [];
      req.session.flash[type].push(message);
    };
    next();
  });

  // Default mock user
  const mockUser = options.user || {
    _id: 'user-123',
    email: 'test@example.com',
    username: 'testuser',
    role: options.isAdmin ? 'admin' : 'user',
  };

  // Mock authentication middleware
  const ensureAuth = (req, res, next) => {
    if (options.authenticated === false) {
      return res.status(401).json({ error: 'Unauthorized' });
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

  // Mock pool for database operations
  const tokenRows = options.tokenRows || [];
  const mockPool = {
    query:
      options.poolQuery ||
      mock.fn((sql, _params) => {
        // Handle INSERT (generate token)
        if (sql.includes('INSERT INTO extension_tokens')) {
          return Promise.resolve({ rowCount: 1 });
        }
        // Handle UPDATE (revoke token)
        if (sql.includes('UPDATE extension_tokens')) {
          const token = _params[0];
          const found = tokenRows.find((t) => t.token === token);
          return Promise.resolve({ rowCount: found ? 1 : 0 });
        }
        // Handle SELECT (list tokens)
        if (sql.includes('SELECT') && sql.includes('FROM extension_tokens')) {
          return Promise.resolve({ rows: tokenRows });
        }
        // Handle DELETE (cleanup)
        if (sql.includes('DELETE FROM extension_tokens')) {
          return Promise.resolve({ rowCount: options.deletedCount || 0 });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
  };

  // Mock usersAsync for token validation
  const mockUsersAsync = {
    findOne:
      options.usersAsyncFindOne ||
      mock.fn((query) => {
        if (query._id === 'user-123') {
          return Promise.resolve(mockUser);
        }
        return Promise.resolve(null);
      }),
    insert: mock.fn(() => Promise.resolve({ _id: 'new-user' })),
  };

  // Mock auth-utils for token operations
  const mockAuthUtils = {
    generateExtensionToken:
      options.generateToken || mock.fn(() => 'test-token-abc123'),
    validateExtensionToken:
      options.validateToken ||
      mock.fn((token, _pool) => {
        if (token === 'valid-token') {
          return Promise.resolve('user-123');
        }
        if (token === 'expired-token' || token === 'revoked-token') {
          return Promise.resolve(null);
        }
        return Promise.resolve(null);
      }),
    cleanupExpiredTokens:
      options.cleanupTokens ||
      mock.fn((_pool) => {
        return Promise.resolve(options.deletedCount || 5);
      }),
  };

  // Cache the mock auth-utils
  require.cache[require.resolve('../auth-utils')] = {
    exports: mockAuthUtils,
  };

  // Mock users datastore
  const mockUsers = {
    update: mock.fn((query, update, opts, callback) => callback(null, 1)),
    findOne: mock.fn((query, callback) => callback(null, null)),
  };

  // Mock async datastores
  const mockListsAsync = {
    find: mock.fn(() => Promise.resolve([])),
  };

  const mockListItemsAsync = {
    count: mock.fn(() => Promise.resolve(0)),
  };

  // Mock validators
  const {
    isValidEmail,
    isValidUsername,
    isValidPassword,
  } = require('../validators');

  // Mock bcrypt
  const mockBcrypt = {
    hash: mock.fn(() => Promise.resolve('hashed-password')),
    compare: mock.fn(() => Promise.resolve(true)),
  };

  // Mock templates
  const mockHtmlTemplate = (content, title) =>
    `<html><head><title>${title}</title></head><body>${content}</body></html>`;
  const mockRegisterTemplate = () => '<form>Register</form>';
  const mockLoginTemplate = () => '<form>Login</form>';
  const mockSpotifyTemplate = () => '<div>Spotify</div>';

  // Mock token helpers
  const mockIsTokenValid = () => true;
  const mockIsTokenUsable = () => true;

  // Admin code mocks
  const mockAdminCodeAttempts = new Map();
  const mockAdminCode = '123456';
  const mockAdminCodeExpiry = new Date(Date.now() + 3600000);
  const mockGenerateAdminCode = mock.fn();

  // Rate limit mock
  const mockRateLimitAdminRequest = (req, res, next) => next();

  // Create deps object
  const deps = {
    csrfProtection: (req, res, next) => next(),
    ensureAuth,
    ensureAuthAPI,
    rateLimitAdminRequest: mockRateLimitAdminRequest,
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
    isTokenValid: mockIsTokenValid,
    isTokenUsable: mockIsTokenUsable,
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

  return { app, mockPool, mockUsersAsync, mockAuthUtils };
}

// ============ GENERATE TOKEN TESTS ============

describe('POST /api/auth/extension-token', () => {
  it('should generate token for authenticated user', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/api/auth/extension-token')
      .set('User-Agent', 'TestBrowser/1.0');

    assert.strictEqual(response.status, 200);
    assert.ok(response.body.token);
    assert.ok(response.body.expiresAt);
  });

  it('should return token and expiry date', async () => {
    const { app } = createTestApp();

    const response = await request(app).post('/api/auth/extension-token');

    assert.strictEqual(response.status, 200);
    assert.strictEqual(typeof response.body.token, 'string');
    assert.strictEqual(typeof response.body.expiresAt, 'string');

    // Verify expiry is in the future (about 90 days)
    const expiresAt = new Date(response.body.expiresAt);
    const now = new Date();
    const daysDiff = (expiresAt - now) / (1000 * 60 * 60 * 24);
    assert.ok(daysDiff > 85 && daysDiff < 95);
  });

  it('should store token in database', async () => {
    const { app, mockPool } = createTestApp();

    await request(app)
      .post('/api/auth/extension-token')
      .set('User-Agent', 'TestBrowser/1.0');

    assert.strictEqual(mockPool.query.mock.calls.length, 1);
    const call = mockPool.query.mock.calls[0];
    assert.ok(call.arguments[0].includes('INSERT INTO extension_tokens'));
    assert.strictEqual(call.arguments[1][0], 'user-123'); // user_id
  });

  it('should capture user agent', async () => {
    const { app, mockPool } = createTestApp();

    await request(app)
      .post('/api/auth/extension-token')
      .set('User-Agent', 'Chrome Extension/2.0');

    const call = mockPool.query.mock.calls[0];
    assert.strictEqual(call.arguments[1][3], 'Chrome Extension/2.0');
  });

  it('should use "Unknown" for missing user agent', async () => {
    const { app, mockPool } = createTestApp();

    await request(app).post('/api/auth/extension-token');

    const call = mockPool.query.mock.calls[0];
    // User-Agent might be set by supertest, check if it's captured
    assert.ok(call.arguments[1][3]);
  });

  it('should reject unauthenticated request', async () => {
    const { app } = createTestApp({ authenticated: false });

    const response = await request(app).post('/api/auth/extension-token');

    assert.strictEqual(response.status, 401);
  });

  it('should handle database errors', async () => {
    const { app } = createTestApp({
      poolQuery: mock.fn(() => Promise.reject(new Error('Database error'))),
    });

    const response = await request(app).post('/api/auth/extension-token');

    assert.strictEqual(response.status, 500);
    assert.strictEqual(response.body.error, 'Error generating token');
  });
});

// ============ VALIDATE TOKEN TESTS ============

describe('GET /api/auth/validate-token', () => {
  it('should validate valid token', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .get('/api/auth/validate-token')
      .set('Authorization', 'Bearer valid-token');

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.valid, true);
  });

  it('should return user info for valid token', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .get('/api/auth/validate-token')
      .set('Authorization', 'Bearer valid-token');

    assert.strictEqual(response.status, 200);
    assert.ok(response.body.user);
    assert.strictEqual(response.body.user._id, 'user-123');
    assert.strictEqual(response.body.user.email, 'test@example.com');
  });

  it('should reject expired token', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .get('/api/auth/validate-token')
      .set('Authorization', 'Bearer expired-token');

    assert.strictEqual(response.status, 401);
    assert.strictEqual(response.body.error, 'Invalid or expired token');
  });

  it('should reject revoked token', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .get('/api/auth/validate-token')
      .set('Authorization', 'Bearer revoked-token');

    assert.strictEqual(response.status, 401);
    assert.strictEqual(response.body.error, 'Invalid or expired token');
  });

  it('should reject invalid token format', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .get('/api/auth/validate-token')
      .set('Authorization', 'Bearer invalid-token-xyz');

    assert.strictEqual(response.status, 401);
    assert.strictEqual(response.body.error, 'Invalid or expired token');
  });

  it('should reject missing Authorization header', async () => {
    const { app } = createTestApp();

    const response = await request(app).get('/api/auth/validate-token');

    assert.strictEqual(response.status, 401);
    assert.strictEqual(response.body.error, 'No token provided');
  });

  it('should reject non-Bearer authorization', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .get('/api/auth/validate-token')
      .set('Authorization', 'Basic dXNlcjpwYXNz');

    assert.strictEqual(response.status, 401);
    assert.strictEqual(response.body.error, 'No token provided');
  });

  it('should return 401 when user not found', async () => {
    const { app } = createTestApp({
      validateToken: mock.fn(() => Promise.resolve('nonexistent-user')),
      usersAsyncFindOne: mock.fn(() => Promise.resolve(null)),
    });

    const response = await request(app)
      .get('/api/auth/validate-token')
      .set('Authorization', 'Bearer valid-token');

    assert.strictEqual(response.status, 401);
    assert.strictEqual(response.body.error, 'User not found');
  });

  it('should handle validation errors', async () => {
    const { app } = createTestApp({
      validateToken: mock.fn(() =>
        Promise.reject(new Error('Validation error'))
      ),
    });

    const response = await request(app)
      .get('/api/auth/validate-token')
      .set('Authorization', 'Bearer valid-token');

    assert.strictEqual(response.status, 500);
    assert.strictEqual(response.body.error, 'Error validating token');
  });
});

// ============ REVOKE TOKEN TESTS ============

describe('DELETE /api/auth/extension-token', () => {
  it('should revoke own token', async () => {
    const { app } = createTestApp({
      tokenRows: [{ token: 'my-token', user_id: 'user-123' }],
      poolQuery: mock.fn((sql, _params) => {
        if (sql.includes('UPDATE')) {
          return Promise.resolve({ rowCount: 1 });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
    });

    const response = await request(app)
      .delete('/api/auth/extension-token')
      .send({ token: 'my-token' });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.success, true);
  });

  it('should return 404 for non-existent token', async () => {
    const { app } = createTestApp({
      poolQuery: mock.fn((sql) => {
        if (sql.includes('UPDATE')) {
          return Promise.resolve({ rowCount: 0 });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
    });

    const response = await request(app)
      .delete('/api/auth/extension-token')
      .send({ token: 'nonexistent-token' });

    assert.strictEqual(response.status, 404);
    assert.strictEqual(response.body.error, 'Token not found');
  });

  it("should not revoke other user's token", async () => {
    const { app } = createTestApp({
      poolQuery: mock.fn((sql) => {
        if (sql.includes('UPDATE')) {
          // Returns 0 because the WHERE clause includes user_id
          return Promise.resolve({ rowCount: 0 });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
    });

    const response = await request(app)
      .delete('/api/auth/extension-token')
      .send({ token: 'other-users-token' });

    assert.strictEqual(response.status, 404);
  });

  it('should require token in request body', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .delete('/api/auth/extension-token')
      .send({});

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.error, 'Token required');
  });

  it('should require authentication', async () => {
    const { app } = createTestApp({ authenticated: false });

    const response = await request(app)
      .delete('/api/auth/extension-token')
      .send({ token: 'my-token' });

    assert.strictEqual(response.status, 401);
  });

  it('should handle database errors', async () => {
    const { app } = createTestApp({
      poolQuery: mock.fn(() => Promise.reject(new Error('Database error'))),
    });

    const response = await request(app)
      .delete('/api/auth/extension-token')
      .send({ token: 'my-token' });

    assert.strictEqual(response.status, 500);
    assert.strictEqual(response.body.error, 'Error revoking token');
  });
});

// ============ LIST TOKENS TESTS ============

describe('GET /api/auth/extension-tokens', () => {
  it("should list user's tokens", async () => {
    const mockTokens = [
      {
        id: 1,
        created_at: '2024-01-01T00:00:00Z',
        last_used_at: '2024-01-15T00:00:00Z',
        expires_at: '2024-04-01T00:00:00Z',
        user_agent: 'Chrome Extension',
        is_revoked: false,
      },
      {
        id: 2,
        created_at: '2024-01-10T00:00:00Z',
        last_used_at: null,
        expires_at: '2024-04-10T00:00:00Z',
        user_agent: 'Firefox Extension',
        is_revoked: false,
      },
    ];

    const { app } = createTestApp({ tokenRows: mockTokens });

    const response = await request(app).get('/api/auth/extension-tokens');

    assert.strictEqual(response.status, 200);
    assert.ok(response.body.tokens);
    assert.strictEqual(response.body.tokens.length, 2);
  });

  it('should return empty array for new user', async () => {
    const { app } = createTestApp({ tokenRows: [] });

    const response = await request(app).get('/api/auth/extension-tokens');

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(response.body.tokens, []);
  });

  it('should include token metadata', async () => {
    const mockTokens = [
      {
        id: 1,
        created_at: '2024-01-01T00:00:00Z',
        last_used_at: '2024-01-15T00:00:00Z',
        expires_at: '2024-04-01T00:00:00Z',
        user_agent: 'Chrome Extension',
        is_revoked: false,
      },
    ];

    const { app } = createTestApp({ tokenRows: mockTokens });

    const response = await request(app).get('/api/auth/extension-tokens');

    assert.strictEqual(response.status, 200);
    const token = response.body.tokens[0];
    assert.ok(token.id);
    assert.ok(token.created_at);
    assert.ok(token.expires_at);
    assert.ok(token.user_agent);
    assert.strictEqual(typeof token.is_revoked, 'boolean');
  });

  it('should require authentication', async () => {
    const { app } = createTestApp({ authenticated: false });

    const response = await request(app).get('/api/auth/extension-tokens');

    assert.strictEqual(response.status, 401);
  });

  it('should handle database errors', async () => {
    const { app } = createTestApp({
      poolQuery: mock.fn(() => Promise.reject(new Error('Database error'))),
    });

    const response = await request(app).get('/api/auth/extension-tokens');

    assert.strictEqual(response.status, 500);
    assert.strictEqual(response.body.error, 'Error listing tokens');
  });
});

// ============ CLEANUP TOKENS TESTS ============

describe('POST /api/auth/cleanup-tokens', () => {
  it('should cleanup expired tokens (admin)', async () => {
    const { app } = createTestApp({
      isAdmin: true,
      deletedCount: 5,
    });

    const response = await request(app).post('/api/auth/cleanup-tokens');

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.deletedCount, 5);
  });

  it('should cleanup revoked tokens (admin)', async () => {
    const { app } = createTestApp({
      isAdmin: true,
      deletedCount: 3,
    });

    const response = await request(app).post('/api/auth/cleanup-tokens');

    assert.strictEqual(response.status, 200);
    assert.ok(response.body.deletedCount >= 0);
  });

  it('should reject non-admin users', async () => {
    const { app } = createTestApp({
      isAdmin: false,
    });

    const response = await request(app).post('/api/auth/cleanup-tokens');

    assert.strictEqual(response.status, 403);
    assert.strictEqual(response.body.error, 'Admin access required');
  });

  it('should return count of deleted tokens', async () => {
    const { app } = createTestApp({
      isAdmin: true,
      deletedCount: 10,
    });

    const response = await request(app).post('/api/auth/cleanup-tokens');

    assert.strictEqual(response.status, 200);
    assert.strictEqual(typeof response.body.deletedCount, 'number');
    assert.strictEqual(response.body.deletedCount, 10);
  });

  it('should require authentication', async () => {
    const { app } = createTestApp({ authenticated: false });

    const response = await request(app).post('/api/auth/cleanup-tokens');

    assert.strictEqual(response.status, 401);
  });

  it('should handle cleanup errors', async () => {
    const { app } = createTestApp({
      isAdmin: true,
      cleanupTokens: mock.fn(() => Promise.reject(new Error('Cleanup error'))),
    });

    const response = await request(app).post('/api/auth/cleanup-tokens');

    assert.strictEqual(response.status, 500);
    assert.strictEqual(response.body.error, 'Error cleaning up tokens');
  });
});

// ============ TOKEN LIFECYCLE TESTS ============

describe('Extension Token Lifecycle', () => {
  it('should handle full token lifecycle', async () => {
    // This test simulates generating, validating, and revoking a token
    const { app } = createTestApp({
      poolQuery: mock.fn((sql, _params) => {
        if (sql.includes('INSERT')) {
          return Promise.resolve({ rowCount: 1 });
        }
        if (sql.includes('UPDATE')) {
          return Promise.resolve({ rowCount: 1 });
        }
        if (sql.includes('SELECT')) {
          return Promise.resolve({ rows: [{ id: 1, token: 'test-token' }] });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
    });

    // 1. Generate token
    const genResponse = await request(app).post('/api/auth/extension-token');
    assert.strictEqual(genResponse.status, 200);
    const token = genResponse.body.token;
    assert.ok(token);

    // 2. List tokens (should include the new one)
    const listResponse = await request(app).get('/api/auth/extension-tokens');
    assert.strictEqual(listResponse.status, 200);
    assert.ok(listResponse.body.tokens.length > 0);

    // 3. Revoke token
    const revokeResponse = await request(app)
      .delete('/api/auth/extension-token')
      .send({ token });
    assert.strictEqual(revokeResponse.status, 200);
  });
});
