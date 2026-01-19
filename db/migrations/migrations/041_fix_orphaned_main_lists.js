const logger = require('../../../utils/logger');

/**
 * Migration: Fix orphaned lists with is_main flag
 *
 * Bug: When collections were deleted, lists were orphaned (group_id set to NULL)
 * but their is_main flag was not cleared. This creates an inconsistent state
 * where lists without years have is_main = TRUE, which violates the business
 * rule that only lists with years can be marked as main.
 *
 * This migration:
 * 1. Clears is_main flag for any orphaned lists (no group_id and no year)
 * 2. Ensures data consistency going forward
 */

async function up(pool) {
  logger.info(
    'Clearing is_main flag for orphaned lists without years or groups...'
  );

  // Fix existing data: clear is_main for any lists that are orphaned
  // (no group_id) and have no year. These lists cannot be main lists.
  const result = await pool.query(`
    UPDATE lists 
    SET is_main = FALSE, updated_at = NOW()
    WHERE is_main = TRUE 
      AND group_id IS NULL
      AND year IS NULL
  `);

  logger.info(
    `Cleared is_main flag for ${result.rowCount} orphaned list(s) without years`
  );

  // Also log any remaining lists that are main but have no year
  // (these would be in year-groups, which is valid)
  const remainingMainWithoutYear = await pool.query(`
    SELECT COUNT(*) as count
    FROM lists
    WHERE is_main = TRUE AND year IS NULL
  `);

  if (parseInt(remainingMainWithoutYear.rows[0].count) > 0) {
    logger.info(
      `Found ${remainingMainWithoutYear.rows[0].count} main list(s) without direct year (likely in year-groups, which is valid)`
    );
  }

  logger.info('Migration complete: orphaned main lists fixed');
}

async function down(_pool) {
  // This migration only fixes data inconsistencies, nothing to roll back
  logger.info(
    'No rollback needed for orphaned main lists fix (data cleanup only)'
  );
}

module.exports = { up, down };
