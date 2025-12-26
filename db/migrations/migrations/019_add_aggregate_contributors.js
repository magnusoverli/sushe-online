const logger = require('../../../utils/logger');

// Add aggregate_list_contributors table for admin-controlled participation
async function up(pool) {
  logger.info('Creating aggregate_list_contributors table...');

  // Contributors table - tracks which users are approved to contribute to aggregate lists per year
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aggregate_list_contributors (
      id SERIAL PRIMARY KEY,
      year INTEGER NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(_id) ON DELETE CASCADE,
      added_by TEXT NOT NULL REFERENCES users(_id),
      added_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(year, user_id)
    )
  `);

  // Index for fast lookups by year
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_aggregate_list_contributors_year
    ON aggregate_list_contributors(year)
  `);

  // Index for lookups by user
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_aggregate_list_contributors_user_id
    ON aggregate_list_contributors(user_id)
  `);

  // Composite index for the unique constraint lookups
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_aggregate_list_contributors_year_user
    ON aggregate_list_contributors(year, user_id)
  `);

  logger.info('aggregate_list_contributors table created successfully');
}

async function down(pool) {
  logger.info('Dropping aggregate_list_contributors table...');

  await pool.query('DROP TABLE IF EXISTS aggregate_list_contributors CASCADE');

  logger.info('aggregate_list_contributors table dropped successfully');
}

module.exports = { up, down };
