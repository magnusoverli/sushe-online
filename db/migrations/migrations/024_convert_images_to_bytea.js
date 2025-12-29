const logger = require('../../../utils/logger');

/**
 * Migration to convert cover_image columns from TEXT (base64) to BYTEA (binary)
 *
 * This improves performance by:
 * - Reducing storage size by ~25% (base64 adds 33% overhead)
 * - Eliminating encode/decode overhead on every request
 * - Enabling proper binary image serving with HTTP caching
 *
 * Note: This migration may take several minutes on large datasets as it
 * reads and converts every image in the database.
 */

async function up(pool) {
  logger.info('Converting cover_image columns from TEXT to BYTEA...');

  // Get row counts for progress reporting
  const albumCount = await pool.query(
    "SELECT COUNT(*) FROM albums WHERE cover_image IS NOT NULL AND cover_image != ''"
  );
  const listItemCount = await pool.query(
    "SELECT COUNT(*) FROM list_items WHERE cover_image IS NOT NULL AND cover_image != ''"
  );

  logger.info(
    `Found ${albumCount.rows[0].count} albums and ${listItemCount.rows[0].count} list items with images to convert`
  );

  // First, clean up any invalid data (URLs stored instead of base64)
  // These will be set to NULL as they can't be converted
  // NOTE: Only clear obvious non-base64 data (URLs/data URIs). Do NOT use regex
  // that might match valid base64 with whitespace/newlines.
  logger.info('Cleaning up invalid cover_image data (URLs, etc.)...');
  const invalidAlbums = await pool.query(`
    UPDATE albums 
    SET cover_image = NULL 
    WHERE cover_image IS NOT NULL 
      AND (cover_image LIKE 'http%' OR cover_image LIKE 'data:%')
    RETURNING album_id
  `);
  if (invalidAlbums.rowCount > 0) {
    logger.info(
      `Cleared ${invalidAlbums.rowCount} albums with invalid cover_image data`
    );
  }

  const invalidListItems = await pool.query(`
    UPDATE list_items 
    SET cover_image = NULL 
    WHERE cover_image IS NOT NULL 
      AND (cover_image LIKE 'http%' OR cover_image LIKE 'data:%')
    RETURNING _id
  `);
  if (invalidListItems.rowCount > 0) {
    logger.info(
      `Cleared ${invalidListItems.rowCount} list_items with invalid cover_image data`
    );
  }

  // Convert albums.cover_image from TEXT (base64) to BYTEA
  // Strip whitespace/newlines from base64 before decoding (common in formatted base64)
  logger.info('Converting albums.cover_image to BYTEA...');
  await pool.query(`
    ALTER TABLE albums 
    ALTER COLUMN cover_image TYPE BYTEA 
    USING CASE 
      WHEN cover_image IS NOT NULL AND cover_image != '' 
      THEN decode(regexp_replace(cover_image, '\\s', '', 'g'), 'base64') 
      ELSE NULL 
    END
  `);
  logger.info('albums.cover_image converted successfully');

  // Convert list_items.cover_image from TEXT (base64) to BYTEA
  // Strip whitespace/newlines from base64 before decoding (common in formatted base64)
  logger.info('Converting list_items.cover_image to BYTEA...');
  await pool.query(`
    ALTER TABLE list_items 
    ALTER COLUMN cover_image TYPE BYTEA 
    USING CASE 
      WHEN cover_image IS NOT NULL AND cover_image != '' 
      THEN decode(regexp_replace(cover_image, '\\s', '', 'g'), 'base64') 
      ELSE NULL 
    END
  `);
  logger.info('list_items.cover_image converted successfully');

  logger.info('Migration completed: cover_image columns converted to BYTEA');
}

async function down(pool) {
  logger.info('Reverting cover_image columns from BYTEA back to TEXT...');

  // Convert albums.cover_image back to TEXT (base64)
  await pool.query(`
    ALTER TABLE albums 
    ALTER COLUMN cover_image TYPE TEXT 
    USING CASE
      WHEN cover_image IS NOT NULL
      THEN encode(cover_image, 'base64')
      ELSE NULL
    END
  `);

  // Convert list_items.cover_image back to TEXT (base64)
  await pool.query(`
    ALTER TABLE list_items 
    ALTER COLUMN cover_image TYPE TEXT 
    USING CASE
      WHEN cover_image IS NOT NULL
      THEN encode(cover_image, 'base64')
      ELSE NULL
    END
  `);

  logger.info('Reverted: cover_image columns converted back to TEXT');
}

/**
 * Post-migration hook that runs OUTSIDE the transaction.
 * This allows VACUUM ANALYZE to run and reclaim disk space.
 */
async function postMigrate(pool) {
  logger.info(
    'Running VACUUM ANALYZE to reclaim space from TEXT→BYTEA conversion...'
  );

  await pool.query('VACUUM ANALYZE albums');
  logger.info('VACUUM ANALYZE albums completed');

  await pool.query('VACUUM ANALYZE list_items');
  logger.info('VACUUM ANALYZE list_items completed');

  logger.info('Post-migration cleanup completed');
}

module.exports = { up, down, postMigrate };
