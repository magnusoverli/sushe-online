/**
 * Tidal API Routes
 *
 * Thin route layer — delegates business logic to tidalService.
 * Handles Tidal integration:
 * - Album search
 * - Track search
 */

const { createAsyncHandler } = require('../../middleware/async-handler');
const { createTidalService } = require('../../services/tidal-service');

/**
 * Register Tidal routes
 * @param {Object} app - Express app instance
 * @param {Object} deps - Dependencies
 */
module.exports = (app, deps) => {
  const { ensureAuthAPI, usersAsync, logger, fetch, requireTidalAuth } = deps;
  const asyncHandler = createAsyncHandler(logger);

  const tidalService = createTidalService({ fetch, usersAsync, logger });

  // Search Tidal for an album and return the ID
  app.get(
    '/api/tidal/album',
    ensureAuthAPI,
    requireTidalAuth,
    asyncHandler(async (req, res) => {
      const { artist, album } = req.query;
      if (!artist || !album) {
        return res.status(400).json({ error: 'artist and album are required' });
      }
      logger.info('Tidal album search:', artist, '-', album);

      const countryCode = await tidalService.resolveCountryCode(
        req.user,
        req.tidalAuth.access_token
      );
      // Update cached country on req.user for this request
      req.user.tidalCountry = countryCode;

      const result = await tidalService.searchAlbum(
        artist,
        album,
        req.tidalAuth.access_token,
        countryCode
      );

      if (!result) {
        return res.status(404).json({ error: 'Album not found' });
      }

      logger.info('Tidal search result id:', result.id);
      res.json(result);
    }, 'searching Tidal album')
  );

  // Search Tidal for a track and return the ID
  app.get(
    '/api/tidal/track',
    ensureAuthAPI,
    requireTidalAuth,
    asyncHandler(async (req, res) => {
      const { artist, album, track } = req.query;
      if (!artist || !album || !track) {
        return res
          .status(400)
          .json({ error: 'artist, album, and track are required' });
      }
      logger.info('Tidal track search:', artist, '-', album, '-', track);

      const countryCode = req.user.tidalCountry || 'US';

      const result = await tidalService.searchTrack(
        artist,
        album,
        track,
        req.tidalAuth.access_token,
        countryCode
      );

      if (!result) {
        return res.status(404).json({ error: 'Track not found' });
      }

      res.json(result);
    }, 'searching Tidal track')
  );
};
