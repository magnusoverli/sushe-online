const logger = require('../../../utils/logger');

// Add aggregate_list_views table to track which users have seen the dramatic reveal
async function up(pool) {
  logger.info('Creating aggregate_list_views table...');

  // Tracks when a user has seen the dramatic reveal for a specific year
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aggregate_list_views (
      user_id TEXT NOT NULL REFERENCES users(_id) ON DELETE CASCADE,
      year INTEGER NOT NULL,
      viewed_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (user_id, year)
    )
  `);

  // Index for quick lookups by year
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_aggregate_list_views_year
    ON aggregate_list_views(year)
  `);

  logger.info('aggregate_list_views table created successfully');
}

async function down(pool) {
  logger.info('Dropping aggregate_list_views table...');
  await pool.query('DROP TABLE IF EXISTS aggregate_list_views CASCADE');
  logger.info('aggregate_list_views table dropped successfully');
}

module.exports = { up, down };
