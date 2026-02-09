/**
 * Duplicate Service
 *
 * Business logic for duplicate album detection and merging:
 * - Scan all albums for fuzzy-match duplicates
 * - Smart-merge metadata from one album into another
 * - Reassign list_items and clean up distinct pairs
 *
 * Follows dependency injection pattern for testability.
 */

const defaultLogger = require('../utils/logger');
const { TransactionAbort } = require('../db/transaction');
const { findPotentialDuplicates } = require('../utils/fuzzy-match');

/**
 * Create duplicate service with injected dependencies
 * @param {Object} deps
 * @param {Object} deps.pool - PostgreSQL pool
 * @param {Object} deps.logger - Logger instance
 */
// eslint-disable-next-line max-lines-per-function -- Cohesive service module with related duplicate operations
function createDuplicateService(deps = {}) {
  const pool = deps.pool;
  const logger = deps.logger || defaultLogger;

  /**
   * Scan all albums for potential fuzzy-match duplicates.
   * @param {number} threshold - Similarity threshold (0.03–0.5, default 0.15)
   * @returns {Promise<Object>} { totalAlbums, potentialDuplicates, excludedPairs, pairs }
   */
  async function scanDuplicates(threshold) {
    const clampedThreshold = Math.max(
      0.03,
      Math.min(0.5, parseFloat(threshold) || 0.15)
    );

    // Get all albums with extended fields for diff comparison
    // Exclude albums without album_id (data integrity issue)
    const albumsResult = await pool.query(`
      SELECT 
        album_id, 
        artist, 
        album, 
        release_date,
        genre_1,
        genre_2,
        COALESCE(jsonb_array_length(tracks), 0) as track_count,
        cover_image IS NOT NULL as has_cover
      FROM albums
      WHERE artist IS NOT NULL AND artist != ''
        AND album IS NOT NULL AND album != ''
        AND album_id IS NOT NULL
      ORDER BY artist, album
    `);

    // Get excluded pairs from album_distinct_pairs table
    const excludedPairsResult = await pool.query(
      `SELECT album_id_1, album_id_2 FROM album_distinct_pairs`
    );

    const excludePairs = new Set();
    for (const row of excludedPairsResult.rows) {
      excludePairs.add(`${row.album_id_1}::${row.album_id_2}`);
      excludePairs.add(`${row.album_id_2}::${row.album_id_1}`);
    }

    const albums = albumsResult.rows.map((row) => ({
      album_id: row.album_id,
      artist: row.artist,
      album: row.album,
      release_date: row.release_date || null,
      genre_1: row.genre_1 || null,
      genre_2: row.genre_2 || null,
      trackCount: row.track_count > 0 ? row.track_count : null,
      hasCover: row.has_cover,
    }));

    // Find all potential duplicate pairs
    const duplicatePairs = [];
    const processedPairs = new Set();

    for (let i = 0; i < albums.length; i++) {
      const album = albums[i];
      const candidates = albums.slice(i + 1);

      const matches = findPotentialDuplicates(album, candidates, {
        threshold: clampedThreshold,
        maxResults: 10,
        excludePairs,
      });

      for (const match of matches) {
        const pairKey = [album.album_id, match.candidate.album_id]
          .sort()
          .join('::');
        if (!processedPairs.has(pairKey)) {
          processedPairs.add(pairKey);
          duplicatePairs.push({
            album1: album,
            album2: match.candidate,
            confidence: Math.round(match.confidence * 100),
            artistScore: Math.round(match.artistScore.score * 100),
            albumScore: Math.round(match.albumScore.score * 100),
          });
        }
      }
    }

    // Sort by confidence (highest first)
    duplicatePairs.sort((a, b) => b.confidence - a.confidence);

    logger.info('Duplicate scan completed', {
      totalAlbums: albums.length,
      potentialDuplicates: duplicatePairs.length,
      excludedPairs: excludePairs.size / 2,
    });

    return {
      totalAlbums: albums.length,
      potentialDuplicates: duplicatePairs.length,
      excludedPairs: excludePairs.size / 2,
      pairs: duplicatePairs.slice(0, 100), // Limit to top 100 for performance
    };
  }

  /**
   * Build SET clause fields for smart metadata merge.
   * Fills missing fields in keepAlbum with values from deleteAlbum.
   * @param {Object} keepAlbum - Album being kept
   * @param {Object} deleteAlbum - Album being deleted (source of fill data)
   * @returns {{ fieldsToMerge: string[], values: any[] }}
   */
  function buildMergeFields(keepAlbum, deleteAlbum) {
    const fieldsToMerge = [];
    // values[0] will be keepAlbumId ($1), so next param is always values.length + 1
    const values = [keepAlbum.album_id];
    const nextParam = () => `$${values.length + 1}`;

    // Helper: use deleteVal when keepVal is empty/null
    const shouldMerge = (keepVal, deleteVal) => {
      const keepEmpty =
        keepVal === null || keepVal === undefined || keepVal === '';
      const deleteHasValue =
        deleteVal !== null && deleteVal !== undefined && deleteVal !== '';
      return keepEmpty && deleteHasValue;
    };

    // Text fields
    if (shouldMerge(keepAlbum.release_date, deleteAlbum.release_date)) {
      fieldsToMerge.push(`release_date = ${nextParam()}`);
      values.push(deleteAlbum.release_date);
    }
    if (shouldMerge(keepAlbum.country, deleteAlbum.country)) {
      fieldsToMerge.push(`country = ${nextParam()}`);
      values.push(deleteAlbum.country);
    }
    if (shouldMerge(keepAlbum.genre_1, deleteAlbum.genre_1)) {
      fieldsToMerge.push(`genre_1 = ${nextParam()}`);
      values.push(deleteAlbum.genre_1);
    }
    if (shouldMerge(keepAlbum.genre_2, deleteAlbum.genre_2)) {
      fieldsToMerge.push(`genre_2 = ${nextParam()}`);
      values.push(deleteAlbum.genre_2);
    }

    // Tracks (if keep has none and delete has some)
    if (
      deleteAlbum.tracks &&
      Array.isArray(deleteAlbum.tracks) &&
      deleteAlbum.tracks.length > 0
    ) {
      const keepTracks = keepAlbum.tracks;
      const keepHasTracks =
        keepTracks && Array.isArray(keepTracks) && keepTracks.length > 0;
      if (!keepHasTracks) {
        fieldsToMerge.push(`tracks = ${nextParam()}`);
        values.push(JSON.stringify(deleteAlbum.tracks));
      }
    }

    // Cover image: prefer larger (higher quality)
    if (deleteAlbum.cover_image && !keepAlbum.cover_image) {
      fieldsToMerge.push(`cover_image = ${nextParam()}`);
      values.push(deleteAlbum.cover_image);
      fieldsToMerge.push(`cover_image_format = ${nextParam()}`);
      values.push(deleteAlbum.cover_image_format || 'jpeg');
    } else if (deleteAlbum.cover_image && keepAlbum.cover_image) {
      // Both have covers — use larger one
      const deleteSize = deleteAlbum.cover_image.length;
      const keepSize = keepAlbum.cover_image.length;
      if (deleteSize > keepSize) {
        fieldsToMerge.push(`cover_image = ${nextParam()}`);
        values.push(deleteAlbum.cover_image);
        fieldsToMerge.push(`cover_image_format = ${nextParam()}`);
        values.push(deleteAlbum.cover_image_format || 'jpeg');
      }
    }

    // Summary: fill if missing
    if (shouldMerge(keepAlbum.summary, deleteAlbum.summary)) {
      fieldsToMerge.push(`summary = ${nextParam()}`);
      values.push(deleteAlbum.summary);
      fieldsToMerge.push(`summary_source = ${nextParam()}`);
      values.push(deleteAlbum.summary_source);
      fieldsToMerge.push(`summary_fetched_at = ${nextParam()}`);
      values.push(deleteAlbum.summary_fetched_at);
    }

    return { fieldsToMerge, values };
  }

  /**
   * Merge two albums: keep one, transfer list_items, smart-merge metadata, delete the other.
   * @param {string} keepAlbumId - Album ID to keep
   * @param {string} deleteAlbumId - Album ID to delete
   * @returns {Promise<Object>} { listItemsUpdated, albumsDeleted, metadataMerged }
   * @throws {TransactionAbort} on validation failure
   */
  async function mergeAlbums(keepAlbumId, deleteAlbumId) {
    if (!keepAlbumId || !deleteAlbumId) {
      throw new TransactionAbort(400, {
        error: 'keepAlbumId and deleteAlbumId are required',
      });
    }

    if (keepAlbumId === deleteAlbumId) {
      throw new TransactionAbort(400, {
        error: 'Cannot merge album with itself',
      });
    }

    // Fetch both albums to merge metadata
    const albumsResult = await pool.query(
      `SELECT album_id, artist, album, release_date, country, 
              genre_1, genre_2, tracks, cover_image, cover_image_format,
              summary, summary_source, summary_fetched_at
       FROM albums WHERE album_id = $1 OR album_id = $2`,
      [keepAlbumId, deleteAlbumId]
    );

    const keepAlbum = albumsResult.rows.find((a) => a.album_id === keepAlbumId);
    const deleteAlbum = albumsResult.rows.find(
      (a) => a.album_id === deleteAlbumId
    );

    if (!keepAlbum) {
      throw new TransactionAbort(404, { error: 'Keep album not found' });
    }

    // Smart merge metadata from deleted album into kept album
    let metadataMerged = false;
    if (deleteAlbum) {
      const { fieldsToMerge, values } = buildMergeFields(
        keepAlbum,
        deleteAlbum
      );

      if (fieldsToMerge.length > 0) {
        fieldsToMerge.push(`updated_at = NOW()`);
        await pool.query(
          `UPDATE albums SET ${fieldsToMerge.join(', ')} WHERE album_id = $1`,
          values
        );
        metadataMerged = true;
        logger.info('Merged metadata into kept album', {
          keepAlbumId,
          fieldsMerged: fieldsToMerge.length - 1, // -1 for updated_at
        });
      }
    }

    // Update all list_items to point to the kept album
    const updateResult = await pool.query(
      `UPDATE list_items SET album_id = $1 WHERE album_id = $2`,
      [keepAlbumId, deleteAlbumId]
    );

    // Delete the duplicate album
    const deleteResult = await pool.query(
      `DELETE FROM albums WHERE album_id = $1`,
      [deleteAlbumId]
    );

    // Clean up any distinct pairs involving the deleted album
    await pool.query(
      `DELETE FROM album_distinct_pairs WHERE album_id_1 = $1 OR album_id_2 = $1`,
      [deleteAlbumId]
    );

    logger.info('Albums merged successfully', {
      keepAlbumId,
      deleteAlbumId,
      listItemsUpdated: updateResult.rowCount,
      albumsDeleted: deleteResult.rowCount,
      metadataMerged,
    });

    return {
      listItemsUpdated: updateResult.rowCount,
      albumsDeleted: deleteResult.rowCount,
      metadataMerged,
    };
  }

  return { scanDuplicates, mergeAlbums };
}

module.exports = { createDuplicateService };
