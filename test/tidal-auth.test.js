const test = require('node:test');
const assert = require('node:assert');
const { createTidalAuth } = require('../utils/tidal-auth.js');

// Mock logger
const createMockLogger = () => ({
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
});

// =============================================================================
// tidalTokenNeedsRefresh tests
// =============================================================================

test('tidalTokenNeedsRefresh should return false for null/undefined auth', () => {
  const { tidalTokenNeedsRefresh } = createTidalAuth();

  assert.strictEqual(tidalTokenNeedsRefresh(null), false);
  assert.strictEqual(tidalTokenNeedsRefresh(undefined), false);
});

test('tidalTokenNeedsRefresh should return false without access_token', () => {
  const { tidalTokenNeedsRefresh } = createTidalAuth();

  assert.strictEqual(tidalTokenNeedsRefresh({}), false);
  assert.strictEqual(tidalTokenNeedsRefresh({ refresh_token: 'test' }), false);
});

test('tidalTokenNeedsRefresh should return false without expires_at', () => {
  const { tidalTokenNeedsRefresh } = createTidalAuth();

  assert.strictEqual(tidalTokenNeedsRefresh({ access_token: 'test' }), false);
});

test('tidalTokenNeedsRefresh should return true for expired token', () => {
  const { tidalTokenNeedsRefresh } = createTidalAuth();

  const expiredAuth = {
    access_token: 'test',
    expires_at: Date.now() - 1000, // Expired 1 second ago
  };

  assert.strictEqual(tidalTokenNeedsRefresh(expiredAuth), true);
});

test('tidalTokenNeedsRefresh should return true for token expiring within buffer', () => {
  const { tidalTokenNeedsRefresh } = createTidalAuth();

  const expiringAuth = {
    access_token: 'test',
    expires_at: Date.now() + 60000, // Expires in 1 minute (within 5 min default buffer)
  };

  assert.strictEqual(tidalTokenNeedsRefresh(expiringAuth), true);
});

test('tidalTokenNeedsRefresh should return false for valid token outside buffer', () => {
  const { tidalTokenNeedsRefresh } = createTidalAuth();

  const validAuth = {
    access_token: 'test',
    expires_at: Date.now() + 3600000, // Expires in 1 hour
  };

  assert.strictEqual(tidalTokenNeedsRefresh(validAuth), false);
});

test('tidalTokenNeedsRefresh should respect custom buffer', () => {
  const { tidalTokenNeedsRefresh } = createTidalAuth();

  const auth = {
    access_token: 'test',
    expires_at: Date.now() + 60000, // Expires in 1 minute
  };

  // With 30 second buffer, should NOT need refresh
  assert.strictEqual(tidalTokenNeedsRefresh(auth, 30000), false);

  // With 2 minute buffer, should need refresh
  assert.strictEqual(tidalTokenNeedsRefresh(auth, 120000), true);
});

// =============================================================================
// refreshTidalToken tests
// =============================================================================

test('refreshTidalToken should return null without refresh_token', async () => {
  const logger = createMockLogger();
  const { refreshTidalToken } = createTidalAuth({ logger });

  const result = await refreshTidalToken({});
  assert.strictEqual(result, null);

  const result2 = await refreshTidalToken(null);
  assert.strictEqual(result2, null);
});

test('refreshTidalToken should return null without client ID', async () => {
  const logger = createMockLogger();
  const { refreshTidalToken } = createTidalAuth({
    logger,
    env: {}, // No credentials
  });

  const result = await refreshTidalToken({ refresh_token: 'test' });
  assert.strictEqual(result, null);
});

test('refreshTidalToken should return null on 400 error', async () => {
  const logger = createMockLogger();
  const mockFetch = async () => ({
    ok: false,
    status: 400,
    text: async () => 'Invalid refresh token',
  });

  const { refreshTidalToken } = createTidalAuth({
    logger,
    fetch: mockFetch,
    env: { TIDAL_CLIENT_ID: 'id' },
  });

  const result = await refreshTidalToken({ refresh_token: 'invalid' });
  assert.strictEqual(result, null);
});

test('refreshTidalToken should return null on 401 error', async () => {
  const logger = createMockLogger();
  const mockFetch = async () => ({
    ok: false,
    status: 401,
    text: async () => 'Unauthorized',
  });

  const { refreshTidalToken } = createTidalAuth({
    logger,
    fetch: mockFetch,
    env: { TIDAL_CLIENT_ID: 'id' },
  });

  const result = await refreshTidalToken({ refresh_token: 'revoked' });
  assert.strictEqual(result, null);
});

test('refreshTidalToken should return null on other HTTP errors', async () => {
  const logger = createMockLogger();
  const mockFetch = async () => ({
    ok: false,
    status: 500,
    text: async () => 'Server error',
  });

  const { refreshTidalToken } = createTidalAuth({
    logger,
    fetch: mockFetch,
    env: { TIDAL_CLIENT_ID: 'id' },
  });

  const result = await refreshTidalToken({ refresh_token: 'test' });
  assert.strictEqual(result, null);
});

test('refreshTidalToken should return null on network error', async () => {
  const logger = createMockLogger();
  const mockFetch = async () => {
    throw new Error('Network error');
  };

  const { refreshTidalToken } = createTidalAuth({
    logger,
    fetch: mockFetch,
    env: { TIDAL_CLIENT_ID: 'id' },
  });

  const result = await refreshTidalToken({ refresh_token: 'test' });
  assert.strictEqual(result, null);
});

test('refreshTidalToken should return new token on success', async () => {
  const logger = createMockLogger();
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      access_token: 'new_access_token',
      token_type: 'Bearer',
      expires_in: 86400,
      refresh_token: 'new_refresh_token',
      scope: 'user.read playlists.read',
    }),
  });

  const { refreshTidalToken } = createTidalAuth({
    logger,
    fetch: mockFetch,
    env: { TIDAL_CLIENT_ID: 'id' },
  });

  const result = await refreshTidalToken({ refresh_token: 'old_refresh' });

  assert.ok(result);
  assert.strictEqual(result.access_token, 'new_access_token');
  assert.strictEqual(result.token_type, 'Bearer');
  assert.strictEqual(result.expires_in, 86400);
  assert.strictEqual(result.refresh_token, 'new_refresh_token');
  assert.strictEqual(result.scope, 'user.read playlists.read');
  assert.ok(result.expires_at > Date.now());
});

test('refreshTidalToken should keep old refresh_token if not returned', async () => {
  const logger = createMockLogger();
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      access_token: 'new_access_token',
      expires_in: 86400,
      // No refresh_token in response
    }),
  });

  const { refreshTidalToken } = createTidalAuth({
    logger,
    fetch: mockFetch,
    env: { TIDAL_CLIENT_ID: 'id' },
  });

  const result = await refreshTidalToken({
    refresh_token: 'original_refresh',
    scope: 'original-scope',
  });

  assert.ok(result);
  assert.strictEqual(result.refresh_token, 'original_refresh');
  assert.strictEqual(result.scope, 'original-scope');
  assert.strictEqual(result.token_type, 'Bearer'); // Default
});

// =============================================================================
// ensureValidTidalToken tests
// =============================================================================

test('ensureValidTidalToken should return NOT_AUTHENTICATED without tidalAuth', async () => {
  const logger = createMockLogger();
  const { ensureValidTidalToken } = createTidalAuth({ logger });

  const result = await ensureValidTidalToken({}, null);

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.error, 'NOT_AUTHENTICATED');
  assert.strictEqual(result.tidalAuth, null);
});

test('ensureValidTidalToken should return NOT_AUTHENTICATED without access_token', async () => {
  const logger = createMockLogger();
  const { ensureValidTidalToken } = createTidalAuth({ logger });

  const result = await ensureValidTidalToken(
    { tidalAuth: { refresh_token: 'test' } },
    null
  );

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.error, 'NOT_AUTHENTICATED');
});

test('ensureValidTidalToken should return valid auth if not expired', async () => {
  const logger = createMockLogger();
  const { ensureValidTidalToken } = createTidalAuth({ logger });

  const tidalAuth = {
    access_token: 'valid_token',
    expires_at: Date.now() + 3600000, // 1 hour from now
  };

  const result = await ensureValidTidalToken({ tidalAuth }, null);

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.tidalAuth, tidalAuth);
  assert.strictEqual(result.error, null);
});

test('ensureValidTidalToken should return TOKEN_EXPIRED without refresh_token', async () => {
  const logger = createMockLogger();
  const { ensureValidTidalToken } = createTidalAuth({ logger });

  const tidalAuth = {
    access_token: 'expired_token',
    expires_at: Date.now() - 1000, // Expired
    // No refresh_token
  };

  const result = await ensureValidTidalToken({ tidalAuth }, null);

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.error, 'TOKEN_EXPIRED');
});

test('ensureValidTidalToken should return TOKEN_REFRESH_FAILED on refresh failure', async () => {
  const logger = createMockLogger();
  const mockFetch = async () => ({
    ok: false,
    status: 400,
    text: async () => 'Invalid token',
  });

  const { ensureValidTidalToken } = createTidalAuth({
    logger,
    fetch: mockFetch,
    env: { TIDAL_CLIENT_ID: 'id' },
  });

  const user = {
    _id: 'user123',
    email: 'test@example.com',
    tidalAuth: {
      access_token: 'expired_token',
      expires_at: Date.now() - 1000,
      refresh_token: 'invalid_refresh',
    },
  };

  const result = await ensureValidTidalToken(user, null);

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.error, 'TOKEN_REFRESH_FAILED');
});

test('ensureValidTidalToken should refresh and save token successfully', async () => {
  const logger = createMockLogger();
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      access_token: 'new_token',
      expires_in: 86400,
      refresh_token: 'new_refresh',
    }),
  });

  let dbUpdateCalled = false;
  const mockUsersDb = {
    update: (query, update, options, callback) => {
      dbUpdateCalled = true;
      assert.strictEqual(query._id, 'user123');
      assert.ok(update.$set.tidalAuth);
      assert.ok(update.$set.updatedAt);
      callback(null);
    },
  };

  const { ensureValidTidalToken } = createTidalAuth({
    logger,
    fetch: mockFetch,
    env: { TIDAL_CLIENT_ID: 'id' },
  });

  const user = {
    _id: 'user123',
    email: 'test@example.com',
    tidalAuth: {
      access_token: 'expired_token',
      expires_at: Date.now() - 1000,
      refresh_token: 'old_refresh',
    },
  };

  const result = await ensureValidTidalToken(user, mockUsersDb);

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.tidalAuth.access_token, 'new_token');
  assert.strictEqual(result.error, null);
  assert.strictEqual(dbUpdateCalled, true);
  // User object should be updated in memory
  assert.strictEqual(user.tidalAuth.access_token, 'new_token');
});

test('ensureValidTidalToken should succeed even if DB save fails', async () => {
  const logger = createMockLogger();
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      access_token: 'new_token',
      expires_in: 86400,
    }),
  });

  const mockUsersDb = {
    update: (query, update, options, callback) => {
      callback(new Error('DB error'));
    },
  };

  const { ensureValidTidalToken } = createTidalAuth({
    logger,
    fetch: mockFetch,
    env: { TIDAL_CLIENT_ID: 'id' },
  });

  const user = {
    _id: 'user123',
    email: 'test@example.com',
    tidalAuth: {
      access_token: 'expired_token',
      expires_at: Date.now() - 1000,
      refresh_token: 'refresh',
    },
  };

  const result = await ensureValidTidalToken(user, mockUsersDb);

  // Should still succeed - token is valid even if not saved
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.tidalAuth.access_token, 'new_token');
  assert.strictEqual(result.error, null);
});

// =============================================================================
// Edge cases and logging tests
// =============================================================================

test('refreshTidalToken should call fetch with correct parameters', async () => {
  const logger = createMockLogger();
  let fetchCalledWith = null;

  const mockFetch = async (url, options) => {
    fetchCalledWith = { url, options };
    return {
      ok: true,
      json: async () => ({ access_token: 'token', expires_in: 86400 }),
    };
  };

  const { refreshTidalToken } = createTidalAuth({
    logger,
    fetch: mockFetch,
    env: { TIDAL_CLIENT_ID: 'my_id' },
  });

  await refreshTidalToken({ refresh_token: 'my_refresh' });

  assert.strictEqual(
    fetchCalledWith.url,
    'https://auth.tidal.com/v1/oauth2/token'
  );
  assert.strictEqual(fetchCalledWith.options.method, 'POST');
  assert.strictEqual(
    fetchCalledWith.options.headers['Content-Type'],
    'application/x-www-form-urlencoded'
  );
  assert.ok(fetchCalledWith.options.body.includes('grant_type=refresh_token'));
  assert.ok(fetchCalledWith.options.body.includes('refresh_token=my_refresh'));
  assert.ok(fetchCalledWith.options.body.includes('client_id=my_id'));
  // Tidal doesn't require client_secret for refresh
  assert.ok(!fetchCalledWith.options.body.includes('client_secret'));
});

test('logger should be called with appropriate messages', async () => {
  const logMessages = [];
  const logger = {
    error: (msg, data) => logMessages.push({ level: 'error', msg, data }),
    warn: (msg, data) => logMessages.push({ level: 'warn', msg, data }),
    info: (msg, data) => logMessages.push({ level: 'info', msg, data }),
  };

  const { refreshTidalToken } = createTidalAuth({
    logger,
    env: {}, // Missing credentials
  });

  await refreshTidalToken({ refresh_token: 'test' });

  assert.ok(logMessages.some((m) => m.level === 'error'));
  assert.ok(
    logMessages.some((m) => m.msg.includes('client ID not configured'))
  );
});
