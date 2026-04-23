/**
 * Year lock service.
 *
 * Provides functions to check if a year is locked and validate mutations.
 */

function createYearLock(deps = {}) {
  const logger = deps.logger || require('../utils/logger');
  const TransactionAbort =
    deps.TransactionAbort || require('../db/transaction').TransactionAbort;
  const { LOCK_NAMESPACES, acquireTransactionLocks } =
    deps.advisoryLocks || require('../db/advisory-locks');

  function asDb(db) {
    if (db && typeof db.raw === 'function') return db;
    if (db && typeof db.query === 'function') {
      return { raw: (sql, params) => db.query(sql, params) };
    }
    throw new Error('year-lock: expected a datastore with .raw() or .query()');
  }

  async function isYearLocked(dbOrPool, year, opts = {}) {
    if (!year) return false;

    const failOpen = opts.failOpen !== false;

    try {
      const db = asDb(dbOrPool);
      const result = await db.raw(
        'SELECT locked FROM master_lists WHERE year = $1',
        [year],
        { name: 'year-lock-check', retryable: true }
      );

      return result.rows.length > 0 && result.rows[0].locked === true;
    } catch (err) {
      logger.error('Error checking year lock status', {
        error: err.message,
        year,
      });

      if (failOpen) {
        return false;
      }

      throw new TransactionAbort(503, {
        error: `Cannot verify year lock status for ${year}`,
        code: 'YEAR_LOCK_CHECK_FAILED',
        yearLocked: true,
        year,
      });
    }
  }

  async function acquireYearLocks(client, years) {
    await acquireTransactionLocks(client, LOCK_NAMESPACES.YEAR, years);
  }

  async function validateYearNotLocked(pool, year, operation) {
    if (!year) return;

    const locked = await isYearLocked(pool, year, { failOpen: false });
    if (locked) {
      throw new TransactionAbort(403, {
        error: `Cannot ${operation}: Year ${year} is locked`,
        code: 'YEAR_LOCKED',
        yearLocked: true,
        year,
      });
    }
  }

  async function isMainListLocked(pool, year, isMain) {
    if (!year || !isMain) return false;
    return await isYearLocked(pool, year);
  }

  async function validateMainListNotLocked(pool, year, isMain, operation) {
    if (!year || !isMain) return;

    const locked = await isYearLocked(pool, year, { failOpen: false });
    if (locked) {
      throw new TransactionAbort(403, {
        error: `Cannot ${operation}: Main list for year ${year} is locked`,
        code: 'YEAR_LOCKED',
        yearLocked: true,
        year,
      });
    }
  }

  return {
    acquireYearLocks,
    isYearLocked,
    validateYearNotLocked,
    isMainListLocked,
    validateMainListNotLocked,
  };
}

const defaultInstance = createYearLock();

module.exports = { createYearLock, ...defaultInstance };
