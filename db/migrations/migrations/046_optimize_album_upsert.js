const logger = require('../../../utils/logger');

/**
 * Migration to add partial unique indexes for optimized album upsert
 *
 * This migration creates two partial unique indexes that allow PostgreSQL
 * to use efficient INSERT ... ON CONFLICT DO UPDATE queries instead of
 * separate SELECT-then-UPDATE/INSERT operations.
 *
 * The two indexes handle different album identification strategies:
 * 1. Albums WITH external album_id (MusicBrainz, Spotify, etc.)
 * 2. Albums WITHOUT external album_id (normalized artist+album name)
 *
 * Performance improvement: Reduces 3 queries per album down to 1 query
 * (2 SELECTs + 1 UPDATE/INSERT → 1 INSERT...ON CONFLICT)
 */

async function up(pool) {
  logger.info('Creating partial unique indexes for optimized album upsert...');

  // First, drop the old global index from migration 032
  // This index conflicts with the new partial indexes and prevents ON CONFLICT from working
  logger.info('Dropping old idx_albums_unique_artist_album index...');
  await pool.query(`
    DROP INDEX IF EXISTS idx_albums_unique_artist_album
  `);

  // Index 1: For albums WITH external album_id (MusicBrainz, Spotify, etc.)
  // This allows fast conflict detection on album_id during upsert
  logger.info('Creating idx_albums_album_id_unique...');
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_albums_album_id_unique 
    ON albums (album_id) 
    WHERE album_id IS NOT NULL AND album_id != ''
  `);

  // Index 2: For albums WITHOUT external album_id (user-added or legacy)
  // Uses normalized artist+album name for conflict detection
  // Note: This index uses expression-based uniqueness with LOWER+TRIM
  logger.info('Creating idx_albums_normalized_name_unique...');
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_albums_normalized_name_unique 
    ON albums (
      LOWER(TRIM(COALESCE(artist, ''))), 
      LOWER(TRIM(COALESCE(album, '')))
    )
    WHERE album_id IS NULL OR album_id = ''
  `);

  logger.info('Album upsert optimization indexes created successfully');
  logger.info(
    'Migration completed: 046_optimize_album_upsert - reduces queries from 3→1 per album'
  );
}

async function down(pool) {
  logger.info('Removing album upsert optimization indexes...');

  await pool.query(`
    DROP INDEX IF EXISTS idx_albums_album_id_unique
  `);

  await pool.query(`
    DROP INDEX IF EXISTS idx_albums_normalized_name_unique
  `);

  // Restore the old global index from migration 032
  logger.info('Restoring idx_albums_unique_artist_album index...');
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_albums_unique_artist_album
    ON albums (LOWER(TRIM(COALESCE(artist, ''))), LOWER(TRIM(COALESCE(album, ''))))
    WHERE artist IS NOT NULL AND artist != '' AND album IS NOT NULL AND album != ''
  `);

  logger.info(
    'Reverted: album upsert optimization indexes removed (back to 3 queries per album)'
  );
}

module.exports = { up, down };
