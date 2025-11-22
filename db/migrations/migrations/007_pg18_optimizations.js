const logger = require('../../../utils/logger');

// PostgreSQL 18 specific optimizations
async function up(pool) {
  logger.info('Adding PostgreSQL 18 optimizations...');

  // 1. GIN index for JSONB tracks column (faster array operations)
  // Useful for searching tracks by name or accessing array elements
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_list_items_tracks_gin 
    ON list_items USING GIN (tracks jsonb_path_ops)
    WHERE tracks IS NOT NULL
  `);

  // 2. GIN index for user authentication JSONB (Spotify/Tidal)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_users_spotify_auth_gin 
    ON users USING GIN (spotify_auth jsonb_path_ops)
    WHERE spotify_auth IS NOT NULL
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_users_tidal_auth_gin 
    ON users USING GIN (tidal_auth jsonb_path_ops)
    WHERE tidal_auth IS NOT NULL
  `);

  // 3. Partial index for role lookups (admin users)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_users_role 
    ON users(role)
    WHERE role IS NOT NULL
  `);

  // 4. Covering index for playlist preferences (if column exists)
  const playlistPrefExists = await pool.query(`
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='users' AND column_name='playlist_preferences'
  `);
  
  if (playlistPrefExists.rowCount > 0) {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_playlist_preferences 
      ON users USING GIN (playlist_preferences jsonb_path_ops)
    `);
  }

  logger.info('PostgreSQL 18 optimizations applied successfully');
}

async function down(pool) {
  logger.info('Removing PostgreSQL 18 optimizations...');

  await pool.query('DROP INDEX IF EXISTS idx_list_items_tracks_gin');
  await pool.query('DROP INDEX IF EXISTS idx_users_spotify_auth_gin');
  await pool.query('DROP INDEX IF EXISTS idx_users_tidal_auth_gin');
  await pool.query('DROP INDEX IF EXISTS idx_users_role');
  await pool.query('DROP INDEX IF EXISTS idx_users_playlist_preferences');

  logger.info('PostgreSQL 18 optimizations removed');
}

module.exports = { up, down };

