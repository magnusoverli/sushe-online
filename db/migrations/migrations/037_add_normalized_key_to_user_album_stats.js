const logger = require('../../../utils/logger');

// Add normalized_key column to user_album_stats for consistent matching
// This aligns Last.fm playcount lookups with the app's album deduplication strategy
// The normalized key uses the same logic as fuzzy-match.js normalizeAlbumKey()
//
// Benefits:
// - "OK Computer (Deluxe Edition)" matches "OK Computer"
// - "The Beatles" matches "Beatles"
// - Handles diacritics, special characters, edition suffixes

async function up(pool) {
  logger.info('Adding normalized_key column to user_album_stats...');

  // Step 1: Add the normalized_key column
  await pool.query(`
    ALTER TABLE user_album_stats
    ADD COLUMN IF NOT EXISTS normalized_key TEXT
  `);

  // Step 2: Create index on normalized_key for fast lookups
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_album_stats_normalized_key
    ON user_album_stats(user_id, normalized_key)
  `);

  // Note: We don't populate existing rows here because we'd need the JS
  // normalizeAlbumKey function. The application will populate this on
  // next refresh. Existing lookups will fall back to LOWER() matching
  // until the data is refreshed.

  logger.info('normalized_key column added successfully');
}

async function down(pool) {
  logger.info('Removing normalized_key column from user_album_stats...');

  await pool.query('DROP INDEX IF EXISTS idx_user_album_stats_normalized_key');
  await pool.query(
    'ALTER TABLE user_album_stats DROP COLUMN IF EXISTS normalized_key'
  );

  logger.info('normalized_key column removed');
}

module.exports = { up, down };
