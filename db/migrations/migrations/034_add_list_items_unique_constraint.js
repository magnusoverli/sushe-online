const logger = require('../../../utils/logger');

/**
 * Migration to add unique constraint on list_items table
 *
 * This prevents the same album from appearing twice in a single list.
 * The constraint is on (list_id, album_id) where album_id is not null/empty.
 *
 * This is a safety net - the UI already prevents duplicates, but this
 * ensures database-level integrity.
 */

async function up(pool) {
  logger.info('Adding unique constraint on list_items(list_id, album_id)...');

  // First, check for any existing duplicates
  const duplicateCheck = await pool.query(`
    SELECT 
      list_id, 
      album_id, 
      COUNT(*) as count,
      array_agg(position ORDER BY position) as positions
    FROM list_items
    WHERE album_id IS NOT NULL AND album_id != ''
    GROUP BY list_id, album_id
    HAVING COUNT(*) > 1
  `);

  if (duplicateCheck.rows.length > 0) {
    logger.warn(
      `Found ${duplicateCheck.rows.length} duplicate entries. Cleaning up before adding constraint...`
    );

    // For each duplicate group, keep the one with the lowest position (first added)
    for (const row of duplicateCheck.rows) {
      const positions = row.positions;
      const keepPosition = Math.min(...positions);

      // Delete all but the one with the lowest position
      const deleteResult = await pool.query(
        `DELETE FROM list_items 
         WHERE list_id = $1 AND album_id = $2 AND position != $3`,
        [row.list_id, row.album_id, keepPosition]
      );

      logger.debug(
        `Cleaned up ${deleteResult.rowCount} duplicate(s) for album ${row.album_id} in list ${row.list_id}`
      );
    }

    logger.info('Duplicate cleanup complete');
  } else {
    logger.info('No duplicates found');
  }

  // Create the unique index
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_list_items_unique_album_per_list
    ON list_items(list_id, album_id)
    WHERE album_id IS NOT NULL AND album_id != ''
  `);

  logger.info('Unique constraint added successfully');

  // Verify the index was created
  const indexCheck = await pool.query(`
    SELECT indexname FROM pg_indexes 
    WHERE tablename = 'list_items' AND indexname = 'idx_list_items_unique_album_per_list'
  `);

  if (indexCheck.rows.length === 0) {
    throw new Error('Failed to create unique index');
  }

  logger.info('Verified: idx_list_items_unique_album_per_list index exists');
}

async function down(pool) {
  logger.info('Removing unique constraint from list_items table...');

  await pool.query('DROP INDEX IF EXISTS idx_list_items_unique_album_per_list');

  logger.info('Unique constraint removed');
}

module.exports = { up, down };
