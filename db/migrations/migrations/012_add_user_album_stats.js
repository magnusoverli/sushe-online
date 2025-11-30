const logger = require('../../../utils/logger');

// Create user_album_stats table for storing Last.fm playcounts per user
async function up(pool) {
  logger.info('Creating user_album_stats table...');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_album_stats (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(_id) ON DELETE CASCADE,
      album_id TEXT,
      artist TEXT NOT NULL,
      album_name TEXT NOT NULL,
      lastfm_playcount INTEGER DEFAULT 0,
      lastfm_updated_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, artist, album_name)
    )
  `);

  // Index for fast lookups by user
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_album_stats_user_id
    ON user_album_stats(user_id)
  `);

  // Index for lookups by album_id (MusicBrainz ID)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_album_stats_album_id
    ON user_album_stats(album_id)
    WHERE album_id IS NOT NULL
  `);

  // Composite index for the unique constraint lookups
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_album_stats_user_artist_album
    ON user_album_stats(user_id, LOWER(artist), LOWER(album_name))
  `);

  // Index for finding stale data that needs refresh
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_album_stats_stale
    ON user_album_stats(user_id, lastfm_updated_at)
    WHERE lastfm_updated_at IS NOT NULL
  `);

  logger.info('user_album_stats table created successfully');
}

async function down(pool) {
  logger.info('Dropping user_album_stats table...');

  await pool.query('DROP INDEX IF EXISTS idx_user_album_stats_stale');
  await pool.query(
    'DROP INDEX IF EXISTS idx_user_album_stats_user_artist_album'
  );
  await pool.query('DROP INDEX IF EXISTS idx_user_album_stats_album_id');
  await pool.query('DROP INDEX IF EXISTS idx_user_album_stats_user_id');
  await pool.query('DROP TABLE IF EXISTS user_album_stats');

  logger.info('user_album_stats table dropped');
}

module.exports = { up, down };
