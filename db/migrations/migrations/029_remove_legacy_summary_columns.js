const logger = require('../../../utils/logger');

/**
 * Migration to remove legacy album summary columns
 *
 * Removes columns that were used for Last.fm and Wikipedia summaries:
 * - lastfm_url: URL to the album page on Last.fm
 * - wikipedia_url: URL to the album page on Wikipedia
 *
 * These columns are no longer needed since we've moved to AI-generated summaries.
 */

async function up(pool) {
  logger.info('Removing legacy summary columns...');

  // Drop lastfm_url column
  await pool.query(`
    ALTER TABLE albums 
    DROP COLUMN IF EXISTS lastfm_url
  `);
  logger.info('Dropped lastfm_url column');

  // Drop wikipedia_url column
  await pool.query(`
    ALTER TABLE albums 
    DROP COLUMN IF EXISTS wikipedia_url
  `);
  logger.info('Dropped wikipedia_url column');

  logger.info('Migration completed: legacy summary columns removed');
}

async function down(pool) {
  logger.info('Restoring legacy summary columns...');

  // Restore lastfm_url column
  await pool.query(`
    ALTER TABLE albums 
    ADD COLUMN IF NOT EXISTS lastfm_url TEXT
  `);
  logger.info('Restored lastfm_url column');

  // Restore wikipedia_url column
  await pool.query(`
    ALTER TABLE albums 
    ADD COLUMN IF NOT EXISTS wikipedia_url TEXT
  `);
  logger.info('Restored wikipedia_url column');

  logger.info('Reverted: legacy summary columns restored');
}

module.exports = { up, down };
