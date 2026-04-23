const logger = require('../../../utils/logger');

async function up(pool) {
  logger.info('Relaxing legacy albums._id requirement...');

  await pool.query(`
    UPDATE albums
    SET _id = COALESCE(_id, album_id)
    WHERE _id IS NULL AND album_id IS NOT NULL
  `);

  await pool.query(`
    ALTER TABLE albums
    ALTER COLUMN _id DROP NOT NULL
  `);
}

async function down(pool) {
  logger.info('Restoring legacy albums._id requirement...');

  await pool.query(`
    UPDATE albums
    SET _id = COALESCE(_id, album_id)
    WHERE _id IS NULL AND album_id IS NOT NULL
  `);

  await pool.query(`
    ALTER TABLE albums
    ALTER COLUMN _id SET NOT NULL
  `);
}

module.exports = { up, down };
