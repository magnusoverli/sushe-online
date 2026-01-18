/**
 * Track Picks API Routes
 *
 * Handles track selection for albums:
 * - Set/update primary and secondary tracks
 * - Remove track picks
 * - Bulk fetch track picks
 */

/**
 * Register track picks routes
 * @param {Object} app - Express app instance
 * @param {Object} deps - Dependencies
 */
module.exports = (app, deps) => {
  const { ensureAuthAPI, logger } = deps;

  /**
   * Set or update a track pick for an album
   * Click logic: first click = secondary (priority 2), second click = promote to primary (priority 1)
   * If promoting and a primary exists, the old primary becomes secondary
   */
  app.post('/api/track-picks/:albumId', ensureAuthAPI, async (req, res) => {
    const { albumId } = req.params;
    const { trackIdentifier, priority } = req.body;

    if (!albumId) {
      return res.status(400).json({ error: 'Album ID is required' });
    }

    if (!trackIdentifier || typeof trackIdentifier !== 'string') {
      return res.status(400).json({ error: 'Track identifier is required' });
    }

    // Priority must be 1 (primary) or 2 (secondary)
    const targetPriority = priority === 1 ? 1 : 2;

    try {
      const { trackPicks } = require('../../db');
      const result = await trackPicks.setTrackPick(
        req.user._id,
        albumId,
        trackIdentifier.trim(),
        targetPriority
      );

      logger.debug('Track pick updated', {
        userId: req.user._id,
        albumId,
        trackIdentifier,
        targetPriority,
        result,
      });

      res.json({
        success: true,
        albumId,
        primary_track: result.primary,
        secondary_track: result.secondary,
      });
    } catch (err) {
      logger.error('Error setting track pick', {
        error: err.message,
        stack: err.stack,
        userId: req.user._id,
        albumId,
      });
      return res.status(500).json({ error: 'Error setting track pick' });
    }
  });

  /**
   * Remove a track pick for an album
   * If trackIdentifier is provided, removes that specific track
   * If not provided, removes all track picks for the album
   */
  app.delete('/api/track-picks/:albumId', ensureAuthAPI, async (req, res) => {
    const { albumId } = req.params;
    const { trackIdentifier } = req.body || {};

    if (!albumId) {
      return res.status(400).json({ error: 'Album ID is required' });
    }

    try {
      const { trackPicks } = require('../../db');
      const result = await trackPicks.removeTrackPick(
        req.user._id,
        albumId,
        trackIdentifier || null
      );

      logger.debug('Track pick removed', {
        userId: req.user._id,
        albumId,
        trackIdentifier,
        result,
      });

      res.json({
        success: true,
        albumId,
        primary_track: result.primary,
        secondary_track: result.secondary,
      });
    } catch (err) {
      logger.error('Error removing track pick', {
        error: err.message,
        stack: err.stack,
        userId: req.user._id,
        albumId,
      });
      return res.status(500).json({ error: 'Error removing track pick' });
    }
  });

  /**
   * Get track picks for specific albums
   * Used to fetch track picks for albums in a list
   */
  app.post('/api/track-picks/bulk', ensureAuthAPI, async (req, res) => {
    const { albumIds } = req.body;

    if (!albumIds || !Array.isArray(albumIds)) {
      return res.status(400).json({ error: 'Album IDs array is required' });
    }

    try {
      const { trackPicks } = require('../../db');
      const result = await trackPicks.findTrackPicksForAlbums(
        req.user._id,
        albumIds
      );

      res.json(result);
    } catch (err) {
      logger.error('Error fetching track picks', {
        error: err.message,
        stack: err.stack,
        userId: req.user._id,
      });
      return res.status(500).json({ error: 'Error fetching track picks' });
    }
  });
};
