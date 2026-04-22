/**
 * Tests for db/errors.js — the PostgreSQL error classifier.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  classify,
  isRetryable,
  KINDS,
  RETRYABLE_CODES,
  RETRYABLE_NODE_CODES,
  CONSTRAINT_CODES,
  FATAL_CODES,
} = require('../db/errors');

// Helper: build a minimal pg-style error.
function pgError(code, message = 'test error') {
  const err = new Error(message);
  err.code = code;
  return err;
}

describe('db/errors classify()', () => {
  describe('retryable SQLSTATE codes', () => {
    const cases = [
      ['40001', 'serialization_failure'],
      ['40P01', 'deadlock_detected'],
      ['08000', 'connection_exception'],
      ['08003', 'connection_does_not_exist'],
      ['08006', 'connection_failure'],
      ['08001', 'sqlclient_unable_to_establish'],
      ['08004', 'sqlserver_rejected'],
      ['57P01', 'admin_shutdown'],
      ['57P02', 'crash_shutdown'],
      ['57P03', 'cannot_connect_now'],
      ['57P04', 'database_dropped'],
      ['53300', 'too_many_connections'],
      ['53400', 'configuration_limit_exceeded'],
    ];

    for (const [code, label] of cases) {
      it(`classifies ${code} (${label}) as retryable`, () => {
        const result = classify(pgError(code));
        assert.strictEqual(result.kind, KINDS.RETRYABLE);
        assert.strictEqual(result.code, code);
      });
    }
  });

  describe('retryable Node-level socket codes', () => {
    const cases = [
      'ECONNRESET',
      'ETIMEDOUT',
      'ECONNREFUSED',
      'ENOTFOUND',
      'EAI_AGAIN',
      'EPIPE',
    ];

    for (const code of cases) {
      it(`classifies Node error ${code} as retryable`, () => {
        const result = classify(pgError(code));
        assert.strictEqual(result.kind, KINDS.RETRYABLE);
        assert.strictEqual(result.code, code);
      });
    }
  });

  describe('constraint violations', () => {
    const cases = [
      ['23505', 'unique_violation'],
      ['23503', 'foreign_key_violation'],
      ['23502', 'not_null_violation'],
      ['23514', 'check_violation'],
      ['23P01', 'exclusion_violation'],
      ['22P02', 'invalid_text_representation'],
      ['22001', 'string_data_right_truncation'],
      ['22003', 'numeric_value_out_of_range'],
    ];

    for (const [code, label] of cases) {
      it(`classifies ${code} (${label}) as constraint (never retry)`, () => {
        const result = classify(pgError(code));
        assert.strictEqual(result.kind, KINDS.CONSTRAINT);
        assert.strictEqual(result.code, code);
      });
    }
  });

  describe('fatal programming/operational errors', () => {
    const cases = [
      ['42P01', 'undefined_table'],
      ['42703', 'undefined_column'],
      ['42883', 'undefined_function'],
      ['42601', 'syntax_error'],
      ['42501', 'insufficient_privilege'],
      ['28000', 'invalid_authorization'],
      ['28P01', 'invalid_password'],
      ['3D000', 'invalid_catalog_name'],
      ['3F000', 'invalid_schema_name'],
    ];

    for (const [code, label] of cases) {
      it(`classifies ${code} (${label}) as fatal`, () => {
        const result = classify(pgError(code));
        assert.strictEqual(result.kind, KINDS.FATAL);
        assert.strictEqual(result.code, code);
      });
    }
  });

  describe('unknown inputs', () => {
    it('treats a plain Error with no code as unknown', () => {
      const result = classify(new Error('something went wrong'));
      assert.strictEqual(result.kind, KINDS.UNKNOWN);
      assert.strictEqual(result.code, undefined);
    });

    it('treats an unknown SQLSTATE code as unknown (preserves code)', () => {
      const result = classify(pgError('XX999'));
      assert.strictEqual(result.kind, KINDS.UNKNOWN);
      assert.strictEqual(result.code, 'XX999');
    });

    it('returns unknown for null', () => {
      const result = classify(null);
      assert.strictEqual(result.kind, KINDS.UNKNOWN);
      assert.strictEqual(result.code, undefined);
    });

    it('returns unknown for undefined', () => {
      const result = classify(undefined);
      assert.strictEqual(result.kind, KINDS.UNKNOWN);
    });

    it('returns unknown for a plain string', () => {
      const result = classify('not an error');
      assert.strictEqual(result.kind, KINDS.UNKNOWN);
    });

    it('returns unknown for an object with non-string code', () => {
      const result = classify({ code: 42 });
      assert.strictEqual(result.kind, KINDS.UNKNOWN);
      assert.strictEqual(result.code, undefined);
    });
  });

  describe('purity', () => {
    it('does not mutate the error object', () => {
      const err = pgError('40001', 'deadlock');
      const before = { ...err, message: err.message, stack: err.stack };
      classify(err);
      assert.strictEqual(err.code, before.code);
      assert.strictEqual(err.message, before.message);
      assert.strictEqual(err.stack, before.stack);
    });

    it('returns a fresh result object each call', () => {
      const err = pgError('40001');
      const a = classify(err);
      const b = classify(err);
      assert.notStrictEqual(a, b);
      assert.deepStrictEqual(a, b);
    });
  });
});

describe('db/errors isRetryable()', () => {
  it('is true for retryable SQLSTATE codes', () => {
    assert.strictEqual(isRetryable(pgError('40001')), true);
    assert.strictEqual(isRetryable(pgError('40P01')), true);
  });

  it('is true for retryable Node codes', () => {
    assert.strictEqual(isRetryable(pgError('ECONNRESET')), true);
  });

  it('is false for constraint violations', () => {
    assert.strictEqual(isRetryable(pgError('23505')), false);
  });

  it('is false for fatal errors', () => {
    assert.strictEqual(isRetryable(pgError('42P01')), false);
  });

  it('is false for unknown errors', () => {
    assert.strictEqual(isRetryable(new Error('mystery')), false);
    assert.strictEqual(isRetryable(null), false);
  });
});

describe('db/errors exports', () => {
  it('exposes KINDS with the four expected values', () => {
    assert.deepStrictEqual(Object.values(KINDS).sort(), [
      'constraint',
      'fatal',
      'retryable',
      'unknown',
    ]);
  });

  it('code sets are non-empty and disjoint across kinds', () => {
    assert.ok(RETRYABLE_CODES.size > 0);
    assert.ok(CONSTRAINT_CODES.size > 0);
    assert.ok(FATAL_CODES.size > 0);

    // No overlap between kinds — a code must classify to exactly one kind.
    for (const code of RETRYABLE_CODES) {
      assert.ok(
        !CONSTRAINT_CODES.has(code),
        `${code} in both retryable and constraint`
      );
      assert.ok(!FATAL_CODES.has(code), `${code} in both retryable and fatal`);
    }
    for (const code of CONSTRAINT_CODES) {
      assert.ok(!FATAL_CODES.has(code), `${code} in both constraint and fatal`);
    }
    for (const code of RETRYABLE_NODE_CODES) {
      assert.ok(
        !RETRYABLE_CODES.has(code),
        `${code} duplicated across SQLSTATE and Node sets`
      );
    }
  });
});
