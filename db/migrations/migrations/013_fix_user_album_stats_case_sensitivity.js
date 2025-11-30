const logger = require('../../../utils/logger');

// Fix case-sensitivity issue in user_album_stats table
// The original unique constraint was case-sensitive, causing duplicate entries
// and failed ON CONFLICT matches when album names had different casing.
//
// This migration:
// 1. Normalizes existing data to lowercase
// 2. Removes duplicates (keeping the most recently updated entry)
// 3. Drops the old case-sensitive unique constraint
// 4. Creates a new case-insensitive unique index using LOWER()

async function up(pool) {
  logger.info(
    'Fixing case-sensitivity in user_album_stats unique constraint...'
  );

  // Step 1: Normalize existing data to lowercase and remove duplicates
  // First, identify and delete duplicates, keeping the one with the latest update
  logger.info('Removing duplicate entries (keeping most recent)...');

  await pool.query(`
    DELETE FROM user_album_stats a
    USING user_album_stats b
    WHERE a.id < b.id
      AND a.user_id = b.user_id
      AND LOWER(a.artist) = LOWER(b.artist)
      AND LOWER(a.album_name) = LOWER(b.album_name)
  `);

  // Step 2: Normalize remaining data to lowercase
  logger.info('Normalizing artist and album_name to lowercase...');

  await pool.query(`
    UPDATE user_album_stats
    SET artist = LOWER(artist),
        album_name = LOWER(album_name),
        updated_at = NOW()
    WHERE artist != LOWER(artist) OR album_name != LOWER(album_name)
  `);

  // Step 3: Drop the old case-sensitive unique constraint
  logger.info('Dropping old case-sensitive unique constraint...');

  await pool.query(`
    ALTER TABLE user_album_stats
    DROP CONSTRAINT IF EXISTS user_album_stats_user_id_artist_album_name_key
  `);

  // Step 4: Create a new unique index on lowercased values
  // This allows ON CONFLICT to work with case-insensitive matching
  logger.info('Creating case-insensitive unique index...');

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS user_album_stats_user_artist_album_lower_idx
    ON user_album_stats (user_id, LOWER(artist), LOWER(album_name))
  `);

  // Step 5: Drop the old composite index (now redundant)
  await pool.query(`
    DROP INDEX IF EXISTS idx_user_album_stats_user_artist_album
  `);

  logger.info('Case-sensitivity fix completed successfully');
}

async function down(pool) {
  logger.info('Reverting case-sensitivity fix...');

  // Drop the case-insensitive unique index
  await pool.query(`
    DROP INDEX IF EXISTS user_album_stats_user_artist_album_lower_idx
  `);

  // Recreate the original unique constraint
  await pool.query(`
    ALTER TABLE user_album_stats
    ADD CONSTRAINT user_album_stats_user_id_artist_album_name_key
    UNIQUE (user_id, artist, album_name)
  `);

  // Recreate the old composite index
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_album_stats_user_artist_album
    ON user_album_stats(user_id, LOWER(artist), LOWER(album_name))
  `);

  logger.info('Case-sensitivity fix reverted');
}

module.exports = { up, down };
