/**
 * Integration Tests for Settings Update Endpoints
 * Tests user preference updates via HTTP requests
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
    setWebsocketConnections: mock.fn(),
    incWebsocketConnections: mock.fn(),
    decWebsocketConnections: mock.fn(),
    setActiveSessions: mock.fn(),
    updateDbPoolMetrics: mock.fn(),
    metricsMiddleware: () => (req, res, next) => next(),
  },
};

/**
 * Create a test Express app with settings routes
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
    res.locals.flash = { ...req.session.flash };
    delete req.session.flash;

    req.flash = (type, message) => {
      if (!req.session.flash) {
        req.session.flash = {};
      }
      if (message === undefined) {
        return req.session.flash[type] || [];
      }
      if (!req.session.flash[type]) {
        req.session.flash[type] = [];
      }
      req.session.flash[type].push(message);
    };

    next();
  });

  // Mock authentication middleware
  const mockUser = options.user || {
    _id: 'user-123',
    email: 'test@example.com',
    username: 'testuser',
    role: 'user',
  };

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
    update:
      options.usersUpdate ||
      mock.fn((query, update, opts, callback) => {
        callback(null, 1);
      }),
    findOne:
      options.usersFindOne ||
      mock.fn((query, callback) => {
        callback(null, null); // No duplicate found by default
      }),
  };

  // Mock pool for async operations
  const mockPool = {
    query: mock.fn(() => Promise.resolve({ rows: [], rowCount: 0 })),
  };

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
  const mockSettingsTemplate = () => '<div>Settings</div>';

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

  // Create deps object similar to the real app
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
    settingsTemplate: mockSettingsTemplate,
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

  return { app, mockUsers, mockPool, mockUsersAsync };
}

// ============ ACCENT COLOR TESTS ============

describe('POST /settings/update-accent-color', () => {
  it('should update accent color with valid hex', async () => {
    const { app, mockUsers } = createTestApp();

    const response = await request(app)
      .post('/settings/update-accent-color')
      .send({ accentColor: '#FF5733' });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.success, true);
    assert.strictEqual(mockUsers.update.mock.calls.length, 1);
  });

  it('should accept lowercase hex colors', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/settings/update-accent-color')
      .send({ accentColor: '#ff5733' });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.success, true);
  });

  it('should reject invalid hex format - missing hash', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/settings/update-accent-color')
      .send({ accentColor: 'FF5733' });

    assert.strictEqual(response.status, 400);
    assert.ok(response.body.error.includes('Invalid color format'));
  });

  it('should reject invalid hex format - too short', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/settings/update-accent-color')
      .send({ accentColor: '#FFF' });

    assert.strictEqual(response.status, 400);
    assert.ok(response.body.error.includes('Invalid color format'));
  });

  it('should reject invalid hex format - invalid characters', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/settings/update-accent-color')
      .send({ accentColor: '#GGGGGG' });

    assert.strictEqual(response.status, 400);
    assert.ok(response.body.error.includes('Invalid color format'));
  });

  it('should reject missing accentColor field', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/settings/update-accent-color')
      .send({});

    assert.strictEqual(response.status, 400);
  });

  it('should require authentication', async () => {
    const { app } = createTestApp({ authenticated: false });

    const response = await request(app)
      .post('/settings/update-accent-color')
      .send({ accentColor: '#FF5733' });

    assert.strictEqual(response.status, 302);
    assert.ok(response.headers.location.includes('/login'));
  });

  it('should handle database errors', async () => {
    const { app } = createTestApp({
      usersUpdate: mock.fn((query, update, opts, callback) => {
        callback(new Error('Database error'));
      }),
    });

    const response = await request(app)
      .post('/settings/update-accent-color')
      .send({ accentColor: '#FF5733' });

    assert.strictEqual(response.status, 500);
    assert.ok(response.body.error.includes('Error updating'));
  });
});

// ============ TIME FORMAT TESTS ============

describe('POST /settings/update-time-format', () => {
  it('should update to 12h format', async () => {
    const { app, mockUsers } = createTestApp();

    const response = await request(app)
      .post('/settings/update-time-format')
      .send({ timeFormat: '12h' });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.success, true);
    assert.strictEqual(mockUsers.update.mock.calls.length, 1);
  });

  it('should update to 24h format', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/settings/update-time-format')
      .send({ timeFormat: '24h' });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.success, true);
  });

  it('should reject invalid time format', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/settings/update-time-format')
      .send({ timeFormat: '13h' });

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.error, 'Invalid time format');
  });

  it('should reject empty time format', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/settings/update-time-format')
      .send({ timeFormat: '' });

    assert.strictEqual(response.status, 400);
  });

  it('should require authentication', async () => {
    const { app } = createTestApp({ authenticated: false });

    const response = await request(app)
      .post('/settings/update-time-format')
      .send({ timeFormat: '12h' });

    assert.strictEqual(response.status, 302);
  });

  it('should handle database errors', async () => {
    const { app } = createTestApp({
      usersUpdate: mock.fn((query, update, opts, callback) => {
        callback(new Error('Database error'));
      }),
    });

    const response = await request(app)
      .post('/settings/update-time-format')
      .send({ timeFormat: '12h' });

    assert.strictEqual(response.status, 500);
  });
});

// ============ DATE FORMAT TESTS ============

describe('POST /settings/update-date-format', () => {
  it('should update to MM/DD/YYYY format', async () => {
    const { app, mockUsers } = createTestApp();

    const response = await request(app)
      .post('/settings/update-date-format')
      .send({ dateFormat: 'MM/DD/YYYY' });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.success, true);
    assert.strictEqual(mockUsers.update.mock.calls.length, 1);
  });

  it('should update to DD/MM/YYYY format', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/settings/update-date-format')
      .send({ dateFormat: 'DD/MM/YYYY' });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.success, true);
  });

  it('should reject invalid date format', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/settings/update-date-format')
      .send({ dateFormat: 'YYYY-MM-DD' });

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.error, 'Invalid date format');
  });

  it('should reject empty date format', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/settings/update-date-format')
      .send({ dateFormat: '' });

    assert.strictEqual(response.status, 400);
  });

  it('should require authentication', async () => {
    const { app } = createTestApp({ authenticated: false });

    const response = await request(app)
      .post('/settings/update-date-format')
      .send({ dateFormat: 'MM/DD/YYYY' });

    assert.strictEqual(response.status, 302);
  });

  it('should handle database errors', async () => {
    const { app } = createTestApp({
      usersUpdate: mock.fn((query, update, opts, callback) => {
        callback(new Error('Database error'));
      }),
    });

    const response = await request(app)
      .post('/settings/update-date-format')
      .send({ dateFormat: 'MM/DD/YYYY' });

    assert.strictEqual(response.status, 500);
  });
});

// ============ MUSIC SERVICE TESTS ============

describe('POST /settings/update-music-service', () => {
  it('should update to spotify', async () => {
    const { app, mockUsers } = createTestApp();

    const response = await request(app)
      .post('/settings/update-music-service')
      .send({ musicService: 'spotify' });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.success, true);
    assert.strictEqual(mockUsers.update.mock.calls.length, 1);
  });

  it('should update to tidal', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/settings/update-music-service')
      .send({ musicService: 'tidal' });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.success, true);
  });

  it('should clear preference with null', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/settings/update-music-service')
      .send({ musicService: null });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.success, true);
  });

  it('should clear preference with empty string', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/settings/update-music-service')
      .send({ musicService: '' });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.success, true);
  });

  it('should reject invalid music service', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/settings/update-music-service')
      .send({ musicService: 'deezer' });

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.error, 'Invalid music service');
  });

  it('should require authentication', async () => {
    const { app } = createTestApp({ authenticated: false });

    const response = await request(app)
      .post('/settings/update-music-service')
      .send({ musicService: 'spotify' });

    assert.strictEqual(response.status, 302);
  });

  it('should handle database errors', async () => {
    const { app } = createTestApp({
      usersUpdate: mock.fn((query, update, opts, callback) => {
        callback(new Error('Database error'));
      }),
    });

    const response = await request(app)
      .post('/settings/update-music-service')
      .send({ musicService: 'spotify' });

    assert.strictEqual(response.status, 500);
  });
});

// ============ UPDATE EMAIL TESTS ============

describe('POST /settings/update-email', () => {
  it('should update email with valid address', async () => {
    const { app, mockUsers } = createTestApp();

    const response = await request(app)
      .post('/settings/update-email')
      .send({ email: 'newemail@example.com' });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.success, true);
    assert.strictEqual(mockUsers.findOne.mock.calls.length, 1);
    assert.strictEqual(mockUsers.update.mock.calls.length, 1);
  });

  it('should reject email with leading/trailing whitespace', async () => {
    // The endpoint validates email format before trimming,
    // so emails with spaces fail validation
    const { app } = createTestApp();

    const response = await request(app)
      .post('/settings/update-email')
      .send({ email: '  newemail@example.com  ' });

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.error, 'Invalid email format');
  });

  it('should reject invalid email format', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/settings/update-email')
      .send({ email: 'not-an-email' });

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.error, 'Invalid email format');
  });

  it('should reject empty email', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/settings/update-email')
      .send({ email: '' });

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.error, 'Email is required');
  });

  it('should reject whitespace-only email', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/settings/update-email')
      .send({ email: '   ' });

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.error, 'Email is required');
  });

  it('should reject duplicate email', async () => {
    const { app } = createTestApp({
      usersFindOne: mock.fn((query, callback) => {
        callback(null, { _id: 'other-user', email: 'newemail@example.com' });
      }),
    });

    const response = await request(app)
      .post('/settings/update-email')
      .send({ email: 'newemail@example.com' });

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.error, 'Email already in use');
  });

  it('should require authentication', async () => {
    const { app } = createTestApp({ authenticated: false });

    const response = await request(app)
      .post('/settings/update-email')
      .send({ email: 'newemail@example.com' });

    assert.strictEqual(response.status, 302);
  });

  it('should handle database errors on findOne', async () => {
    const { app } = createTestApp({
      usersFindOne: mock.fn((query, callback) => {
        callback(new Error('Database error'));
      }),
    });

    const response = await request(app)
      .post('/settings/update-email')
      .send({ email: 'newemail@example.com' });

    assert.strictEqual(response.status, 500);
    assert.strictEqual(response.body.error, 'Database error');
  });

  it('should handle database errors on update', async () => {
    const { app } = createTestApp({
      usersUpdate: mock.fn((query, update, opts, callback) => {
        callback(new Error('Database error'));
      }),
    });

    const response = await request(app)
      .post('/settings/update-email')
      .send({ email: 'newemail@example.com' });

    assert.strictEqual(response.status, 500);
    assert.strictEqual(response.body.error, 'Error updating email');
  });
});

// ============ UPDATE USERNAME TESTS ============

describe('POST /settings/update-username', () => {
  it('should update username with valid value', async () => {
    const { app, mockUsers } = createTestApp();

    const response = await request(app)
      .post('/settings/update-username')
      .send({ username: 'newusername' });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.success, true);
    assert.strictEqual(mockUsers.findOne.mock.calls.length, 1);
    assert.strictEqual(mockUsers.update.mock.calls.length, 1);
  });

  it('should accept username with underscores', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/settings/update-username')
      .send({ username: 'new_user_name' });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.success, true);
  });

  it('should accept username with numbers', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/settings/update-username')
      .send({ username: 'user123' });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.success, true);
  });

  it('should reject username with leading/trailing whitespace', async () => {
    // The endpoint validates username format before trimming,
    // so usernames with spaces fail validation
    const { app } = createTestApp();

    const response = await request(app)
      .post('/settings/update-username')
      .send({ username: '  newusername  ' });

    assert.strictEqual(response.status, 400);
    assert.ok(
      response.body.error.includes('letters, numbers, and underscores')
    );
  });

  it('should reject username with special characters', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/settings/update-username')
      .send({ username: 'user@name!' });

    assert.strictEqual(response.status, 400);
    assert.ok(
      response.body.error.includes('letters, numbers, and underscores')
    );
  });

  it('should reject username that is too short', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/settings/update-username')
      .send({ username: 'ab' });

    assert.strictEqual(response.status, 400);
    assert.ok(response.body.error.includes('3-30 characters'));
  });

  it('should reject username that is too long', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/settings/update-username')
      .send({ username: 'a'.repeat(31) });

    assert.strictEqual(response.status, 400);
    assert.ok(response.body.error.includes('3-30 characters'));
  });

  it('should reject empty username', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/settings/update-username')
      .send({ username: '' });

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.error, 'Username is required');
  });

  it('should reject whitespace-only username', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/settings/update-username')
      .send({ username: '   ' });

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.error, 'Username is required');
  });

  it('should reject duplicate username', async () => {
    const { app } = createTestApp({
      usersFindOne: mock.fn((query, callback) => {
        callback(null, { _id: 'other-user', username: 'newusername' });
      }),
    });

    const response = await request(app)
      .post('/settings/update-username')
      .send({ username: 'newusername' });

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.error, 'Username already taken');
  });

  it('should require authentication', async () => {
    const { app } = createTestApp({ authenticated: false });

    const response = await request(app)
      .post('/settings/update-username')
      .send({ username: 'newusername' });

    assert.strictEqual(response.status, 302);
  });

  it('should handle database errors on findOne', async () => {
    const { app } = createTestApp({
      usersFindOne: mock.fn((query, callback) => {
        callback(new Error('Database error'));
      }),
    });

    const response = await request(app)
      .post('/settings/update-username')
      .send({ username: 'newusername' });

    assert.strictEqual(response.status, 500);
    assert.strictEqual(response.body.error, 'Database error');
  });

  it('should handle database errors on update', async () => {
    const { app } = createTestApp({
      usersUpdate: mock.fn((query, update, opts, callback) => {
        callback(new Error('Database error'));
      }),
    });

    const response = await request(app)
      .post('/settings/update-username')
      .send({ username: 'newusername' });

    assert.strictEqual(response.status, 500);
    assert.strictEqual(response.body.error, 'Error updating username');
  });
});

// ============ EDGE CASES ============

describe('Settings Routes Edge Cases', () => {
  it('should handle multiple settings updates in sequence', async () => {
    const { app } = createTestApp();

    // Update accent color
    let response = await request(app)
      .post('/settings/update-accent-color')
      .send({ accentColor: '#FF5733' });
    assert.strictEqual(response.status, 200);

    // Update time format
    response = await request(app)
      .post('/settings/update-time-format')
      .send({ timeFormat: '24h' });
    assert.strictEqual(response.status, 200);

    // Update date format
    response = await request(app)
      .post('/settings/update-date-format')
      .send({ dateFormat: 'DD/MM/YYYY' });
    assert.strictEqual(response.status, 200);
  });

  it('should handle concurrent settings updates', async () => {
    const { app } = createTestApp();

    const promises = [
      request(app)
        .post('/settings/update-accent-color')
        .send({ accentColor: '#FF5733' }),
      request(app)
        .post('/settings/update-time-format')
        .send({ timeFormat: '24h' }),
      request(app)
        .post('/settings/update-date-format')
        .send({ dateFormat: 'DD/MM/YYYY' }),
    ];

    const responses = await Promise.all(promises);
    responses.forEach((response) => {
      assert.strictEqual(response.status, 200);
    });
  });
});
