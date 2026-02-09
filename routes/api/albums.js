/**
 * Albums API Routes
 *
 * Thin route handlers that delegate to album-service.js for business logic.
 * Handles: request parsing, response formatting, HTTP-specific concerns.
 */

/**
 * Register album routes
 * @param {Object} app - Express app instance
 * @param {Object} deps - Dependencies
 */
module.exports = (app, deps) => {
  const { ensureAuthAPI, logger, albumService } = deps;

  const { createAsyncHandler } = require('../../middleware/async-handler');
  const asyncHandler = createAsyncHandler(logger);

  // Get album cover image
  app.get(
    '/api/albums/:album_id/cover',
    ensureAuthAPI,
    asyncHandler(
      async (req, res) => {
        const { imageBuffer, contentType, albumId } =
          await albumService.getCoverImage(req.params.album_id);

        res.set({
          'Content-Type': contentType,
          'Content-Length': imageBuffer.length,
          'Cache-Control': 'public, max-age=31536000, immutable',
          ETag: `"${albumId}-${imageBuffer.length}"`,
        });

        res.send(imageBuffer);
      },
      'fetching album cover',
      { errorMessage: 'Error fetching image' }
    )
  );

  // Get single album summary
  app.get(
    '/api/albums/:albumId/summary',
    ensureAuthAPI,
    asyncHandler(
      async (req, res) => {
        const summary = await albumService.getSummary(req.params.albumId);
        res.json(summary);
      },
      'fetching album summary',
      { errorMessage: 'Error fetching summary' }
    )
  );

  // Update album summary (for import)
  app.put(
    '/api/albums/:albumId/summary',
    ensureAuthAPI,
    asyncHandler(
      async (req, res) => {
        await albumService.updateSummary(
          req.params.albumId,
          req.body.summary,
          req.body.summary_source
        );
        res.json({ success: true });
      },
      'updating album summary',
      { errorMessage: 'Error updating summary' }
    )
  );

  // Update canonical album country
  app.patch(
    '/api/albums/:albumId/country',
    ensureAuthAPI,
    asyncHandler(
      async (req, res) => {
        await albumService.updateCountry(
          req.params.albumId,
          req.body.country,
          req.user._id
        );
        res.json({ success: true });
      },
      'updating album country',
      { errorMessage: 'Error updating country' }
    )
  );

  // Update canonical album genres
  app.patch(
    '/api/albums/:albumId/genres',
    ensureAuthAPI,
    asyncHandler(
      async (req, res) => {
        await albumService.updateGenres(
          req.params.albumId,
          { genre_1: req.body.genre_1, genre_2: req.body.genre_2 },
          req.user._id
        );
        res.json({ success: true });
      },
      'updating album genres',
      { errorMessage: 'Error updating genres' }
    )
  );

  // Batch update album metadata
  app.patch(
    '/api/albums/batch-update',
    ensureAuthAPI,
    asyncHandler(async (req, res) => {
      const updated = await albumService.batchUpdate(
        req.body.updates,
        req.user._id
      );
      res.json({ success: true, updated });
    }, 'batch updating albums')
  );

  // Check for similar albums (fuzzy duplicate detection)
  app.post(
    '/api/albums/check-similar',
    ensureAuthAPI,
    asyncHandler(
      async (req, res) => {
        const result = await albumService.checkSimilar({
          artist: req.body.artist,
          album: req.body.album,
          album_id: req.body.album_id,
        });
        res.json(result);
      },
      'checking similar albums',
      { errorMessage: 'Error checking for similar albums' }
    )
  );

  // Mark two albums as distinct
  app.post(
    '/api/albums/mark-distinct',
    ensureAuthAPI,
    asyncHandler(async (req, res) => {
      await albumService.markDistinct(
        req.body.album_id_1,
        req.body.album_id_2,
        req.user?.id
      );
      res.json({ success: true });
    }, 'marking albums as distinct')
  );

  // Merge metadata into an existing canonical album
  app.post(
    '/api/albums/merge-metadata',
    ensureAuthAPI,
    asyncHandler(async (req, res) => {
      const canonicalId = await albumService.mergeMetadata(
        {
          album_id: req.body.album_id,
          artist: req.body.artist,
          album: req.body.album,
          cover_image: req.body.cover_image,
          cover_image_format: req.body.cover_image_format,
          tracks: req.body.tracks,
        },
        req.user?.id
      );
      res.json({ success: true, album_id: canonicalId });
    }, 'merging album metadata')
  );
};
