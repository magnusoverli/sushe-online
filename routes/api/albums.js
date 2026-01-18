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
    helpers: { upsertAlbumRecord },
  } = deps;

  // Get album cover image
  app.get('/api/albums/:album_id/cover', ensureAuthAPI, async (req, res) => {
    try {
      const { album_id } = req.params;

      // Query albums table for cover image
      const result = await pool.query(
        'SELECT cover_image, cover_image_format FROM albums WHERE album_id = $1',
        [album_id]
      );

      if (!result.rows.length || !result.rows[0].cover_image) {
        return res.status(404).json({ error: 'Image not found' });
      }

      const { cover_image, cover_image_format } = result.rows[0];

      // Handle both BYTEA (Buffer) and legacy TEXT (base64 string) formats
      // This ensures compatibility with database backups from before migration 024
      const imageBuffer = Buffer.isBuffer(cover_image)
        ? cover_image
        : Buffer.from(cover_image, 'base64');

      // Determine content type
      const contentType = cover_image_format
        ? `image/${cover_image_format.toLowerCase()}`
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
        threshold: 0.2, // Very low threshold - human reviews all matches
        maxResults: 3,
        excludePairs,
      });

      res.json({
        hasSimilar: matches.length > 0,
        matches: matches.map((m) => ({
          album_id: m.candidate.album_id,
          artist: m.candidate.artist,
          album: m.candidate.album,
          hasCover: m.candidate.hasCover,
          confidence: Math.round(m.confidence * 100),
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
