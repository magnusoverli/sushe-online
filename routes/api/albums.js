/**
 * Albums API Routes
 *
 * Handles album-related endpoints:
 * - Cover images
 * - Summaries
 * - Similar album detection
 * - Metadata merging
 */

const { findPotentialDuplicates } = require('../../utils/fuzzy-match');
const { withTransaction } = require('../../db/transaction');
const { buildPartialUpdate } = require('./_helpers');

/**
 * Register album routes
 * @param {Object} app - Express app instance
 * @param {Object} deps - Dependencies
 */
module.exports = (app, deps) => {
  const {
    ensureAuthAPI,
    pool,
    logger,
    helpers: { upsertAlbumRecord, invalidateCachesForAlbumUsers },
  } = deps;

  // Get album cover image
  app.get('/api/albums/:album_id/cover', ensureAuthAPI, async (req, res) => {
    try {
      const { album_id } = req.params;

      // Query albums table for cover image (also get artist/album for async fetch)
      const result = await pool.query(
        'SELECT cover_image, cover_image_format, artist, album FROM albums WHERE album_id = $1',
        [album_id]
      );

      if (!result.rows.length) {
        return res.status(404).json({ error: 'Album not found' });
      }

      const album = result.rows[0];

      // If cover is missing, trigger async fetch (don't wait - return 404 for now)
      if (!album.cover_image && album.artist && album.album) {
        const { getCoverFetchQueue } = require('../../utils/cover-fetch-queue');
        try {
          const coverQueue = getCoverFetchQueue();
          coverQueue.add(album_id, album.artist, album.album);
          logger.debug('Triggered lazy cover fetch', {
            albumId: album_id,
            artist: album.artist,
            album: album.album,
          });
        } catch (error) {
          logger.warn('Cover fetch queue not available for lazy fetch', {
            albumId: album_id,
            error: error.message,
          });
        }
        return res
          .status(404)
          .json({ error: 'Image not found (fetching in background)' });
      }

      if (!album.cover_image) {
        return res.status(404).json({ error: 'Image not found' });
      }

      // Handle both BYTEA (Buffer) and legacy TEXT (base64 string) formats
      // This ensures compatibility with database backups from before migration 024
      const imageBuffer = Buffer.isBuffer(album.cover_image)
        ? album.cover_image
        : Buffer.from(album.cover_image, 'base64');

      // Determine content type
      const contentType = album.cover_image_format
        ? `image/${album.cover_image_format.toLowerCase()}`
        : 'image/jpeg';

      // Set aggressive caching headers (images rarely change)
      res.set({
        'Content-Type': contentType,
        'Content-Length': imageBuffer.length,
        'Cache-Control': 'public, max-age=31536000, immutable', // 1 year
        ETag: `"${album_id}-${imageBuffer.length}"`,
      });

      res.send(imageBuffer);
    } catch (err) {
      logger.error('Error fetching album cover:', {
        error: err.message,
        albumId: req.params.album_id,
      });
      res.status(500).json({ error: 'Error fetching image' });
    }
  });

  // Get single album summary (for incremental updates)
  app.get('/api/albums/:albumId/summary', ensureAuthAPI, async (req, res) => {
    try {
      const { albumId } = req.params;
      const result = await pool.query(
        `SELECT summary, summary_source 
         FROM albums 
         WHERE album_id = $1`,
        [albumId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Album not found' });
      }

      res.json({
        summary: result.rows[0].summary || '',
        summarySource: result.rows[0].summary_source || '',
      });
    } catch (err) {
      logger.error('Error fetching album summary', {
        error: err.message,
        albumId: req.params.albumId,
      });
      res.status(500).json({ error: 'Error fetching summary' });
    }
  });

  // Update album summary (for import)
  app.put('/api/albums/:albumId/summary', ensureAuthAPI, async (req, res) => {
    try {
      const { albumId } = req.params;
      const { summary, summary_source } = req.body;

      // Check if album exists
      const checkResult = await pool.query(
        `SELECT album_id FROM albums WHERE album_id = $1`,
        [albumId]
      );

      if (checkResult.rows.length === 0) {
        return res.status(404).json({ error: 'Album not found' });
      }

      // Update summary if provided
      await pool.query(
        `UPDATE albums 
         SET summary = COALESCE($1, summary),
             summary_source = COALESCE($2, summary_source),
             updated_at = NOW()
         WHERE album_id = $3`,
        [summary || null, summary_source || null, albumId]
      );

      res.json({ success: true });
    } catch (err) {
      logger.error('Error updating album summary', {
        error: err.message,
        albumId: req.params.albumId,
      });
      res.status(500).json({ error: 'Error updating summary' });
    }
  });

  // Update canonical album country (lightweight endpoint for inline editing)
  app.patch('/api/albums/:albumId/country', ensureAuthAPI, async (req, res) => {
    try {
      const { albumId } = req.params;
      const { country } = req.body;

      // Validate country (string, empty string, or null)
      if (
        country !== null &&
        country !== undefined &&
        typeof country !== 'string'
      ) {
        return res.status(400).json({ error: 'Invalid country value' });
      }

      // Check if album exists
      const checkResult = await pool.query(
        'SELECT album_id FROM albums WHERE album_id = $1',
        [albumId]
      );

      if (checkResult.rows.length === 0) {
        return res.status(404).json({ error: 'Album not found' });
      }

      const trimmedCountry = country ? country.trim() : null;

      await pool.query(
        'UPDATE albums SET country = $1, updated_at = $2 WHERE album_id = $3',
        [trimmedCountry, new Date(), albumId]
      );

      // Invalidate caches for ALL users who have this album
      await invalidateCachesForAlbumUsers(albumId);

      logger.info('Album country updated', {
        userId: req.user._id,
        albumId,
        country: trimmedCountry,
      });

      res.json({ success: true });
    } catch (err) {
      logger.error('Error updating album country', {
        error: err.message,
        albumId: req.params.albumId,
      });
      res.status(500).json({ error: 'Error updating country' });
    }
  });

  // Update canonical album genres (lightweight endpoint for inline editing)
  app.patch('/api/albums/:albumId/genres', ensureAuthAPI, async (req, res) => {
    try {
      const { albumId } = req.params;
      const { genre_1, genre_2 } = req.body;

      // Validate genres (must be strings, empty string, or null)
      if (
        (genre_1 !== undefined &&
          genre_1 !== null &&
          typeof genre_1 !== 'string') ||
        (genre_2 !== undefined &&
          genre_2 !== null &&
          typeof genre_2 !== 'string')
      ) {
        return res.status(400).json({ error: 'Invalid genre values' });
      }

      // Check if album exists
      const checkResult = await pool.query(
        'SELECT album_id FROM albums WHERE album_id = $1',
        [albumId]
      );

      if (checkResult.rows.length === 0) {
        return res.status(404).json({ error: 'Album not found' });
      }

      // Build dynamic update query
      const fields = [];
      if (genre_1 !== undefined) {
        fields.push({
          column: 'genre_1',
          value: genre_1 ? genre_1.trim() : null,
        });
      }
      if (genre_2 !== undefined) {
        fields.push({
          column: 'genre_2',
          value: genre_2 ? genre_2.trim() : null,
        });
      }

      const update = buildPartialUpdate('albums', 'album_id', albumId, fields);
      await pool.query(update.query, update.values);

      // Invalidate caches for ALL users who have this album
      await invalidateCachesForAlbumUsers(albumId);

      logger.info('Album genres updated', {
        userId: req.user._id,
        albumId,
        genre_1,
        genre_2,
      });

      res.json({ success: true });
    } catch (err) {
      logger.error('Error updating album genres', {
        error: err.message,
        albumId: req.params.albumId,
      });
      res.status(500).json({ error: 'Error updating genres' });
    }
  });

  // Batch update album metadata (country, genres) - reduces API calls for rapid edits
  app.patch('/api/albums/batch-update', ensureAuthAPI, async (req, res) => {
    try {
      const { updates } = req.body;

      if (!updates || !Array.isArray(updates) || updates.length === 0) {
        return res.status(400).json({ error: 'Updates array is required' });
      }

      // Limit batch size to prevent abuse
      if (updates.length > 50) {
        return res.status(400).json({ error: 'Maximum 50 updates per batch' });
      }

      const timestamp = new Date();
      let successCount = 0;
      const albumIds = new Set();

      await withTransaction(pool, async (client) => {
        for (const update of updates) {
          const { albumId, country, genre_1, genre_2 } = update;

          if (!albumId) continue;

          // Build dynamic update query
          const fields = [];
          if (country !== undefined) {
            fields.push({
              column: 'country',
              value: country ? country.trim() : null,
            });
          }
          if (genre_1 !== undefined) {
            fields.push({
              column: 'genre_1',
              value: genre_1 ? genre_1.trim() : null,
            });
          }
          if (genre_2 !== undefined) {
            fields.push({
              column: 'genre_2',
              value: genre_2 ? genre_2.trim() : null,
            });
          }

          const partialUpdate = buildPartialUpdate(
            'albums',
            'album_id',
            albumId,
            fields,
            { timestamp }
          );
          if (!partialUpdate) continue;

          const result = await client.query(
            partialUpdate.query,
            partialUpdate.values
          );

          if (result.rowCount > 0) {
            successCount++;
            albumIds.add(albumId);
          }
        }
      });

      // Invalidate caches for all affected albums
      for (const albumId of albumIds) {
        await invalidateCachesForAlbumUsers(albumId);
      }

      logger.info('Batch album update completed', {
        userId: req.user._id,
        requestedCount: updates.length,
        successCount,
      });

      res.json({ success: true, updated: successCount });
    } catch (err) {
      logger.error('Error batch updating albums', {
        error: err.message,
        userId: req.user._id,
      });
      res.status(500).json({ error: 'Error batch updating albums' });
    }
  });

  // Check for similar albums before adding (fuzzy duplicate detection)
  app.post('/api/albums/check-similar', ensureAuthAPI, async (req, res) => {
    try {
      const { artist, album, album_id } = req.body;

      if (!artist || !album) {
        return res.status(400).json({ error: 'artist and album are required' });
      }

      // Get all albums from the database
      const albumsResult = await pool.query(`
        SELECT album_id, artist, album, cover_image IS NOT NULL as has_cover
        FROM albums
        WHERE artist IS NOT NULL AND artist != ''
          AND album IS NOT NULL AND album != ''
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

      // Find potential duplicates
      const candidates = albumsResult.rows.map((row) => ({
        album_id: row.album_id,
        artist: row.artist,
        album: row.album,
        hasCover: row.has_cover,
      }));

      const newAlbum = { artist, album, album_id };
      const matches = findPotentialDuplicates(newAlbum, candidates, {
        // Thresholds:
        // - >= 98% confidence: auto-merge (shouldAutoMerge: true)
        // - 10-97% confidence: show modal for user decision
        // - < 10% confidence: treat as distinct (not included in results)
        threshold: 0.1,
        autoMergeThreshold: 0.98,
        maxResults: 3,
        excludePairs,
      });

      // Check if the best match should be auto-merged (>= 98% confidence)
      const bestMatch = matches[0];
      const shouldAutoMerge = bestMatch?.shouldAutoMerge || false;

      res.json({
        hasSimilar: matches.length > 0,
        shouldAutoMerge,
        matches: matches.map((m) => ({
          album_id: m.candidate.album_id,
          artist: m.candidate.artist,
          album: m.candidate.album,
          hasCover: m.candidate.hasCover,
          confidence: Math.round(m.confidence * 100),
          shouldAutoMerge: m.shouldAutoMerge,
        })),
      });
    } catch (err) {
      logger.error('Error checking similar albums:', {
        error: err.message,
        artist: req.body.artist,
        album: req.body.album,
      });
      res.status(500).json({ error: 'Error checking for similar albums' });
    }
  });

  // Mark two albums as distinct (not the same album)
  app.post('/api/albums/mark-distinct', ensureAuthAPI, async (req, res) => {
    try {
      const { album_id_1, album_id_2 } = req.body;

      if (!album_id_1 || !album_id_2) {
        return res
          .status(400)
          .json({ error: 'album_id_1 and album_id_2 are required' });
      }

      if (album_id_1 === album_id_2) {
        return res
          .status(400)
          .json({ error: 'Cannot mark album as distinct from itself' });
      }

      // Store in consistent order (id_1 < id_2)
      const [id1, id2] =
        album_id_1 < album_id_2
          ? [album_id_1, album_id_2]
          : [album_id_2, album_id_1];

      // Insert the pair (ignore if already exists)
      await pool.query(
        `INSERT INTO album_distinct_pairs (album_id_1, album_id_2, created_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (album_id_1, album_id_2) DO NOTHING`,
        [id1, id2, req.user?.id || null]
      );

      logger.info('Albums marked as distinct', {
        album_id_1: id1,
        album_id_2: id2,
        userId: req.user?.id,
      });

      res.json({ success: true });
    } catch (err) {
      logger.error('Error marking albums as distinct:', {
        error: err.message,
        album_id_1: req.body.album_id_1,
        album_id_2: req.body.album_id_2,
      });
      res.status(500).json({ error: 'Error marking albums as distinct' });
    }
  });

  // Merge metadata into an existing canonical album (e.g., better cover, more complete data)
  app.post('/api/albums/merge-metadata', ensureAuthAPI, async (req, res) => {
    try {
      const {
        album_id,
        artist,
        album,
        cover_image,
        cover_image_format,
        tracks,
      } = req.body;

      if (!album_id) {
        return res.status(400).json({ error: 'album_id is required' });
      }

      // Use upsertAlbumRecord to merge the new metadata with existing
      const timestamp = new Date();
      const canonicalId = await upsertAlbumRecord(
        {
          album_id,
          artist,
          album,
          cover_image,
          cover_image_format,
          tracks,
        },
        timestamp
      );

      logger.info('Album metadata merged', {
        album_id: canonicalId,
        userId: req.user?.id,
      });

      res.json({ success: true, album_id: canonicalId });
    } catch (err) {
      logger.error('Error merging album metadata:', {
        error: err.message,
        album_id: req.body.album_id,
      });
      res.status(500).json({ error: 'Error merging album metadata' });
    }
  });
};
