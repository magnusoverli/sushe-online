const logger = require('../../../utils/logger');

/**
 * Migration to add composite index for aggregate list queries
 *
 * Adds an index optimized for queries that filter lists by year and is_main=true.
 * This is a common pattern in aggregate list calculations where we need to find
 * all main lists for a given year across all users.
 *
 * Example query this optimizes:
 *   SELECT * FROM lists WHERE year = 2024 AND is_main = TRUE
 *
 * Existing indexes:
 * - idx_lists_user_year_main: UNIQUE (user_id, year) WHERE is_main = TRUE
 *   - Good for per-user lookups, not for year-wide scans
 * - idx_lists_is_main: (is_main) WHERE is_main = TRUE
 *   - Good for finding all main lists, but not filtered by year
 *
 * This new index fills the gap for year-filtered aggregate queries.
 */

async function up(pool) {
  logger.info('Adding composite index for aggregate list queries...');

  // Create partial index on year for main lists only
  // This optimizes queries like: WHERE year = ? AND is_main = TRUE
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_lists_year_main 
    ON lists(year) 
    WHERE is_main = TRUE
  `);

  logger.info('Added idx_lists_year_main partial index for aggregate queries');
  logger.info('Migration completed: lists year+main index added');
}

async function down(pool) {
  logger.info('Removing lists year+main index...');

  await pool.query(`
    DROP INDEX IF EXISTS idx_lists_year_main
  `);

  logger.info('Reverted: lists year+main index removed');
}

module.exports = { up, down };
