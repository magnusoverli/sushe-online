const logger = require('../../../utils/logger');
const crypto = require('crypto');

/**
 * Migration to create track_picks table
 *
 * This creates a new normalized table for storing user track picks per album.
 * Track picks are now user+album scoped (not list-item scoped), meaning:
 * - A user's track picks for an album persist across all lists
 * - Moving an album between lists preserves the track picks
 * - Each user has their own independent track picks
 *
 * Supports primary (priority=1) and secondary (priority=2) track picks.
 */

async function up(pool) {
  logger.info('Creating track_picks table...');

  // Create the track_picks table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS track_picks (
      id SERIAL PRIMARY KEY,
      _id TEXT UNIQUE NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(_id) ON DELETE CASCADE,
      album_id TEXT NOT NULL,
      track_identifier TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  logger.info('track_picks table created');

  // Create index for fast lookups by user_id + album_id
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_track_picks_user_album 
    ON track_picks(user_id, album_id)
  `);

  // Ensure unique track per user+album (no duplicate track picks)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_track_picks_unique_track
    ON track_picks(user_id, album_id, track_identifier)
  `);

  // Ensure unique priority per user+album (only one primary, one secondary)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_track_picks_unique_priority
    ON track_picks(user_id, album_id, priority)
  `);

  logger.info('track_picks indexes created');

  // Migrate existing track_pick data from list_items
  // We need to join with lists to get the user_id
  logger.info('Migrating existing track_pick data...');

  const existingPicks = await pool.query(`
    SELECT DISTINCT ON (l.user_id, li.album_id)
      l.user_id,
      li.album_id,
      li.track_pick
    FROM list_items li
    JOIN lists l ON li.list_id = l._id
    WHERE li.track_pick IS NOT NULL 
      AND li.track_pick != ''
      AND li.album_id IS NOT NULL 
      AND li.album_id != ''
    ORDER BY l.user_id, li.album_id, li.updated_at DESC NULLS LAST
  `);

  logger.info(
    `Found ${existingPicks.rows.length} existing track picks to migrate`
  );

  let migrated = 0;
  let skipped = 0;

  for (const row of existingPicks.rows) {
    try {
      const _id = crypto.randomBytes(12).toString('hex');
      await pool.query(
        `INSERT INTO track_picks (_id, user_id, album_id, track_identifier, priority, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 1, NOW(), NOW())
         ON CONFLICT (user_id, album_id, priority) DO NOTHING`,
        [_id, row.user_id, row.album_id, row.track_pick]
      );
      migrated++;
    } catch (err) {
      logger.warn(`Failed to migrate track pick for album ${row.album_id}`, {
        error: err.message,
      });
      skipped++;
    }
  }

  logger.info(`Migration complete: ${migrated} migrated, ${skipped} skipped`);

  // Verify the table was created
  const tableCheck = await pool.query(`
    SELECT tablename FROM pg_tables 
    WHERE tablename = 'track_picks'
  `);

  if (tableCheck.rows.length === 0) {
    throw new Error('Failed to create track_picks table');
  }

  logger.info('Verified: track_picks table exists');

  // Note: We do NOT drop the track_pick column from list_items yet
  // This allows for rollback and gives time to verify the migration worked
  // A future migration can remove the column once the new system is stable
}

async function down(pool) {
  logger.info('Rolling back track_picks table...');

  // Note: This does NOT restore data to list_items.track_pick
  // The original data should still be there since we didn't drop the column

  await pool.query('DROP INDEX IF EXISTS idx_track_picks_unique_priority');
  await pool.query('DROP INDEX IF EXISTS idx_track_picks_unique_track');
  await pool.query('DROP INDEX IF EXISTS idx_track_picks_user_album');
  await pool.query('DROP TABLE IF EXISTS track_picks');

  logger.info('track_picks table dropped');
}

module.exports = { up, down };
