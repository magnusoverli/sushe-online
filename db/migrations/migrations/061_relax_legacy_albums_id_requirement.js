const logger = require('../../../utils/logger');

async function columnExists(pool, tableName, columnName) {
  const result = await pool.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_name = $1 AND column_name = $2`,
    [tableName, columnName]
  );
  return result.rows.length > 0;
}

async function up(pool) {
  logger.info('Relaxing albums._id requirement when present...');

  const hasLegacyId = await columnExists(pool, 'albums', '_id');
  if (!hasLegacyId) {
    logger.info('albums._id does not exist; nothing to relax');
    return;
  }

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
  logger.info('Restoring albums._id requirement when present...');

  const hasLegacyId = await columnExists(pool, 'albums', '_id');
  if (!hasLegacyId) {
    logger.info('albums._id does not exist; skipping restore');
    return;
  }

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
