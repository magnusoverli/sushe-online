/**
 * Groups API Routes
 *
 * Handles list group (collection) management:
 * - CRUD operations for groups
 * - Reordering groups
 * - Moving lists between groups
 * - Reordering lists within groups
 */

/**
 * Register group routes
 * @param {Object} app - Express app instance
 * @param {Object} deps - Dependencies
 */
module.exports = (app, deps) => {
  const {
    ensureAuthAPI,
    pool,
    logger,
    crypto,
    responseCache,
    helpers: {
      triggerAggregateListRecompute,
      findOrCreateYearGroup,
      findOrCreateUncategorizedGroup,
      deleteGroupIfEmptyAutoGroup,
    },
  } = deps;

  const { isYearLocked } = require('../../utils/year-lock');
  const { withTransaction, TransactionAbort } = require('../../db/transaction');
  const { buildPartialUpdate } = require('./_helpers');
  const { createAsyncHandler } = require('../../middleware/async-handler');
  const asyncHandler = createAsyncHandler(logger);

  // Get all groups for the current user (with list counts)
  app.get(
    '/api/groups',
    ensureAuthAPI,
    asyncHandler(
      async (req, res) => {
        const result = await pool.query(
          `SELECT 
          g._id,
          g.name,
          g.year,
          g.sort_order,
          g.created_at,
          g.updated_at,
          COUNT(l.id) as list_count
        FROM list_groups g
        LEFT JOIN lists l ON l.group_id = g.id
        WHERE g.user_id = $1
        GROUP BY g.id
        ORDER BY g.sort_order ASC`,
          [req.user._id]
        );

        // Filter out empty "Uncategorized" groups
        const groups = result.rows
          .filter((row) => {
            const listCount = parseInt(row.list_count, 10);
            const isUncategorized =
              row.name === 'Uncategorized' && row.year === null;

            // Hide empty "Uncategorized" groups
            if (isUncategorized && listCount === 0) {
              return false;
            }

            return true;
          })
          .map((row) => ({
            _id: row._id,
            name: row.name,
            year: row.year,
            sortOrder: row.sort_order,
            listCount: parseInt(row.list_count, 10),
            isYearGroup: row.year !== null,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          }));

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
        const { name } = req.body;

        if (!name || typeof name !== 'string' || name.trim().length === 0) {
          return res.status(400).json({ error: 'Collection name is required' });
        }

        const trimmedName = name.trim();

        // Check if name looks like a year (we don't allow creating year-groups manually)
        if (/^\d{4}$/.test(trimmedName)) {
          return res.status(400).json({
            error:
              'Collection name cannot be a year. Year groups are created automatically.',
          });
        }

        // Check for duplicate name
        const existing = await pool.query(
          `SELECT 1 FROM list_groups WHERE user_id = $1 AND name = $2`,
          [req.user._id, trimmedName]
        );

        if (existing.rows.length > 0) {
          return res
            .status(409)
            .json({ error: 'A group with this name already exists' });
        }

        // Get max sort_order to append at the end
        const maxOrder = await pool.query(
          `SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM list_groups WHERE user_id = $1`,
          [req.user._id]
        );

        const groupId = crypto.randomBytes(12).toString('hex');
        const timestamp = new Date();

        await pool.query(
          `INSERT INTO list_groups (_id, user_id, name, year, sort_order, created_at, updated_at)
         VALUES ($1, $2, $3, NULL, $4, $5, $6)`,
          [
            groupId,
            req.user._id,
            trimmedName,
            maxOrder.rows[0].next_order,
            timestamp,
            timestamp,
          ]
        );

        // Invalidate cache
        responseCache.invalidate(`GET:/api/groups:${req.user._id}`);

        res.status(201).json({
          _id: groupId,
          name: trimmedName,
          year: null,
          sortOrder: maxOrder.rows[0].next_order,
          listCount: 0,
          isYearGroup: false,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
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
        const { id } = req.params;
        const { name, sortOrder } = req.body;

        // Get the group and verify ownership
        const groupResult = await pool.query(
          `SELECT id, name, year, sort_order FROM list_groups WHERE _id = $1 AND user_id = $2`,
          [id, req.user._id]
        );

        if (groupResult.rows.length === 0) {
          return res.status(404).json({ error: 'Group not found' });
        }

        const group = groupResult.rows[0];

        // Year-groups cannot be renamed (their name is the year)
        if (name !== undefined && group.year !== null) {
          return res
            .status(400)
            .json({ error: 'Year groups cannot be renamed' });
        }

        // Validate new name if provided
        if (name !== undefined) {
          if (typeof name !== 'string' || name.trim().length === 0) {
            return res
              .status(400)
              .json({ error: 'Collection name is required' });
          }
          if (/^\d{4}$/.test(name.trim())) {
            return res
              .status(400)
              .json({ error: 'Collection name cannot be a year' });
          }
          // Check for duplicate name
          const existing = await pool.query(
            `SELECT 1 FROM list_groups WHERE user_id = $1 AND name = $2 AND _id != $3`,
            [req.user._id, name.trim(), id]
          );
          if (existing.rows.length > 0) {
            return res
              .status(409)
              .json({ error: 'A group with this name already exists' });
          }
        }

        // Build update query
        const fields = [];

        if (name !== undefined) {
          fields.push({ column: 'name', value: name.trim() });
        }

        if (sortOrder !== undefined) {
          if (typeof sortOrder !== 'number' || sortOrder < 0) {
            return res.status(400).json({ error: 'Invalid sort order' });
          }
          fields.push({ column: 'sort_order', value: sortOrder });
        }

        if (fields.length === 0) {
          return res.status(400).json({ error: 'No updates provided' });
        }

        const update = buildPartialUpdate(
          'list_groups',
          'id',
          group.id,
          fields
        );
        await pool.query(update.query, update.values);

        // Invalidate cache
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
        const { id } = req.params;
        const { force } = req.query;

        // Get the group and verify ownership
        const groupResult = await pool.query(
          `SELECT id, name, year FROM list_groups WHERE _id = $1 AND user_id = $2`,
          [id, req.user._id]
        );

        if (groupResult.rows.length === 0) {
          return res.status(404).json({ error: 'Group not found' });
        }

        const group = groupResult.rows[0];

        // Cannot delete year-groups (they auto-delete when empty)
        if (group.year !== null) {
          return res.status(400).json({
            error:
              'Year groups cannot be deleted manually. They are removed automatically when empty.',
          });
        }

        // Check if any main lists in the group are in locked years
        const mainListsWithYears = await pool.query(
          `SELECT year FROM lists WHERE group_id = $1 AND year IS NOT NULL AND is_main = TRUE`,
          [group.id]
        );

        for (const row of mainListsWithYears.rows) {
          const yearLocked = await isYearLocked(pool, row.year);
          if (yearLocked) {
            return res.status(403).json({
              error: `Cannot delete group: Main list for year ${row.year} is locked`,
              yearLocked: true,
              year: row.year,
            });
          }
        }

        // Check if collection has lists
        const listCountResult = await pool.query(
          `SELECT COUNT(*) as count FROM lists WHERE group_id = $1`,
          [group.id]
        );
        const listCount = parseInt(listCountResult.rows[0].count, 10);

        if (listCount > 0 && force !== 'true') {
          // Return conflict status with list count so frontend can show confirmation
          return res.status(409).json({
            error: 'Collection contains lists',
            listCount,
            requiresConfirmation: true,
          });
        }

        // If force=true or no lists, delete the group
        // First, move all lists from this group to "Uncategorized"
        // Also clear is_main flag and year since uncategorized lists can't be main
        if (listCount > 0) {
          // Get or create "Uncategorized" group for this user
          const uncategorizedId = await findOrCreateUncategorizedGroup(
            pool,
            req.user._id
          );

          // Move lists to Uncategorized group
          await pool.query(
            `UPDATE lists SET group_id = $1, is_main = FALSE, year = NULL, updated_at = NOW() 
           WHERE group_id = $2`,
            [uncategorizedId, group.id]
          );
        }

        await pool.query(`DELETE FROM list_groups WHERE id = $1`, [group.id]);

        logger.info('Collection deleted', {
          userId: req.user._id,
          groupId: id,
          groupName: group.name,
          listsUnassigned: listCount,
        });

        // Invalidate cache
        responseCache.invalidate(`GET:/api/groups:${req.user._id}`);
        responseCache.invalidate(`GET:/api/lists:${req.user._id}`);

        res.json({ success: true, listsUnassigned: listCount });
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
        const { order } = req.body;

        if (!Array.isArray(order)) {
          return res
            .status(400)
            .json({ error: 'Order must be an array of group IDs' });
        }

        await withTransaction(pool, async (client) => {
          // Verify all groups belong to user
          const groupsResult = await client.query(
            `SELECT _id FROM list_groups WHERE user_id = $1`,
            [req.user._id]
          );

          const userGroupIds = new Set(groupsResult.rows.map((r) => r._id));

          for (const gId of order) {
            if (!userGroupIds.has(gId)) {
              throw new TransactionAbort(400, {
                error: `Invalid group ID: ${gId}`,
              });
            }
          }

          // Update sort_order for each group
          for (let i = 0; i < order.length; i++) {
            await client.query(
              `UPDATE list_groups SET sort_order = $1, updated_at = NOW() WHERE _id = $2 AND user_id = $3`,
              [i, order[i], req.user._id]
            );
          }
        });

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
        const { id } = req.params;
        const { groupId, year } = req.body;

        // Either groupId or year must be provided, not both
        if (groupId && year !== undefined) {
          return res
            .status(400)
            .json({ error: 'Provide either groupId or year, not both' });
        }

        if (!groupId && year === undefined) {
          return res
            .status(400)
            .json({ error: 'Either groupId or year is required' });
        }

        const result = await withTransaction(pool, async (client) => {
          // Get the list by ID
          const listResult = await client.query(
            `SELECT l.id, l._id, l.name, l.year, l.is_main, l.group_id, g.year as current_group_year
           FROM lists l
           LEFT JOIN list_groups g ON l.group_id = g.id
           WHERE l.user_id = $1 AND l._id = $2`,
            [req.user._id, id]
          );

          if (listResult.rows.length === 0) {
            throw new TransactionAbort(404, { error: 'List not found' });
          }

          const list = listResult.rows[0];
          const oldYear = list.current_group_year;
          let targetGroupId;
          let targetYear;

          if (year !== undefined) {
            // Moving to a year-group
            const yearGroup = await findOrCreateYearGroup(
              client,
              req.user._id,
              year
            );
            targetGroupId = yearGroup.groupId;
            targetYear = yearGroup.year;
          } else {
            // Moving to an existing group (collection)
            const groupResult = await client.query(
              `SELECT id, year FROM list_groups WHERE _id = $1 AND user_id = $2`,
              [groupId, req.user._id]
            );

            if (groupResult.rows.length === 0) {
              throw new TransactionAbort(404, {
                error: 'Target group not found',
              });
            }

            targetGroupId = groupResult.rows[0].id;
            targetYear = groupResult.rows[0].year;
          }

          // Check if source or target years are locked (only for main lists)
          if (list.is_main) {
            const sourceYearLocked = oldYear
              ? await isYearLocked(pool, oldYear)
              : false;
            const targetYearLocked =
              targetYear && targetYear !== oldYear
                ? await isYearLocked(pool, targetYear)
                : false;

            if (sourceYearLocked) {
              throw new TransactionAbort(403, {
                error: `Cannot move main list from year ${oldYear}: Year is locked`,
                yearLocked: true,
              });
            }
            if (targetYearLocked) {
              throw new TransactionAbort(403, {
                error: `Cannot move main list to year ${targetYear}: Year is locked`,
                yearLocked: true,
              });
            }
          }
          // Note: Non-main lists can be moved freely even in locked years

          // If moving to a collection (no year), must clear is_main flag
          if (targetYear === null && list.is_main) {
            await client.query(
              `UPDATE lists SET is_main = FALSE WHERE id = $1`,
              [list.id]
            );
          }

          // Get max sort_order in target group
          const maxOrder = await client.query(
            `SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM lists WHERE group_id = $1`,
            [targetGroupId]
          );

          // Update the list
          await client.query(
            `UPDATE lists SET group_id = $1, year = $2, sort_order = $3, updated_at = NOW() WHERE id = $4`,
            [targetGroupId, targetYear, maxOrder.rows[0].next_order, list.id]
          );

          // Auto-delete empty year-groups and "Uncategorized"
          await deleteGroupIfEmptyAutoGroup(client, list.group_id);

          return { oldYear, targetYear, targetGroupId };
        });

        // Invalidate caches so frontend gets updated data
        responseCache.invalidate(`GET:/api/lists:${req.user._id}`);
        responseCache.invalidate(`GET:/api/groups:${req.user._id}`);

        // Trigger aggregate recompute for affected years
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
        const { groupId, order } = req.body;

        if (!groupId) {
          return res.status(400).json({ error: 'groupId is required' });
        }

        if (!Array.isArray(order)) {
          return res
            .status(400)
            .json({ error: 'order must be an array of list IDs' });
        }

        await withTransaction(pool, async (client) => {
          // Verify group belongs to user
          const groupResult = await client.query(
            `SELECT id FROM list_groups WHERE _id = $1 AND user_id = $2`,
            [groupId, req.user._id]
          );

          if (groupResult.rows.length === 0) {
            throw new TransactionAbort(404, { error: 'Group not found' });
          }

          const dbGroupId = groupResult.rows[0].id;

          // Verify all lists belong to user and group
          const listsResult = await client.query(
            `SELECT _id FROM lists WHERE user_id = $1 AND group_id = $2`,
            [req.user._id, dbGroupId]
          );

          const groupListIds = new Set(listsResult.rows.map((r) => r._id));

          for (const listId of order) {
            if (!groupListIds.has(listId)) {
              throw new TransactionAbort(400, {
                error: `List '${listId}' is not in this group`,
              });
            }
          }

          // Update sort_order for each list
          for (let i = 0; i < order.length; i++) {
            await client.query(
              `UPDATE lists SET sort_order = $1, updated_at = NOW() WHERE _id = $2 AND user_id = $3`,
              [i, order[i], req.user._id]
            );
          }
        });

        // Invalidate cache so next fetch gets updated order
        responseCache.invalidate(`GET:/api/lists:${req.user._id}`);

        res.json({ success: true });
      },
      'reordering lists',
      { errorMessage: 'Failed to reorder lists' }
    )
  );
};
