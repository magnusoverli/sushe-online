/**
 * Year Lock Utilities
 *
 * Provides functions to check if a year is locked and validate operations
 * against locked years. Year locking prevents modification of MAIN lists
 * for specific years while allowing:
 * - Creation of new lists (they start as non-main)
 * - Editing non-main lists
 * - Admin operations like contributor management and aggregate recomputation
 *
 * Main status cannot be changed in locked years (cannot set or unset main).
 *
 * Uses dependency injection via createYearLock(deps) factory.
 * Tests can inject a mock logger; production uses the default instance.
 */

/**
 * Factory that creates year lock utility functions with injectable dependencies.
 *
 * @param {Object} deps - Dependencies
 * @param {Object} deps.logger - Logger with error() method
 * @param {Function} deps.TransactionAbort - TransactionAbort constructor
 * @returns {Object} Year lock utility functions
 */
function createYearLock(deps = {}) {
  const logger = deps.logger || require('./logger');
  const TransactionAbort =
    deps.TransactionAbort || require('../db/transaction').TransactionAbort;

  /**
   * Check if a year is locked
   * @param {object} pool - PostgreSQL connection pool
   * @param {number|null} year - Year to check
   * @returns {Promise<boolean>} - True if year is locked, false otherwise
   */
  async function isYearLocked(pool, year) {
    if (!year) return false; // null/undefined years can't be locked

    try {
      const result = await pool.query(
        'SELECT locked FROM master_lists WHERE year = $1',
        [year]
      );

      return result.rows.length > 0 && result.rows[0].locked === true;
    } catch (err) {
      logger.error('Error checking year lock status', {
        error: err.message,
        year,
      });
      // Fail safe: if we can't check, assume not locked to avoid blocking operations
      return false;
    }
  }

  /**
   * Validate that a year is not locked before performing an operation
   * Throws an error if the year is locked
   * @param {object} pool - PostgreSQL connection pool
   * @param {number|null} year - Year to validate
   * @param {string} operation - Description of the operation being attempted
   * @throws {TransactionAbort} - 403 if year is locked
   */
  async function validateYearNotLocked(pool, year, operation) {
    if (!year) return; // null years are fine (collections)

    const locked = await isYearLocked(pool, year);
    if (locked) {
      throw new TransactionAbort(403, {
        error: `Cannot ${operation}: Year ${year} is locked`,
      });
    }
  }

  /**
   * Check if a specific list is locked
   * A list is locked only if the year is locked AND the list is the main list
   * @param {object} pool - PostgreSQL connection pool
   * @param {number|null} year - Year to check
   * @param {boolean} isMain - Whether the list is the main list
   * @returns {Promise<boolean>} - True if list is locked, false otherwise
   */
  async function isMainListLocked(pool, year, isMain) {
    if (!year || !isMain) return false;
    return await isYearLocked(pool, year);
  }

  /**
   * Validate that a main list is not locked before performing an operation
   * Throws an error only if the year is locked AND the list is main
   * @param {object} pool - PostgreSQL connection pool
   * @param {number|null} year - Year to validate
   * @param {boolean} isMain - Whether the list is the main list
   * @param {string} operation - Description of the operation being attempted
   * @throws {TransactionAbort} - 403 if list is locked (year locked + is main)
   */
  async function validateMainListNotLocked(pool, year, isMain, operation) {
    if (!year || !isMain) return; // Non-main lists are never locked

    const locked = await isYearLocked(pool, year);
    if (locked) {
      throw new TransactionAbort(403, {
        error: `Cannot ${operation}: Main list for year ${year} is locked`,
      });
    }
  }

  return {
    isYearLocked,
    validateYearNotLocked,
    isMainListLocked,
    validateMainListNotLocked,
  };
}

// Default instance for production use — callers import as before
const defaultInstance = createYearLock();

module.exports = { createYearLock, ...defaultInstance };
