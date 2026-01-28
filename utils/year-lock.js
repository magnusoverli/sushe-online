const logger = require('./logger');

/**
 * Year Lock Utilities
 *
 * Provides functions to check if a year is locked and validate operations
 * against locked years. Year locking prevents list creation/modification
 * for specific years while allowing admin operations like contributor
 * management and aggregate recomputation.
 */

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
 * @throws {Error} - If year is locked
 */
async function validateYearNotLocked(pool, year, operation) {
  if (!year) return; // null years are fine (collections)

  const locked = await isYearLocked(pool, year);
  if (locked) {
    throw new Error(`Cannot ${operation}: Year ${year} is locked`);
  }
}

module.exports = { isYearLocked, validateYearNotLocked };
