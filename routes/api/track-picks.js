/**
 * Track Picks API Routes
 *
 * Handles track selection for list items:
 * - Set/update primary and secondary tracks
 * - Remove track picks
 *
 * Track picks are now stored directly on list_items (per-list, not per-user-album)
 */

/**
 * Register track picks routes
 * @param {Object} app - Express app instance
 * @param {Object} deps - Dependencies
 */
module.exports = (app, deps) => {
  const { ensureAuthAPI, logger, responseCache } = deps;

  /**
   * Set or update a track pick for a list item
   * Click logic: first click = secondary (priority 2), second click = promote to primary (priority 1)
   * If promoting and a primary exists, the old primary becomes secondary
   */
  app.post('/api/track-picks/:listItemId', ensureAuthAPI, async (req, res) => {
    const { listItemId } = req.params;
    const { trackIdentifier, priority } = req.body;

    if (!listItemId) {
      return res.status(400).json({ error: 'List item ID is required' });
    }

    if (!trackIdentifier || typeof trackIdentifier !== 'string') {
      return res.status(400).json({ error: 'Track identifier is required' });
    }

    // Priority must be 1 (primary) or 2 (secondary)
    const targetPriority = priority === 1 ? 1 : 2;

    try {
      const { listItemsAsync, listsAsync } = require('../../db');

      // Verify the list item belongs to the user
      const listItem = await listItemsAsync.findOne({ _id: listItemId });
      if (!listItem) {
        return res.status(404).json({ error: 'List item not found' });
      }

      const list = await listsAsync.findOne({ _id: listItem.listId });
      if (!list || list.userId !== req.user._id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const result = await listItemsAsync.setTrackPick(
        listItemId,
        trackIdentifier.trim(),
        targetPriority
      );

      // Invalidate cache for this list so refreshes show updated track picks
      responseCache.invalidate(
        `GET:/api/lists/${encodeURIComponent(list.name)}:${req.user._id}`
      );
      responseCache.invalidate(`GET:/api/lists:${req.user._id}`);
      responseCache.invalidate(`GET:/api/lists?full=true:${req.user._id}`);

      logger.debug('Track pick updated', {
        userId: req.user._id,
        listItemId,
        trackIdentifier,
        targetPriority,
        result,
      });

      res.json({
        success: true,
        listItemId,
        primary_track: result.primary,
        secondary_track: result.secondary,
      });
    } catch (err) {
      logger.error('Error setting track pick', {
        error: err.message,
        stack: err.stack,
        userId: req.user._id,
        listItemId,
      });
      return res.status(500).json({ error: 'Error setting track pick' });
    }
  });

  /**
   * Remove a track pick for a list item
   * If trackIdentifier is provided, removes that specific track
   * If not provided, removes all track picks for the list item
   */
  app.delete(
    '/api/track-picks/:listItemId',
    ensureAuthAPI,
    async (req, res) => {
      const { listItemId } = req.params;
      const { trackIdentifier } = req.body || {};

      if (!listItemId) {
        return res.status(400).json({ error: 'List item ID is required' });
      }

      try {
        const { listItemsAsync, listsAsync } = require('../../db');

        // Verify the list item belongs to the user
        const listItem = await listItemsAsync.findOne({ _id: listItemId });
        if (!listItem) {
          return res.status(404).json({ error: 'List item not found' });
        }

        const list = await listsAsync.findOne({ _id: listItem.listId });
        if (!list || list.userId !== req.user._id) {
          return res.status(403).json({ error: 'Access denied' });
        }

        const result = await listItemsAsync.removeTrackPick(
          listItemId,
          trackIdentifier || null
        );

        // Invalidate cache for this list so refreshes show updated track picks
        responseCache.invalidate(
          `GET:/api/lists/${encodeURIComponent(list.name)}:${req.user._id}`
        );
        responseCache.invalidate(`GET:/api/lists:${req.user._id}`);
        responseCache.invalidate(`GET:/api/lists?full=true:${req.user._id}`);

        logger.debug('Track pick removed', {
          userId: req.user._id,
          listItemId,
          trackIdentifier,
          result,
        });

        res.json({
          success: true,
          listItemId,
          primary_track: result.primary,
          secondary_track: result.secondary,
        });
      } catch (err) {
        logger.error('Error removing track pick', {
          error: err.message,
          stack: err.stack,
          userId: req.user._id,
          listItemId,
        });
        return res.status(500).json({ error: 'Error removing track pick' });
      }
    }
  );
};
