const logger = require('../../../utils/logger');

// Add is_official column to lists table for marking one list per user per year as "official"
async function up(pool) {
  logger.info('Adding is_official column to lists table...');

  // Add is_official boolean column (defaults to false)
  await pool.query(`
    ALTER TABLE lists 
    ADD COLUMN IF NOT EXISTS is_official BOOLEAN DEFAULT FALSE
  `);

  // Create partial unique index: only one official list per user per year
  // This allows multiple non-official lists but enforces uniqueness for official ones
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lists_user_year_official
    ON lists(user_id, year)
    WHERE is_official = TRUE
  `);

  // Regular index for querying official lists
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_lists_is_official
    ON lists(is_official)
    WHERE is_official = TRUE
  `);

  logger.info('is_official column added to lists table successfully');
}

async function down(pool) {
  logger.info('Removing is_official column from lists table...');

  // Drop indexes first
  await pool.query('DROP INDEX IF EXISTS idx_lists_user_year_official');
  await pool.query('DROP INDEX IF EXISTS idx_lists_is_official');

  // Drop column
  await pool.query('ALTER TABLE lists DROP COLUMN IF EXISTS is_official');

  logger.info('is_official column removed from lists table');
}

module.exports = { up, down };
