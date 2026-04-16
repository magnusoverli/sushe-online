const logger = require('../../../utils/logger');

/**
 * Enforce album reference integrity.
 *
 * Adds:
 * - list_items.album_id -> albums.album_id (ON DELETE RESTRICT)
 * - album_distinct_pairs.album_id_1 -> albums.album_id (ON DELETE CASCADE)
 * - album_distinct_pairs.album_id_2 -> albums.album_id (ON DELETE CASCADE)
 *
 * Before adding constraints we remove rows that already violate these
 * relationships so the migration can be applied safely in production.
 */
async function up(pool) {
  logger.info('Cleaning orphan album references before adding foreign keys...');

  const blankAlbumIdsResult = await pool.query(`
    UPDATE list_items
    SET album_id = NULL
    WHERE album_id = ''
  `);

  const orphanListItemsDelete = await pool.query(`
    DELETE FROM list_items li
    WHERE li.album_id IS NOT NULL
      AND li.album_id != ''
      AND NOT EXISTS (
        SELECT 1
        FROM albums a
        WHERE a.album_id = li.album_id
      )
  `);

  const orphanDistinctPairsDelete = await pool.query(`
    DELETE FROM album_distinct_pairs adp
    WHERE NOT EXISTS (
            SELECT 1 FROM albums a WHERE a.album_id = adp.album_id_1
          )
       OR NOT EXISTS (
            SELECT 1 FROM albums a WHERE a.album_id = adp.album_id_2
          )
  `);

  logger.info('Orphan cleanup complete', {
    blankAlbumIdsNormalized: blankAlbumIdsResult.rowCount,
    deletedListItems: orphanListItemsDelete.rowCount,
    deletedDistinctPairs: orphanDistinctPairsDelete.rowCount,
  });

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_list_items_album_id'
      ) THEN
        ALTER TABLE list_items
        ADD CONSTRAINT fk_list_items_album_id
        FOREIGN KEY (album_id)
        REFERENCES albums(album_id)
        ON DELETE RESTRICT;
      END IF;
    END $$;
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_album_distinct_pairs_album_1'
      ) THEN
        ALTER TABLE album_distinct_pairs
        ADD CONSTRAINT fk_album_distinct_pairs_album_1
        FOREIGN KEY (album_id_1)
        REFERENCES albums(album_id)
        ON DELETE CASCADE;
      END IF;
    END $$;
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_album_distinct_pairs_album_2'
      ) THEN
        ALTER TABLE album_distinct_pairs
        ADD CONSTRAINT fk_album_distinct_pairs_album_2
        FOREIGN KEY (album_id_2)
        REFERENCES albums(album_id)
        ON DELETE CASCADE;
      END IF;
    END $$;
  `);

  logger.info('Album reference foreign keys added successfully');
}

async function down(pool) {
  logger.info('Dropping album reference foreign keys...');

  await pool.query(`
    ALTER TABLE list_items
    DROP CONSTRAINT IF EXISTS fk_list_items_album_id
  `);

  await pool.query(`
    ALTER TABLE album_distinct_pairs
    DROP CONSTRAINT IF EXISTS fk_album_distinct_pairs_album_1
  `);

  await pool.query(`
    ALTER TABLE album_distinct_pairs
    DROP CONSTRAINT IF EXISTS fk_album_distinct_pairs_album_2
  `);

  logger.info('Album reference foreign keys dropped');
}

module.exports = { up, down };
