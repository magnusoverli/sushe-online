const test = require('node:test');
const assert = require('node:assert');
const { createSpotifyAuth } = require('../utils/spotify-auth.js');

// Mock logger
const createMockLogger = () => ({
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
});

// =============================================================================
// spotifyTokenNeedsRefresh tests
// =============================================================================

test('spotifyTokenNeedsRefresh should return false for null/undefined auth', () => {
  const { spotifyTokenNeedsRefresh } = createSpotifyAuth();

  assert.strictEqual(spotifyTokenNeedsRefresh(null), false);
  assert.strictEqual(spotifyTokenNeedsRefresh(undefined), false);
});

test('spotifyTokenNeedsRefresh should return false without access_token', () => {
  const { spotifyTokenNeedsRefresh } = createSpotifyAuth();

  assert.strictEqual(spotifyTokenNeedsRefresh({}), false);
  assert.strictEqual(
    spotifyTokenNeedsRefresh({ refresh_token: 'test' }),
    false
  );
});

test('spotifyTokenNeedsRefresh should return false without expires_at', () => {
  const { spotifyTokenNeedsRefresh } = createSpotifyAuth();

  assert.strictEqual(spotifyTokenNeedsRefresh({ access_token: 'test' }), false);
});

test('spotifyTokenNeedsRefresh should return true for expired token', () => {
  const { spotifyTokenNeedsRefresh } = createSpotifyAuth();

  const expiredAuth = {
    access_token: 'test',
    expires_at: Date.now() - 1000, // Expired 1 second ago
  };

  assert.strictEqual(spotifyTokenNeedsRefresh(expiredAuth), true);
});

test('spotifyTokenNeedsRefresh should return true for token expiring within buffer', () => {
  const { spotifyTokenNeedsRefresh } = createSpotifyAuth();

  const expiringAuth = {
    access_token: 'test',
    expires_at: Date.now() + 60000, // Expires in 1 minute (within 5 min default buffer)
  };

  assert.strictEqual(spotifyTokenNeedsRefresh(expiringAuth), true);
});

test('spotifyTokenNeedsRefresh should return false for valid token outside buffer', () => {
  const { spotifyTokenNeedsRefresh } = createSpotifyAuth();

  const validAuth = {
    access_token: 'test',
    expires_at: Date.now() + 3600000, // Expires in 1 hour
  };

  assert.strictEqual(spotifyTokenNeedsRefresh(validAuth), false);
});

test('spotifyTokenNeedsRefresh should respect custom buffer', () => {
  const { spotifyTokenNeedsRefresh } = createSpotifyAuth();

  const auth = {
    access_token: 'test',
    expires_at: Date.now() + 60000, // Expires in 1 minute
  };

  // With 30 second buffer, should NOT need refresh
  assert.strictEqual(spotifyTokenNeedsRefresh(auth, 30000), false);

  // With 2 minute buffer, should need refresh
  assert.strictEqual(spotifyTokenNeedsRefresh(auth, 120000), true);
});

// =============================================================================
// refreshSpotifyToken tests
// =============================================================================

test('refreshSpotifyToken should return null without refresh_token', async () => {
  const logger = createMockLogger();
  const { refreshSpotifyToken } = createSpotifyAuth({ logger });

  const result = await refreshSpotifyToken({});
  assert.strictEqual(result, null);

  const result2 = await refreshSpotifyToken(null);
  assert.strictEqual(result2, null);
});

test('refreshSpotifyToken should return null without client credentials', async () => {
  const logger = createMockLogger();
  const { refreshSpotifyToken } = createSpotifyAuth({
    logger,
    env: {}, // No credentials
  });

  const result = await refreshSpotifyToken({ refresh_token: 'test' });
  assert.strictEqual(result, null);
});

test('refreshSpotifyToken should return null on 400 error', async () => {
  const logger = createMockLogger();
  const mockFetch = async () => ({
    ok: false,
    status: 400,
    text: async () => 'Invalid refresh token',
  });

  const { refreshSpotifyToken } = createSpotifyAuth({
    logger,
    fetch: mockFetch,
    env: { SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET: 'secret' },
  });

  const result = await refreshSpotifyToken({ refresh_token: 'invalid' });
  assert.strictEqual(result, null);
});

test('refreshSpotifyToken should return null on 401 error', async () => {
  const logger = createMockLogger();
  const mockFetch = async () => ({
    ok: false,
    status: 401,
    text: async () => 'Unauthorized',
  });

  const { refreshSpotifyToken } = createSpotifyAuth({
    logger,
    fetch: mockFetch,
    env: { SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET: 'secret' },
  });

  const result = await refreshSpotifyToken({ refresh_token: 'revoked' });
  assert.strictEqual(result, null);
});

test('refreshSpotifyToken should return null on other HTTP errors', async () => {
  const logger = createMockLogger();
  const mockFetch = async () => ({
    ok: false,
    status: 500,
    text: async () => 'Server error',
  });

  const { refreshSpotifyToken } = createSpotifyAuth({
    logger,
    fetch: mockFetch,
    env: { SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET: 'secret' },
  });

  const result = await refreshSpotifyToken({ refresh_token: 'test' });
  assert.strictEqual(result, null);
});

test('refreshSpotifyToken should return null on network error', async () => {
  const logger = createMockLogger();
  const mockFetch = async () => {
    throw new Error('Network error');
  };

  const { refreshSpotifyToken } = createSpotifyAuth({
    logger,
    fetch: mockFetch,
    env: { SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET: 'secret' },
  });

  const result = await refreshSpotifyToken({ refresh_token: 'test' });
  assert.strictEqual(result, null);
});

test('refreshSpotifyToken should return new token on success', async () => {
  const logger = createMockLogger();
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

  const { refreshSpotifyToken } = createSpotifyAuth({
    logger,
    fetch: mockFetch,
    env: { SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET: 'secret' },
  });

  const result = await refreshSpotifyToken({ refresh_token: 'old_refresh' });

  assert.ok(result);
  assert.strictEqual(result.access_token, 'new_access_token');
  assert.strictEqual(result.token_type, 'Bearer');
  assert.strictEqual(result.expires_in, 3600);
  assert.strictEqual(result.refresh_token, 'new_refresh_token');
  assert.strictEqual(result.scope, 'user-read-private');
  assert.ok(result.expires_at > Date.now());
});

test('refreshSpotifyToken should keep old refresh_token if not returned', async () => {
  const logger = createMockLogger();
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      access_token: 'new_access_token',
      expires_in: 3600,
      // No refresh_token in response
    }),
  });

  const { refreshSpotifyToken } = createSpotifyAuth({
    logger,
    fetch: mockFetch,
    env: { SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET: 'secret' },
  });

  const result = await refreshSpotifyToken({
    refresh_token: 'original_refresh',
    scope: 'original-scope',
  });

  assert.ok(result);
  assert.strictEqual(result.refresh_token, 'original_refresh');
  assert.strictEqual(result.scope, 'original-scope');
  assert.strictEqual(result.token_type, 'Bearer'); // Default
});

// =============================================================================
// ensureValidSpotifyToken tests
// =============================================================================

test('ensureValidSpotifyToken should return NOT_AUTHENTICATED without spotifyAuth', async () => {
  const logger = createMockLogger();
  const { ensureValidSpotifyToken } = createSpotifyAuth({ logger });

  const result = await ensureValidSpotifyToken({}, null);

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.error, 'NOT_AUTHENTICATED');
  assert.strictEqual(result.spotifyAuth, null);
});

test('ensureValidSpotifyToken should return NOT_AUTHENTICATED without access_token', async () => {
  const logger = createMockLogger();
  const { ensureValidSpotifyToken } = createSpotifyAuth({ logger });

  const result = await ensureValidSpotifyToken(
    { spotifyAuth: { refresh_token: 'test' } },
    null
  );

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.error, 'NOT_AUTHENTICATED');
});

test('ensureValidSpotifyToken should return valid auth if not expired', async () => {
  const logger = createMockLogger();
  const { ensureValidSpotifyToken } = createSpotifyAuth({ logger });

  const spotifyAuth = {
    access_token: 'valid_token',
    expires_at: Date.now() + 3600000, // 1 hour from now
  };

  const result = await ensureValidSpotifyToken({ spotifyAuth }, null);

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.spotifyAuth, spotifyAuth);
  assert.strictEqual(result.error, null);
});

test('ensureValidSpotifyToken should return TOKEN_EXPIRED without refresh_token', async () => {
  const logger = createMockLogger();
  const { ensureValidSpotifyToken } = createSpotifyAuth({ logger });

  const spotifyAuth = {
    access_token: 'expired_token',
    expires_at: Date.now() - 1000, // Expired
    // No refresh_token
  };

  const result = await ensureValidSpotifyToken({ spotifyAuth }, null);

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.error, 'TOKEN_EXPIRED');
});

test('ensureValidSpotifyToken should return TOKEN_REFRESH_FAILED on refresh failure', async () => {
  const logger = createMockLogger();
  const mockFetch = async () => ({
    ok: false,
    status: 400,
    text: async () => 'Invalid token',
  });

  const { ensureValidSpotifyToken } = createSpotifyAuth({
    logger,
    fetch: mockFetch,
    env: { SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET: 'secret' },
  });

  const user = {
    _id: 'user123',
    email: 'test@example.com',
    spotifyAuth: {
      access_token: 'expired_token',
      expires_at: Date.now() - 1000,
      refresh_token: 'invalid_refresh',
    },
  };

  const result = await ensureValidSpotifyToken(user, null);

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.error, 'TOKEN_REFRESH_FAILED');
});

test('ensureValidSpotifyToken should refresh and save token successfully', async () => {
  const logger = createMockLogger();
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
      assert.ok(update.$set.spotifyAuth);
      assert.ok(update.$set.updatedAt);
      callback(null);
    },
  };

  const { ensureValidSpotifyToken } = createSpotifyAuth({
    logger,
    fetch: mockFetch,
    env: { SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET: 'secret' },
  });

  const user = {
    _id: 'user123',
    email: 'test@example.com',
    spotifyAuth: {
      access_token: 'expired_token',
      expires_at: Date.now() - 1000,
      refresh_token: 'old_refresh',
    },
  };

  const result = await ensureValidSpotifyToken(user, mockUsersDb);

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.spotifyAuth.access_token, 'new_token');
  assert.strictEqual(result.error, null);
  assert.strictEqual(dbUpdateCalled, true);
  // User object should be updated in memory
  assert.strictEqual(user.spotifyAuth.access_token, 'new_token');
});

test('ensureValidSpotifyToken should succeed even if DB save fails', async () => {
  const logger = createMockLogger();
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

  const { ensureValidSpotifyToken } = createSpotifyAuth({
    logger,
    fetch: mockFetch,
    env: { SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET: 'secret' },
  });

  const user = {
    _id: 'user123',
    email: 'test@example.com',
    spotifyAuth: {
      access_token: 'expired_token',
      expires_at: Date.now() - 1000,
      refresh_token: 'refresh',
    },
  };

  const result = await ensureValidSpotifyToken(user, mockUsersDb);

  // Should still succeed - token is valid even if not saved
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.spotifyAuth.access_token, 'new_token');
  assert.strictEqual(result.error, null);
});

// =============================================================================
// Edge cases and logging tests
// =============================================================================

test('refreshSpotifyToken should call fetch with correct parameters', async () => {
  const logger = createMockLogger();
  let fetchCalledWith = null;

  const mockFetch = async (url, options) => {
    fetchCalledWith = { url, options };
    return {
      ok: true,
      json: async () => ({ access_token: 'token', expires_in: 3600 }),
    };
  };

  const { refreshSpotifyToken } = createSpotifyAuth({
    logger,
    fetch: mockFetch,
    env: { SPOTIFY_CLIENT_ID: 'my_id', SPOTIFY_CLIENT_SECRET: 'my_secret' },
  });

  await refreshSpotifyToken({ refresh_token: 'my_refresh' });

  assert.strictEqual(
    fetchCalledWith.url,
    'https://accounts.spotify.com/api/token'
  );
  assert.strictEqual(fetchCalledWith.options.method, 'POST');
  assert.strictEqual(
    fetchCalledWith.options.headers['Content-Type'],
    'application/x-www-form-urlencoded'
  );
  assert.ok(fetchCalledWith.options.body.includes('grant_type=refresh_token'));
  assert.ok(fetchCalledWith.options.body.includes('refresh_token=my_refresh'));
  assert.ok(fetchCalledWith.options.body.includes('client_id=my_id'));
  assert.ok(fetchCalledWith.options.body.includes('client_secret=my_secret'));
});

test('logger should be called with appropriate messages', async () => {
  const logMessages = [];
  const logger = {
    error: (msg, data) => logMessages.push({ level: 'error', msg, data }),
    warn: (msg, data) => logMessages.push({ level: 'warn', msg, data }),
    info: (msg, data) => logMessages.push({ level: 'info', msg, data }),
  };

  const { refreshSpotifyToken } = createSpotifyAuth({
    logger,
    env: {}, // Missing credentials
  });

  await refreshSpotifyToken({ refresh_token: 'test' });

  assert.ok(logMessages.some((m) => m.level === 'error'));
  assert.ok(
    logMessages.some((m) => m.msg.includes('credentials not configured'))
  );
});
