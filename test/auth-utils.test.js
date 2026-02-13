const test = require('node:test');
const assert = require('node:assert');
const { createMockLogger } = require('./helpers');
const { createAuthUtils } = require('../utils/auth-utils.js');

// Create instance with mock logger for all tests
const mockLogger = createMockLogger();
const {
  isTokenValid,
  isTokenUsable,
  canTokenBeRefreshed,
  generateExtensionToken,
  validateExtensionToken,
  cleanupExpiredTokens,
} = createAuthUtils({ logger: mockLogger });

// =============================================================================
// isTokenValid tests
// =============================================================================

test('isTokenValid should return false for null/undefined token', () => {
  assert.strictEqual(isTokenValid(null), false);
  assert.strictEqual(isTokenValid(undefined), false);
  assert.strictEqual(isTokenValid({}), false);
});

test('isTokenValid should return false for token without access_token', () => {
  assert.strictEqual(isTokenValid({ expires_at: Date.now() + 1000 }), false);
  assert.strictEqual(isTokenValid({ refresh_token: 'test' }), false);
});

test('isTokenValid should return false for expired token', () => {
  const expiredToken = {
    access_token: 'test_token',
    expires_at: Date.now() - 1000, // Expired 1 second ago
  };
  assert.strictEqual(isTokenValid(expiredToken), false);
});

test('isTokenValid should return true for valid token without expiry', () => {
  const validToken = {
    access_token: 'test_token',
  };
  assert.strictEqual(isTokenValid(validToken), true);
});

test('isTokenValid should return true for valid token with future expiry', () => {
  const validToken = {
    access_token: 'test_token',
    expires_at: Date.now() + 3600000, // Expires in 1 hour
  };
  assert.strictEqual(isTokenValid(validToken), true);
});

test('isTokenValid should handle edge case of expiry exactly at current time', () => {
  const edgeToken = {
    access_token: 'test_token',
    expires_at: Date.now(),
  };
  assert.strictEqual(isTokenValid(edgeToken), false);
});

// =============================================================================
// canTokenBeRefreshed tests
// =============================================================================

test('canTokenBeRefreshed should return false for null/undefined token', () => {
  assert.strictEqual(canTokenBeRefreshed(null), false);
  assert.strictEqual(canTokenBeRefreshed(undefined), false);
});

test('canTokenBeRefreshed should return true if refresh_token exists', () => {
  assert.strictEqual(canTokenBeRefreshed({ refresh_token: 'abc' }), true);
});

test('canTokenBeRefreshed should return false if no refresh_token', () => {
  assert.strictEqual(canTokenBeRefreshed({}), false);
  assert.strictEqual(canTokenBeRefreshed({ access_token: 'test' }), false);
});

// =============================================================================
// isTokenUsable tests
// =============================================================================

test('isTokenUsable should return false for null/undefined token', () => {
  assert.strictEqual(isTokenUsable(null), false);
  assert.strictEqual(isTokenUsable(undefined), false);
});

test('isTokenUsable should return true for valid non-expired token', () => {
  const validToken = {
    access_token: 'test_token',
    expires_at: Date.now() + 3600000,
  };
  assert.strictEqual(isTokenUsable(validToken), true);
});

test('isTokenUsable should return true for expired token with refresh_token', () => {
  const expiredButRefreshable = {
    access_token: 'test_token',
    refresh_token: 'refresh_token',
    expires_at: Date.now() - 1000, // Expired
  };
  assert.strictEqual(isTokenUsable(expiredButRefreshable), true);
});

test('isTokenUsable should return false for expired token without refresh_token', () => {
  const expiredNoRefresh = {
    access_token: 'test_token',
    expires_at: Date.now() - 1000, // Expired
  };
  assert.strictEqual(isTokenUsable(expiredNoRefresh), false);
});

test('isTokenUsable should return true for token with only refresh_token', () => {
  // Edge case: no access_token but has refresh_token
  const onlyRefresh = {
    refresh_token: 'refresh_token',
  };
  assert.strictEqual(isTokenUsable(onlyRefresh), true);
});

// =============================================================================
// generateExtensionToken tests
// =============================================================================

test('generateExtensionToken should return a 43-character base64url string', () => {
  const token = generateExtensionToken();
  assert.strictEqual(typeof token, 'string');
  assert.strictEqual(token.length, 43);
});

test('generateExtensionToken should only contain valid base64url characters', () => {
  const token = generateExtensionToken();
  assert.match(token, /^[A-Za-z0-9_-]+$/);
});

test('generateExtensionToken should generate unique tokens', () => {
  const tokens = new Set();
  for (let i = 0; i < 100; i++) {
    tokens.add(generateExtensionToken());
  }
  // All 100 tokens should be unique
  assert.strictEqual(tokens.size, 100);
});

// =============================================================================
// isValidExtensionToken tests (internal function, tested via validateExtensionToken)
// =============================================================================

test('validateExtensionToken should return null for invalid token format', async () => {
  const mockPool = { query: async () => ({ rows: [] }) };

  // null/undefined
  assert.strictEqual(await validateExtensionToken(null, mockPool), null);
  assert.strictEqual(await validateExtensionToken(undefined, mockPool), null);

  // Wrong type
  assert.strictEqual(await validateExtensionToken(12345, mockPool), null);
  assert.strictEqual(await validateExtensionToken({}, mockPool), null);

  // Wrong length
  assert.strictEqual(await validateExtensionToken('short', mockPool), null);
  assert.strictEqual(
    await validateExtensionToken('a'.repeat(44), mockPool),
    null
  );

  // Invalid characters
  assert.strictEqual(
    await validateExtensionToken('a'.repeat(42) + '!', mockPool),
    null
  );
  assert.strictEqual(
    await validateExtensionToken('a'.repeat(42) + ' ', mockPool),
    null
  );
});

test('validateExtensionToken should return null for token not found in database', async () => {
  const mockPool = {
    query: async () => ({ rows: [] }),
  };

  const validFormatToken = generateExtensionToken();
  const result = await validateExtensionToken(validFormatToken, mockPool);
  assert.strictEqual(result, null);
});

test('validateExtensionToken should return null for revoked token', async () => {
  const mockPool = {
    query: async () => ({
      rows: [
        {
          user_id: 123,
          expires_at: new Date(Date.now() + 3600000),
          is_revoked: true,
        },
      ],
    }),
  };

  const validFormatToken = generateExtensionToken();
  const result = await validateExtensionToken(validFormatToken, mockPool);
  assert.strictEqual(result, null);
});

test('validateExtensionToken should return null for expired token', async () => {
  const mockPool = {
    query: async () => ({
      rows: [
        {
          user_id: 123,
          expires_at: new Date(Date.now() - 1000),
          is_revoked: false,
        }, // Expired
      ],
    }),
  };

  const validFormatToken = generateExtensionToken();
  const result = await validateExtensionToken(validFormatToken, mockPool);
  assert.strictEqual(result, null);
});

test('validateExtensionToken should return user_id for valid token and update last_used_at', async () => {
  let updateCalled = false;
  const mockPool = {
    query: async (sql) => {
      if (sql.includes('SELECT')) {
        return {
          rows: [
            {
              user_id: 456,
              expires_at: new Date(Date.now() + 3600000),
              is_revoked: false,
            },
          ],
        };
      }
      if (sql.includes('UPDATE')) {
        updateCalled = true;
        return { rowCount: 1 };
      }
      return { rows: [] };
    },
  };

  const validFormatToken = generateExtensionToken();
  const result = await validateExtensionToken(validFormatToken, mockPool);
  assert.strictEqual(result, 456);
  assert.strictEqual(updateCalled, true);
});

test('validateExtensionToken should return null on database error', async () => {
  const mockPool = {
    query: async () => {
      throw new Error('Database connection failed');
    },
  };

  const validFormatToken = generateExtensionToken();
  const result = await validateExtensionToken(validFormatToken, mockPool);
  assert.strictEqual(result, null);
});

// =============================================================================
// cleanupExpiredTokens tests
// =============================================================================

test('cleanupExpiredTokens should return rowCount on success', async () => {
  const mockPool = {
    query: async () => ({ rowCount: 5 }),
  };

  const result = await cleanupExpiredTokens(mockPool);
  assert.strictEqual(result, 5);
});

test('cleanupExpiredTokens should return 0 when no tokens deleted', async () => {
  const mockPool = {
    query: async () => ({ rowCount: 0 }),
  };

  const result = await cleanupExpiredTokens(mockPool);
  assert.strictEqual(result, 0);
});

test('cleanupExpiredTokens should return 0 on database error', async () => {
  const mockPool = {
    query: async () => {
      throw new Error('Database error');
    },
  };

  const result = await cleanupExpiredTokens(mockPool);
  assert.strictEqual(result, 0);
});

// =============================================================================
// Logger injection tests (verify DI pattern works)
// =============================================================================

test('validateExtensionToken should log error on database failure', async () => {
  const logger = createMockLogger();
  const { validateExtensionToken: validate } = createAuthUtils({ logger });
  const mockPool = {
    query: async () => {
      throw new Error('Connection refused');
    },
  };

  const validToken = generateExtensionToken();
  await validate(validToken, mockPool);

  assert.strictEqual(logger.error.mock.calls.length, 1);
  const logArgs = logger.error.mock.calls[0].arguments;
  assert.strictEqual(logArgs[0], 'Error validating extension token');
  assert.strictEqual(logArgs[1].error, 'Connection refused');
});

test('cleanupExpiredTokens should log error on database failure', async () => {
  const logger = createMockLogger();
  const { cleanupExpiredTokens: cleanup } = createAuthUtils({ logger });
  const mockPool = {
    query: async () => {
      throw new Error('Timeout');
    },
  };

  await cleanup(mockPool);

  assert.strictEqual(logger.error.mock.calls.length, 1);
  const logArgs = logger.error.mock.calls[0].arguments;
  assert.strictEqual(logArgs[0], 'Error cleaning up expired tokens');
  assert.strictEqual(logArgs[1].error, 'Timeout');
});
