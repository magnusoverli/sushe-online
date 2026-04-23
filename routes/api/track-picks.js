/**
 * Track Picks API Routes
 *
 * Handles track selection for list items:
 * - Set/update primary and secondary tracks
 * - Remove track picks
 *
 * Track picks are now stored directly on list_items (per-list, not per-user-album)
 */

const { createAsyncHandler } = require('../../middleware/async-handler');

/**
 * Register track picks routes
 * @param {Object} app - Express app instance
 * @param {Object} deps - Dependencies
 */
module.exports = (app, deps) => {
  const {
    ensureAuthAPI,
    logger,
    listService,
    helpers: { invalidateListCaches },
  } = deps;
  const asyncHandler = createAsyncHandler(logger);

  /**
   * Set or update a track pick for a list item
   * Click logic: first click = secondary (priority 2), second click = promote to primary (priority 1)
   * If promoting and a primary exists, the old primary becomes secondary
   */
  app.post(
    '/api/track-picks/:listItemId',
    ensureAuthAPI,
    asyncHandler(async (req, res) => {
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

      const result = await listService.setTrackPick(
        req.user._id,
        listItemId,
        trackIdentifier.trim(),
        targetPriority
      );

      if (result.status === 'not_found') {
        return res.status(404).json({ error: 'List item not found' });
      }
      if (result.status === 'forbidden') {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Invalidate cache for this list so refreshes show updated track picks
      invalidateListCaches(req.user._id, result.listId);

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
    }, 'setting track pick')
  );

  /**
   * Remove a track pick for a list item
   * If trackIdentifier is provided, removes that specific track
   * If not provided, removes all track picks for the list item
   */
  app.delete(
    '/api/track-picks/:listItemId',
    ensureAuthAPI,
    asyncHandler(async (req, res) => {
      const { listItemId } = req.params;
      const { trackIdentifier } = req.body || {};

      if (!listItemId) {
        return res.status(400).json({ error: 'List item ID is required' });
      }

      const result = await listService.removeTrackPick(
        req.user._id,
        listItemId,
        trackIdentifier || null
      );

      if (result.status === 'not_found') {
        return res.status(404).json({ error: 'List item not found' });
      }
      if (result.status === 'forbidden') {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Invalidate cache for this list so refreshes show updated track picks
      invalidateListCaches(req.user._id, result.listId);

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
    }, 'removing track pick')
  );
};
