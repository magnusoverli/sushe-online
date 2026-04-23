/**
 * Integration Tests for Admin User Operations
 * Tests admin-only endpoints for user management
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

// Mock response-cache to prevent setInterval from keeping the process alive
// The ResponseCache singleton creates a cleanup timer that would hang tests
require.cache[require.resolve('../middleware/response-cache')] = {
  exports: {
    ResponseCache: class MockResponseCache {
      constructor() {
        this.cache = new Map();
      }
      get() {
        return null;
      }
      set() {}
      invalidate() {}
      cleanup() {}
    },
    responseCache: {
      cache: new Map(),
      get() {
        return null;
      },
      set() {},
      invalidate() {},
      cleanup() {},
    },
    cacheConfigs: {},
  },
};

/**
 * Create a test Express app with admin routes
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

  // Default mock user (admin by default for admin tests)
  const mockUser = options.user || {
    _id: 'admin-123',
    email: 'admin@example.com',
    username: 'adminuser',
    role: options.isAdmin === false ? 'user' : 'admin',
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

  // Mock admin middleware
  const ensureAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  };

  // Mock users datastore
  const mockUsers = {
    update:
      options.usersUpdate ||
      mock.fn((query, update, opts, callback) => {
        // Simulate successful update
        callback(null, 1);
      }),
    remove:
      options.usersRemove ||
      mock.fn((query, opts, callback) => {
        if (query._id === 'nonexistent-user') {
          callback(null, 0);
        } else {
          callback(null, 1);
        }
      }),
    findOne:
      options.usersFindOne ||
      mock.fn((query, callback) => {
        callback(null, null);
      }),
  };

  // Mock lists datastore
  const mockLists = {
    remove:
      options.listsRemove ||
      mock.fn((query, opts, callback) => {
        callback(null, 2); // Removed 2 lists
      }),
  };

  // Mock async datastores
  // Forward reference — mockPool is defined below; the raw() defaults
  // close over poolHolder so tests that customize poolQuery continue to
  // intercept stats/list-service SQL by text match.
  const poolHolder = { pool: null };
  const mockUsersAsync = {
    raw:
      options.usersAsyncRaw ||
      mock.fn((sql, params) => poolHolder.pool.query(sql, params)),
    find:
      options.usersAsyncFind ||
      mock.fn(() => {
        return Promise.resolve([
          {
            _id: 'admin-123',
            username: 'adminuser',
            email: 'admin@example.com',
            role: 'admin',
            createdAt: new Date(),
          },
        ]);
      }),
    count:
      options.usersAsyncCount ||
      mock.fn(() => {
        return Promise.resolve(1);
      }),
    update:
      options.usersAsyncUpdate ||
      mock.fn((_query, _update) => {
        // Simulate successful update - returns number of updated docs
        return Promise.resolve(1);
      }),
  };

  const mockListsAsync = {
    raw:
      options.listsAsyncRaw ||
      mock.fn((sql, params) => poolHolder.pool.query(sql, params)),
    count:
      options.listsAsyncCount ||
      mock.fn(() => {
        return Promise.resolve(2);
      }),
    find:
      options.listsAsyncFind ||
      mock.fn((query) => {
        if (query.userId === 'user-with-lists') {
          return Promise.resolve([
            {
              _id: 'list-1',
              name: 'My Albums',
              userId: 'user-with-lists',
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            {
              _id: 'list-2',
              name: 'Favorites',
              userId: 'user-with-lists',
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ]);
        }
        return Promise.resolve([]);
      }),
    findWithCounts:
      options.listsAsyncFindWithCounts ||
      mock.fn((query) => {
        if (query.userId === 'user-with-lists') {
          return Promise.resolve([
            {
              _id: 'list-1',
              name: 'My Albums',
              userId: 'user-with-lists',
              itemCount: 15,
              createdAt: new Date(),
              updatedAt: new Date(),
              group: null,
            },
            {
              _id: 'list-2',
              name: 'Favorites',
              userId: 'user-with-lists',
              itemCount: 8,
              createdAt: new Date(),
              updatedAt: new Date(),
              group: null,
            },
          ]);
        }
        return Promise.resolve([]);
      }),
  };

  const mockListItemsAsync = {
    count:
      options.listItemsAsyncCount ||
      mock.fn((query) => {
        if (query.listId === 'list-1') return Promise.resolve(15);
        if (query.listId === 'list-2') return Promise.resolve(8);
        return Promise.resolve(0);
      }),
  };

  // Mock pool
  const mockPool = {
    query:
      options.poolQuery ||
      mock.fn(() => Promise.resolve({ rows: [], rowCount: 0 })),
  };

  mockPool.connect =
    options.poolConnect ||
    mock.fn(async () => ({
      query: (...args) => mockPool.query(...args),
      release: () => {},
    }));

  poolHolder.pool = mockPool;

  // Mock upload middleware (for restore endpoint)
  const mockUpload = {
    single: () => (req, res, next) => {
      req.file = options.uploadedFile || null;
      next();
    },
  };

  // Mock crypto
  const mockCrypto = require('crypto');

  // Mock duplicate service
  const mockDuplicateService = {
    scanDuplicates: mock.fn(() =>
      Promise.resolve({
        totalAlbums: 0,
        potentialDuplicates: 0,
        excludedPairs: 0,
        pairs: [],
      })
    ),
    mergeAlbums: mock.fn(() =>
      Promise.resolve({
        listItemsUpdated: 0,
        albumsDeleted: 1,
        metadataMerged: false,
      })
    ),
  };

  const mockInvalidateUserCache =
    options.invalidateUserCache || mock.fn(() => {});

  // Create deps object
  const deps = {
    ensureAuth,
    ensureAdmin,
    users: mockUsers,
    usersAsync: mockUsersAsync,
    lists: mockLists,
    listsAsync: mockListsAsync,
    listItemsAsync: mockListItemsAsync,
    upload: mockUpload,
    adminCodeState: {
      get adminCodeExpiry() {
        return options.adminCodeExpiry || new Date(Date.now() + 3600000);
      },
    },
    crypto: mockCrypto,
    // Canonical db: duck-typed datastore that delegates .raw() to the mockPool
    // so existing poolQuery SQL matchers keep working.
    db: {
      raw: (sql, params) => mockPool.query(sql, params),
      withClient: async (cb) => {
        const client = await mockPool.connect();
        try {
          return await cb(client);
        } finally {
          if (client.release) client.release();
        }
      },
      withTransaction: async (cb) => {
        const client = await mockPool.connect();
        try {
          await client.query('BEGIN');
          const r = await cb(client);
          await client.query('COMMIT');
          return r;
        } finally {
          if (client.release) client.release();
        }
      },
    },
    pool: mockPool,
    duplicateService: mockDuplicateService,
    invalidateUserCache: mockInvalidateUserCache,
  };

  // Import and setup routes
  const adminRoutes = require('../routes/admin');
  adminRoutes(app, deps);

  // Error handler
  app.use((err, req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });

  return {
    app,
    mockUsers,
    mockUsersAsync,
    mockLists,
    mockListsAsync,
    mockListItemsAsync,
    mockPool,
    mockInvalidateUserCache,
  };
}

// ============ DELETE USER TESTS ============

describe('POST /admin/delete-user', () => {
  it('should delete user as admin', async () => {
    const { app, mockUsers, mockLists, mockInvalidateUserCache } =
      createTestApp();

    const response = await request(app)
      .post('/admin/delete-user')
      .send({ userId: 'target-user-123' });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.success, true);
    assert.strictEqual(mockLists.remove.mock.calls.length, 1);
    assert.strictEqual(mockUsers.remove.mock.calls.length, 1);
    assert.strictEqual(mockInvalidateUserCache.mock.calls.length, 1);
    assert.strictEqual(
      mockInvalidateUserCache.mock.calls[0].arguments[0],
      'target-user-123'
    );
  });

  it("should cascade delete user's lists", async () => {
    const { app, mockLists } = createTestApp();

    await request(app)
      .post('/admin/delete-user')
      .send({ userId: 'target-user-123' });

    // Verify lists.remove was called with the user's ID
    const listsRemoveCall = mockLists.remove.mock.calls[0];
    assert.strictEqual(listsRemoveCall.arguments[0].userId, 'target-user-123');
    assert.deepStrictEqual(listsRemoveCall.arguments[1], { multi: true });
  });

  it('should prevent deleting yourself', async () => {
    const { app } = createTestApp({
      user: {
        _id: 'admin-123',
        email: 'admin@example.com',
        username: 'adminuser',
        role: 'admin',
      },
    });

    const response = await request(app)
      .post('/admin/delete-user')
      .send({ userId: 'admin-123' }); // Same as logged-in user

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.error, 'Cannot delete yourself');
  });

  it('should return 404 for non-existent user', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/admin/delete-user')
      .send({ userId: 'nonexistent-user' });

    assert.strictEqual(response.status, 404);
    assert.strictEqual(response.body.error, 'User not found');
  });

  it('should reject non-admin users', async () => {
    const { app } = createTestApp({ isAdmin: false });

    const response = await request(app)
      .post('/admin/delete-user')
      .send({ userId: 'target-user-123' });

    assert.strictEqual(response.status, 403);
    assert.strictEqual(response.body.error, 'Admin access required');
  });

  it('should require authentication', async () => {
    const { app } = createTestApp({ authenticated: false });

    const response = await request(app)
      .post('/admin/delete-user')
      .send({ userId: 'target-user-123' });

    assert.strictEqual(response.status, 401);
  });

  it('should handle errors when deleting user lists', async () => {
    const { app } = createTestApp({
      listsRemove: mock.fn((query, opts, callback) => {
        callback(new Error('Database error'));
      }),
    });

    const response = await request(app)
      .post('/admin/delete-user')
      .send({ userId: 'target-user-123' });

    assert.strictEqual(response.status, 500);
    assert.strictEqual(response.body.error, 'Error deleting user data');
  });

  it('should handle errors when deleting user', async () => {
    const { app } = createTestApp({
      usersRemove: mock.fn((query, opts, callback) => {
        callback(new Error('Database error'));
      }),
    });

    const response = await request(app)
      .post('/admin/delete-user')
      .send({ userId: 'target-user-123' });

    assert.strictEqual(response.status, 500);
    assert.strictEqual(response.body.error, 'Error deleting user');
  });
});

// ============ MAKE ADMIN TESTS ============

describe('POST /admin/make-admin', () => {
  it('should grant admin role', async () => {
    const { app, mockUsersAsync, mockInvalidateUserCache } = createTestApp();

    const response = await request(app)
      .post('/admin/make-admin')
      .send({ userId: 'target-user-123' });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.success, true);
    assert.strictEqual(mockUsersAsync.update.mock.calls.length, 1);
    assert.strictEqual(mockInvalidateUserCache.mock.calls.length, 1);
    assert.strictEqual(
      mockInvalidateUserCache.mock.calls[0].arguments[0],
      'target-user-123'
    );
  });

  it('should set adminGrantedAt timestamp', async () => {
    const { app, mockUsersAsync } = createTestApp();

    await request(app)
      .post('/admin/make-admin')
      .send({ userId: 'target-user-123' });

    const updateCall = mockUsersAsync.update.mock.calls[0];
    const updateData = updateCall.arguments[1].$set;
    assert.strictEqual(updateData.role, 'admin');
    assert.ok(updateData.adminGrantedAt instanceof Date);
  });

  it('should return 404 for non-existent user', async () => {
    const { app } = createTestApp({
      usersAsyncUpdate: mock.fn(() => Promise.resolve(0)), // No user found
    });

    const response = await request(app)
      .post('/admin/make-admin')
      .send({ userId: 'nonexistent-user' });

    assert.strictEqual(response.status, 404);
    assert.strictEqual(response.body.error, 'User not found');
  });

  it('should reject non-admin users', async () => {
    const { app } = createTestApp({ isAdmin: false });

    const response = await request(app)
      .post('/admin/make-admin')
      .send({ userId: 'target-user-123' });

    assert.strictEqual(response.status, 403);
    assert.strictEqual(response.body.error, 'Admin access required');
  });

  it('should require authentication', async () => {
    const { app } = createTestApp({ authenticated: false });

    const response = await request(app)
      .post('/admin/make-admin')
      .send({ userId: 'target-user-123' });

    assert.strictEqual(response.status, 401);
  });

  it('should handle database errors', async () => {
    const { app } = createTestApp({
      usersAsyncUpdate: mock.fn(() =>
        Promise.reject(new Error('Database error'))
      ),
    });

    const response = await request(app)
      .post('/admin/make-admin')
      .send({ userId: 'target-user-123' });

    assert.strictEqual(response.status, 500);
    assert.strictEqual(response.body.error, 'Error granting admin privileges');
  });
});

// ============ REVOKE ADMIN TESTS ============

describe('POST /admin/revoke-admin', () => {
  it('should revoke admin role', async () => {
    const { app, mockUsersAsync, mockInvalidateUserCache } = createTestApp();

    const response = await request(app)
      .post('/admin/revoke-admin')
      .send({ userId: 'other-admin-456' });

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.success, true);
    assert.strictEqual(mockUsersAsync.update.mock.calls.length, 1);
    assert.strictEqual(mockInvalidateUserCache.mock.calls.length, 1);
    assert.strictEqual(
      mockInvalidateUserCache.mock.calls[0].arguments[0],
      'other-admin-456'
    );
  });

  it('should unset role and adminGrantedAt', async () => {
    const { app, mockUsersAsync } = createTestApp();

    await request(app)
      .post('/admin/revoke-admin')
      .send({ userId: 'other-admin-456' });

    const updateCall = mockUsersAsync.update.mock.calls[0];
    const updateData = updateCall.arguments[1].$unset;
    assert.strictEqual(updateData.role, true);
    assert.strictEqual(updateData.adminGrantedAt, true);
  });

  it('should prevent revoking own admin', async () => {
    const { app } = createTestApp({
      user: {
        _id: 'admin-123',
        email: 'admin@example.com',
        username: 'adminuser',
        role: 'admin',
      },
    });

    const response = await request(app)
      .post('/admin/revoke-admin')
      .send({ userId: 'admin-123' }); // Same as logged-in user

    assert.strictEqual(response.status, 400);
    assert.strictEqual(
      response.body.error,
      'Cannot revoke your own admin privileges'
    );
  });

  it('should return 404 for non-existent user', async () => {
    const { app } = createTestApp({
      usersAsyncUpdate: mock.fn(() => Promise.resolve(0)), // No user found
    });

    const response = await request(app)
      .post('/admin/revoke-admin')
      .send({ userId: 'nonexistent-user' });

    assert.strictEqual(response.status, 404);
    assert.strictEqual(response.body.error, 'User not found');
  });

  it('should reject non-admin users', async () => {
    const { app } = createTestApp({ isAdmin: false });

    const response = await request(app)
      .post('/admin/revoke-admin')
      .send({ userId: 'other-admin-456' });

    assert.strictEqual(response.status, 403);
    assert.strictEqual(response.body.error, 'Admin access required');
  });

  it('should require authentication', async () => {
    const { app } = createTestApp({ authenticated: false });

    const response = await request(app)
      .post('/admin/revoke-admin')
      .send({ userId: 'other-admin-456' });

    assert.strictEqual(response.status, 401);
  });

  it('should handle database errors', async () => {
    const { app } = createTestApp({
      usersAsyncUpdate: mock.fn(() =>
        Promise.reject(new Error('Database error'))
      ),
    });

    const response = await request(app)
      .post('/admin/revoke-admin')
      .send({ userId: 'other-admin-456' });

    assert.strictEqual(response.status, 500);
    assert.strictEqual(response.body.error, 'Error revoking admin privileges');
  });
});

// ============ GET USER LISTS TESTS ============

describe('GET /admin/user-lists/:userId', () => {
  it("should return user's lists with album counts", async () => {
    const { app } = createTestApp();

    const response = await request(app).get(
      '/admin/user-lists/user-with-lists'
    );

    assert.strictEqual(response.status, 200);
    assert.ok(response.body.lists);
    assert.strictEqual(response.body.lists.length, 2);
    assert.strictEqual(response.body.lists[0].name, 'My Albums');
    assert.strictEqual(response.body.lists[0].albumCount, 15);
    assert.strictEqual(response.body.lists[1].name, 'Favorites');
    assert.strictEqual(response.body.lists[1].albumCount, 8);
  });

  it('should return empty array for user with no lists', async () => {
    const { app } = createTestApp();

    const response = await request(app).get(
      '/admin/user-lists/user-without-lists'
    );

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(response.body.lists, []);
  });

  it('should include list metadata', async () => {
    const { app } = createTestApp();

    const response = await request(app).get(
      '/admin/user-lists/user-with-lists'
    );

    assert.strictEqual(response.status, 200);
    const list = response.body.lists[0];
    assert.ok(list.name);
    assert.ok(typeof list.albumCount === 'number');
    assert.ok(list.createdAt);
    assert.ok(list.updatedAt);
  });

  it('should reject non-admin users', async () => {
    const { app } = createTestApp({ isAdmin: false });

    const response = await request(app).get(
      '/admin/user-lists/user-with-lists'
    );

    assert.strictEqual(response.status, 403);
    assert.strictEqual(response.body.error, 'Admin access required');
  });

  it('should require authentication', async () => {
    const { app } = createTestApp({ authenticated: false });

    const response = await request(app).get(
      '/admin/user-lists/user-with-lists'
    );

    assert.strictEqual(response.status, 401);
  });

  it('should handle database errors', async () => {
    const { app } = createTestApp({
      listsAsyncFindWithCounts: mock.fn(() =>
        Promise.reject(new Error('Database error'))
      ),
    });

    const response = await request(app).get(
      '/admin/user-lists/user-with-lists'
    );

    assert.strictEqual(response.status, 500);
    assert.strictEqual(response.body.error, 'Error fetching user lists');
  });
});

// ============ ADMIN STATUS TESTS ============

describe('GET /api/admin/status', () => {
  it('should return admin status for admin user', async () => {
    const { app } = createTestApp();

    const response = await request(app).get('/api/admin/status');

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.isAdmin, true);
    assert.strictEqual(typeof response.body.codeValid, 'boolean');
    assert.ok(response.body.codeExpiresIn);
  });

  it('should return non-admin status for regular user', async () => {
    const { app } = createTestApp({ isAdmin: false });

    const response = await request(app).get('/api/admin/status');

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.isAdmin, false);
  });

  it('should show code validity', async () => {
    const { app } = createTestApp({
      adminCodeExpiry: new Date(Date.now() + 60000), // 1 minute from now
    });

    const response = await request(app).get('/api/admin/status');

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.codeValid, true);
  });

  it('should show expired code', async () => {
    const { app } = createTestApp({
      adminCodeExpiry: new Date(Date.now() - 60000), // 1 minute ago
    });

    const response = await request(app).get('/api/admin/status');

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.codeValid, false);
    assert.ok(response.body.codeExpiresIn.includes('0 seconds'));
  });

  it('should require authentication', async () => {
    const { app } = createTestApp({ authenticated: false });

    const response = await request(app).get('/api/admin/status');

    assert.strictEqual(response.status, 401);
  });
});

describe('GET /api/admin/bootstrap', () => {
  it('should return unified admin bootstrap payload', async () => {
    const poolQuery = mock.fn(async (sql) => {
      if (sql.includes('SELECT COUNT(*) FROM admin_events')) {
        return { rows: [{ count: '1' }] };
      }

      if (sql.includes('SELECT * FROM admin_events')) {
        return {
          rows: [
            {
              id: 1,
              event_type: 'account_approval',
              title: 'Needs approval',
              priority: 'high',
              status: 'pending',
            },
          ],
        };
      }

      if (sql.includes('SELECT priority, COUNT(*) as count')) {
        return { rows: [{ priority: 'high', count: '1' }] };
      }

      if (
        sql.includes(
          'SELECT user_id, COUNT(*) as list_count FROM lists GROUP BY user_id'
        )
      ) {
        return { rows: [{ user_id: 'admin-123', list_count: '2' }] };
      }

      if (sql.includes('WITH album_genres AS')) {
        return { rows: [{ total_albums: '10', active_users: '1' }] };
      }

      if (sql.includes('SELECT DISTINCT year FROM lists')) {
        return { rows: [{ year: 2024 }] };
      }

      if (
        sql.includes('FROM master_lists') &&
        sql.includes('WHERE year = ANY($1::int[])')
      ) {
        return {
          rows: [
            {
              year: 2024,
              revealed: false,
              revealed_at: null,
              computed_at: new Date(),
              locked: false,
              stats: {
                participantCount: 3,
                totalAlbums: 20,
                albumsWith3PlusVoters: 4,
                albumsWith2Voters: 6,
              },
            },
          ],
        };
      }

      if (sql.includes('FROM master_list_confirmations')) {
        return {
          rows: [
            { year: 2024, confirmed_at: new Date(), username: 'adminuser' },
          ],
        };
      }

      if (sql.includes('FROM recommendation_settings')) {
        return { rows: [{ year: 2024, locked: true }] };
      }

      if (
        sql.includes('FROM recommendation_access') &&
        sql.includes('COUNT(*)::int AS count')
      ) {
        return { rows: [] };
      }

      if (
        sql.includes('FROM recommendation_access') &&
        sql.includes('AND user_id = $2')
      ) {
        return { rows: [] };
      }

      if (
        sql.includes('FROM recommendations') &&
        sql.includes('GROUP BY year')
      ) {
        return { rows: [{ year: 2024, count: 5 }] };
      }

      return { rows: [], rowCount: 0 };
    });

    const { app } = createTestApp({ poolQuery });

    app.locals.telegramNotifier = {
      getConfig: mock.fn(async () => null),
      getRecommendationThreads: mock.fn(async () => []),
    };

    app.locals.albumSummaryService = {
      getStats: mock.fn(async () => ({
        totalAlbums: 20,
        withSummary: 12,
        attemptedNoSummary: 3,
        neverAttempted: 5,
        fromClaude: 12,
      })),
      getBatchStatus: mock.fn(() => ({ running: false })),
    };

    app.locals.imageRefetchService = {
      getStats: mock.fn(async () => ({
        totalAlbums: 20,
        withImage: 18,
        withoutImage: 2,
        avgSizeKb: 80,
        minSizeKb: 20,
        maxSizeKb: 220,
      })),
      isJobRunning: mock.fn(() => false),
      getProgress: mock.fn(() => null),
    };

    const response = await request(app).get('/api/admin/bootstrap');

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.hasData, true);
    assert.strictEqual(response.body.events.pending.length, 1);
    assert.strictEqual(response.body.aggregateLists.length, 1);
    assert.strictEqual(response.body.aggregateLists[0].year, 2024);
    assert.strictEqual(response.body.aggregateLists[0].recStatus.locked, true);
    assert.strictEqual(response.body.summaryStats.stats.withSummary, 12);
    assert.strictEqual(response.body.imageStats.stats.withImage, 18);
  });
});

describe('Admin catalog cleanup routes', () => {
  it('should return cleanup preview', async () => {
    const poolQuery = mock.fn(async (sql) => {
      if (sql.includes('FROM pg_tables')) {
        return { rows: [{ tablename: 'list_items' }] };
      }

      if (
        sql.includes('FROM albums a') &&
        sql.includes('orphan_albums_total')
      ) {
        return {
          rows: [
            {
              total_albums: 846,
              orphan_albums_total: 401,
              orphan_albums_eligible: 4,
              orphan_albums_too_young: 2,
            },
          ],
        };
      }

      if (sql.includes('SELECT a.album_id, a.artist, a.album, a.created_at')) {
        return {
          rows: [
            {
              album_id: 'internal-1',
              artist: 'Artist',
              album: 'Album',
              created_at: new Date(),
            },
          ],
        };
      }

      return { rows: [], rowCount: 0 };
    });

    const { app } = createTestApp({ poolQuery });
    const response = await request(app).get(
      '/api/admin/catalog-cleanup/preview'
    );

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.success, true);
    assert.strictEqual(response.body.preview.totalAlbums, 846);
    assert.strictEqual(response.body.preview.orphanAlbumsTotal, 401);
    assert.strictEqual(response.body.preview.orphanAlbums, 4);
    assert.strictEqual(response.body.preview.orphanAlbumsTooYoung, 2);
    assert.strictEqual(Array.isArray(response.body.preview.sampleAlbums), true);
  });

  it('should reject cleanup execute with stale preview count', async () => {
    const poolQuery = mock.fn(async (sql) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') {
        return { rows: [], rowCount: 0 };
      }

      if (sql.includes('FROM pg_tables')) {
        return { rows: [{ tablename: 'list_items' }] };
      }

      if (sql.includes('DROP TABLE IF EXISTS cleanup_album_targets')) {
        return { rows: [], rowCount: 0 };
      }

      if (sql.includes('CREATE TEMP TABLE cleanup_album_targets')) {
        return { rows: [], rowCount: 0 };
      }

      if (
        sql.includes('SELECT COUNT(*)::int AS count FROM cleanup_album_targets')
      ) {
        return { rows: [{ count: 3 }] };
      }

      return { rows: [], rowCount: 0 };
    });

    const { app } = createTestApp({ poolQuery });
    const response = await request(app)
      .post('/api/admin/catalog-cleanup/execute')
      .send({ minAgeDays: 30, expectedDeleteCount: 1 });

    assert.strictEqual(response.status, 409);
    assert.match(response.body.error, /stale/i);
    assert.strictEqual(response.body.expectedDeleteCount, 1);
    assert.strictEqual(response.body.currentDeleteCount, 3);
  });
});

// ============ ADMIN OPERATIONS EDGE CASES ============

describe('Admin Operations Edge Cases', () => {
  it('should handle multiple admin operations in sequence', async () => {
    const { app } = createTestApp();

    // Grant admin to user A
    let response = await request(app)
      .post('/admin/make-admin')
      .send({ userId: 'user-a' });
    assert.strictEqual(response.status, 200);

    // Grant admin to user B
    response = await request(app)
      .post('/admin/make-admin')
      .send({ userId: 'user-b' });
    assert.strictEqual(response.status, 200);

    // Revoke admin from user A
    response = await request(app)
      .post('/admin/revoke-admin')
      .send({ userId: 'user-a' });
    assert.strictEqual(response.status, 200);
  });

  it('should handle special characters in userId', async () => {
    const { app } = createTestApp();

    // The userId might contain special characters (like MongoDB ObjectId)
    const response = await request(app)
      .post('/admin/delete-user')
      .send({ userId: '507f1f77bcf86cd799439011' });

    assert.strictEqual(response.status, 200);
  });
});
