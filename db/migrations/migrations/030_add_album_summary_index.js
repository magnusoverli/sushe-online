const logger = require('../../../utils/logger');

/**
 * Migration to add index for album summary batch queries
 *
 * Adds a partial index on summary_fetched_at for albums without summaries.
 * This optimizes batch queries that filter by fetch status, which is a common
 * pattern in the album summary batch processing.
 */

async function up(pool) {
  logger.info('Adding album summary index...');

  // Create partial index on summary_fetched_at for albums without summaries
  // This optimizes queries like: WHERE summary IS NULL AND summary_fetched_at IS NULL
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_albums_summary_fetched_at 
    ON albums(summary_fetched_at) 
    WHERE summary IS NULL
  `);
  logger.info('Added idx_albums_summary_fetched_at partial index');

  logger.info('Migration completed: album summary index added');
}

async function down(pool) {
  logger.info('Removing album summary index...');

  await pool.query(`
    DROP INDEX IF EXISTS idx_albums_summary_fetched_at
  `);

  logger.info('Reverted: album summary index removed');
}

module.exports = { up, down };
