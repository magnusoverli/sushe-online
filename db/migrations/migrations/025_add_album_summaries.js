const logger = require('../../../utils/logger');

/**
 * Migration to add album summary columns for Last.fm wiki integration
 *
 * Adds three columns to the albums table:
 * - summary: The plain text album summary from Last.fm wiki
 * - lastfm_url: URL to the album page on Last.fm
 * - summary_fetched_at: Timestamp of when we last attempted to fetch the summary
 *
 * The summary_fetched_at column allows us to distinguish between:
 * - summary = NULL + summary_fetched_at = NULL → never attempted
 * - summary = NULL + summary_fetched_at = timestamp → attempted, none found
 * - summary = text + summary_fetched_at = timestamp → has summary
 */

async function up(pool) {
  logger.info('Adding album summary columns...');

  // Add summary column
  await pool.query(`
    ALTER TABLE albums 
    ADD COLUMN IF NOT EXISTS summary TEXT
  `);
  logger.info('Added summary column');

  // Add lastfm_url column
  await pool.query(`
    ALTER TABLE albums 
    ADD COLUMN IF NOT EXISTS lastfm_url TEXT
  `);
  logger.info('Added lastfm_url column');

  // Add summary_fetched_at column
  await pool.query(`
    ALTER TABLE albums 
    ADD COLUMN IF NOT EXISTS summary_fetched_at TIMESTAMPTZ
  `);
  logger.info('Added summary_fetched_at column');

  logger.info('Migration completed: album summary columns added');
}

async function down(pool) {
  logger.info('Removing album summary columns...');

  await pool.query('ALTER TABLE albums DROP COLUMN IF EXISTS summary');
  await pool.query('ALTER TABLE albums DROP COLUMN IF EXISTS lastfm_url');
  await pool.query(
    'ALTER TABLE albums DROP COLUMN IF EXISTS summary_fetched_at'
  );

  logger.info('Reverted: album summary columns removed');
}

module.exports = { up, down };
