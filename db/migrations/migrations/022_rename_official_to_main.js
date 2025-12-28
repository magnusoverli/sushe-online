const logger = require('../../../utils/logger');

// Rename is_official to is_main for clearer terminology
// "Main" indicates the designated list for aggregate contribution without
// implying public visibility (which "official" might suggest)
async function up(pool) {
  logger.info('Renaming is_official column to is_main...');

  // Drop old indexes first
  await pool.query('DROP INDEX IF EXISTS idx_lists_user_year_official');
  await pool.query('DROP INDEX IF EXISTS idx_lists_is_official');

  // Rename the column
  await pool.query(`
    ALTER TABLE lists 
    RENAME COLUMN is_official TO is_main
  `);

  // Recreate indexes with new naming
  // Partial unique index: only one main list per user per year
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lists_user_year_main
    ON lists(user_id, year)
    WHERE is_main = TRUE
  `);

  // Regular index for querying main lists
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_lists_is_main
    ON lists(is_main)
    WHERE is_main = TRUE
  `);

  logger.info('is_official column renamed to is_main successfully');
}

async function down(pool) {
  logger.info('Reverting is_main column back to is_official...');

  // Drop new indexes
  await pool.query('DROP INDEX IF EXISTS idx_lists_user_year_main');
  await pool.query('DROP INDEX IF EXISTS idx_lists_is_main');

  // Rename column back
  await pool.query(`
    ALTER TABLE lists 
    RENAME COLUMN is_main TO is_official
  `);

  // Recreate original indexes
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lists_user_year_official
    ON lists(user_id, year)
    WHERE is_official = TRUE
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_lists_is_official
    ON lists(is_official)
    WHERE is_official = TRUE
  `);

  logger.info('is_main column reverted to is_official');
}

module.exports = { up, down };
