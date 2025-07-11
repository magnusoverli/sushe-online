const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const request = require('supertest');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');

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

const mockUsersAsync = {
  findOne: async (query) => {
    for (const [id, user] of mockUsers) {
      if (query.email && user.email === query.email)
        return { ...user, _id: id };
      if (query.username && user.username === query.username)
        return { ...user, _id: id };
      if (query._id && id === query._id) return { ...user, _id: id };
    }
    return null;
  },
  insert: async (userData) => {
    const id = 'user_' + Date.now();
    mockUsers.set(id, { ...userData, _id: id });
    return { ...userData, _id: id };
  },
  update: async (query, update) => {
    for (const [id, user] of mockUsers) {
      if (query._id && id === query._id) {
        if (update.$set) Object.assign(user, update.$set);
        if (update.$unset) {
          Object.keys(update.$unset).forEach((key) => delete user[key]);
        }
        return 1;
      }
    }
    return 0;
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
  count: async (query) => {
    let count = 0;
    for (const [id, list] of mockLists) {
      if (query.userId && list.userId === query.userId) count++;
    }
    return count;
  },
};

const mockListItemsAsync = {
  count: async () => 0,
};

// Mock validation functions
const {
  isValidEmail,
  isValidUsername,
  isValidPassword,
} = require('../validators');

// Mock templates
const mockTemplates = {
  htmlTemplate: (content, title) =>
    `<html><head><title>${title}</title></head><body>${content}</body></html>`,
  registerTemplate: (req, flash) => `<form>Register Form</form>`,
  loginTemplate: (req, flash) => `<form>Login Form</form>`,
  spotifyTemplate: (user) => `<div>Welcome ${user.username}</div>`,
  settingsTemplate: (req, data) =>
    `<div>Settings for ${data.user.username}</div>`,
};

// Mock CSRF protection
const mockCsrfProtection = (req, res, next) => {
  req.csrfToken = () => 'mock-csrf-token';
  next();
};

// Mock authentication middleware
const mockEnsureAuth = (req, res, next) => {
  if (req.user) {
    next();
  } else {
    res.status(401).json({ error: 'Authentication required' });
  }
};

const mockEnsureAuthAPI = (req, res, next) => {
  if (req.user) {
    next();
  } else {
    res.status(401).json({ error: 'Authentication required' });
  }
};

// Mock sanitizeUser function
const mockSanitizeUser = (user) => {
  const { hash, resetToken, resetExpires, ...sanitized } = user;
  return sanitized;
};

function createTestApp() {
  const app = express();

  // Basic middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Session middleware
  app.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false },
    })
  );

  // Passport setup
  passport.use(
    new LocalStrategy(
      { usernameField: 'email' },
      async (email, password, done) => {
        try {
          const user = await mockUsersAsync.findOne({ email });
          if (!user) {
            return done(null, false, { message: 'Invalid credentials' });
          }

          const isMatch = await bcrypt.compare(password, user.hash);
          if (!isMatch) {
            return done(null, false, { message: 'Invalid credentials' });
          }

          return done(null, user);
        } catch (err) {
          return done(err);
        }
      }
    )
  );

  passport.serializeUser((user, done) => done(null, user._id));
  passport.deserializeUser(async (id, done) => {
    try {
      const user = await mockUsersAsync.findOne({ _id: id });
      done(null, user);
    } catch (err) {
      done(err);
    }
  });

  app.use(passport.initialize());
  app.use(passport.session());

  // Flash messages mock
  app.use((req, res, next) => {
    req.flash = (type, message) => {
      req.session.flash = req.session.flash || {};
      req.session.flash[type] = message;
    };
    res.locals.flash = req.session.flash || {};
    delete req.session.flash;
    next();
  });

  // Mock dependencies
  const deps = {
    htmlTemplate: mockTemplates.htmlTemplate,
    registerTemplate: mockTemplates.registerTemplate,
    loginTemplate: mockTemplates.loginTemplate,
    spotifyTemplate: mockTemplates.spotifyTemplate,
    settingsTemplate: mockTemplates.settingsTemplate,
    isTokenValid: () => false,
    csrfProtection: mockCsrfProtection,
    ensureAuth: mockEnsureAuth,
    ensureAuthAPI: mockEnsureAuthAPI,
    users: {
      update: (query, update, options, callback) => {
        mockUsersAsync
          .update(query, update)
          .then((result) => callback(null, result))
          .catch(callback);
      },
    },
    usersAsync: mockUsersAsync,
    listsAsync: mockListsAsync,
    listItemsAsync: mockListItemsAsync,
    bcrypt,
    isValidEmail,
    isValidUsername,
    isValidPassword,
    sanitizeUser: mockSanitizeUser,
    adminCodeAttempts: new Map(),
    adminCode: 'TEST123',
    adminCodeExpiry: new Date(Date.now() + 3600000),
    generateAdminCode: () => {},
    dataDir: '/tmp',
    pool: {},
    passport,
    rateLimitAdminRequest: (req, res, next) => next(),
  };

  // Load auth routes
  require('../routes/auth')(app, deps);

  return app;
}

test('GET /register should render registration form', async () => {
  const app = createTestApp();

  const response = await request(app).get('/register').expect(200);

  assert.ok(response.text.includes('Register Form'));
  assert.ok(response.text.includes('Join the KVLT'));
});

test('POST /register should create new user with valid data', async () => {
  const app = createTestApp();

  const userData = {
    email: 'test@example.com',
    username: 'testuser',
    password: 'password123',
    confirmPassword: 'password123',
    _csrf: 'mock-csrf-token',
  };

  const response = await request(app)
    .post('/register')
    .send(userData)
    .expect(302);

  assert.strictEqual(response.headers.location, '/login');

  // Verify user was created
  const user = await mockUsersAsync.findOne({ email: 'test@example.com' });
  assert.ok(user);
  assert.strictEqual(user.username, 'testuser');
  assert.ok(user.hash); // Password should be hashed
});

test('POST /register should reject invalid email', async () => {
  const app = createTestApp();

  const userData = {
    email: 'invalid-email',
    username: 'testuser',
    password: 'password123',
    confirmPassword: 'password123',
    _csrf: 'mock-csrf-token',
  };

  const response = await request(app)
    .post('/register')
    .send(userData)
    .expect(302);

  assert.strictEqual(response.headers.location, '/register');
});

test('POST /register should reject mismatched passwords', async () => {
  const app = createTestApp();

  const userData = {
    email: 'test@example.com',
    username: 'testuser',
    password: 'password123',
    confirmPassword: 'different123',
    _csrf: 'mock-csrf-token',
  };

  const response = await request(app)
    .post('/register')
    .send(userData)
    .expect(302);

  assert.strictEqual(response.headers.location, '/register');
});

test('POST /register should reject duplicate email', async () => {
  const app = createTestApp();

  // Create existing user
  await mockUsersAsync.insert({
    email: 'existing@example.com',
    username: 'existing',
    hash: await bcrypt.hash('password123', 12),
  });

  const userData = {
    email: 'existing@example.com',
    username: 'newuser',
    password: 'password123',
    confirmPassword: 'password123',
    _csrf: 'mock-csrf-token',
  };

  const response = await request(app)
    .post('/register')
    .send(userData)
    .expect(302);

  assert.strictEqual(response.headers.location, '/register');
});

test('GET /login should render login form', async () => {
  const app = createTestApp();

  const response = await request(app).get('/login').expect(200);

  assert.ok(response.text.includes('Login Form'));
  assert.ok(response.text.includes('SuShe Online'));
});

test('GET /login should redirect if already authenticated', async () => {
  const app = createTestApp();

  // Create and login user
  const user = await mockUsersAsync.insert({
    email: 'test@example.com',
    username: 'testuser',
    hash: await bcrypt.hash('password123', 12),
  });

  const agent = request.agent(app);

  // Login first
  await agent.post('/login').send({
    email: 'test@example.com',
    password: 'password123',
    _csrf: 'mock-csrf-token',
  });

  // Then try to access login page
  const response = await agent.get('/login').expect(302);

  assert.strictEqual(response.headers.location, '/');
});

test('POST /login should authenticate valid user', async () => {
  const app = createTestApp();

  // Create user
  await mockUsersAsync.insert({
    email: 'test@example.com',
    username: 'testuser',
    hash: await bcrypt.hash('password123', 12),
  });

  const response = await request(app)
    .post('/login')
    .send({
      email: 'test@example.com',
      password: 'password123',
      _csrf: 'mock-csrf-token',
    })
    .expect(302);

  assert.strictEqual(response.headers.location, '/');
});

test('POST /login should reject invalid credentials', async () => {
  const app = createTestApp();

  // Create user
  await mockUsersAsync.insert({
    email: 'test@example.com',
    username: 'testuser',
    hash: await bcrypt.hash('password123', 12),
  });

  const response = await request(app)
    .post('/login')
    .send({
      email: 'test@example.com',
      password: 'wrongpassword',
      _csrf: 'mock-csrf-token',
    })
    .expect(302);

  assert.strictEqual(response.headers.location, '/login');
});

test('GET /logout should logout user', async () => {
  const app = createTestApp();

  const response = await request(app).get('/logout').expect(302);

  assert.strictEqual(response.headers.location, '/login');
});

test('GET / should require authentication', async () => {
  const app = createTestApp();

  const response = await request(app).get('/').expect(401);

  assert.ok(response.body.error.includes('Authentication required'));
});

test('GET / should render home page for authenticated user', async () => {
  const app = createTestApp();

  // Create and login user
  const user = await mockUsersAsync.insert({
    email: 'test@example.com',
    username: 'testuser',
    hash: await bcrypt.hash('password123', 12),
  });

  const agent = request.agent(app);

  // Login first
  await agent.post('/login').send({
    email: 'test@example.com',
    password: 'password123',
    _csrf: 'mock-csrf-token',
  });

  // Then access home page
  const response = await agent.get('/').expect(200);

  assert.ok(response.text.includes('Welcome testuser'));
});

test('GET /settings should require authentication', async () => {
  const app = createTestApp();

  const response = await request(app).get('/settings').expect(401);

  assert.ok(response.body.error.includes('Authentication required'));
});

test('POST /settings/update-accent-color should update user accent color', async () => {
  const app = createTestApp();

  // Create and login user
  const user = await mockUsersAsync.insert({
    email: 'test@example.com',
    username: 'testuser',
    hash: await bcrypt.hash('password123', 12),
    accentColor: '#dc2626',
  });

  const agent = request.agent(app);

  // Login first
  await agent.post('/login').send({
    email: 'test@example.com',
    password: 'password123',
    _csrf: 'mock-csrf-token',
  });

  // Update accent color
  const response = await agent
    .post('/settings/update-accent-color')
    .send({ accentColor: '#3b82f6' })
    .expect(200);

  assert.strictEqual(response.body.success, true);
});

test('POST /settings/update-accent-color should reject invalid color format', async () => {
  const app = createTestApp();

  // Create and login user
  const user = await mockUsersAsync.insert({
    email: 'test@example.com',
    username: 'testuser',
    hash: await bcrypt.hash('password123', 12),
  });

  const agent = request.agent(app);

  // Login first
  await agent.post('/login').send({
    email: 'test@example.com',
    password: 'password123',
    _csrf: 'mock-csrf-token',
  });

  // Try invalid color
  const response = await agent
    .post('/settings/update-accent-color')
    .send({ accentColor: 'invalid-color' })
    .expect(400);

  assert.ok(response.body.error.includes('Invalid color format'));
});

test('POST /api/user/last-list should update last selected list', async () => {
  const app = createTestApp();

  // Create and login user
  const user = await mockUsersAsync.insert({
    email: 'test@example.com',
    username: 'testuser',
    hash: await bcrypt.hash('password123', 12),
  });

  const agent = request.agent(app);

  // Login first
  await agent.post('/login').send({
    email: 'test@example.com',
    password: 'password123',
    _csrf: 'mock-csrf-token',
  });

  // Update last list
  const response = await agent
    .post('/api/user/last-list')
    .send({ listName: 'My Favorites' })
    .expect(200);

  assert.strictEqual(response.body.success, true);
});
