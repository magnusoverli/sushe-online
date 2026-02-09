/**
 * Admin Album Re-identification Routes
 *
 * Handles MusicBrainz album search and re-identification:
 * - /api/admin/album/reidentify/search - Search for candidates
 * - /api/admin/album/reidentify - Apply selected release group
 *
 * All business logic delegated to services/reidentify-service.js
 */

const logger = require('../../utils/logger');
const { TransactionAbort } = require('../../db/transaction');

module.exports = (app, deps) => {
  const { ensureAuth, ensureAdmin, reidentifyService } = deps;

  /**
   * Search for release group candidates on MusicBrainz
   */
  app.post(
    '/api/admin/album/reidentify/search',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      const { artist, album, currentAlbumId } = req.body;

      try {
        logger.info('Admin searching for album candidates', {
          adminUsername: req.user.username,
          artist,
          album,
        });

        const result = await reidentifyService.searchCandidates(
          artist,
          album,
          currentAlbumId
        );

        res.json({ success: true, ...result });
      } catch (error) {
        if (error instanceof TransactionAbort) {
          return res.status(error.status).json(error.body);
        }
        logger.error('Admin album search failed', {
          adminUsername: req.user.username,
          artist,
          album,
          error: error.message,
        });
        res.status(500).json({ error: error.message });
      }
    }
  );

  /**
   * Apply a selected release group to an album
   */
  app.post(
    '/api/admin/album/reidentify',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      const { currentAlbumId, newAlbumId, artist, album } = req.body;

      try {
        logger.info('Admin applying album re-identification', {
          adminUsername: req.user.username,
          adminId: req.user._id,
          artist,
          album,
          currentAlbumId,
          newAlbumId,
        });

        const result = await reidentifyService.applyReidentification({
          currentAlbumId,
          newAlbumId,
          artist,
          album,
        });

        res.json({ success: true, ...result });
      } catch (error) {
        if (error instanceof TransactionAbort) {
          return res.status(error.status).json(error.body);
        }
        logger.error('Admin album re-identification failed', {
          adminUsername: req.user.username,
          artist,
          album,
          error: error.message,
        });
        res.status(500).json({ error: error.message });
      }
    }
  );
};
