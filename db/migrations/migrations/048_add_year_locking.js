const logger = require('../../../utils/logger');

/**
 * Migration: Add year locking support to master_lists table
 *
 * Adds a locked boolean field to prevent list modifications for specific years.
 * When locked = TRUE, users cannot create/edit lists for that year.
 * Admin operations (contributor management, aggregate recompute) remain available.
 */

async function up(pool) {
  logger.info('Adding locked field to master_lists table...');

  // Add locked column (defaults to FALSE for existing rows)
  await pool.query(`
    ALTER TABLE master_lists 
    ADD COLUMN IF NOT EXISTS locked BOOLEAN DEFAULT FALSE
  `);

  // Add partial index for efficient lookup of locked years
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_master_lists_locked 
    ON master_lists(locked) 
    WHERE locked = TRUE
  `);

  logger.info('Year locking support added successfully');
}

async function down(pool) {
  logger.info('Removing year locking support...');

  // Drop index
  await pool.query('DROP INDEX IF EXISTS idx_master_lists_locked');

  // Remove locked column
  await pool.query('ALTER TABLE master_lists DROP COLUMN IF EXISTS locked');

  logger.info('Year locking support removed');
}

module.exports = { up, down };
