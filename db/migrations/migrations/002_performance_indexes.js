const logger = require('../../../utils/logger');

async function up(pool) {
  logger.info('Adding performance indexes for low latency queries...');

  // Note: Using regular CREATE INDEX instead of CONCURRENTLY since we're in a transaction
  // Composite indexes for common query patterns
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_users_email_hash 
    ON users(email, hash) 
    WHERE email IS NOT NULL
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_users_username_hash 
    ON users(username, hash) 
    WHERE username IS NOT NULL
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_users_reset_token_expires_active 
    ON users(reset_token, reset_expires) 
    WHERE reset_token IS NOT NULL
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_lists_user_name_active 
    ON lists(user_id, name) 
    WHERE name IS NOT NULL
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_list_items_list_position 
    ON list_items(list_id, position) 
    WHERE position IS NOT NULL
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_list_items_album_batch 
    ON list_items(album_id) 
    WHERE album_id IS NOT NULL
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_albums_lookup 
    ON albums(album_id) 
    WHERE album_id IS NOT NULL
  `);

  // Index for recent activity lookups
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_users_recent_activity 
    ON users(last_activity) 
    WHERE last_activity IS NOT NULL
  `);

  logger.info('Performance indexes created successfully');
}
async function down(pool) {
  logger.info('Removing performance indexes...');

  await pool.query('DROP INDEX IF EXISTS idx_users_email_hash');
  await pool.query('DROP INDEX IF EXISTS idx_users_username_hash');
  await pool.query('DROP INDEX IF EXISTS idx_users_reset_token_expires_active');
  await pool.query('DROP INDEX IF EXISTS idx_lists_user_name_active');
  await pool.query('DROP INDEX IF EXISTS idx_list_items_list_position');
  await pool.query('DROP INDEX IF EXISTS idx_list_items_album_batch');
  await pool.query('DROP INDEX IF EXISTS idx_albums_lookup');
  await pool.query('DROP INDEX IF EXISTS idx_users_recent_activity');

  logger.info('Performance indexes removed successfully');
}

module.exports = { up, down };
