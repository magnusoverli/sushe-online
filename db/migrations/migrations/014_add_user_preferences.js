const logger = require('../../../utils/logger');

// Create user_preferences table for aggregated user taste data
async function up(pool) {
  logger.info('Creating user_preferences table...');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(_id) ON DELETE CASCADE,
      
      -- Aggregated from user's lists
      top_genres JSONB DEFAULT '[]',
      top_artists JSONB DEFAULT '[]',
      top_countries JSONB DEFAULT '[]',
      total_albums INTEGER DEFAULT 0,
      
      -- From Spotify API
      spotify_top_artists JSONB DEFAULT '[]',
      spotify_top_tracks JSONB DEFAULT '[]',
      spotify_saved_albums JSONB DEFAULT '[]',
      spotify_synced_at TIMESTAMPTZ,
      
      -- From Last.fm API
      lastfm_top_artists JSONB DEFAULT '[]',
      lastfm_top_albums JSONB DEFAULT '[]',
      lastfm_total_scrobbles INTEGER DEFAULT 0,
      lastfm_synced_at TIMESTAMPTZ,
      
      -- Computed affinity scores (weighted combination of all sources)
      genre_affinity JSONB DEFAULT '[]',
      artist_affinity JSONB DEFAULT '[]',
      
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id)
    )
  `);

  // Index for fast lookups by user
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id
    ON user_preferences(user_id)
  `);

  // Index for finding stale Spotify data that needs refresh
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_preferences_spotify_stale
    ON user_preferences(user_id, spotify_synced_at)
    WHERE spotify_synced_at IS NOT NULL
  `);

  // Index for finding stale Last.fm data that needs refresh
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_preferences_lastfm_stale
    ON user_preferences(user_id, lastfm_synced_at)
    WHERE lastfm_synced_at IS NOT NULL
  `);

  // GIN indexes for JSONB querying (if we need to search within preferences)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_preferences_genre_affinity
    ON user_preferences USING GIN (genre_affinity)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_preferences_artist_affinity
    ON user_preferences USING GIN (artist_affinity)
  `);

  logger.info('user_preferences table created successfully');
}

async function down(pool) {
  logger.info('Dropping user_preferences table...');

  await pool.query('DROP INDEX IF EXISTS idx_user_preferences_artist_affinity');
  await pool.query('DROP INDEX IF EXISTS idx_user_preferences_genre_affinity');
  await pool.query('DROP INDEX IF EXISTS idx_user_preferences_lastfm_stale');
  await pool.query('DROP INDEX IF EXISTS idx_user_preferences_spotify_stale');
  await pool.query('DROP INDEX IF EXISTS idx_user_preferences_user_id');
  await pool.query('DROP TABLE IF EXISTS user_preferences');

  logger.info('user_preferences table dropped');
}

module.exports = { up, down };
