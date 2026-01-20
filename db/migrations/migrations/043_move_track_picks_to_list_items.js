const logger = require('../../../utils/logger');

/**
 * Migration to move track picks from dedicated table to list_items
 *
 * This changes track picks from being user+album scoped to list_item scoped:
 * - Before: One track pick per user per album (shared across all lists)
 * - After: One track pick per list_item (can differ between lists)
 *
 * Migration strategy: Copy track picks to ALL list_items where the user has
 * that album, preserving all existing selections.
 *
 * New columns added to list_items:
 * - primary_track: The user's primary/favorite track (displayed with ★)
 * - secondary_track: The user's secondary track pick (displayed with ☆)
 */

async function up(pool) {
  logger.info('Moving track picks from track_picks table to list_items...');

  // 1. Add new columns to list_items
  logger.info(
    'Adding primary_track and secondary_track columns to list_items...'
  );
  await pool.query(`
    ALTER TABLE list_items 
    ADD COLUMN IF NOT EXISTS primary_track TEXT,
    ADD COLUMN IF NOT EXISTS secondary_track TEXT
  `);
  logger.info('Columns added');

  // 2. Check if track_picks table exists (might not exist in fresh installs)
  const tableCheck = await pool.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'track_picks'
    ) as exists
  `);

  if (!tableCheck.rows[0].exists) {
    logger.info('track_picks table does not exist, skipping data migration');
    return;
  }

  // 3. Count existing track picks
  const countResult = await pool.query('SELECT COUNT(*) FROM track_picks');
  const trackPickCount = parseInt(countResult.rows[0].count, 10);
  logger.info(`Found ${trackPickCount} track picks to migrate`);

  if (trackPickCount > 0) {
    // 4. Migrate primary tracks (priority = 1)
    // PostgreSQL UPDATE...FROM syntax: the updated table can't be in the FROM clause
    logger.info('Migrating primary track picks...');
    const primaryResult = await pool.query(`
      UPDATE list_items
      SET primary_track = tp.track_identifier
      FROM track_picks tp, lists l
      WHERE list_items.list_id = l._id
        AND tp.user_id = l.user_id
        AND tp.album_id = list_items.album_id
        AND tp.priority = 1
    `);
    logger.info(
      `Updated ${primaryResult.rowCount} list_items with primary tracks`
    );

    // 5. Migrate secondary tracks (priority = 2)
    logger.info('Migrating secondary track picks...');
    const secondaryResult = await pool.query(`
      UPDATE list_items
      SET secondary_track = tp.track_identifier
      FROM track_picks tp, lists l
      WHERE list_items.list_id = l._id
        AND tp.user_id = l.user_id
        AND tp.album_id = list_items.album_id
        AND tp.priority = 2
    `);
    logger.info(
      `Updated ${secondaryResult.rowCount} list_items with secondary tracks`
    );
  }

  // 6. Drop the track_picks table
  logger.info('Dropping track_picks table...');
  await pool.query('DROP TABLE IF EXISTS track_picks');
  logger.info('track_picks table dropped');

  logger.info('Migration completed: track picks moved to list_items');
}

async function down(pool) {
  logger.info('Reverting: Moving track picks back to dedicated table...');

  // 1. Recreate track_picks table
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

  // 2. Create indexes
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_track_picks_user_album 
    ON track_picks(user_id, album_id)
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_track_picks_unique_track 
    ON track_picks(user_id, album_id, track_identifier)
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_track_picks_unique_priority 
    ON track_picks(user_id, album_id, priority)
  `);

  // 3. Migrate data back (take first occurrence per user+album)
  // For primary tracks
  await pool.query(`
    INSERT INTO track_picks (_id, user_id, album_id, track_identifier, priority)
    SELECT DISTINCT ON (l.user_id, li.album_id)
      gen_random_uuid()::text,
      l.user_id,
      li.album_id,
      li.primary_track,
      1
    FROM list_items li
    JOIN lists l ON li.list_id = l._id
    WHERE li.primary_track IS NOT NULL
    ORDER BY l.user_id, li.album_id, li.updated_at DESC
  `);

  // For secondary tracks
  await pool.query(`
    INSERT INTO track_picks (_id, user_id, album_id, track_identifier, priority)
    SELECT DISTINCT ON (l.user_id, li.album_id)
      gen_random_uuid()::text,
      l.user_id,
      li.album_id,
      li.secondary_track,
      2
    FROM list_items li
    JOIN lists l ON li.list_id = l._id
    WHERE li.secondary_track IS NOT NULL
    ORDER BY l.user_id, li.album_id, li.updated_at DESC
    ON CONFLICT (user_id, album_id, priority) DO NOTHING
  `);

  // 4. Drop columns from list_items
  await pool.query(`
    ALTER TABLE list_items 
    DROP COLUMN IF EXISTS primary_track,
    DROP COLUMN IF EXISTS secondary_track
  `);

  logger.info('Reverted: track picks restored to dedicated table');
}

module.exports = { up, down };
