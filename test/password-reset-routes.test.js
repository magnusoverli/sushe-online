const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const request = require('supertest');
const session = require('express-session');

function createTestApp(overrides = {}) {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: true,
      cookie: { secure: false },
    })
  );

  app.use((req, res, next) => {
    req.flash = () => {};
    res.locals.flash = {};
    next();
  });

  const usersAsync = {
    findOne:
      overrides.findOne ||
      mock.fn(() =>
        Promise.resolve({ _id: 'user-1', email: 'user@example.com' })
      ),
    update: overrides.update || mock.fn(() => Promise.resolve(1)),
  };

  const bcrypt = {
    hash: overrides.hash || mock.fn(() => Promise.resolve('hashed-password')),
  };

  const deps = {
    users: {
      findOne: mock.fn((_query, callback) => callback(null, null)),
    },
    usersAsync,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    crypto: require('crypto'),
    bcrypt,
    nodemailer: {
      createTransport: () => ({ sendMail: () => Promise.resolve() }),
    },
    csrfProtection: (_req, _res, next) => next(),
    forgotPasswordRateLimit: (_req, _res, next) => next(),
    resetPasswordRateLimit: (_req, _res, next) => next(),
    htmlTemplate: (body) => body,
    forgotPasswordTemplate: () => '<form></form>',
    invalidTokenTemplate: () => '<p>invalid</p>',
    resetPasswordTemplate: () => '<form></form>',
    composeForgotPasswordEmail: () => ({}),
    isValidPassword:
      overrides.isValidPassword ||
      ((password) => typeof password === 'string' && password.length >= 8),
  };

  require('../routes/api/password-reset')(app, deps);

  return { app, usersAsync, bcrypt };
}

describe('password-reset routes', () => {
  it('rejects weak password before hashing on reset', async () => {
    const { app, bcrypt, usersAsync } = createTestApp({
      isValidPassword: () => false,
    });

    const response = await request(app)
      .post('/reset/test-token')
      .send({ password: 'short' });

    assert.strictEqual(response.status, 302);
    assert.strictEqual(response.headers.location, '/reset/test-token');
    assert.strictEqual(bcrypt.hash.mock.calls.length, 0);
    assert.strictEqual(usersAsync.update.mock.calls.length, 0);
  });

  it('hashes and updates when password is valid', async () => {
    const { app, bcrypt, usersAsync } = createTestApp();

    const response = await request(app)
      .post('/reset/test-token')
      .send({ password: 'long-enough-password' });

    assert.strictEqual(response.status, 302);
    assert.strictEqual(response.headers.location, '/login');
    assert.strictEqual(bcrypt.hash.mock.calls.length, 1);
    assert.strictEqual(usersAsync.update.mock.calls.length, 1);
  });
});
