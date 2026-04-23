/**
 * User API Routes
 *
 * Handles user-related endpoints.
 */

const { createAsyncHandler } = require('../../middleware/async-handler');

/**
 * Register user routes
 * @param {Object} app - Express app instance
 * @param {Object} deps - Dependencies
 */
module.exports = (app, deps) => {
  const { ensureAuthAPI, listService, logger } = deps;
  const asyncHandler = createAsyncHandler(logger);

  // GET /api/user/lists-summary - Get list names for the current user (for "Add to..." dropdown)
  app.get(
    '/api/user/lists-summary',
    ensureAuthAPI,
    asyncHandler(async (req, res) => {
      const lists = await listService.getUserListSummaries(req.user._id);

      res.json({
        lists,
      });
    }, 'fetching lists summary')
  );
};
