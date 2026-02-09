const logger = require('../../../utils/logger');

/**
 * Migration: Add artist, album, genre columns to personal_recommendation_items
 *
 * Recommendation items should carry their own artist/album/genre data so they
 * don't depend on a LEFT JOIN to the albums table (which may not have an entry
 * for new releases discovered via MusicBrainz or Claude search).
 */

async function up(pool) {
  logger.info(
    'Running migration 055: Adding artist/album/genre to personal_recommendation_items...'
  );

  await pool.query(`
    ALTER TABLE personal_recommendation_items
    ADD COLUMN IF NOT EXISTS artist TEXT,
    ADD COLUMN IF NOT EXISTS album TEXT,
    ADD COLUMN IF NOT EXISTS genre TEXT
  `);

  logger.info(
    'Migration 055 completed: artist, album, genre columns added to personal_recommendation_items'
  );
}

async function down(pool) {
  logger.info(
    'Rolling back migration 055: Removing artist/album/genre from personal_recommendation_items...'
  );

  await pool.query(`
    ALTER TABLE personal_recommendation_items
    DROP COLUMN IF EXISTS artist,
    DROP COLUMN IF EXISTS album,
    DROP COLUMN IF EXISTS genre
  `);

  logger.info('Rollback 055 complete');
}

module.exports = { up, down };
