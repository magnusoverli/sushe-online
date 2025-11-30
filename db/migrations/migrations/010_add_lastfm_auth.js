const logger = require('../../../utils/logger');

// Add Last.fm authentication columns to users table
async function up(pool) {
  logger.info('Adding Last.fm auth columns to users table...');

  // Add lastfm_auth JSONB column for storing session data
  await pool.query(`
    ALTER TABLE users 
    ADD COLUMN IF NOT EXISTS lastfm_auth JSONB
  `);

  // Add lastfm_username for quick lookups without parsing JSONB
  await pool.query(`
    ALTER TABLE users 
    ADD COLUMN IF NOT EXISTS lastfm_username TEXT
  `);

  // Index for looking up users by Last.fm username
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_users_lastfm_username
    ON users(lastfm_username)
    WHERE lastfm_username IS NOT NULL
  `);

  logger.info('Last.fm auth columns added to users table successfully');
}

async function down(pool) {
  logger.info('Removing Last.fm auth columns from users table...');

  // Drop index first
  await pool.query('DROP INDEX IF EXISTS idx_users_lastfm_username');

  // Drop columns
  await pool.query('ALTER TABLE users DROP COLUMN IF EXISTS lastfm_auth');
  await pool.query('ALTER TABLE users DROP COLUMN IF EXISTS lastfm_username');

  logger.info('Last.fm auth columns removed from users table');
}

module.exports = { up, down };
