const logger = require('../../../utils/logger');

/**
 * Migration: Add Telegram recommendations support
 *
 * Creates table for storing recommendation thread IDs per year
 * and adds recommendations_enabled column to telegram_config.
 */

async function up(pool) {
  logger.info('Adding Telegram recommendations support...');

  // Add recommendations_enabled column to telegram_config
  await pool.query(`
    ALTER TABLE telegram_config
    ADD COLUMN IF NOT EXISTS recommendations_enabled BOOLEAN DEFAULT FALSE
  `);

  // Create table to store thread IDs for each year's recommendations
  await pool.query(`
    CREATE TABLE IF NOT EXISTS telegram_recommendation_threads (
      year INTEGER PRIMARY KEY CHECK (year >= 1000 AND year <= 9999),
      thread_id BIGINT NOT NULL,
      topic_name TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  logger.info('Telegram recommendations support added successfully');
}

async function down(pool) {
  logger.info('Removing Telegram recommendations support...');

  await pool.query('DROP TABLE IF EXISTS telegram_recommendation_threads');
  await pool.query(`
    ALTER TABLE telegram_config
    DROP COLUMN IF EXISTS recommendations_enabled
  `);

  logger.info('Telegram recommendations support removed');
}

module.exports = { up, down };
