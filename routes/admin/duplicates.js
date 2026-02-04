/**
 * Admin Duplicate Scanning Routes
 *
 * Handles duplicate album detection and merging:
 * - /admin/api/scan-duplicates - Scan for potential duplicates
 * - /admin/api/merge-albums - Merge two albums
 */

const logger = require('../../utils/logger');
const { findPotentialDuplicates } = require('../../utils/fuzzy-match');

module.exports = (app, deps) => {
  const { ensureAuth, ensureAdmin, pool } = deps;

  // Admin: Scan for potential duplicate albums in the database
  app.get(
    '/admin/api/scan-duplicates',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      // Parse threshold from query param, default to 0.15 (high sensitivity)
      const threshold = Math.max(
        0.03,
        Math.min(0.5, parseFloat(req.query.threshold) || 0.15)
      );

      try {
        logger.info('Starting duplicate album scan', {
          adminId: req.user?._id,
          threshold,
        });

        // Get all albums from database with extended fields for diff comparison
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
        const excludedPairsResult = await pool.query(`
          SELECT album_id_1, album_id_2 FROM album_distinct_pairs
        `);

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
          const candidates = albums.slice(i + 1); // Only check forward to avoid duplicate pairs

          const matches = findPotentialDuplicates(album, candidates, {
            threshold, // Configurable threshold - human reviews all matches
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

        res.json({
          totalAlbums: albums.length,
          potentialDuplicates: duplicatePairs.length,
          excludedPairs: excludePairs.size / 2,
          pairs: duplicatePairs.slice(0, 100), // Limit to top 100 for performance
        });
      } catch (error) {
        logger.error('Error scanning for duplicates', {
          error: error.message,
        });
        res.status(500).json({ error: error.message });
      }
    }
  );

  // Admin: Merge two albums (keep one, update references, delete other)
  // Smart merges metadata from deleted album into kept album before deleting
  app.post(
    '/admin/api/merge-albums',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const { keepAlbumId, deleteAlbumId } = req.body;

        if (!keepAlbumId || !deleteAlbumId) {
          return res
            .status(400)
            .json({ error: 'keepAlbumId and deleteAlbumId are required' });
        }

        if (keepAlbumId === deleteAlbumId) {
          return res
            .status(400)
            .json({ error: 'Cannot merge album with itself' });
        }

        logger.info('Merging albums', {
          keepAlbumId,
          deleteAlbumId,
          adminId: req.user?._id,
        });

        // Fetch both albums to merge metadata
        const albumsResult = await pool.query(
          `SELECT album_id, artist, album, release_date, country, 
                  genre_1, genre_2, tracks, cover_image, cover_image_format,
                  summary, summary_source, summary_fetched_at
           FROM albums WHERE album_id = $1 OR album_id = $2`,
          [keepAlbumId, deleteAlbumId]
        );

        const keepAlbum = albumsResult.rows.find(
          (a) => a.album_id === keepAlbumId
        );
        const deleteAlbum = albumsResult.rows.find(
          (a) => a.album_id === deleteAlbumId
        );

        if (!keepAlbum) {
          return res.status(404).json({ error: 'Keep album not found' });
        }

        // Smart merge: fill in missing fields from the album being deleted
        const fieldsToMerge = [];
        const values = [keepAlbumId];
        let paramIndex = 2;

        // Helper to check if we should use the value from deleteAlbum
        const shouldMerge = (keepVal, deleteVal) => {
          if (!deleteAlbum) return false;
          // Use deleteVal if keepVal is empty/null and deleteVal has content
          const keepEmpty =
            keepVal === null || keepVal === undefined || keepVal === '';
          const deleteHasValue =
            deleteVal !== null && deleteVal !== undefined && deleteVal !== '';
          return keepEmpty && deleteHasValue;
        };

        // Text fields
        if (shouldMerge(keepAlbum.release_date, deleteAlbum?.release_date)) {
          fieldsToMerge.push(`release_date = $${paramIndex++}`);
          values.push(deleteAlbum.release_date);
        }
        if (shouldMerge(keepAlbum.country, deleteAlbum?.country)) {
          fieldsToMerge.push(`country = $${paramIndex++}`);
          values.push(deleteAlbum.country);
        }
        if (shouldMerge(keepAlbum.genre_1, deleteAlbum?.genre_1)) {
          fieldsToMerge.push(`genre_1 = $${paramIndex++}`);
          values.push(deleteAlbum.genre_1);
        }
        if (shouldMerge(keepAlbum.genre_2, deleteAlbum?.genre_2)) {
          fieldsToMerge.push(`genre_2 = $${paramIndex++}`);
          values.push(deleteAlbum.genre_2);
        }

        // Tracks (if keep has none and delete has some)
        if (
          deleteAlbum?.tracks &&
          Array.isArray(deleteAlbum.tracks) &&
          deleteAlbum.tracks.length > 0
        ) {
          const keepTracks = keepAlbum.tracks;
          const keepHasTracks =
            keepTracks && Array.isArray(keepTracks) && keepTracks.length > 0;
          if (!keepHasTracks) {
            fieldsToMerge.push(`tracks = $${paramIndex++}`);
            values.push(JSON.stringify(deleteAlbum.tracks));
          }
        }

        // Cover image: prefer larger (higher quality)
        if (deleteAlbum?.cover_image && !keepAlbum.cover_image) {
          fieldsToMerge.push(`cover_image = $${paramIndex++}`);
          values.push(deleteAlbum.cover_image);
          fieldsToMerge.push(`cover_image_format = $${paramIndex++}`);
          values.push(deleteAlbum.cover_image_format || 'jpeg');
        } else if (deleteAlbum?.cover_image && keepAlbum.cover_image) {
          // Both have covers - use larger one
          const deleteSize = deleteAlbum.cover_image.length;
          const keepSize = keepAlbum.cover_image.length;
          if (deleteSize > keepSize) {
            fieldsToMerge.push(`cover_image = $${paramIndex++}`);
            values.push(deleteAlbum.cover_image);
            fieldsToMerge.push(`cover_image_format = $${paramIndex++}`);
            values.push(deleteAlbum.cover_image_format || 'jpeg');
          }
        }

        // Summary: prefer existing, but fill if missing
        if (shouldMerge(keepAlbum.summary, deleteAlbum?.summary)) {
          fieldsToMerge.push(`summary = $${paramIndex++}`);
          values.push(deleteAlbum.summary);
          fieldsToMerge.push(`summary_source = $${paramIndex++}`);
          values.push(deleteAlbum.summary_source);
          fieldsToMerge.push(`summary_fetched_at = $${paramIndex++}`);
          values.push(deleteAlbum.summary_fetched_at);
        }

        // Update the kept album if we have fields to merge
        let metadataMerged = false;
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

        // Also clean up any distinct pairs involving the deleted album
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

        res.json({
          success: true,
          listItemsUpdated: updateResult.rowCount,
          albumsDeleted: deleteResult.rowCount,
          metadataMerged,
        });
      } catch (error) {
        logger.error('Error merging albums', {
          error: error.message,
          keepAlbumId: req.body?.keepAlbumId,
          deleteAlbumId: req.body?.deleteAlbumId,
        });
        res.status(500).json({ error: error.message });
      }
    }
  );
};
