const logger = require('../../../utils/logger');

/**
 * Migration to fix conflicting album unique constraint
 *
 * Problem: Migration 046 created new partial unique indexes but forgot to drop
 * the old global index from migration 032. This causes duplicate key violations
 * when trying to add albums via the extension because the old index catches
 * duplicates BEFORE the ON CONFLICT clause can handle them gracefully.
 *
 * Solution: Drop the old idx_albums_unique_artist_album index. The new partial
 * indexes from migration 046 already handle uniqueness correctly:
 * - idx_albums_album_id_unique: For albums WITH external album_id
 * - idx_albums_normalized_name_unique: For albums WITHOUT external album_id
 *
 * This allows the upsertCanonical() function to work as designed:
 * INSERT ... ON CONFLICT ... DO UPDATE will find existing albums and return
 * their album_id instead of throwing a constraint violation.
 */

async function up(pool) {
  logger.info('Dropping conflicting album index from migration 032...');

  // Check if the old index exists
  const indexCheck = await pool.query(`
    SELECT indexname FROM pg_indexes 
    WHERE tablename = 'albums' AND indexname = 'idx_albums_unique_artist_album'
  `);

  if (indexCheck.rows.length > 0) {
    logger.info('Found idx_albums_unique_artist_album - dropping...');
    await pool.query(`
      DROP INDEX IF EXISTS idx_albums_unique_artist_album
    `);
    logger.info('Successfully dropped idx_albums_unique_artist_album');
  } else {
    logger.info(
      'Index idx_albums_unique_artist_album does not exist - skipping'
    );
  }

  // Verify the partial indexes from migration 046 still exist
  const partialIndexCheck = await pool.query(`
    SELECT indexname FROM pg_indexes 
    WHERE tablename = 'albums' 
      AND indexname IN ('idx_albums_album_id_unique', 'idx_albums_normalized_name_unique')
    ORDER BY indexname
  `);

  if (partialIndexCheck.rows.length === 2) {
    logger.info('Verified: Both partial indexes from migration 046 exist');
  } else {
    logger.warn(
      `Warning: Expected 2 partial indexes, found ${partialIndexCheck.rows.length}`
    );
  }

  logger.info(
    'Migration completed: ON CONFLICT in upsertCanonical() will now work correctly'
  );
}

async function down(pool) {
  logger.info('Restoring old album unique constraint...');

  // Restore the old global index
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_albums_unique_artist_album
    ON albums (LOWER(TRIM(COALESCE(artist, ''))), LOWER(TRIM(COALESCE(album, ''))))
    WHERE artist IS NOT NULL AND artist != '' AND album IS NOT NULL AND album != ''
  `);

  logger.info('Restored idx_albums_unique_artist_album index');
}

module.exports = { up, down };
