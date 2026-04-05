const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const {
  resolveSessionSettings,
  FALLBACK_SESSION_SECRET,
} = require('../config/session.js');

function createMockLogger() {
  return {
    error: mock.fn(),
    warn: mock.fn(),
    info: mock.fn(),
    debug: mock.fn(),
  };
}

describe('resolveSessionSettings', () => {
  it('uses fallback secret in development with secure=false', () => {
    const logger = createMockLogger();

    const settings = resolveSessionSettings(
      {
        NODE_ENV: 'development',
      },
      logger
    );

    assert.strictEqual(settings.sessionSecret, FALLBACK_SESSION_SECRET);
    assert.strictEqual(settings.cookieSecure, false);
    assert.strictEqual(logger.error.mock.calls.length, 0);
  });

  it('logs error when production uses fallback secret', () => {
    const logger = createMockLogger();

    const settings = resolveSessionSettings(
      {
        NODE_ENV: 'production',
      },
      logger
    );

    assert.strictEqual(settings.sessionSecret, FALLBACK_SESSION_SECRET);
    assert.strictEqual(settings.cookieSecure, 'auto');
    assert.strictEqual(logger.error.mock.calls.length, 1);
  });

  it('throws when strict secret mode is enabled in production with fallback', () => {
    const logger = createMockLogger();

    assert.throws(
      () =>
        resolveSessionSettings(
          {
            NODE_ENV: 'production',
            SESSION_SECRET_REQUIRED: 'true',
          },
          logger
        ),
      /SESSION_SECRET is required/
    );
  });

  it('uses provided secret in production and secure auto cookie', () => {
    const logger = createMockLogger();

    const settings = resolveSessionSettings(
      {
        NODE_ENV: 'production',
        SESSION_SECRET: 'super-secret-value',
      },
      logger
    );

    assert.strictEqual(settings.sessionSecret, 'super-secret-value');
    assert.strictEqual(settings.cookieSecure, 'auto');
    assert.strictEqual(logger.error.mock.calls.length, 0);
  });
});
