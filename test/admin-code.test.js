const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const {
  generateSecureCode,
  getLoggableCode,
} = require('../config/admin-code.js');
const { createAuthService } = require('../services/auth-service.js');

describe('admin-code secure generation', () => {
  it('generateSecureCode returns uppercase alphanumeric code of expected length', () => {
    const code = generateSecureCode(8);
    assert.strictEqual(code.length, 8);
    assert.ok(/^[A-Z0-9]{8}$/.test(code));
  });

  it('getLoggableCode masks code when ADMIN_CODE_LOG_MODE=masked', () => {
    const originalValue = process.env.ADMIN_CODE_LOG_MODE;
    process.env.ADMIN_CODE_LOG_MODE = 'masked';

    const masked = getLoggableCode('ABCDEFGH');
    assert.strictEqual(masked, 'AB******');

    if (originalValue === undefined) {
      delete process.env.ADMIN_CODE_LOG_MODE;
    } else {
      process.env.ADMIN_CODE_LOG_MODE = originalValue;
    }
  });
});

describe('auth-service admin code logging', () => {
  it('validateAdminCode does not log submitted or expected code values', () => {
    const logger = {
      info: mock.fn(),
      warn: mock.fn(),
      error: mock.fn(),
      debug: mock.fn(),
    };

    const service = createAuthService({
      db: { raw: mock.fn(async () => ({ rows: [], rowCount: 0 })) },
      logger,
    });

    service.validateAdminCode('ABC12345', 'user-1', {
      adminCode: 'ABC12345',
      adminCodeExpiry: new Date(Date.now() + 60000),
    });

    assert.strictEqual(logger.info.mock.calls.length, 1);
    const [, logData] = logger.info.mock.calls[0].arguments;
    assert.strictEqual(logData.submittedCode, undefined);
    assert.strictEqual(logData.expectedCode, undefined);
    assert.strictEqual(logData.hasSubmittedCode, true);
  });
});
