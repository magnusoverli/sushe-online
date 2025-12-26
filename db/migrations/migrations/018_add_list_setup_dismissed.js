const logger = require('../../../utils/logger');

// Add list_setup_dismissed_until column to users table for wizard dismiss functionality
async function up(pool) {
  logger.info('Adding list_setup_dismissed_until column to users table...');

  await pool.query(`
    ALTER TABLE users 
    ADD COLUMN IF NOT EXISTS list_setup_dismissed_until TIMESTAMPTZ
  `);

  logger.info('list_setup_dismissed_until column added to users table');
}

async function down(pool) {
  logger.info('Removing list_setup_dismissed_until column from users table...');

  await pool.query(
    'ALTER TABLE users DROP COLUMN IF EXISTS list_setup_dismissed_until'
  );

  logger.info('list_setup_dismissed_until column removed from users table');
}

module.exports = { up, down };
