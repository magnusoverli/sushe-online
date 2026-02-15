/**
 * Lists API Routes
 *
 * Thin routing layer that delegates business logic to ListService.
 * Each handler: parses request -> calls service -> invalidates cache -> responds.
 *
 * NOTE: Lists are now identified by ID, not name, to support duplicate names
 * in different categories (groups).
 */

/**
 * Register list routes
 * @param {Object} app - Express app instance
 * @param {Object} deps - Dependencies
 */
module.exports = (app, deps) => {
  const {
    ensureAuthAPI,
    logger,
    cacheConfigs,
    listService,
    helpers: { triggerAggregateListRecompute, invalidateListCaches },
  } = deps;

  const { createAsyncHandler } = require('../../middleware/async-handler');
  const asyncHandler = createAsyncHandler(logger);

  // ============================================
  // GET ROUTES
  // ============================================

  // Get all lists for current user
  app.get(
    '/api/lists',
    ensureAuthAPI,
    cacheConfigs.userSpecific,
    asyncHandler(async (req, res) => {
      const { full } = req.query;
      const listsObj = await listService.getAllLists(req.user._id, {
        full: full === 'true',
      });
      res.json(listsObj);
    }, 'fetching lists')
  );

  // Check if user needs to complete list setup
  app.get(
    '/api/lists/setup-status',
    ensureAuthAPI,
    asyncHandler(
      async (req, res) => {
        const status = await listService.getSetupStatus(req.user._id, req.user);
        res.json(status);
      },
      'checking list setup status',
      { errorMessage: 'Failed to check setup status' }
    )
  );

  // Get a single list by ID
  app.get(
    '/api/lists/:id',
    ensureAuthAPI,
    cacheConfigs.userSpecific,
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const isExport = req.query.export === 'true';

      const result = await listService.getListById(id, req.user._id, {
        isExport,
      });

      if (!result) {
        return res.status(404).json({ error: 'List not found' });
      }

      if (isExport) {
        res.json({
          _metadata: {
            list_id: result.list._id,
            list_name: result.list.name,
            year: result.list.year || null,
            group_id: result.list.groupExternalId || null,
            group_name: result.list.groupName || null,
          },
          albums: result.items,
        });
      } else {
        res.json(result.items);
      }
    }, 'fetching list')
  );

  // ============================================
  // WRITE ROUTES
  // ============================================

  // Bulk update lists (year assignment and main list designation)
  app.post(
    '/api/lists/bulk-update',
    ensureAuthAPI,
    asyncHandler(
      async (req, res) => {
        const { updates } = req.body;

        if (!Array.isArray(updates)) {
          return res.status(400).json({ error: 'Updates must be an array' });
        }

        const { results, yearsToRecompute } = await listService.bulkUpdate(
          req.user._id,
          updates
        );

        invalidateListCaches(req.user._id, null, { full: false });

        for (const y of yearsToRecompute) {
          triggerAggregateListRecompute(y);
        }

        res.json({
          success: true,
          results,
          recomputingYears: [...yearsToRecompute],
        });
      },
      'bulk updating lists',
      { errorMessage: 'Failed to update lists' }
    )
  );

  // Dismiss list setup wizard (temporary)
  app.post(
    '/api/lists/setup-dismiss',
    ensureAuthAPI,
    asyncHandler(
      async (req, res) => {
        const dismissedUntil = await listService.dismissSetup(req.user._id);
        res.json({ success: true, dismissedUntil });
      },
      'dismissing setup wizard',
      { errorMessage: 'Failed to dismiss wizard' }
    )
  );

  // Create a new list
  app.post(
    '/api/lists',
    ensureAuthAPI,
    asyncHandler(async (req, res) => {
      const { name, groupId, year, data: albums } = req.body;

      const result = await listService.createList(req.user._id, {
        name,
        groupId,
        year,
        albums,
      });

      invalidateListCaches(req.user._id, null, { full: false });

      if (result.year) {
        triggerAggregateListRecompute(result.year);
      }

      res.status(201).json({
        success: true,
        _id: result.listId,
        name: result.name,
        year: result.year,
        groupId: result.groupId,
        count: result.count,
      });
    }, 'creating list')
  );

  // Update list metadata (rename, change year, move to group)
  app.patch(
    '/api/lists/:id',
    ensureAuthAPI,
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const { name: newName, year, groupId: newGroupId } = req.body;

      const result = await listService.updateListMetadata(id, req.user._id, {
        name: newName,
        year,
        groupId: newGroupId,
      });

      invalidateListCaches(req.user._id, id, { full: false });

      if (result.list.year !== null) {
        triggerAggregateListRecompute(result.list.year);
      }
      if (
        result.targetYear !== null &&
        result.targetYear !== result.list.year
      ) {
        triggerAggregateListRecompute(result.targetYear);
      }

      // Broadcast rename event if name changed
      const broadcast = req.app.locals.broadcast;
      if (broadcast && newName && newName.trim() !== result.list.name) {
        broadcast.listRenamed(req.user._id, result.list.name, newName.trim());
      }

      res.json({ success: true });
    }, 'updating list')
  );

  // Update list items (full replacement)
  app.put(
    '/api/lists/:id',
    ensureAuthAPI,
    asyncHandler(
      async (req, res) => {
        const { id } = req.params;
        const { data: rawAlbums } = req.body;

        if (!rawAlbums || !Array.isArray(rawAlbums)) {
          return res.status(400).json({ error: 'Invalid albums array' });
        }

        const { list, count } = await listService.replaceListItems(
          id,
          req.user._id,
          rawAlbums
        );

        invalidateListCaches(req.user._id, id);

        if (list.year) {
          triggerAggregateListRecompute(list.year);
        }

        res.json({ success: true, count });
      },
      'updating list items',
      { errorMessage: 'Error updating list' }
    )
  );

  // Reorder list items (lightweight endpoint for drag-and-drop)
  app.post(
    '/api/lists/:id/reorder',
    ensureAuthAPI,
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const { order } = req.body;

      if (!order || !Array.isArray(order)) {
        return res.status(400).json({ error: 'Invalid order array' });
      }

      const { list } = await listService.reorderItems(id, req.user._id, order);

      invalidateListCaches(req.user._id, id, { full: false });

      const broadcast = req.app.locals.broadcast;
      if (broadcast) {
        const excludeSocketId = req.headers['x-socket-id'];
        broadcast.listReordered(req.user._id, list._id, order, {
          excludeSocketId,
        });
      }

      res.json({ success: true });
    }, 'reordering list')
  );

  // Update single album's comment
  app.patch(
    '/api/lists/:id/items/:identifier/comment',
    ensureAuthAPI,
    asyncHandler(async (req, res) => {
      const { id, identifier } = req.params;
      const { comment } = req.body;

      if (
        comment !== null &&
        comment !== undefined &&
        typeof comment !== 'string'
      ) {
        return res.status(400).json({ error: 'Invalid comment value' });
      }

      await listService.updateItemComment(
        id,
        req.user._id,
        identifier,
        comment
      );

      invalidateListCaches(req.user._id, id, { full: false });

      res.json({ success: true });
    }, 'updating comment')
  );

  // Update single album's comment 2
  app.patch(
    '/api/lists/:id/items/:identifier/comment2',
    ensureAuthAPI,
    asyncHandler(async (req, res) => {
      const { id, identifier } = req.params;
      const { comment } = req.body;

      if (
        comment !== null &&
        comment !== undefined &&
        typeof comment !== 'string'
      ) {
        return res.status(400).json({ error: 'Invalid comment value' });
      }

      await listService.updateItemComment2(
        id,
        req.user._id,
        identifier,
        comment
      );

      invalidateListCaches(req.user._id, id, { full: false });

      res.json({ success: true });
    }, 'updating comment 2')
  );

  // Incremental list update (add/remove/update items without full rebuild)
  app.patch(
    '/api/lists/:id/items',
    ensureAuthAPI,
    asyncHandler(
      async (req, res) => {
        const { id } = req.params;
        const { added, removed, updated } = req.body;

        if (!added && !removed && !updated) {
          return res.status(400).json({ error: 'No changes specified' });
        }

        const result = await listService.incrementalUpdate(
          id,
          req.user._id,
          { added, removed, updated },
          req.user
        );

        invalidateListCaches(req.user._id, id);

        const broadcast = req.app.locals.broadcast;
        if (broadcast) {
          const excludeSocketId = req.headers['x-socket-id'];
          broadcast.listUpdated(req.user._id, result.list._id, {
            excludeSocketId,
          });
        }

        if (result.list.year) {
          triggerAggregateListRecompute(result.list.year);
        }

        res.json({
          success: true,
          changes: result.changeCount,
          addedItems: result.addedItems,
          duplicates: result.duplicateAlbums,
        });
      },
      'incrementally updating list',
      { errorMessage: 'Error updating list' }
    )
  );

  // Toggle main list status for a year
  app.post(
    '/api/lists/:id/main',
    ensureAuthAPI,
    asyncHandler(
      async (req, res) => {
        const { id } = req.params;
        const { isMain } = req.body;

        if (typeof isMain !== 'boolean') {
          return res.status(400).json({ error: 'isMain must be a boolean' });
        }

        const result = await listService.toggleMainStatus(
          id,
          req.user._id,
          isMain
        );

        invalidateListCaches(req.user._id, null, { full: false });

        if (result.year) {
          triggerAggregateListRecompute(result.year);
        }

        if (result.isRemoval) {
          return res.json({ success: true, year: result.year || null });
        }

        res.json({
          success: true,
          year: result.year,
          previousMainListId:
            result.previousMainResult.length > 0
              ? result.previousMainResult[0]._id
              : null,
          previousMainList:
            result.previousMainResult.length > 0
              ? result.previousMainResult[0].name
              : null,
        });
      },
      'toggling main list status',
      { errorMessage: 'Failed to update main list status' }
    )
  );

  // Delete a list
  app.delete(
    '/api/lists/:id',
    ensureAuthAPI,
    asyncHandler(async (req, res) => {
      const { id } = req.params;

      const list = await listService.deleteList(id, req.user._id);

      invalidateListCaches(req.user._id, id, { groups: true });

      if (list.year) {
        triggerAggregateListRecompute(list.year);
      }

      res.json({ success: true });
    }, 'deleting list')
  );
};
