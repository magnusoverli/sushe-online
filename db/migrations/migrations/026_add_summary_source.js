const logger = require('../../../utils/logger');

/**
 * Migration to add summary source tracking
 *
 * Adds columns to track where album summaries come from:
 * - summary_source: 'lastfm', 'wikipedia', etc.
 * - wikipedia_url: URL to the album page on Wikipedia (if source is wikipedia)
 */

async function up(pool) {
  logger.info('Adding summary source columns...');

  // Add summary_source column to track where the summary came from
  await pool.query(`
    ALTER TABLE albums 
    ADD COLUMN IF NOT EXISTS summary_source TEXT
  `);
  logger.info('Added summary_source column');

  // Add wikipedia_url column
  await pool.query(`
    ALTER TABLE albums 
    ADD COLUMN IF NOT EXISTS wikipedia_url TEXT
  `);
  logger.info('Added wikipedia_url column');

  // Update existing records that have a lastfm_url to set source as 'lastfm'
  const result = await pool.query(`
    UPDATE albums 
    SET summary_source = 'lastfm' 
    WHERE summary IS NOT NULL AND lastfm_url IS NOT NULL AND summary_source IS NULL
  `);
  logger.info(`Updated ${result.rowCount} existing records with lastfm source`);

  logger.info('Migration completed: summary source columns added');
}

async function down(pool) {
  logger.info('Removing summary source columns...');

  await pool.query('ALTER TABLE albums DROP COLUMN IF EXISTS summary_source');
  await pool.query('ALTER TABLE albums DROP COLUMN IF EXISTS wikipedia_url');

  logger.info('Reverted: summary source columns removed');
}

module.exports = { up, down };
