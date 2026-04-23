const logger = require('../../../utils/logger');

// Fix: Re-apply Last.fm columns if they're missing
// This handles cases where migration 010 was recorded but columns weren't created
async function up(pool) {
  logger.info('Ensuring Last.fm auth columns exist...');

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

  logger.info('Last.fm auth columns verified/added successfully');
}

async function down(_pool) {
  // No-op: don't remove columns on rollback since they may have user data
  logger.info('Rollback is no-op for this fix migration');
}

// Irreversible: this migration fixes pre-existing user data. Rolling back
// would remove columns that may have user data, so the runner refuses to
// auto-rollback. Restore from backup if a true rollback is needed.
module.exports = { up, down, irreversible: true };
