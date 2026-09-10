const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createMockLogger } = require('./helpers');
const {
  serializeIdentity,
  resolveSessionIdentity,
} = require('../services/session-identity');
const { beginOAuthState, consumeOAuthState } = require('../utils/oauth-state');
const {
  changePasswordHash,
  resetPasswordHash,
} = require('../db/repositories/password-mutations');
const { createCsrfProtection } = require('../middleware/csrf');
const { createEnsureAuthAPI } = require('../middleware/auth');
const {
  createOriginPolicyFromEnv,
  isAllowedOrigin,
} = require('../utils/origin-policy');

test('Passport serialization/deserialization cannot resurrect a pre-reset session', async () => {
  const { configurePassport } = require('../config/passport');
  let serialize;
  let deserialize;
  let user = { _id: 'passport-user', authVersion: '0', hash: 'old' };
  configurePassport(
    {
      use() {},
      serializeUser(fn) {
        serialize = fn;
      },
      deserializeUser(fn) {
        deserialize = fn;
      },
    },
    {
      authService: { getUserById: async () => ({ ...user }) },
      bcrypt: {},
    }
  );
  const identity = await new Promise((resolve) =>
    serialize(user, (_err, value) => resolve(value))
  );
  const read = () =>
    new Promise((resolve, reject) =>
      deserialize(identity, (err, value) =>
        err ? reject(err) : resolve(value)
      )
    );
  assert.equal((await read()).hash, 'old');
  user = { ...user, hash: 'new', authVersion: '1' };
  assert.equal(await read(), null);
});

test('production CORS rejects arbitrary and localhost-lookalike sites while accepting the configured app', () => {
  const policy = createOriginPolicyFromEnv({
    NODE_ENV: 'production',
    BASE_URL: 'https://sushe.example/app',
  });
  assert.equal(isAllowedOrigin('https://attacker.example', policy), false);
  assert.equal(
    isAllowedOrigin('https://localhost.attacker.example', policy),
    false
  );
  assert.equal(isAllowedOrigin('https://sushe.example', policy), true);
});

test('password-version changes revoke cached browser identities and fresh reads do not return the old hash', async () => {
  let user = {
    _id: 'u',
    hash: 'old',
    authVersion: '0',
    approvalStatus: 'approved',
  };
  const authService = { getUserById: async () => ({ ...user }) };
  const identity = serializeIdentity(user);
  assert.equal(
    (await resolveSessionIdentity(identity, authService)).hash,
    'old'
  );
  user = { ...user, hash: 'new', authVersion: '1' };
  assert.equal(await resolveSessionIdentity(identity, authService), null);
  assert.equal(await resolveSessionIdentity('u', authService), null);
  assert.equal(
    (await resolveSessionIdentity(serializeIdentity(user), authService)).hash,
    'new'
  );
  user.approvalStatus = 'rejected';
  assert.equal(
    await resolveSessionIdentity(serializeIdentity(user), authService),
    null
  );
});

test('password and reset mutations revoke tokens and sessions in the same transaction and roll back failures', async () => {
  for (const reset of [false, true]) {
    for (const fail of [false, true]) {
      let committedHash = 'old';
      const statements = [];
      const db = {
        withTransaction: async (fn) => {
          let stagedHash = committedHash;
          const result = await fn({
            query: async (sql, params) => {
              statements.push(sql);
              if (sql.includes('UPDATE users')) stagedHash = params[0];
              if (fail && sql.includes('UPDATE extension_tokens'))
                throw new Error('storage failure');
              return { rows: [{ _id: 'u' }], rowCount: 1 };
            },
          });
          committedHash = stagedHash;
          return result;
        },
      };
      const operation = reset
        ? resetPasswordHash(db, 'reset-digest', Date.now(), 'new')
        : changePasswordHash(db, 'u', 'new', 'old');
      if (fail) await assert.rejects(operation, /storage failure/);
      else await operation;
      assert.equal(committedHash, fail ? 'old' : 'new');
      assert.ok(statements[0].includes('auth_version = auth_version + 1'));
      if (!fail)
        assert.ok(
          statements.some((sql) => sql.includes('DELETE FROM session'))
        );
    }
  }
});

test('OAuth state is required, expires, and is consumed once', () => {
  const session = {};
  assert.equal(consumeOAuthState(session, 'spotify', undefined), false);
  const valid = beginOAuthState(session, 'spotify');
  assert.equal(consumeOAuthState(session, 'spotify', valid), true);
  assert.equal(consumeOAuthState(session, 'spotify', valid), false);
  const expired = beginOAuthState(session, 'spotify');
  session.spotifyStateCreatedAt -= 11 * 60 * 1000;
  assert.equal(consumeOAuthState(session, 'spotify', expired), false);
});

test('real Spotify callback rejects absent state before exchanging a code', async (t) => {
  const exchange = t.mock.method(global, 'fetch', async () => {
    throw new Error('must not exchange');
  });
  const app = express();
  app.use((req, _res, next) => {
    req.session = {};
    req.user = { _id: 'victim' };
    req.flash = () => {};
    next();
  });
  require('../routes/oauth/spotify')(app, {
    ensureAuth: (_req, _res, next) => next(),
    userService: {},
  });
  await request(app).get('/auth/spotify/callback?code=attacker').expect(302);
  assert.equal(exchange.mock.callCount(), 0);
});

test('session plus bearer header still requires CSRF; verified bearer-only calls remain supported', async () => {
  const auth = createEnsureAuthAPI({
    authService: { getUserById: async () => ({ _id: 'u' }) },
    db: {},
    recordActivity: () => {},
    logger: createMockLogger(),
    validateExtensionToken: async () => 'u',
    csrfProtection: createCsrfProtection(),
  });
  for (const session of [false, true]) {
    const req = {
      user: session ? { _id: 'u' } : null,
      isAuthenticated: () => session,
      session: { csrfSecret: 'secret' },
      method: 'POST',
      headers: {},
      get: () => 'Bearer ignored',
    };
    let error;
    await auth(req, {}, (value) => {
      error = value;
    });
    assert.equal(error?.code, session ? 'EBADCSRFTOKEN' : undefined);
    assert.equal(req.authMethod, session ? 'session' : 'token');
  }
});

test('extension completion requires configured origin, pending top-level tab, and single-use completion', async () => {
  require('../browser-extension/extension-constants');
  require('../browser-extension/login-flow');
  const stored = {};
  let tokenWrites = 0;
  let validates = 0;
  const chrome = {
    tabs: { create: async () => ({ id: 42 }), update: async () => {} },
    storage: {
      session: {
        set: async (value) => Object.assign(stored, value),
        get: async () => ({ ...stored }),
        remove: async (key) => {
          delete stored[key];
        },
      },
      local: {
        set: async () => {
          tokenWrites++;
        },
      },
    },
  };
  const flow = globalThis.ExtensionLoginFlow.createLoginFlow({
    chrome,
    getApiBase: () => 'https://sushe.example',
    fetch: async () => {
      validates++;
      return { ok: true, json: async () => ({ valid: true }) };
    },
  });
  await flow.begin();
  const message = { token: 'a'.repeat(43), expiresAt: '2099-01-01T00:00:00Z' };
  const sender = {
    tab: { id: 42 },
    frameId: 0,
    url: 'https://sushe.example/extension/auth',
  };
  await assert.rejects(
    flow.complete(message, {
      ...sender,
      url: 'https://attacker.example/extension/auth',
    })
  );
  await assert.rejects(flow.complete(message, { ...sender, frameId: 1 }));
  assert.equal(validates, 0);
  const outcomes = await Promise.allSettled([
    flow.complete(message, sender),
    flow.complete(message, sender),
  ]);
  assert.equal(
    outcomes.filter((outcome) => outcome.status === 'fulfilled').length,
    1
  );
  assert.equal(tokenWrites, 1);
});
