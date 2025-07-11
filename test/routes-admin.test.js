const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const request = require('supertest');
const crypto = require('crypto');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Mock logger to avoid file operations
const mockLogger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
};

// Mock the logger module
require.cache[require.resolve('../utils/logger')] = {
  exports: mockLogger,
};

// Mock database operations
const mockUsers = new Map();
const mockLists = new Map();
const mockListItems = new Map();
const mockAlbums = new Map();

const mockUsersAsync = {
  find: async (query) => {
    const results = [];
    for (const [id, user] of mockUsers) {
      if (!query || Object.keys(query).length === 0) {
        results.push({ ...user, _id: id });
      }
    }
    return results;
  },
  findOne: async (query) => {
    for (const [id, user] of mockUsers) {
      if (query._id && id === query._id) return { ...user, _id: id };
    }
    return null;
  },
};

const mockListsAsync = {
  find: async (query) => {
    const results = [];
    for (const [id, list] of mockLists) {
      if (!query.userId || list.userId === query.userId) {
        results.push({ ...list, _id: id });
      }
    }
    return results;
  },
};

const mockListItemsAsync = {
  find: async (query) => {
    const results = [];
    for (const [id, item] of mockListItems) {
      if (query.listId && item.listId === query.listId) {
        results.push({ ...item, _id: id });
      }
    }
    return results.sort((a, b) => a.position - b.position);
  },
  count: async (query) => {
    let count = 0;
    for (const [id, item] of mockListItems) {
      if (query.listId && item.listId === query.listId) count++;
    }
    return count;
  },
};

const mockAlbumsAsync = {
  findByIds: async (ids) => {
    const results = [];
    for (const id of ids) {
      if (mockAlbums.has(id)) {
        results.push({ ...mockAlbums.get(id), _id: id });
      }
    }
    return results;
  },
};

// Mock authentication middleware
const mockEnsureAuth = (req, res, next) => {
  if (req.user) {
    next();
  } else {
    res.status(401).json({ error: 'Authentication required' });
  }
};

const mockEnsureAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: 'Admin access required' });
  }
};

// Mock users operations
const mockUsersDB = {
  remove: (query, options, callback) => {
    setTimeout(() => {
      let removed = 0;
      for (const [id, user] of mockUsers) {
        if (query._id && id === query._id) {
          mockUsers.delete(id);
          removed++;
        }
      }
      callback(null, removed);
    }, 0);
  },
  update: (query, update, options, callback) => {
    setTimeout(() => {
      let updated = 0;
      for (const [id, user] of mockUsers) {
        if (query._id && id === query._id) {
          if (update.$set) Object.assign(user, update.$set);
          if (update.$unset) {
            Object.keys(update.$unset).forEach((key) => delete user[key]);
          }
          updated++;
        }
      }
      callback(null, updated);
    }, 0);
  },
  find: (query, callback) => {
    setTimeout(() => {
      const results = [];
      for (const [id, user] of mockUsers) {
        results.push({ ...user, _id: id });
      }
      callback(null, results);
    }, 0);
  },
};

// Mock lists operations
const mockListsDB = {
  remove: (query, options, callback) => {
    setTimeout(() => {
      let removed = 0;
      for (const [id, list] of mockLists) {
        if (query.userId && list.userId === query.userId) {
          mockLists.delete(id);
          removed++;
        }
      }
      callback(null, removed);
    }, 0);
  },
};

// Mock multer upload
const mockUpload = {
  single: (fieldName) => (req, res, next) => {
    req.file = {
      path: '/tmp/test-backup.dump',
      filename: 'test-backup.dump',
    };
    next();
  },
};

// Mock spawn for pg_dump/pg_restore
const mockSpawn = (command, args) => {
  const mockProcess = {
    stdout: {
      pipe: (stream) => {
        // Simulate piping data to response
        setTimeout(() => {
          stream.write('mock backup data');
          stream.end();
        }, 10);
      },
    },
    stderr: {
      on: (event, callback) => {
        if (event === 'data') {
          // Don't call callback to simulate no errors
        }
      },
    },
    on: (event, callback) => {
      if (event === 'error') {
        // Don't call callback to simulate no errors
      } else if (event === 'exit') {
        setTimeout(() => callback(0), 20); // Success exit code
      }
    },
  };
  return mockProcess;
};

function createTestApp() {
  const app = express();

  // Basic middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Mock user authentication - set admin user by default
  app.use((req, res, next) => {
    req.user = {
      _id: 'admin_user_id',
      email: 'admin@example.com',
      username: 'admin',
      role: 'admin',
    };

    // Mock session store
    req.sessionStore = {
      clear: (callback) => {
        setTimeout(() => callback(null), 0);
      },
    };

    next();
  });

  // Mock dependencies
  const deps = {
    ensureAuth: mockEnsureAuth,
    ensureAdmin: mockEnsureAdmin,
    users: mockUsersDB,
    lists: mockListsDB,
    usersAsync: mockUsersAsync,
    listsAsync: mockListsAsync,
    listItemsAsync: mockListItemsAsync,
    albumsAsync: mockAlbumsAsync,
    upload: mockUpload,
    adminCodeExpiry: new Date(Date.now() + 3600000),
    crypto,
  };

  // Mock spawn
  require.cache[require.resolve('child_process')] = {
    exports: { spawn: mockSpawn },
  };

  // Mock fs
  require.cache[require.resolve('fs')] = {
    exports: {
      existsSync: () => true,
      unlink: (path, callback) => callback && callback(),
    },
  };

  // Load admin routes
  require('../routes/admin')(app, deps);

  return app;
}

test('POST /admin/delete-user should delete user', async () => {
  const app = createTestApp();

  // Add test user
  mockUsers.set('user_to_delete', {
    email: 'delete@example.com',
    username: 'deleteuser',
  });

  const response = await request(app)
    .post('/admin/delete-user')
    .send({ userId: 'user_to_delete' })
    .expect(200);

  assert.strictEqual(response.body.success, true);
});

test('POST /admin/delete-user should prevent self-deletion', async () => {
  const app = createTestApp();

  const response = await request(app)
    .post('/admin/delete-user')
    .send({ userId: 'admin_user_id' })
    .expect(400);

  assert.ok(response.body.error.includes('Cannot delete yourself'));
});

test('POST /admin/delete-user should return 404 for non-existent user', async () => {
  const app = createTestApp();

  const response = await request(app)
    .post('/admin/delete-user')
    .send({ userId: 'non_existent_user' })
    .expect(404);

  assert.ok(response.body.error.includes('User not found'));
});

test('POST /admin/make-admin should grant admin privileges', async () => {
  const app = createTestApp();

  // Add test user
  mockUsers.set('regular_user', {
    email: 'user@example.com',
    username: 'regularuser',
  });

  const response = await request(app)
    .post('/admin/make-admin')
    .send({ userId: 'regular_user' })
    .expect(200);

  assert.strictEqual(response.body.success, true);
});

test('POST /admin/make-admin should return 404 for non-existent user', async () => {
  const app = createTestApp();

  const response = await request(app)
    .post('/admin/make-admin')
    .send({ userId: 'non_existent_user' })
    .expect(404);

  assert.ok(response.body.error.includes('User not found'));
});

test('POST /admin/revoke-admin should revoke admin privileges', async () => {
  const app = createTestApp();

  // Add test admin user
  mockUsers.set('admin_to_revoke', {
    email: 'admin2@example.com',
    username: 'admin2',
    role: 'admin',
  });

  const response = await request(app)
    .post('/admin/revoke-admin')
    .send({ userId: 'admin_to_revoke' })
    .expect(200);

  assert.strictEqual(response.body.success, true);
});

test('POST /admin/revoke-admin should prevent self-revocation', async () => {
  const app = createTestApp();

  const response = await request(app)
    .post('/admin/revoke-admin')
    .send({ userId: 'admin_user_id' })
    .expect(400);

  assert.ok(
    response.body.error.includes('Cannot revoke your own admin privileges')
  );
});

test('GET /admin/export-users should export users as CSV', async () => {
  const app = createTestApp();

  // Add test users
  mockUsers.set('user1', {
    email: 'user1@example.com',
    username: 'user1',
    role: 'user',
    createdAt: '2023-01-01T00:00:00.000Z',
  });
  mockUsers.set('user2', {
    email: 'user2@example.com',
    username: 'user2',
    role: 'admin',
    createdAt: '2023-01-01T00:00:00.000Z',
  });
  mockUsers.set('user2', {
    email: 'user2@example.com',
    username: 'user2',
    role: 'admin',
    createdAt: new Date(),
  });

  const response = await request(app).get('/admin/export-users').expect(200);

  assert.strictEqual(
    response.headers['content-type'],
    'text/csv; charset=utf-8'
  );
  assert.ok(
    response.headers['content-disposition'].includes('users-export.csv')
  );
  assert.ok(response.text.includes('Email,Username,Role,Created At'));
  assert.ok(response.text.includes('user1@example.com'));
  assert.ok(response.text.includes('user2@example.com'));
});

test('GET /admin/user-lists/:userId should return user lists', async () => {
  const app = createTestApp();

  // Add test data
  const userId = 'test_user';
  const listId = 'test_list';

  mockLists.set(listId, {
    name: 'Test List',
    userId: userId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const response = await request(app)
    .get(`/admin/user-lists/${userId}`)
    .expect(200);

  assert.ok(Array.isArray(response.body.lists));
  assert.strictEqual(response.body.lists[0].name, 'Test List');
});

test('GET /admin/export should export database as JSON', async () => {
  const app = createTestApp();

  // Add test data
  mockUsers.set('user1', {
    email: 'user1@example.com',
    username: 'user1',
  });

  mockLists.set('list1', {
    name: 'Test List',
    userId: 'user1',
  });

  const response = await request(app).get('/admin/export').expect(200);

  assert.strictEqual(
    response.headers['content-type'],
    'application/json; charset=utf-8'
  );
  assert.ok(
    response.headers['content-disposition'].includes('sushe-export.json')
  );

  const exportData = JSON.parse(response.text);
  assert.ok(exportData.exportDate);
  assert.ok(Array.isArray(exportData.users));
  assert.ok(Array.isArray(exportData.lists));
});

test('GET /admin/backup should create database backup', async () => {
  const app = createTestApp();

  const response = await request(app).get('/admin/backup').expect(200);

  assert.strictEqual(
    response.headers['content-type'],
    'application/octet-stream'
  );
  assert.ok(response.headers['content-disposition'].includes('sushe-db.dump'));
});

test('POST /admin/restore should restore database from backup', async () => {
  const app = createTestApp();

  const response = await request(app)
    .post('/admin/restore')
    .attach('backup', Buffer.from('mock backup data'), 'backup.dump')
    .expect(200);

  assert.strictEqual(response.body.success, true);
  assert.ok(response.body.message.includes('restored successfully'));
});

test('POST /admin/restore should require file upload', async () => {
  const app = express();
  app.use(express.json());

  // Mock user as admin
  app.use((req, res, next) => {
    req.user = { _id: 'admin', role: 'admin' };
    next();
  });

  const deps = {
    ensureAuth: mockEnsureAuth,
    ensureAdmin: mockEnsureAdmin,
    upload: {
      single: (fieldName) => (req, res, next) => {
        // No file uploaded
        req.file = null;
        next();
      },
    },
  };

  require('../routes/admin')(app, deps);

  const response = await request(app).post('/admin/restore').expect(400);

  assert.ok(response.body.error.includes('No file uploaded'));
});

test('POST /admin/clear-sessions should clear all sessions', async () => {
  const app = createTestApp();

  const response = await request(app).post('/admin/clear-sessions').expect(200);

  assert.strictEqual(response.body.success, true);
});

test('GET /api/admin/status should return admin status', async () => {
  const app = createTestApp();

  const response = await request(app).get('/api/admin/status').expect(200);

  assert.strictEqual(response.body.isAdmin, true);
  assert.strictEqual(response.body.codeValid, true);
  assert.ok(response.body.codeExpiresIn.includes('seconds'));
});

// OAuth tests removed due to complexity - these would require full session setup

test('GET /auth/spotify/callback should handle OAuth callback', async () => {
  const app = createTestApp();

  // Mock session with state
  app.use((req, res, next) => {
    req.session = { spotifyState: 'test_state' };
    req.flash = () => {};
    next();
  });

  // Mock fetch for token exchange
  global.fetch = async (url) => {
    if (url.includes('accounts.spotify.com/api/token')) {
      return {
        ok: true,
        json: async () => ({
          access_token: 'test_token',
          expires_in: 3600,
          refresh_token: 'refresh_token',
        }),
      };
    }
    throw new Error('Unexpected URL');
  };

  const response = await request(app)
    .get('/auth/spotify/callback?code=test_code&state=test_state')
    .expect(302);

  assert.strictEqual(response.headers.location, '/settings');
});

test('GET /auth/spotify/disconnect should disconnect Spotify', async () => {
  const app = createTestApp();

  // Mock session and flash
  app.use((req, res, next) => {
    req.flash = () => {};
    next();
  });

  const response = await request(app)
    .get('/auth/spotify/disconnect')
    .expect(302);

  assert.strictEqual(response.headers.location, '/settings');
});

test('GET /auth/tidal should initiate Tidal OAuth', async () => {
  const app = createTestApp();

  // Mock session
  app.use((req, res, next) => {
    req.session = {};
    next();
  });

  const response = await request(app).get('/auth/tidal').expect(302);

  assert.ok(response.headers.location.includes('login.tidal.com'));
});

test('Admin routes should require admin privileges', async () => {
  const app = express();
  app.use(express.json());

  // Mock regular user (not admin)
  app.use((req, res, next) => {
    req.user = {
      _id: 'regular_user',
      email: 'user@example.com',
      role: 'user',
    };
    next();
  });

  const deps = {
    ensureAuth: mockEnsureAuth,
    ensureAdmin: mockEnsureAdmin,
    users: mockUsersDB,
    lists: mockListsDB,
    upload: mockUpload,
  };

  require('../routes/admin')(app, deps);

  const response = await request(app)
    .post('/admin/delete-user')
    .send({ userId: 'some_user' })
    .expect(403);

  assert.ok(response.body.error.includes('Admin access required'));
});

test('Admin routes should require authentication', async () => {
  const app = express();
  app.use(express.json());

  // No user authentication
  app.use((req, res, next) => {
    req.user = null;
    next();
  });

  const deps = {
    ensureAuth: mockEnsureAuth,
    ensureAdmin: mockEnsureAdmin,
    users: mockUsersDB,
    lists: mockListsDB,
    upload: mockUpload,
  };

  require('../routes/admin')(app, deps);

  const response = await request(app)
    .post('/admin/delete-user')
    .send({ userId: 'some_user' })
    .expect(401);

  assert.ok(response.body.error.includes('Authentication required'));
});

test('Admin routes should require authentication', async () => {
  const app = express();
  app.use(express.json());

  // No user authentication
  app.use((req, res, next) => {
    req.user = null;
    next();
  });

  const deps = {
    ensureAuth: mockEnsureAuth,
    ensureAdmin: mockEnsureAdmin,
  };

  require('../routes/admin')(app, deps);

  const response = await request(app)
    .post('/admin/delete-user')
    .send({ userId: 'some_user' })
    .expect(401);

  assert.ok(response.body.error.includes('Authentication required'));
});
