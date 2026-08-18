const logger = require('../../../utils/logger');

async function up(pool) {
  logger.info('Adding album metadata event version sequence...');
  await pool.query(`
    CREATE SEQUENCE IF NOT EXISTS album_metadata_event_version_seq
  `);
  logger.info('Album metadata event version sequence added');
}

async function down(pool) {
  await pool.query(`
    DROP SEQUENCE IF EXISTS album_metadata_event_version_seq
  `);
}

module.exports = { up, down };
