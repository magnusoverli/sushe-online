// @ts-check
/**
 * PostgreSQL error classification.
 *
 * Pure, side-effect-free classifier used by retry logic and error handlers
 * to decide whether a DB error is safely retryable, a caller-facing constraint
 * violation, a fatal programming/operational error, or unknown.
 *
 * References:
 *   - PostgreSQL SQLSTATE codes:
 *     https://www.postgresql.org/docs/current/errcodes-appendix.html
 *   - Node.js system error codes (ECONNRESET, ETIMEDOUT, etc.)
 */

// Kinds returned by classify().
const KINDS = Object.freeze({
  RETRYABLE: 'retryable',
  CONSTRAINT: 'constraint',
  FATAL: 'fatal',
  UNKNOWN: 'unknown',
});

// Transient failures that are safe to retry (assuming idempotency).
const RETRYABLE_CODES = new Set([
  // Transaction conflicts
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  // Connection problems
  '08000', // connection_exception
  '08003', // connection_does_not_exist
  '08006', // connection_failure
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
  // Admin-initiated disconnects / crashes
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '57P04', // database_dropped (not strictly retryable, but the next connect may find the replacement — treat as retryable connection-level)
  // Resource exhaustion (often resolves shortly)
  '53300', // too_many_connections
  '53400', // configuration_limit_exceeded
]);

// Node-level transient error codes on the socket/DNS layer.
const RETRYABLE_NODE_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
]);

// Integrity-level failures that MUST surface to the caller — never retry.
const CONSTRAINT_CODES = new Set([
  '23505', // unique_violation
  '23503', // foreign_key_violation
  '23502', // not_null_violation
  '23514', // check_violation
  '23P01', // exclusion_violation
  '22P02', // invalid_text_representation
  '22001', // string_data_right_truncation
  '22003', // numeric_value_out_of_range
  '22007', // invalid_datetime_format
  '22008', // datetime_field_overflow
]);

// Programming / schema / auth errors — retrying just wastes work; alert instead.
const FATAL_CODES = new Set([
  '42P01', // undefined_table
  '42703', // undefined_column
  '42883', // undefined_function
  '42P02', // undefined_parameter
  '42601', // syntax_error
  '42501', // insufficient_privilege
  '28000', // invalid_authorization_specification
  '28P01', // invalid_password
  '3D000', // invalid_catalog_name
  '3F000', // invalid_schema_name
]);

/**
 * Classify a database error.
 *
 * Does not mutate the input. Safe to call on any value — non-Error inputs
 * (null, string, object) return { kind: 'unknown', code: undefined }.
 *
 * @param {*} err - A pg error, Node system error, or anything else.
 * @returns {{ kind: string, code: string | undefined }} Classification result.
 */
function classify(err) {
  if (err == null || typeof err !== 'object') {
    return { kind: KINDS.UNKNOWN, code: undefined };
  }

  const code = typeof err.code === 'string' ? err.code : undefined;

  if (code && RETRYABLE_CODES.has(code)) {
    return { kind: KINDS.RETRYABLE, code };
  }
  if (code && RETRYABLE_NODE_CODES.has(code)) {
    return { kind: KINDS.RETRYABLE, code };
  }
  if (code && CONSTRAINT_CODES.has(code)) {
    return { kind: KINDS.CONSTRAINT, code };
  }
  if (code && FATAL_CODES.has(code)) {
    return { kind: KINDS.FATAL, code };
  }

  return { kind: KINDS.UNKNOWN, code };
}

/**
 * Convenience predicate. Returns true iff the error is transient/safe to retry.
 * @param {*} err
 * @returns {boolean}
 */
function isRetryable(err) {
  return classify(err).kind === KINDS.RETRYABLE;
}

module.exports = {
  classify,
  isRetryable,
  KINDS,
  // Exposed for tests and future extension; callers should prefer classify().
  RETRYABLE_CODES,
  RETRYABLE_NODE_CODES,
  CONSTRAINT_CODES,
  FATAL_CODES,
};
