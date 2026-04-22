/**
 * Database retry + health utilities.
 *
 * Exports:
 *   - healthCheck(pool)                — liveness probe
 *   - withRetry(fn, opts)              — classifier-aware retry with backoff
 *   - computeBackoffDelay(attempt, o)  — exposed for testing
 */

const { classify, KINDS } = require('./errors');
const logger = require('../utils/logger');

const DEFAULT_RETRIES = 3;
const DEFAULT_BASE_MS = 50;
const DEFAULT_MAX_MS = 1000;

/**
 * Compute backoff delay for attempt N (zero-indexed) using
 * full-jitter exponential backoff: delay ∈ [0, min(maxMs, baseMs * 2^attempt)].
 *
 * @param {number} attempt - Zero-indexed retry attempt number.
 * @param {{ baseMs?: number, maxMs?: number, jitter?: boolean, random?: () => number }} opts
 * @returns {number} Delay in milliseconds.
 */
function computeBackoffDelay(attempt, opts = {}) {
  const baseMs = opts.baseMs ?? DEFAULT_BASE_MS;
  const maxMs = opts.maxMs ?? DEFAULT_MAX_MS;
  const jitter = opts.jitter !== false;
  const random = opts.random ?? Math.random;

  const ceiling = Math.min(maxMs, baseMs * Math.pow(2, attempt));
  if (!jitter) {
    return ceiling;
  }
  return Math.floor(random() * ceiling);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute `fn` with classifier-aware retry on transient database errors.
 *
 * A retry fires ONLY when all hold:
 *   1. The thrown error's classification kind is 'retryable'.
 *   2. The retry budget has not been exhausted.
 *   3. Either `idempotent: true`, OR the error occurred before any side-effect
 *      of `fn` was observable (i.e. a connection-level failure raised before
 *      the first pool.query resolved).
 *
 * The idempotency guard exists to prevent double-writes: if a non-idempotent
 * multi-statement operation fails mid-flight with a retryable error, retrying
 * the whole function could replay committed statements. Callers that KNOW
 * their work is idempotent (simple SELECT, INSERT ... ON CONFLICT, etc.) can
 * opt in with `idempotent: true`.
 *
 * Without `idempotent: true`, only errors raised from the very first attempt
 * before any successful query are retried — signaled by the caller via the
 * `beforeFirstQuery: () => boolean` hook. If no hook is provided and
 * `idempotent` is not set, retries are disabled (fn runs at most once).
 *
 * @param {() => Promise<*>} fn - Async function to execute.
 * @param {Object} [opts]
 * @param {number} [opts.retries=3] - Maximum retry attempts (total calls ≤ retries+1).
 * @param {number} [opts.baseMs=50]
 * @param {number} [opts.maxMs=1000]
 * @param {boolean} [opts.jitter=true]
 * @param {boolean} [opts.idempotent=false] - If true, retry any retryable error.
 * @param {() => boolean} [opts.beforeFirstQuery] - If provided, return true iff
 *   the current failure occurred before any observable side effect (safe to retry
 *   even when not idempotent).
 * @param {(err: Error) => {kind: string}} [opts.classify=classify]
 * @param {(ms: number) => Promise<void>} [opts.sleep=sleep]
 * @param {{ debug: Function, warn: Function }} [opts.logger]
 * @param {string} [opts.label] - Optional label for log context.
 * @returns {Promise<*>} The fn result.
 */
async function withRetry(fn, opts = {}) {
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const idempotent = opts.idempotent === true;
  const beforeFirstQuery =
    typeof opts.beforeFirstQuery === 'function' ? opts.beforeFirstQuery : null;
  const classifyFn = opts.classify ?? classify;
  const sleepFn = opts.sleep ?? sleep;
  const log = opts.logger ?? logger;
  const label = opts.label ?? 'db.withRetry';

  let attempt = 0;
  // Loop terminates by return or throw; attempt increments each retry.
  // Max iterations = retries + 1.
  while (true) {
    try {
      return await fn();
    } catch (err) {
      const { kind, code } = classifyFn(err);

      if (kind !== KINDS.RETRYABLE) {
        throw err;
      }
      if (attempt >= retries) {
        log.warn('Retries exhausted', {
          label,
          attempts: attempt + 1,
          code,
        });
        throw err;
      }
      if (!idempotent && !(beforeFirstQuery && beforeFirstQuery())) {
        // Retryable error, but caller has not asserted idempotency and
        // no side-effect-free hook says it is safe to retry.
        throw err;
      }

      const delay = computeBackoffDelay(attempt, opts);
      log.debug('Retrying after transient DB error', {
        label,
        attempt: attempt + 1,
        nextDelayMs: delay,
        code,
      });
      await sleepFn(delay);
      attempt++;
    }
  }
}

/**
 * Health check function that verifies database connectivity.
 * @param {Object} pool - Database connection pool
 * @returns {Promise<Object>} - Health status object
 */
async function healthCheck(pool) {
  try {
    const start = Date.now();
    await pool.query('SELECT 1 as health_check');
    const duration = Date.now() - start;

    return {
      status: 'healthy',
      database: 'connected',
      responseTime: duration,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      database: 'disconnected',
      error: error.message,
      code: error.code,
      timestamp: new Date().toISOString(),
    };
  }
}

module.exports = {
  healthCheck,
  withRetry,
  computeBackoffDelay,
};
