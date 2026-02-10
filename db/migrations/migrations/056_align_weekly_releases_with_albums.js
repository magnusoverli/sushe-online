const logger = require('../../../utils/logger');

/**
 * Migration: Align weekly_new_releases schema with canonical albums table
 *
 * Adds columns to weekly_new_releases so its data closely matches the albums table:
 * - _id (TEXT UNIQUE) - internal document ID, matching albums._id pattern
 * - country (TEXT) - country of origin
 * - genre_1, genre_2 (TEXT) - replaces single genre column, matching albums.genre_1/genre_2
 * - tracks (JSONB) - track listing array, matching albums.tracks
 * - cover_image (BYTEA) - album cover art binary, matching albums.cover_image
 * - cover_image_format (TEXT) - MIME type hint, matching albums.cover_image_format
 * - updated_at (TIMESTAMPTZ) - update timestamp, matching albums.updated_at
 *
 * Migrates existing genre data to genre_1 then drops the old genre column.
 */

async function up(pool) {
  logger.info(
    'Running migration 056: Aligning weekly_new_releases with albums table...'
  );

  // Add new columns
  await pool.query(`
    ALTER TABLE weekly_new_releases
    ADD COLUMN IF NOT EXISTS _id TEXT UNIQUE,
    ADD COLUMN IF NOT EXISTS country TEXT,
    ADD COLUMN IF NOT EXISTS genre_1 TEXT,
    ADD COLUMN IF NOT EXISTS genre_2 TEXT,
    ADD COLUMN IF NOT EXISTS tracks JSONB,
    ADD COLUMN IF NOT EXISTS cover_image BYTEA,
    ADD COLUMN IF NOT EXISTS cover_image_format TEXT,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()
  `);

  // Migrate existing genre data to genre_1
  await pool.query(`
    UPDATE weekly_new_releases
    SET genre_1 = genre
    WHERE genre IS NOT NULL AND genre != '' AND genre_1 IS NULL
  `);

  // Drop old genre column
  await pool.query(`
    ALTER TABLE weekly_new_releases
    DROP COLUMN IF EXISTS genre
  `);

  // Also update personal_recommendation_items to use genre_1/genre_2 instead of genre
  await pool.query(`
    ALTER TABLE personal_recommendation_items
    ADD COLUMN IF NOT EXISTS genre_1 TEXT,
    ADD COLUMN IF NOT EXISTS genre_2 TEXT,
    ADD COLUMN IF NOT EXISTS country TEXT
  `);

  // Migrate existing genre data in recommendation items
  await pool.query(`
    UPDATE personal_recommendation_items
    SET genre_1 = genre
    WHERE genre IS NOT NULL AND genre != '' AND genre_1 IS NULL
  `);

  // Drop old genre column from recommendation items
  await pool.query(`
    ALTER TABLE personal_recommendation_items
    DROP COLUMN IF EXISTS genre
  `);

  logger.info(
    'Migration 056 completed: weekly_new_releases aligned with albums table'
  );
}

async function down(pool) {
  logger.info('Rolling back migration 056...');

  // Re-add genre column to recommendation items
  await pool.query(`
    ALTER TABLE personal_recommendation_items
    ADD COLUMN IF NOT EXISTS genre TEXT
  `);

  // Migrate genre_1 back to genre in recommendation items
  await pool.query(`
    UPDATE personal_recommendation_items
    SET genre = genre_1
    WHERE genre_1 IS NOT NULL AND genre_1 != ''
  `);

  // Drop new columns from recommendation items
  await pool.query(`
    ALTER TABLE personal_recommendation_items
    DROP COLUMN IF EXISTS genre_1,
    DROP COLUMN IF EXISTS genre_2,
    DROP COLUMN IF EXISTS country
  `);

  // Re-add genre column to weekly_new_releases
  await pool.query(`
    ALTER TABLE weekly_new_releases
    ADD COLUMN IF NOT EXISTS genre TEXT
  `);

  // Migrate genre_1 back to genre
  await pool.query(`
    UPDATE weekly_new_releases
    SET genre = genre_1
    WHERE genre_1 IS NOT NULL AND genre_1 != ''
  `);

  // Drop new columns
  await pool.query(`
    ALTER TABLE weekly_new_releases
    DROP COLUMN IF EXISTS _id,
    DROP COLUMN IF EXISTS country,
    DROP COLUMN IF EXISTS genre_1,
    DROP COLUMN IF EXISTS genre_2,
    DROP COLUMN IF EXISTS tracks,
    DROP COLUMN IF EXISTS cover_image,
    DROP COLUMN IF EXISTS cover_image_format,
    DROP COLUMN IF EXISTS updated_at
  `);

  logger.info('Rollback 056 complete');
}

module.exports = { up, down };
