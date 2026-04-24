const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  RESTORE_ERROR_CODES,
  createRestoreError,
  isRestoreError,
  toRestoreHttpError,
} = require('../services/restore-errors');

describe('restore-errors', () => {
  it('builds restore-specific error objects', () => {
    const error = createRestoreError(
      RESTORE_ERROR_CODES.INVALID_DUMP,
      'Invalid backup',
      400,
      { file: 'sample.dump' }
    );

    assert.strictEqual(error.code, RESTORE_ERROR_CODES.INVALID_DUMP);
    assert.strictEqual(error.statusCode, 400);
    assert.deepStrictEqual(error.details, { file: 'sample.dump' });
    assert.strictEqual(isRestoreError(error), true);
  });

  it('maps restore errors to API payloads', () => {
    const error = createRestoreError(
      RESTORE_ERROR_CODES.PRECHECK_FAILED,
      'Precheck failed',
      400
    );

    const mapped = toRestoreHttpError(error);

    assert.strictEqual(mapped.statusCode, 400);
    assert.strictEqual(mapped.body.code, RESTORE_ERROR_CODES.PRECHECK_FAILED);
    assert.strictEqual(mapped.body.error, 'Precheck failed');
  });

  it('maps unknown errors to internal restore error', () => {
    const mapped = toRestoreHttpError(new Error('boom'));

    assert.strictEqual(mapped.statusCode, 500);
    assert.strictEqual(mapped.body.code, RESTORE_ERROR_CODES.INTERNAL_ERROR);
  });
});
