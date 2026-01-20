const logger = require('../../../utils/logger');

/**
 * Migration to simplify list_items table
 *
 * The list_items table was designed with override columns that could store
 * user-specific album metadata. In practice, this feature was rarely used
 * and all album metadata now comes from the canonical albums table.
 *
 * This migration removes the unused override columns:
 * - artist: Album artist (canonical in albums table)
 * - album: Album name (canonical in albums table)
 * - release_date: Release date (canonical in albums table)
 * - country: Country of origin (canonical in albums table)
 * - genre_1: Primary genre (was always NULL - never used)
 * - genre_2: Secondary genre (was always NULL - never used)
 * - tracks: Track listing (canonical in albums table)
 * - cover_image: Cover art (was always NULL on insert)
 * - cover_image_format: Image format (was always NULL on insert)
 * - track_pick: Legacy track picks (migrated to track_picks table in migration 035)
 *
 * After this migration, list_items becomes a simple junction table with:
 * - _id: Unique identifier
 * - list_id: FK to lists table
 * - album_id: FK to albums table
 * - position: Order in list
 * - comments: User-specific notes (the only user-specific data)
 * - created_at, updated_at: Timestamps
 */

async function up(pool) {
  logger.info(
    'Simplifying list_items table - removing unused override columns...'
  );

  // Drop columns one by one to avoid issues if some don't exist
  const columnsToDrop = [
    'artist',
    'album',
    'release_date',
    'country',
    'genre_1',
    'genre_2',
    'tracks',
    'cover_image',
    'cover_image_format',
    'track_pick',
  ];

  for (const column of columnsToDrop) {
    try {
      await pool.query(
        `ALTER TABLE list_items DROP COLUMN IF EXISTS ${column}`
      );
      logger.info(`Dropped list_items.${column} column`);
    } catch (error) {
      logger.warn(`Could not drop list_items.${column}: ${error.message}`);
    }
  }

  logger.info('Migration completed: list_items table simplified');
}

/**
 * Post-migration hook runs outside the transaction.
 * Used for VACUUM which cannot run inside a transaction block.
 */
async function postMigrate(pool) {
  logger.info('Running VACUUM ANALYZE to reclaim space...');
  await pool.query('VACUUM ANALYZE list_items');
  logger.info('VACUUM ANALYZE completed');
}

async function down(pool) {
  logger.info('Restoring list_items override columns...');

  // Restore columns (all nullable, no data to restore)
  await pool.query(`
    ALTER TABLE list_items 
    ADD COLUMN IF NOT EXISTS artist TEXT,
    ADD COLUMN IF NOT EXISTS album TEXT,
    ADD COLUMN IF NOT EXISTS release_date TEXT,
    ADD COLUMN IF NOT EXISTS country TEXT,
    ADD COLUMN IF NOT EXISTS genre_1 TEXT,
    ADD COLUMN IF NOT EXISTS genre_2 TEXT,
    ADD COLUMN IF NOT EXISTS tracks JSONB,
    ADD COLUMN IF NOT EXISTS cover_image BYTEA,
    ADD COLUMN IF NOT EXISTS cover_image_format TEXT,
    ADD COLUMN IF NOT EXISTS track_pick TEXT
  `);

  logger.info('Reverted: list_items override columns restored (empty)');
}

module.exports = { up, down, postMigrate };
