// @ts-check
/**
 * Graceful database pool shutdown.
 *
 * Pure helper extracted for testability. The singleton in db/index.js is a
 * thin wrapper around drainPool() with the module-level pool baked in.
 */

const defaultLogger = require('../utils/logger');
const { markPoolDraining } = require('./postgres');

/**
 * Drain `pool` with a timeout-bounded end(), setting the draining flag first
 * so in-flight PgDatastore calls reject fast with ShuttingDownError.
 *
 * Returns { drained: true } on clean shutdown, { drained: false } on timeout
 * or pool.end() rejection. Always resolves — never throws.
 *
 * @param {Object} pool - pg Pool instance.
 * @param {Object} [opts]
 * @param {number} [opts.timeoutMs=8000]
 * @param {Object} [opts.logger]
 * @param {(pool: Object) => void} [opts.markDraining] - injected for tests
 * @returns {Promise<{ drained: boolean }>}
 */
async function drainPool(pool, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const logger = opts.logger ?? defaultLogger;
  const markDraining = opts.markDraining ?? markPoolDraining;

  if (!pool || typeof pool.end !== 'function') {
    return { drained: true };
  }

  markDraining(pool);
  logger.info('Database pool draining', { timeoutMs });

  let timeoutHandle;
  const timeoutPromise = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => {
      logger.error('Database pool drain timed out', {
        timeoutMs,
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount,
      });
      resolve({ drained: false });
    }, timeoutMs);
    if (typeof timeoutHandle.unref === 'function') {
      timeoutHandle.unref();
    }
  });

  const endPromise = Promise.resolve(pool.end()).then(
    () => ({ drained: true }),
    (err) => {
      logger.error('Database pool.end() rejected', {
        error: err?.message,
        code: err?.code,
      });
      return { drained: false };
    }
  );

  const result = await Promise.race([endPromise, timeoutPromise]);
  clearTimeout(timeoutHandle);

  if (result.drained) {
    logger.info('Database pool drained cleanly');
  }
  return result;
}

module.exports = { drainPool };
