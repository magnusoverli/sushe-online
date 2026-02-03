const logger = require('../../../utils/logger');

/**
 * Add lastfm_status column to user_album_stats table
 *
 * This distinguishes between:
 * - 'success': Album found on Last.fm, playcount is accurate
 * - 'not_found': Album not found on Last.fm
 * - NULL: Never fetched yet
 */
async function up(pool) {
  logger.info('Adding lastfm_status column to user_album_stats...');

  // Add the status column
  await pool.query(`
    ALTER TABLE user_album_stats
    ADD COLUMN IF NOT EXISTS lastfm_status TEXT
  `);

  // Update existing rows: if lastfm_updated_at is set, assume success
  // (we can't retroactively know which were not_found)
  await pool.query(`
    UPDATE user_album_stats
    SET lastfm_status = 'success'
    WHERE lastfm_updated_at IS NOT NULL
      AND lastfm_status IS NULL
  `);

  logger.info('lastfm_status column added successfully');
}

async function down(pool) {
  logger.info('Removing lastfm_status column from user_album_stats...');

  await pool.query(`
    ALTER TABLE user_album_stats
    DROP COLUMN IF EXISTS lastfm_status
  `);

  logger.info('lastfm_status column removed');
}

module.exports = { up, down };
