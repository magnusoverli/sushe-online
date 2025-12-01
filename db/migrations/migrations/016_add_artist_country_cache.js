const logger = require('../../../utils/logger');

// Add column for caching artist country data from MusicBrainz
// This enables country-based preference consolidation across all sources
async function up(pool) {
  logger.info('Adding artist country cache column...');

  // Add artist_countries column to cache MusicBrainz country lookups
  // Format: { "Artist Name": { country: "Norway", countryCode: "NO", mbid: "..." }, ... }
  await pool.query(`
    ALTER TABLE user_preferences 
    ADD COLUMN IF NOT EXISTS artist_countries JSONB DEFAULT '{}'
  `);

  logger.info('Artist country cache column added successfully');
}

async function down(pool) {
  logger.info('Removing artist country cache column...');

  await pool.query(
    'ALTER TABLE user_preferences DROP COLUMN IF EXISTS artist_countries'
  );

  logger.info('Artist country cache column removed');
}

module.exports = { up, down };
