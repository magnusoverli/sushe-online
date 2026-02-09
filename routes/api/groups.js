/**
 * Groups API Routes
 *
 * Thin route handlers that delegate to group-service.js for business logic.
 * Handles: request parsing, response formatting, cache invalidation.
 */

/**
 * Register group routes
 * @param {Object} app - Express app instance
 * @param {Object} deps - Dependencies
 */
module.exports = (app, deps) => {
  const {
    ensureAuthAPI,
    logger,
    responseCache,
    helpers: { triggerAggregateListRecompute },
    groupService,
  } = deps;

  const { createAsyncHandler } = require('../../middleware/async-handler');
  const asyncHandler = createAsyncHandler(logger);

  // Get all groups for the current user (with list counts)
  app.get(
    '/api/groups',
    ensureAuthAPI,
    asyncHandler(
      async (req, res) => {
        const groups = await groupService.getGroups(req.user._id);
        res.json(groups);
      },
      'fetching groups',
      { errorMessage: 'Failed to fetch groups' }
    )
  );

  // Create a new collection (custom group without year)
  app.post(
    '/api/groups',
    ensureAuthAPI,
    asyncHandler(
      async (req, res) => {
        const group = await groupService.createGroup(
          req.user._id,
          req.body.name
        );

        responseCache.invalidate(`GET:/api/groups:${req.user._id}`);

        res.status(201).json(group);
      },
      'creating collection',
      { errorMessage: 'Failed to create collection' }
    )
  );

  // Update a group (rename or change sort_order)
  app.patch(
    '/api/groups/:id',
    ensureAuthAPI,
    asyncHandler(
      async (req, res) => {
        await groupService.updateGroup(req.user._id, req.params.id, {
          name: req.body.name,
          sortOrder: req.body.sortOrder,
        });

        responseCache.invalidate(`GET:/api/groups:${req.user._id}`);

        res.json({ success: true });
      },
      'updating group',
      { errorMessage: 'Failed to update group' }
    )
  );

  // Delete a collection (must be empty, cannot delete year-groups)
  app.delete(
    '/api/groups/:id',
    ensureAuthAPI,
    asyncHandler(
      async (req, res) => {
        const result = await groupService.deleteGroup(
          req.user._id,
          req.params.id,
          req.query.force === 'true'
        );

        responseCache.invalidate(`GET:/api/groups:${req.user._id}`);
        responseCache.invalidate(`GET:/api/lists:${req.user._id}`);

        res.json({ success: true, listsUnassigned: result.listsUnassigned });
      },
      'deleting group',
      { errorMessage: 'Failed to delete group' }
    )
  );

  // Reorder groups (bulk update sort_order)
  app.post(
    '/api/groups/reorder',
    ensureAuthAPI,
    asyncHandler(
      async (req, res) => {
        await groupService.reorderGroups(req.user._id, req.body.order);

        res.json({ success: true });
      },
      'reordering groups',
      { errorMessage: 'Failed to reorder groups' }
    )
  );

  // Move a list to a different group (by list ID)
  app.post(
    '/api/lists/:id/move',
    ensureAuthAPI,
    asyncHandler(
      async (req, res) => {
        const result = await groupService.moveList(
          req.user._id,
          req.params.id,
          { groupId: req.body.groupId, year: req.body.year }
        );

        responseCache.invalidate(`GET:/api/lists:${req.user._id}`);
        responseCache.invalidate(`GET:/api/groups:${req.user._id}`);

        if (result.oldYear) triggerAggregateListRecompute(result.oldYear);
        if (result.targetYear && result.targetYear !== result.oldYear)
          triggerAggregateListRecompute(result.targetYear);

        res.json({
          success: true,
          year: result.targetYear,
          groupId: result.targetGroupId,
        });
      },
      'moving list',
      { errorMessage: 'Failed to move list' }
    )
  );

  // Reorder lists within a group (by list IDs)
  app.post(
    '/api/lists/reorder',
    ensureAuthAPI,
    asyncHandler(
      async (req, res) => {
        await groupService.reorderLists(
          req.user._id,
          req.body.groupId,
          req.body.order
        );

        responseCache.invalidate(`GET:/api/lists:${req.user._id}`);

        res.json({ success: true });
      },
      'reordering lists',
      { errorMessage: 'Failed to reorder lists' }
    )
  );
};
