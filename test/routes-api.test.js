const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const request = require('supertest');
const crypto = require('crypto');

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

// Mock response cache
const mockResponseCache = {
  invalidate: () => {},
};

require.cache[require.resolve('../middleware/response-cache')] = {
  exports: {
    cacheConfigs: {
      userSpecific: (req, res, next) => next(),
      public: (req, res, next) => next(),
      static: (req, res, next) => next(),
    },
    responseCache: mockResponseCache,
  },
};

// Mock database operations
const mockUsers = new Map();
const mockLists = new Map();
const mockListItems = new Map();
const mockAlbums = new Map();

const mockUsersAsync = {
  findOne: async (query) => {
    for (const [id, user] of mockUsers) {
      if (query._id && id === query._id) return { ...user, _id: id };
      if (query.email && user.email === query.email)
        return { ...user, _id: id };
    }
    return null;
  },
};

const mockListsAsync = {
  find: async (query) => {
    const results = [];
    for (const [id, list] of mockLists) {
      if (query.userId && list.userId === query.userId) {
        results.push({ ...list, _id: id });
      }
    }
    return results;
  },
  findOne: async (query) => {
    for (const [id, list] of mockLists) {
      if (
        query.userId &&
        list.userId === query.userId &&
        query.name &&
        list.name === query.name
      ) {
        return { ...list, _id: id };
      }
    }
    return null;
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

// Mock pool for database operations
const mockPool = {
  connect: async () => ({
    query: async (sql, params) => {
      if (sql.includes('INSERT INTO lists')) {
        const listId = 'list_' + Date.now();
        return { rows: [{ _id: listId }] };
      }
      return { rows: [] };
    },
    release: () => {},
  }),
  query: async (sql, params) => ({ rows: [] }),
};

// Mock authentication middleware
const mockEnsureAuthAPI = (req, res, next) => {
  if (req.user) {
    next();
  } else {
    res.status(401).json({ error: 'Authentication required' });
  }
};

// Mock CSRF protection
const mockCsrfProtection = (req, res, next) => {
  req.csrfToken = () => 'mock-csrf-token';
  next();
};

// Mock templates
const mockTemplates = {
  htmlTemplate: (content, title) =>
    `<html><head><title>${title}</title></head><body>${content}</body></html>`,
  forgotPasswordTemplate: (req, flash) =>
    `<div>Forgot Password Form</div><div>Password Recovery</div>`,
  invalidTokenTemplate: () => `<div>Invalid Token</div>`,
  resetPasswordTemplate: (token) => `<div>Reset Password Form</div>`,
};

// Mock users operations
const mockUsersDB = {
  findOne: (query, callback) => {
    setTimeout(() => {
      for (const [id, user] of mockUsers) {
        if (query._id && id === query._id) {
          return callback(null, { ...user, _id: id });
        }
        if (query.email && user.email === query.email) {
          return callback(null, { ...user, _id: id });
        }
        if (query.resetToken && user.resetToken === query.resetToken) {
          return callback(null, { ...user, _id: id });
        }
      }
      callback(null, null);
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
};

// Mock lists operations
const mockListsDB = {
  findOne: (query, callback) => {
    setTimeout(() => {
      for (const [id, list] of mockLists) {
        if (
          query.userId &&
          list.userId === query.userId &&
          query.name &&
          list.name === query.name
        ) {
          return callback(null, { ...list, _id: id });
        }
      }
      callback(null, null);
    }, 0);
  },
  remove: (query, options, callback) => {
    setTimeout(() => {
      let removed = 0;
      for (const [id, list] of mockLists) {
        if (
          query.userId &&
          list.userId === query.userId &&
          query.name &&
          list.name === query.name
        ) {
          mockLists.delete(id);
          removed++;
        }
      }
      callback(null, removed);
    }, 0);
  },
};

// Mock list items operations
const mockListItemsDB = {
  find: (query, callback) => {
    setTimeout(() => {
      const results = [];
      for (const [id, item] of mockListItems) {
        if (query.listId && item.listId === query.listId) {
          results.push({ ...item, _id: id });
        }
      }
      callback(null, results);
    }, 0);
  },
  insert: (data, callback) => {
    setTimeout(() => {
      const id = 'item_' + Date.now();
      mockListItems.set(id, data);
      callback(null, { ...data, _id: id });
    }, 0);
  },
};

// Mock albums operations
const mockAlbumsDB = {
  findOne: (query, callback) => {
    setTimeout(() => {
      for (const [id, album] of mockAlbums) {
        if (query.spotifyId && album.spotifyId === query.spotifyId) {
          return callback(null, { ...album, _id: id });
        }
      }
      callback(null, null);
    }, 0);
  },
  insert: (data, callback) => {
    setTimeout(() => {
      const id = 'album_' + Date.now();
      mockAlbums.set(id, data);
      callback(null, { ...data, _id: id });
    }, 0);
  },
};

// Mock broadcast function
const mockBroadcastListUpdate = () => {};
const mockListSubscribers = new Map();

function createTestApp() {
  const app = express();

  // Basic middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Mock user authentication
  app.use((req, res, next) => {
    // Set a default test user for authenticated routes
    req.user = {
      _id: 'test_user_id',
      email: 'test@example.com',
      username: 'testuser',
      spotifyAuth: null,
      tidalAuth: null,
    };
    // Mock flash function
    req.flash = (type, message) => {
      if (!req.session) req.session = {};
      if (!req.session.flash) req.session.flash = {};
      if (message) {
        if (!req.session.flash[type]) req.session.flash[type] = [];
        req.session.flash[type].push(message);
      } else {
        const messages = req.session.flash[type] || [];
        delete req.session.flash[type];
        return messages;
      }
    };
    // Mock res.locals.flash
    res.locals = res.locals || {};
    res.locals.flash = {};
    next();
  });

  // Mock dependencies
  const deps = {
    cacheConfigs: {
      userSpecific: (req, res, next) => next(),
      public: (req, res, next) => next(),
      static: (req, res, next) => next(),
    },
    responseCache: mockResponseCache,
    htmlTemplate: mockTemplates.htmlTemplate,
    forgotPasswordTemplate: mockTemplates.forgotPasswordTemplate,
    invalidTokenTemplate: mockTemplates.invalidTokenTemplate,
    resetPasswordTemplate: mockTemplates.resetPasswordTemplate,
    ensureAuthAPI: mockEnsureAuthAPI,
    users: {
      findOne: (query, callback) => {
        setTimeout(() => {
          for (const [id, user] of mockUsers) {
            if (query.email && user.email === query.email) {
              return callback(null, { ...user, _id: id });
            }
            if (query.resetToken && user.resetToken === query.resetToken) {
              return callback(null, { ...user, _id: id });
            }
          }
          callback(null, null);
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
    },
    lists: mockListsDB,
    listsAsync: mockListsAsync,
    listItemsAsync: mockListItemsAsync,
    albumsAsync: mockAlbumsAsync,
    bcrypt: require('bcryptjs'),
    crypto,
    nodemailer: {
      createTransporter: () => ({
        sendMail: (options, callback) => callback(null, { messageId: 'test' }),
      }),
    },
    composeForgotPasswordEmail: (email, resetUrl) => ({
      from: 'test@example.com',
      to: email,
      subject: 'Password Reset',
      text: `Reset your password: ${resetUrl}`,
    }),
    csrfProtection: mockCsrfProtection,
    broadcastListUpdate: mockBroadcastListUpdate,
    listSubscribers: mockListSubscribers,
    pool: mockPool,
  };

  // Load API routes
  require('../routes/api')(app, deps);

  return app;
}

test('GET /api/lists should return user lists', async () => {
  const app = createTestApp();

  // Add test data
  const listId = 'list_1';
  mockLists.set(listId, {
    name: 'My Favorites',
    userId: 'test_user_id',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const response = await request(app).get('/api/lists').expect(200);

  assert.ok(typeof response.body === 'object');
  assert.ok(response.body['My Favorites']);
});

test('GET /api/lists should require authentication', async () => {
  const app = express();
  app.use(express.json());

  // No authentication middleware
  const deps = {
    ensureAuthAPI: (req, res, next) => {
      res.status(401).json({ error: 'Authentication required' });
    },
    cacheConfigs: {
      userSpecific: (req, res, next) => next(),
      public: (req, res, next) => next(),
      static: (req, res, next) => next(),
    },
    responseCache: mockResponseCache,
    htmlTemplate: mockTemplates.htmlTemplate,
    forgotPasswordTemplate: mockTemplates.forgotPasswordTemplate,
    invalidTokenTemplate: mockTemplates.invalidTokenTemplate,
    resetPasswordTemplate: mockTemplates.resetPasswordTemplate,
    users: mockUsersDB,
    lists: mockListsDB,
    listItems: mockListItemsDB,
    albums: mockAlbumsDB,
    listsAsync: mockListsAsync,
    listItemsAsync: mockListItemsAsync,
    albumsAsync: mockAlbumsAsync,
    bcrypt: require('bcryptjs'),
    crypto,
    nodemailer: {
      createTransporter: () => ({
        sendMail: (options, callback) => callback(null, { messageId: 'test' }),
      }),
    },
    composeForgotPasswordEmail: (email, resetUrl) => ({
      from: 'test@example.com',
      to: email,
      subject: 'Password Reset',
      text: `Reset your password: ${resetUrl}`,
    }),
    csrfProtection: mockCsrfProtection,
    broadcastListUpdate: mockBroadcastListUpdate,
    listSubscribers: mockListSubscribers,
    pool: mockPool,
  };

  require('../routes/api')(app, deps);

  const response = await request(app).get('/api/lists').expect(401);

  assert.ok(response.body.error.includes('Authentication required'));
});

test('GET /api/lists/:name should return specific list', async () => {
  const app = createTestApp();

  // Add test data
  const listId = 'list_1';
  mockLists.set(listId, {
    name: 'Test List',
    userId: 'test_user_id',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const response = await request(app).get('/api/lists/Test%20List').expect(200);

  assert.ok(Array.isArray(response.body));
});

test('GET /api/lists/:name should return 404 for non-existent list', async () => {
  const app = createTestApp();

  const response = await request(app).get('/api/lists/NonExistent').expect(404);

  assert.ok(response.body.error.includes('List not found'));
});

test('POST /api/lists/:name should reject invalid data', async () => {
  const app = createTestApp();

  const response = await request(app)
    .post('/api/lists/Test%20List')
    .send({ data: 'invalid' })
    .expect(400);

  assert.ok(response.body.error.includes('Invalid list data'));
});

test('DELETE /api/lists/:name should delete list', async () => {
  const app = createTestApp();

  // Add test list
  const listId = 'list_to_delete';
  mockLists.set(listId, {
    name: 'List to Delete',
    userId: 'test_user_id',
  });

  const response = await request(app)
    .delete('/api/lists/List%20to%20Delete')
    .expect(200);

  assert.strictEqual(response.body.success, true);
  assert.ok(response.body.message.includes('deleted'));
});

test('DELETE /api/lists/:name should return 404 for non-existent list', async () => {
  const app = createTestApp();

  const response = await request(app)
    .delete('/api/lists/NonExistent')
    .expect(404);

  assert.ok(response.body.error.includes('List not found'));
});

test('POST /forgot should handle password reset request', async () => {
  const app = createTestApp();

  // Add test user
  mockUsers.set('user_1', {
    email: 'test@example.com',
    username: 'testuser',
  });

  const response = await request(app)
    .post('/forgot')
    .send({
      email: 'test@example.com',
      _csrf: 'mock-csrf-token',
    })
    .expect(302);

  assert.strictEqual(response.headers.location, '/forgot');
});

test('POST /forgot should handle non-existent email gracefully', async () => {
  const app = createTestApp();

  const response = await request(app)
    .post('/forgot')
    .send({
      email: 'nonexistent@example.com',
      _csrf: 'mock-csrf-token',
    })
    .expect(302);

  // Should still redirect to maintain security
  assert.strictEqual(response.headers.location, '/forgot');
});

test('GET /reset/:token should show invalid token for expired token', async () => {
  const app = createTestApp();

  const response = await request(app).get('/reset/invalid_token').expect(200);

  assert.ok(response.text.includes('Invalid Token'));
});

test('GET /api/proxy/deezer should proxy Deezer API', async () => {
  const app = createTestApp();

  const response = await request(app)
    .get('/api/proxy/deezer?q=test')
    .expect(200);

  // Validate structure instead of specific content
  assert.ok(response.body.data, 'Response should have data array');
  assert.ok(Array.isArray(response.body.data), 'data should be an array');
  
  if (response.body.data.length > 0) {
    // If we have results, check they have expected structure
    const firstResult = response.body.data[0];
    assert.ok(typeof firstResult === 'object', 'First result should be an object');
    // Deezer API typically returns albums with title property
    assert.ok('title' in firstResult || 'name' in firstResult, 'Result should have title or name');
  }
});

test('GET /api/proxy/deezer should require query parameter', async () => {
  const app = createTestApp();

  const response = await request(app).get('/api/proxy/deezer').expect(400);

  assert.ok(response.body.error.includes('Query parameter q is required'));
});

test('GET /api/spotify/album should require Spotify authentication', async () => {
  const app = createTestApp();

  const response = await request(app)
    .get('/api/spotify/album?artist=Test&album=Album')
    .expect(400);

  assert.ok(response.body.error.includes('Not authenticated with Spotify'));
});

test('GET /api/tidal/album should require Tidal authentication', async () => {
  const app = createTestApp();

  const response = await request(app)
    .get('/api/tidal/album?artist=Test&album=Album')
    .expect(400);

  assert.ok(response.body.error.includes('Not authenticated with Tidal'));
});

test('GET /api/unfurl should fetch metadata from URL', async () => {
  const app = createTestApp();

  const response = await request(app)
    .get('/api/unfurl?url=http://example.com')
    .expect(200);

  // Validate structure instead of specific content
  assert.ok(typeof response.body === 'object', 'Response should be an object');
  assert.ok('title' in response.body, 'Response should have title property');
  assert.ok('description' in response.body, 'Response should have description property');
  assert.ok('image' in response.body, 'Response should have image property');
  
  // Validate that title has some content (example.com should have a title)
  assert.ok(typeof response.body.title === 'string', 'Title should be a string');
  assert.ok(response.body.title.length > 0, 'Title should not be empty');
});

test('GET /api/unfurl should require URL parameter', async () => {
  const app = createTestApp();

  const response = await request(app).get('/api/unfurl').expect(400);

  assert.ok(response.body.error.includes('url query is required'));
});

test('GET /api/musicbrainz/tracks should fetch track list or handle errors appropriately', async () => {
  const app = createTestApp();

  const response = await request(app)
    .get('/api/musicbrainz/tracks?artist=Test%20Artist&album=Test%20Album');

  // The endpoint can return either 200 (success) or error status depending on:
  // - Network connectivity
  // - MusicBrainz API availability
  // - Whether the artist/album is found
  if (response.status === 200) {
    // If successful, validate the response structure
    assert.ok(typeof response.body === 'object', 'Response should be an object');
    
    // Check if it returned tracks data
    if (response.body.tracks) {
      assert.ok(Array.isArray(response.body.tracks), 'tracks should be an array');
    }
  } else {
    // If error, should be 400 (bad request) or 500 (server error)
    assert.ok([400, 404, 500].includes(response.status), 'Error status should be 400, 404, or 500');
    
    if (response.body && response.body.error) {
      assert.ok(typeof response.body.error === 'string', 'Error message should be a string');
    }
  }
});

test('GET /api/lists/subscribe/:name should setup SSE connection', async () => {
  const app = createTestApp();

  const response = await request(app)
    .get('/api/lists/subscribe/Test%20List')
    .expect(200);

  assert.ok(response.headers['content-type'].includes('text/event-stream'));
});
