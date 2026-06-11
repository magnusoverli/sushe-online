const logger = require('../../../utils/logger');

async function up(pool) {
  logger.info('Adding album cover thumbnail columns...');

  await pool.query(`
    ALTER TABLE albums
    ADD COLUMN IF NOT EXISTS cover_thumbnail BYTEA,
    ADD COLUMN IF NOT EXISTS cover_thumbnail_format TEXT,
    ADD COLUMN IF NOT EXISTS cover_thumbnail_updated_at TIMESTAMPTZ
  `);
}

async function down(pool) {
  logger.info('Removing album cover thumbnail columns...');

  await pool.query(`
    ALTER TABLE albums
    DROP COLUMN IF EXISTS cover_thumbnail,
    DROP COLUMN IF EXISTS cover_thumbnail_format,
    DROP COLUMN IF EXISTS cover_thumbnail_updated_at
  `);
}

module.exports = { up, down };
