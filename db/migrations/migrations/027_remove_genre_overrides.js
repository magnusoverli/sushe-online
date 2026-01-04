const logger = require('../../../utils/logger');

/**
 * Migration to remove genre overrides from list_items
 *
 * Genres should be canonical (stored in albums table only), not customizable per-list.
 * The albums table is the source of truth for genres.
 *
 * This migration:
 * 1. Finds all genre overrides (non-NULL genre_1/genre_2 in list_items that differ from albums)
 * 2. Only updates albums table if it's NULL/empty (preserves existing albums table values)
 * 3. Resolves conflicts by using the most recent override (by updated_at) when albums table is empty
 * 4. NULL-ifies all list_items genre fields so they use albums table going forward
 */

async function up(pool) {
  logger.info('Removing genre overrides from list_items...');

  // Step 1: Find genre overrides where albums table is empty (albums table is source of truth)
  logger.info('Finding genre overrides where albums table needs values...');

  // For genre_1: Only update albums table if it's NULL/empty (preserve existing values)
  // Get the most recent override per album_id where albums table is empty
  const genre1Overrides = await pool.query(`
    SELECT DISTINCT ON (li.album_id)
      li.album_id,
      li.genre_1,
      li.updated_at
    FROM list_items li
    INNER JOIN albums a ON li.album_id = a.album_id
    WHERE li.album_id IS NOT NULL 
      AND li.album_id != ''
      AND li.genre_1 IS NOT NULL 
      AND li.genre_1 != ''
      AND (a.genre_1 IS NULL OR a.genre_1 = '')
    ORDER BY li.album_id, li.updated_at DESC
  `);

  logger.info(
    `Found ${genre1Overrides.rows.length} albums needing genre_1 values`
  );

  // For genre_2: Only update albums table if it's NULL/empty (preserve existing values)
  const genre2Overrides = await pool.query(`
    SELECT DISTINCT ON (li.album_id)
      li.album_id,
      li.genre_2,
      li.updated_at
    FROM list_items li
    INNER JOIN albums a ON li.album_id = a.album_id
    WHERE li.album_id IS NOT NULL 
      AND li.album_id != ''
      AND li.genre_2 IS NOT NULL 
      AND li.genre_2 != ''
      AND (a.genre_2 IS NULL OR a.genre_2 = '')
    ORDER BY li.album_id, li.updated_at DESC
  `);

  logger.info(
    `Found ${genre2Overrides.rows.length} albums needing genre_2 values`
  );

  // Step 2: Update albums table only where values are missing (preserve existing)
  logger.info('Updating albums table with genre values (only where empty)...');

  let genre1Updated = 0;
  let genre2Updated = 0;

  // Update genre_1 only if albums table is NULL/empty
  for (const row of genre1Overrides.rows) {
    const result = await pool.query(
      `UPDATE albums 
       SET genre_1 = $1, updated_at = NOW() 
       WHERE album_id = $2 
         AND (genre_1 IS NULL OR genre_1 = '')`,
      [row.genre_1, row.album_id]
    );
    if (result.rowCount > 0) {
      genre1Updated++;
    }
  }

  // Update genre_2 only if albums table is NULL/empty
  for (const row of genre2Overrides.rows) {
    const result = await pool.query(
      `UPDATE albums 
       SET genre_2 = $1, updated_at = NOW() 
       WHERE album_id = $2 
         AND (genre_2 IS NULL OR genre_2 = '')`,
      [row.genre_2, row.album_id]
    );
    if (result.rowCount > 0) {
      genre2Updated++;
    }
  }

  logger.info(
    `Updated ${genre1Updated} albums with genre_1 values (only where empty)`
  );
  logger.info(
    `Updated ${genre2Updated} albums with genre_2 values (only where empty)`
  );

  // Count how many overrides existed but were ignored (albums table already had values)
  const ignoredOverrides = await pool.query(`
    SELECT COUNT(DISTINCT li.album_id) as count
    FROM list_items li
    INNER JOIN albums a ON li.album_id = a.album_id
    WHERE li.album_id IS NOT NULL 
      AND li.album_id != ''
      AND (
        (li.genre_1 IS NOT NULL AND li.genre_1 != '' AND a.genre_1 IS NOT NULL AND a.genre_1 != '' AND li.genre_1 != a.genre_1)
        OR
        (li.genre_2 IS NOT NULL AND li.genre_2 != '' AND a.genre_2 IS NOT NULL AND a.genre_2 != '' AND li.genre_2 != a.genre_2)
      )
  `);

  if (ignoredOverrides.rows[0].count > 0) {
    logger.info(
      `Preserved ${ignoredOverrides.rows[0].count} albums table genre values (ignored conflicting list_items overrides)`
    );
  }

  // Step 3: NULL-ify all genre fields in list_items
  logger.info('Removing genre overrides from list_items...');

  const nullifyResult = await pool.query(`
    UPDATE list_items 
    SET genre_1 = NULL, genre_2 = NULL, updated_at = NOW()
    WHERE (genre_1 IS NOT NULL OR genre_2 IS NOT NULL)
      AND album_id IS NOT NULL 
      AND album_id != ''
  `);

  logger.info(
    `Removed genre overrides from ${nullifyResult.rowCount} list items`
  );

  logger.info('Migration completed: genre overrides removed');
}

async function down(_pool) {
  logger.info('Reverting genre override removal...');
  logger.warn(
    'Cannot fully revert: genre overrides were merged into albums table. ' +
      'This migration only logs a warning.'
  );
  logger.info('Revert complete (no changes made - data already merged)');
}

module.exports = { up, down };
