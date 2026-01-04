const logger = require('../../../utils/logger');

/**
 * Migration to support Claude API as album summary source
 *
 * This migration doesn't change the schema (summary_source column already exists),
 * but it documents the transition from Last.fm/Wikipedia to Claude API.
 * Existing summaries with 'lastfm' or 'wikipedia' sources will remain until regenerated.
 */

async function up(pool) {
  logger.info('Migration 028: Claude summary source support');

  // No schema changes needed - summary_source column already exists
  // Claude will use 'claude' as the source value
  // Existing 'lastfm' and 'wikipedia' values will remain for backward compatibility

  logger.info('Migration completed: Claude summary source support added');
}

async function down(pool) {
  logger.info('Reverting migration 028: Claude summary source support');

  // No schema changes to revert
  // Optionally, we could update Claude summaries back to NULL if needed
  // But we'll leave them as-is for data preservation

  logger.info('Reverted: Claude summary source support');
}

module.exports = { up, down };
