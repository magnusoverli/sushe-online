/**
 * Qobuz API Routes
 *
 * Thin route layer for Qobuz deep-link album resolution.
 */

const { createAsyncHandler } = require('../../middleware/async-handler');
const { createQobuzService } = require('../../services/qobuz-service');

module.exports = (app, deps) => {
  const { ensureAuthAPI, logger, fetch } = deps;
  const asyncHandler = createAsyncHandler(logger);

  const qobuzService = createQobuzService({ fetch, logger });

  app.get(
    '/api/qobuz/album',
    ensureAuthAPI,
    asyncHandler(async (req, res) => {
      const { artist, album } = req.query;
      if (!artist || !album) {
        return res.status(400).json({ error: 'artist and album are required' });
      }

      const result = await qobuzService.searchAlbum(artist, album);

      if (!result?.id) {
        return res.status(404).json({ error: 'Album not found' });
      }

      res.json({ id: result.id });
    }, 'searching Qobuz album')
  );
};
