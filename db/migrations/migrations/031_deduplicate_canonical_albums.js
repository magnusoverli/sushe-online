const logger = require('../../../utils/logger');

/**
 * Migration to deduplicate canonical albums table
 *
 * Problem: The same album (same artist + album name) can exist multiple times
 * in the albums table with different album_id values (from Spotify, MusicBrainz,
 * manual entry, etc.). This causes the aggregate list to show duplicates.
 *
 * Solution: Merge duplicate albums by normalized artist/album name:
 * 1. Group albums by LOWER(TRIM(artist)) + LOWER(TRIM(album))
 * 2. For each duplicate group, choose a "winner" (canonical entry)
 * 3. Update list_items to point to the winner
 * 4. Delete the duplicate album records
 *
 * Winner selection priority:
 * - Prefer non-NULL album_id over NULL
 * - Prefer external ID (Spotify/MusicBrainz) over internal ID
 * - Prefer most complete metadata (cover_image, genres, tracks)
 * - Prefer earliest created_at (oldest entry)
 */

async function up(pool) {
  logger.info('Starting album deduplication migration...');

  // Step 1: Find all duplicate groups
  const duplicateGroups = await pool.query(`
    SELECT 
      LOWER(TRIM(COALESCE(artist, ''))) as normalized_artist,
      LOWER(TRIM(COALESCE(album, ''))) as normalized_album,
      array_agg(album_id ORDER BY 
        CASE WHEN album_id IS NOT NULL AND album_id NOT LIKE 'internal-%' THEN 0 
             WHEN album_id IS NOT NULL THEN 1 
             ELSE 2 END,
        CASE WHEN cover_image IS NOT NULL THEN 0 ELSE 1 END,
        CASE WHEN genre_1 IS NOT NULL AND genre_1 != '' THEN 0 ELSE 1 END,
        CASE WHEN tracks IS NOT NULL THEN 0 ELSE 1 END,
        created_at ASC
      ) as album_ids,
      COUNT(*) as count
    FROM albums
    WHERE artist IS NOT NULL AND artist != ''
      AND album IS NOT NULL AND album != ''
    GROUP BY normalized_artist, normalized_album
    HAVING COUNT(*) > 1
    ORDER BY count DESC
  `);

  logger.info(
    `Found ${duplicateGroups.rows.length} duplicate album groups to merge`
  );

  if (duplicateGroups.rows.length === 0) {
    logger.info('No duplicates found, migration complete');
    return;
  }

  // Step 2: Process each duplicate group
  let totalMerged = 0;
  let totalDeleted = 0;
  let listItemsUpdated = 0;

  for (const group of duplicateGroups.rows) {
    const albumIds = group.album_ids;
    const winnerId = albumIds[0]; // First one is the winner based on ORDER BY
    const loserIds = albumIds.slice(1);

    logger.debug(
      `Merging "${group.normalized_artist} - ${group.normalized_album}": ` +
        `winner=${winnerId}, losers=${loserIds.join(', ')}`
    );

    // Skip if winner is NULL (shouldn't happen with our query, but be safe)
    if (!winnerId) {
      logger.warn(
        `Skipping group with no valid winner: ${group.normalized_artist} - ${group.normalized_album}`
      );
      continue;
    }

    // Step 2a: Merge metadata from losers into winner (smart merge)
    // Only fill in missing fields, don't overwrite existing
    for (const loserId of loserIds) {
      if (!loserId) continue;

      await pool.query(
        `
        UPDATE albums SET
          release_date = COALESCE(NULLIF(release_date, ''), (SELECT release_date FROM albums WHERE album_id = $2)),
          country = COALESCE(NULLIF(country, ''), (SELECT country FROM albums WHERE album_id = $2)),
          genre_1 = COALESCE(NULLIF(genre_1, ''), (SELECT genre_1 FROM albums WHERE album_id = $2)),
          genre_2 = COALESCE(NULLIF(genre_2, ''), (SELECT genre_2 FROM albums WHERE album_id = $2)),
          tracks = COALESCE(tracks, (SELECT tracks FROM albums WHERE album_id = $2)),
          cover_image = CASE 
            WHEN cover_image IS NULL THEN (SELECT cover_image FROM albums WHERE album_id = $2)
            WHEN (SELECT cover_image FROM albums WHERE album_id = $2) IS NOT NULL 
              AND octet_length((SELECT cover_image FROM albums WHERE album_id = $2)) > octet_length(cover_image)
            THEN (SELECT cover_image FROM albums WHERE album_id = $2)
            ELSE cover_image
          END,
          cover_image_format = CASE 
            WHEN cover_image IS NULL THEN (SELECT cover_image_format FROM albums WHERE album_id = $2)
            WHEN (SELECT cover_image FROM albums WHERE album_id = $2) IS NOT NULL 
              AND octet_length((SELECT cover_image FROM albums WHERE album_id = $2)) > octet_length(cover_image)
            THEN (SELECT cover_image_format FROM albums WHERE album_id = $2)
            ELSE cover_image_format
          END,
          summary = COALESCE(summary, (SELECT summary FROM albums WHERE album_id = $2)),
          summary_fetched_at = COALESCE(summary_fetched_at, (SELECT summary_fetched_at FROM albums WHERE album_id = $2)),
          summary_source = COALESCE(summary_source, (SELECT summary_source FROM albums WHERE album_id = $2)),
          updated_at = NOW()
        WHERE album_id = $1
      `,
        [winnerId, loserId]
      );
    }

    // Step 2b: Update list_items to point to winner
    // Handle both NULL and non-NULL loser IDs
    const loserIdsNonNull = loserIds.filter((id) => id !== null);

    if (loserIdsNonNull.length > 0) {
      const placeholders = loserIdsNonNull
        .map((_, i) => `$${i + 2}`)
        .join(', ');
      const result = await pool.query(
        `UPDATE list_items SET album_id = $1, updated_at = NOW() WHERE album_id IN (${placeholders})`,
        [winnerId, ...loserIdsNonNull]
      );
      listItemsUpdated += result.rowCount;
    }

    // Handle NULL album_id entries by matching on artist/album name
    const nullResult = await pool.query(
      `
      UPDATE list_items SET album_id = $1, updated_at = NOW()
      WHERE album_id IS NULL
        AND LOWER(TRIM(COALESCE(artist, ''))) = $2
        AND LOWER(TRIM(COALESCE(album, ''))) = $3
    `,
      [winnerId, group.normalized_artist, group.normalized_album]
    );
    listItemsUpdated += nullResult.rowCount;

    // Also update list_items with empty string album_id
    const emptyResult = await pool.query(
      `
      UPDATE list_items SET album_id = $1, updated_at = NOW()
      WHERE album_id = ''
        AND LOWER(TRIM(COALESCE(artist, ''))) = $2
        AND LOWER(TRIM(COALESCE(album, ''))) = $3
    `,
      [winnerId, group.normalized_artist, group.normalized_album]
    );
    listItemsUpdated += emptyResult.rowCount;

    // Step 2c: Delete loser albums
    if (loserIdsNonNull.length > 0) {
      const placeholders = loserIdsNonNull
        .map((_, i) => `$${i + 1}`)
        .join(', ');
      const deleteResult = await pool.query(
        `DELETE FROM albums WHERE album_id IN (${placeholders})`,
        loserIdsNonNull
      );
      totalDeleted += deleteResult.rowCount;
    }

    // Delete albums with NULL album_id that match this normalized name (except winner)
    const deleteNullResult = await pool.query(
      `
      DELETE FROM albums 
      WHERE album_id IS NULL
        AND LOWER(TRIM(COALESCE(artist, ''))) = $1
        AND LOWER(TRIM(COALESCE(album, ''))) = $2
    `,
      [group.normalized_artist, group.normalized_album]
    );
    totalDeleted += deleteNullResult.rowCount;

    totalMerged++;
  }

  logger.info(`Migration complete:`);
  logger.info(`  - Merged ${totalMerged} duplicate groups`);
  logger.info(`  - Deleted ${totalDeleted} duplicate album records`);
  logger.info(`  - Updated ${listItemsUpdated} list_item references`);

  // Step 3: Verify no orphaned list_items
  const orphanedItems = await pool.query(`
    SELECT COUNT(*) as count
    FROM list_items li
    LEFT JOIN albums a ON li.album_id = a.album_id
    WHERE li.album_id IS NOT NULL 
      AND li.album_id != ''
      AND a.album_id IS NULL
  `);

  if (parseInt(orphanedItems.rows[0].count) > 0) {
    logger.warn(
      `Found ${orphanedItems.rows[0].count} orphaned list_items after migration`
    );
  } else {
    logger.info('No orphaned list_items found - all references are valid');
  }

  // Step 4: Report final state
  const albumCount = await pool.query('SELECT COUNT(*) as count FROM albums');
  const uniqueCount = await pool.query(`
    SELECT COUNT(DISTINCT LOWER(TRIM(artist)) || '::' || LOWER(TRIM(album))) as count
    FROM albums 
    WHERE artist IS NOT NULL AND album IS NOT NULL
  `);

  logger.info(
    `Final state: ${albumCount.rows[0].count} albums, ${uniqueCount.rows[0].count} unique artist/album combinations`
  );
}

async function down(_pool) {
  logger.info('Reverting album deduplication...');
  logger.warn(
    'Cannot fully revert: duplicate albums were merged and deleted. ' +
      'This migration only logs a warning. Restore from backup if needed.'
  );
  logger.info('Revert complete (no changes made - data already merged)');
}

module.exports = { up, down };
