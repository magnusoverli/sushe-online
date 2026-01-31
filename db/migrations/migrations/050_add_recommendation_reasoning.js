const logger = require('../../../utils/logger');

/**
 * Migration: Add reasoning column to recommendations
 *
 * Adds a reasoning field (max 500 chars) that stores why a user
 * recommended an album. Required for new recommendations.
 */

async function up(pool) {
  logger.info('Adding reasoning column to recommendations table...');

  // Add reasoning column (nullable initially for existing rows)
  await pool.query(`
    ALTER TABLE recommendations
    ADD COLUMN IF NOT EXISTS reasoning TEXT
    CHECK (char_length(reasoning) <= 500)
  `);

  // Update existing rows with default value
  await pool.query(`
    UPDATE recommendations
    SET reasoning = 'No reason provided'
    WHERE reasoning IS NULL
  `);

  // Now make it NOT NULL for future entries
  await pool.query(`
    ALTER TABLE recommendations
    ALTER COLUMN reasoning SET NOT NULL
  `);

  logger.info('reasoning column added to recommendations table successfully');
}

async function down(pool) {
  logger.info('Removing reasoning column from recommendations table...');

  await pool.query(`
    ALTER TABLE recommendations
    DROP COLUMN IF EXISTS reasoning
  `);

  logger.info('reasoning column removed from recommendations table');
}

module.exports = { up, down };
