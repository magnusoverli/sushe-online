const logger = require('../../../utils/logger');

async function up(pool) {
  logger.info('Removing independent user-list reveal state...');
  await pool.query('DROP TABLE IF EXISTS user_list_year_visibility');
  logger.info('Year reveal state is now sourced only from master lists');
}

async function down(_pool) {
  logger.info('Rollback is a no-op for unified year reveal state');
}

module.exports = { up, down, irreversible: true };
