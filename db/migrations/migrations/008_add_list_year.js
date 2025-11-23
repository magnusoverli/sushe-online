const logger = require('../../../utils/logger');

// Add year column to lists table for chronological categorization
async function up(pool) {
  logger.info('Adding year column to lists table...');

  // Add nullable year column (existing lists won't have years)
  await pool.query(`
    ALTER TABLE lists 
    ADD COLUMN IF NOT EXISTS year INTEGER
  `);

  // Add check constraint for valid year range (1000-9999)
  // PostgreSQL doesn't support IF NOT EXISTS for constraints, so we check manually
  const constraintExists = await pool.query(`
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'lists_year_range' 
    AND conrelid = 'lists'::regclass
  `);

  if (constraintExists.rows.length === 0) {
    await pool.query(`
      ALTER TABLE lists 
      ADD CONSTRAINT lists_year_range 
      CHECK (year IS NULL OR (year >= 1000 AND year <= 9999))
    `);
  }

  // Index on year for efficient filtering/grouping
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_lists_year 
    ON lists(year)
    WHERE year IS NOT NULL
  `);

  // Composite index for user's lists grouped by year
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_lists_user_year 
    ON lists(user_id, year)
  `);

  logger.info('Year column added to lists table successfully');
}

async function down(pool) {
  logger.info('Removing year column from lists table...');

  // Drop indexes first
  await pool.query('DROP INDEX IF EXISTS idx_lists_year');
  await pool.query('DROP INDEX IF EXISTS idx_lists_user_year');

  // Drop constraint
  await pool.query(
    'ALTER TABLE lists DROP CONSTRAINT IF EXISTS lists_year_range'
  );

  // Drop column
  await pool.query('ALTER TABLE lists DROP COLUMN IF EXISTS year');

  logger.info('Year column removed from lists table');
}

module.exports = { up, down };
