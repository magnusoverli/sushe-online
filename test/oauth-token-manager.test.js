const test = require('node:test');
const assert = require('node:assert');
const { createOAuthTokenManager } = require('../utils/oauth-token-manager.js');

// Mock logger
const createMockLogger = () => ({
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
});

// Helper to create a manager with standard test config
function createTestManager(overrides = {}, deps = {}) {
  return createOAuthTokenManager(
    {
      serviceName: 'TestService',
      tokenUrl: 'https://auth.test.com/token',
      authField: 'testAuth',
      getClientCredentials: (env) => {
        const clientId = env.TEST_CLIENT_ID;
        if (!clientId) {
          return { valid: false, errorMessage: 'client ID not configured' };
        }
        return { valid: true, params: { client_id: clientId } };
      },
      ...overrides,
    },
    {
      logger: createMockLogger(),
      env: { TEST_CLIENT_ID: 'test_id' },
      ...deps,
    }
  );
}

// =============================================================================
// tokenNeedsRefresh tests
// =============================================================================

test('tokenNeedsRefresh should return false for null/undefined auth', () => {
  const { tokenNeedsRefresh } = createTestManager();

  assert.strictEqual(tokenNeedsRefresh(null), false);
  assert.strictEqual(tokenNeedsRefresh(undefined), false);
});

test('tokenNeedsRefresh should return false without access_token', () => {
  const { tokenNeedsRefresh } = createTestManager();

  assert.strictEqual(tokenNeedsRefresh({}), false);
  assert.strictEqual(tokenNeedsRefresh({ refresh_token: 'test' }), false);
});

test('tokenNeedsRefresh should return false without expires_at', () => {
  const { tokenNeedsRefresh } = createTestManager();

  assert.strictEqual(tokenNeedsRefresh({ access_token: 'test' }), false);
});

test('tokenNeedsRefresh should return true for expired token', () => {
  const { tokenNeedsRefresh } = createTestManager();

  const expiredAuth = {
    access_token: 'test',
    expires_at: Date.now() - 1000,
  };

  assert.strictEqual(tokenNeedsRefresh(expiredAuth), true);
});

test('tokenNeedsRefresh should return true for token expiring within buffer', () => {
  const { tokenNeedsRefresh } = createTestManager();

  const expiringAuth = {
    access_token: 'test',
    expires_at: Date.now() + 60000, // Expires in 1 minute (within 5 min default buffer)
  };

  assert.strictEqual(tokenNeedsRefresh(expiringAuth), true);
});

test('tokenNeedsRefresh should return false for valid token outside buffer', () => {
  const { tokenNeedsRefresh } = createTestManager();

  const validAuth = {
    access_token: 'test',
    expires_at: Date.now() + 3600000, // Expires in 1 hour
  };

  assert.strictEqual(tokenNeedsRefresh(validAuth), false);
});

test('tokenNeedsRefresh should respect custom buffer', () => {
  const { tokenNeedsRefresh } = createTestManager();

  const auth = {
    access_token: 'test',
    expires_at: Date.now() + 60000, // Expires in 1 minute
  };

  assert.strictEqual(tokenNeedsRefresh(auth, 30000), false);
  assert.strictEqual(tokenNeedsRefresh(auth, 120000), true);
});

// =============================================================================
// refreshToken tests
// =============================================================================

test('refreshToken should return null without refresh_token', async () => {
  const { refreshToken } = createTestManager();

  const result = await refreshToken({});
  assert.strictEqual(result, null);

  const result2 = await refreshToken(null);
  assert.strictEqual(result2, null);
});

test('refreshToken should return null without valid credentials', async () => {
  const { refreshToken } = createTestManager({}, { env: {} });

  const result = await refreshToken({ refresh_token: 'test' });
  assert.strictEqual(result, null);
});

test('refreshToken should return null on 400 error', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 400,
    text: async () => 'Invalid refresh token',
  });

  const { refreshToken } = createTestManager({}, { fetch: mockFetch });

  const result = await refreshToken({ refresh_token: 'invalid' });
  assert.strictEqual(result, null);
});

test('refreshToken should return null on 401 error', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 401,
    text: async () => 'Unauthorized',
  });

  const { refreshToken } = createTestManager({}, { fetch: mockFetch });

  const result = await refreshToken({ refresh_token: 'revoked' });
  assert.strictEqual(result, null);
});

test('refreshToken should return null on 500 error', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 500,
    text: async () => 'Server error',
  });

  const { refreshToken } = createTestManager({}, { fetch: mockFetch });

  const result = await refreshToken({ refresh_token: 'test' });
  assert.strictEqual(result, null);
});

test('refreshToken should return null on network error', async () => {
  const mockFetch = async () => {
    throw new Error('Network error');
  };

  const { refreshToken } = createTestManager({}, { fetch: mockFetch });

  const result = await refreshToken({ refresh_token: 'test' });
  assert.strictEqual(result, null);
});

test('refreshToken should return new token on success', async () => {
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      access_token: 'new_access_token',
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: 'new_refresh_token',
      scope: 'user-read-private',
    }),
  });

  const { refreshToken } = createTestManager({}, { fetch: mockFetch });

  const result = await refreshToken({ refresh_token: 'old_refresh' });

  assert.ok(result);
  assert.strictEqual(result.access_token, 'new_access_token');
  assert.strictEqual(result.token_type, 'Bearer');
  assert.strictEqual(result.expires_in, 3600);
  assert.strictEqual(result.refresh_token, 'new_refresh_token');
  assert.strictEqual(result.scope, 'user-read-private');
  assert.ok(result.expires_at > Date.now());
});

test('refreshToken should keep old refresh_token if not returned', async () => {
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      access_token: 'new_access_token',
      expires_in: 3600,
    }),
  });

  const { refreshToken } = createTestManager({}, { fetch: mockFetch });

  const result = await refreshToken({
    refresh_token: 'original_refresh',
    scope: 'original-scope',
  });

  assert.ok(result);
  assert.strictEqual(result.refresh_token, 'original_refresh');
  assert.strictEqual(result.scope, 'original-scope');
  assert.strictEqual(result.token_type, 'Bearer');
});

test('refreshToken should call fetch with correct parameters', async () => {
  let fetchCalledWith = null;

  const mockFetch = async (url, options) => {
    fetchCalledWith = { url, options };
    return {
      ok: true,
      json: async () => ({ access_token: 'token', expires_in: 3600 }),
    };
  };

  const { refreshToken } = createTestManager({}, { fetch: mockFetch });

  await refreshToken({ refresh_token: 'my_refresh' });

  assert.strictEqual(fetchCalledWith.url, 'https://auth.test.com/token');
  assert.strictEqual(fetchCalledWith.options.method, 'POST');
  assert.strictEqual(
    fetchCalledWith.options.headers['Content-Type'],
    'application/x-www-form-urlencoded'
  );
  assert.ok(fetchCalledWith.options.body.includes('grant_type=refresh_token'));
  assert.ok(fetchCalledWith.options.body.includes('refresh_token=my_refresh'));
  assert.ok(fetchCalledWith.options.body.includes('client_id=test_id'));
});

test('refreshToken should use custom onRefreshSuccess callback', async () => {
  let callbackCalled = false;
  let callbackArgs = null;

  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      access_token: 'new_token',
      expires_in: 3600,
      scope: 'test-scope',
    }),
  });

  const { refreshToken } = createTestManager(
    {
      onRefreshSuccess: (log, newToken, result) => {
        callbackCalled = true;
        callbackArgs = { newToken, result };
      },
    },
    { fetch: mockFetch }
  );

  await refreshToken({ refresh_token: 'test' });

  assert.strictEqual(callbackCalled, true);
  assert.strictEqual(callbackArgs.newToken.access_token, 'new_token');
  assert.strictEqual(callbackArgs.result.scope, 'test-scope');
});

test('refreshToken should pass service-specific credential params', async () => {
  let fetchCalledWith = null;

  const mockFetch = async (url, options) => {
    fetchCalledWith = { url, options };
    return {
      ok: true,
      json: async () => ({ access_token: 'token', expires_in: 3600 }),
    };
  };

  const manager = createOAuthTokenManager(
    {
      serviceName: 'TestWithSecret',
      tokenUrl: 'https://auth.test.com/token',
      authField: 'testAuth',
      getClientCredentials: () => ({
        valid: true,
        params: {
          client_id: 'my_id',
          client_secret: 'my_secret',
        },
      }),
    },
    { logger: createMockLogger(), fetch: mockFetch, env: {} }
  );

  await manager.refreshToken({ refresh_token: 'my_refresh' });

  assert.ok(fetchCalledWith.options.body.includes('client_id=my_id'));
  assert.ok(fetchCalledWith.options.body.includes('client_secret=my_secret'));
});

// =============================================================================
// ensureValidToken tests
// =============================================================================

test('ensureValidToken should return NOT_AUTHENTICATED without auth', async () => {
  const { ensureValidToken } = createTestManager();

  const result = await ensureValidToken({}, null);

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.error, 'NOT_AUTHENTICATED');
  assert.strictEqual(result.testAuth, null);
});

test('ensureValidToken should return NOT_AUTHENTICATED without access_token', async () => {
  const { ensureValidToken } = createTestManager();

  const result = await ensureValidToken(
    { testAuth: { refresh_token: 'test' } },
    null
  );

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.error, 'NOT_AUTHENTICATED');
});

test('ensureValidToken should return valid auth if not expired', async () => {
  const { ensureValidToken } = createTestManager();

  const testAuth = {
    access_token: 'valid_token',
    expires_at: Date.now() + 3600000,
  };

  const result = await ensureValidToken({ testAuth }, null);

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.testAuth, testAuth);
  assert.strictEqual(result.error, null);
});

test('ensureValidToken should return TOKEN_EXPIRED without refresh_token', async () => {
  const { ensureValidToken } = createTestManager();

  const testAuth = {
    access_token: 'expired_token',
    expires_at: Date.now() - 1000,
  };

  const result = await ensureValidToken({ testAuth }, null);

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.error, 'TOKEN_EXPIRED');
});

test('ensureValidToken should return TOKEN_REFRESH_FAILED on refresh failure', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 400,
    text: async () => 'Invalid token',
  });

  const { ensureValidToken } = createTestManager({}, { fetch: mockFetch });

  const user = {
    _id: 'user123',
    email: 'test@example.com',
    testAuth: {
      access_token: 'expired_token',
      expires_at: Date.now() - 1000,
      refresh_token: 'invalid_refresh',
    },
  };

  const result = await ensureValidToken(user, null);

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.error, 'TOKEN_REFRESH_FAILED');
});

test('ensureValidToken should refresh and save token successfully', async () => {
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      access_token: 'new_token',
      expires_in: 3600,
      refresh_token: 'new_refresh',
    }),
  });

  let dbUpdateCalled = false;
  const mockUsersDb = {
    update: (query, update, options, callback) => {
      dbUpdateCalled = true;
      assert.strictEqual(query._id, 'user123');
      assert.ok(update.$set.testAuth);
      assert.ok(update.$set.updatedAt);
      callback(null);
    },
  };

  const { ensureValidToken } = createTestManager({}, { fetch: mockFetch });

  const user = {
    _id: 'user123',
    email: 'test@example.com',
    testAuth: {
      access_token: 'expired_token',
      expires_at: Date.now() - 1000,
      refresh_token: 'old_refresh',
    },
  };

  const result = await ensureValidToken(user, mockUsersDb);

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.testAuth.access_token, 'new_token');
  assert.strictEqual(result.error, null);
  assert.strictEqual(dbUpdateCalled, true);
  assert.strictEqual(user.testAuth.access_token, 'new_token');
});

test('ensureValidToken should succeed even if DB save fails', async () => {
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      access_token: 'new_token',
      expires_in: 3600,
    }),
  });

  const mockUsersDb = {
    update: (query, update, options, callback) => {
      callback(new Error('DB error'));
    },
  };

  const { ensureValidToken } = createTestManager({}, { fetch: mockFetch });

  const user = {
    _id: 'user123',
    email: 'test@example.com',
    testAuth: {
      access_token: 'expired_token',
      expires_at: Date.now() - 1000,
      refresh_token: 'refresh',
    },
  };

  const result = await ensureValidToken(user, mockUsersDb);

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.testAuth.access_token, 'new_token');
  assert.strictEqual(result.error, null);
});

test('ensureValidToken uses correct authField as response key', async () => {
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      access_token: 'new_token',
      expires_in: 3600,
    }),
  });

  const mockUsersDb = {
    update: (query, update, options, callback) => callback(null),
  };

  // Create manager with a custom auth field name
  const manager = createOAuthTokenManager(
    {
      serviceName: 'Custom',
      tokenUrl: 'https://auth.custom.com/token',
      authField: 'customServiceAuth',
      getClientCredentials: () => ({
        valid: true,
        params: { client_id: 'id' },
      }),
    },
    {
      logger: createMockLogger(),
      fetch: mockFetch,
      env: {},
    }
  );

  const user = {
    _id: 'user123',
    email: 'test@example.com',
    customServiceAuth: {
      access_token: 'expired_token',
      expires_at: Date.now() - 1000,
      refresh_token: 'refresh',
    },
  };

  const result = await manager.ensureValidToken(user, mockUsersDb);

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.customServiceAuth.access_token, 'new_token');
  // Should NOT have other auth field keys
  assert.strictEqual(result.testAuth, undefined);
  assert.strictEqual(result.spotifyAuth, undefined);
});

// =============================================================================
// Logging tests
// =============================================================================

test('credential error message should be logged correctly', async () => {
  const logMessages = [];
  const mockLogger = {
    error: (msg, data) => logMessages.push({ level: 'error', msg, data }),
    warn: (msg, data) => logMessages.push({ level: 'warn', msg, data }),
    info: (msg, data) => logMessages.push({ level: 'info', msg, data }),
  };

  const manager = createOAuthTokenManager(
    {
      serviceName: 'TestSvc',
      tokenUrl: 'https://auth.test.com/token',
      authField: 'testAuth',
      getClientCredentials: () => ({
        valid: false,
        errorMessage: 'client credentials not configured',
      }),
    },
    { logger: mockLogger, env: {} }
  );

  await manager.refreshToken({ refresh_token: 'test' });

  assert.ok(logMessages.some((m) => m.level === 'error'));
  assert.ok(
    logMessages.some(
      (m) =>
        m.msg.includes('TestSvc') &&
        m.msg.includes('credentials not configured')
    )
  );
});
