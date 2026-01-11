const logger = require('../../../utils/logger');

/**
 * Migration to add unique constraint on albums table
 *
 * After deduplication (migration 031), this adds a database-level constraint
 * to prevent future duplicate albums from being created.
 *
 * The constraint ensures only ONE album per unique artist/album combination
 * (case-insensitive, trimmed).
 *
 * Note: This uses a unique index rather than a constraint because PostgreSQL
 * doesn't support expressions in UNIQUE constraints, but does in indexes.
 */

async function up(pool) {
  logger.info('Adding unique constraint on albums table...');

  // First verify no duplicates exist (migration 031 should have cleaned these up)
  const duplicates = await pool.query(`
    SELECT 
      LOWER(TRIM(COALESCE(artist, ''))) as normalized_artist,
      LOWER(TRIM(COALESCE(album, ''))) as normalized_album,
      COUNT(*) as count
    FROM albums
    WHERE artist IS NOT NULL AND artist != ''
      AND album IS NOT NULL AND album != ''
    GROUP BY normalized_artist, normalized_album
    HAVING COUNT(*) > 1
  `);

  if (duplicates.rows.length > 0) {
    logger.error(
      `Cannot add constraint: ${duplicates.rows.length} duplicate groups still exist`
    );
    logger.error('Run migration 031_deduplicate_canonical_albums first');
    throw new Error('Duplicate albums exist - cannot add unique constraint');
  }

  // Create unique index on normalized artist/album
  // This prevents future duplicates at the database level
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_albums_unique_artist_album
    ON albums (LOWER(TRIM(COALESCE(artist, ''))), LOWER(TRIM(COALESCE(album, ''))))
    WHERE artist IS NOT NULL AND artist != '' AND album IS NOT NULL AND album != ''
  `);

  logger.info('Unique constraint added successfully');

  // Verify the index was created
  const indexCheck = await pool.query(`
    SELECT indexname FROM pg_indexes 
    WHERE tablename = 'albums' AND indexname = 'idx_albums_unique_artist_album'
  `);

  if (indexCheck.rows.length === 0) {
    throw new Error('Failed to create unique index');
  }

  logger.info('Verified: idx_albums_unique_artist_album index exists');
}

async function down(pool) {
  logger.info('Removing unique constraint from albums table...');

  await pool.query('DROP INDEX IF EXISTS idx_albums_unique_artist_album');

  logger.info('Unique constraint removed');
}

module.exports = { up, down };
