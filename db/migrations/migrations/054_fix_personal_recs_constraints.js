const logger = require('../../../utils/logger');

/**
 * Migration: Fix personal recommendations constraints
 *
 * - Drop FK constraint on weekly_new_releases.album_id (new releases may not exist in albums table)
 * - Drop FK constraint on personal_recommendation_items.album_id (same reason)
 * - Change weekly_new_releases.release_date from DATE to TEXT (sources return partial dates like "2026")
 */

async function up(pool) {
  logger.info(
    'Running migration 054: Fixing personal recommendations constraints...'
  );

  // Drop FK on weekly_new_releases.album_id
  await pool.query(`
    ALTER TABLE weekly_new_releases
    DROP CONSTRAINT IF EXISTS weekly_new_releases_album_id_fkey
  `);

  // Drop FK on personal_recommendation_items.album_id
  await pool.query(`
    ALTER TABLE personal_recommendation_items
    DROP CONSTRAINT IF EXISTS personal_recommendation_items_album_id_fkey
  `);

  // Change release_date from DATE to TEXT to handle partial dates
  await pool.query(`
    ALTER TABLE weekly_new_releases
    ALTER COLUMN release_date TYPE TEXT USING release_date::TEXT
  `);

  logger.info(
    'Migration 054 completed: FK constraints dropped, release_date changed to TEXT'
  );
}

async function down(pool) {
  logger.info('Rolling back migration 054...');

  // Restore release_date to DATE (may lose partial dates)
  await pool.query(`
    ALTER TABLE weekly_new_releases
    ALTER COLUMN release_date TYPE DATE USING NULLIF(release_date, '')::DATE
  `);

  // Re-add FK constraints
  await pool.query(`
    ALTER TABLE weekly_new_releases
    ADD CONSTRAINT weekly_new_releases_album_id_fkey
    FOREIGN KEY (album_id) REFERENCES albums(album_id) ON DELETE CASCADE
  `);

  await pool.query(`
    ALTER TABLE personal_recommendation_items
    ADD CONSTRAINT personal_recommendation_items_album_id_fkey
    FOREIGN KEY (album_id) REFERENCES albums(album_id) ON DELETE CASCADE
  `);

  logger.info('Rollback 054 complete');
}

module.exports = { up, down };
