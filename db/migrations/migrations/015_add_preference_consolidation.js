const logger = require('../../../utils/logger');

// Add columns for preference data consolidation:
// - country_affinity: consolidated country preferences (from internal lists)
// - lastfm_artist_tags: cached artist genre tags from Last.fm for genre consolidation
async function up(pool) {
  logger.info('Adding preference consolidation columns...');

  // Add country_affinity column
  await pool.query(`
    ALTER TABLE user_preferences 
    ADD COLUMN IF NOT EXISTS country_affinity JSONB DEFAULT '[]'
  `);

  // Add lastfm_artist_tags column to cache artist->genre mappings
  await pool.query(`
    ALTER TABLE user_preferences 
    ADD COLUMN IF NOT EXISTS lastfm_artist_tags JSONB DEFAULT '{}'
  `);

  // Add GIN index for country_affinity queries
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_preferences_country_affinity
    ON user_preferences USING GIN (country_affinity)
  `);

  logger.info('Preference consolidation columns added successfully');
}

async function down(pool) {
  logger.info('Removing preference consolidation columns...');

  await pool.query(
    'DROP INDEX IF EXISTS idx_user_preferences_country_affinity'
  );
  await pool.query(
    'ALTER TABLE user_preferences DROP COLUMN IF EXISTS lastfm_artist_tags'
  );
  await pool.query(
    'ALTER TABLE user_preferences DROP COLUMN IF EXISTS country_affinity'
  );

  logger.info('Preference consolidation columns removed');
}

module.exports = { up, down };
