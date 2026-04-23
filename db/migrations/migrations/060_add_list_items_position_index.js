const logger = require('../../../utils/logger');

async function up(pool) {
  logger.info('Ensuring list_items(list_id, position) index exists...');

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_list_items_position
    ON list_items(list_id, position)
  `);
}

async function down(pool) {
  logger.info('Removing list_items(list_id, position) index...');

  await pool.query(`DROP INDEX IF EXISTS idx_list_items_position`);
}

module.exports = { up, down };
