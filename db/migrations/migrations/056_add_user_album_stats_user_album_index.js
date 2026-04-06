const logger = require('../../../utils/logger');

/**
 * Add composite index for user_album_stats lookups by user and album.
 *
 * Optimizes joins that validate per-user playcount coverage for list albums.
 */
async function up(pool) {
  logger.info('Adding idx_user_album_stats_user_album_id index...');

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_album_stats_user_album_id
    ON user_album_stats(user_id, album_id)
    WHERE album_id IS NOT NULL
  `);

  logger.info('idx_user_album_stats_user_album_id index added');
}

async function down(pool) {
  logger.info('Removing idx_user_album_stats_user_album_id index...');
  await pool.query('DROP INDEX IF EXISTS idx_user_album_stats_user_album_id');
  logger.info('idx_user_album_stats_user_album_id index removed');
}

module.exports = { up, down };
