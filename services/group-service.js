/**
 * Group Service
 *
 * Business logic for list group (collection) management:
 * - CRUD operations for groups
 * - Reordering groups
 * - Moving lists between groups
 * - Reordering lists within groups
 *
 * Follows dependency injection pattern for testability.
 */

const defaultLogger = require('../utils/logger');
const { isYearLocked } = require('../utils/year-lock');
const { withTransaction, TransactionAbort } = require('../db/transaction');
const { buildPartialUpdate } = require('../utils/query-builder');

/**
 * Create group service with injected dependencies
 * @param {Object} deps
 * @param {Object} deps.pool - PostgreSQL pool
 * @param {Object} deps.logger - Logger instance
 * @param {Object} deps.crypto - Node.js crypto module
 * @param {Function} deps.findOrCreateYearGroup - Helper from _helpers.js
 * @param {Function} deps.findOrCreateUncategorizedGroup - Helper from _helpers.js
 * @param {Function} deps.deleteGroupIfEmptyAutoGroup - Helper from _helpers.js
 */
// eslint-disable-next-line max-lines-per-function -- Cohesive service module with related group operations
function createGroupService(deps = {}) {
  const pool = deps.pool;
  const logger = deps.logger || defaultLogger;
  const crypto = deps.crypto || require('crypto');
  const {
    findOrCreateYearGroup,
    findOrCreateUncategorizedGroup,
    deleteGroupIfEmptyAutoGroup,
  } = deps;

  /**
   * Get all groups for a user (with list counts).
   * Filters out empty "Uncategorized" groups.
   * @param {string} userId
   * @returns {Promise<Array>}
   */
  async function getGroups(userId) {
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
      [userId]
    );

    return result.rows
      .filter((row) => {
        const listCount = parseInt(row.list_count, 10);
        const isUncategorized =
          row.name === 'Uncategorized' && row.year === null;
        if (isUncategorized && listCount === 0) return false;
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
  }

  /**
   * Create a new collection (custom group without year).
   * @param {string} userId
   * @param {string} name - Collection name
   * @returns {Promise<Object>} Created group
   * @throws {TransactionAbort} on validation failure
   */
  async function createGroup(userId, name) {
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new TransactionAbort(400, { error: 'Collection name is required' });
    }

    const trimmedName = name.trim();

    if (/^\d{4}$/.test(trimmedName)) {
      throw new TransactionAbort(400, {
        error:
          'Collection name cannot be a year. Year groups are created automatically.',
      });
    }

    // Check for duplicate name
    const existing = await pool.query(
      `SELECT 1 FROM list_groups WHERE user_id = $1 AND name = $2`,
      [userId, trimmedName]
    );

    if (existing.rows.length > 0) {
      throw new TransactionAbort(409, {
        error: 'A group with this name already exists',
      });
    }

    // Get max sort_order to append at the end
    const maxOrder = await pool.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM list_groups WHERE user_id = $1`,
      [userId]
    );

    const groupId = crypto.randomBytes(12).toString('hex');
    const timestamp = new Date();

    await pool.query(
      `INSERT INTO list_groups (_id, user_id, name, year, sort_order, created_at, updated_at)
       VALUES ($1, $2, $3, NULL, $4, $5, $6)`,
      [
        groupId,
        userId,
        trimmedName,
        maxOrder.rows[0].next_order,
        timestamp,
        timestamp,
      ]
    );

    return {
      _id: groupId,
      name: trimmedName,
      year: null,
      sortOrder: maxOrder.rows[0].next_order,
      listCount: 0,
      isYearGroup: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  /**
   * Update a group (rename or change sort_order).
   * @param {string} userId
   * @param {string} groupExternalId - The group's _id
   * @param {Object} updates - { name?, sortOrder? }
   * @throws {TransactionAbort} on validation failure
   */
  async function updateGroup(userId, groupExternalId, updates) {
    const { name, sortOrder } = updates;

    const groupResult = await pool.query(
      `SELECT id, name, year, sort_order FROM list_groups WHERE _id = $1 AND user_id = $2`,
      [groupExternalId, userId]
    );

    if (groupResult.rows.length === 0) {
      throw new TransactionAbort(404, { error: 'Group not found' });
    }

    const group = groupResult.rows[0];

    if (name !== undefined && group.year !== null) {
      throw new TransactionAbort(400, {
        error: 'Year groups cannot be renamed',
      });
    }

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        throw new TransactionAbort(400, {
          error: 'Collection name is required',
        });
      }
      if (/^\d{4}$/.test(name.trim())) {
        throw new TransactionAbort(400, {
          error: 'Collection name cannot be a year',
        });
      }
      const existing = await pool.query(
        `SELECT 1 FROM list_groups WHERE user_id = $1 AND name = $2 AND _id != $3`,
        [userId, name.trim(), groupExternalId]
      );
      if (existing.rows.length > 0) {
        throw new TransactionAbort(409, {
          error: 'A group with this name already exists',
        });
      }
    }

    const fields = [];
    if (name !== undefined) {
      fields.push({ column: 'name', value: name.trim() });
    }
    if (sortOrder !== undefined) {
      if (typeof sortOrder !== 'number' || sortOrder < 0) {
        throw new TransactionAbort(400, { error: 'Invalid sort order' });
      }
      fields.push({ column: 'sort_order', value: sortOrder });
    }

    if (fields.length === 0) {
      throw new TransactionAbort(400, { error: 'No updates provided' });
    }

    const update = buildPartialUpdate('list_groups', 'id', group.id, fields);
    await pool.query(update.query, update.values);
  }

  /**
   * Delete a collection. Must be empty or force=true.
   * Cannot delete year-groups. Moves lists to Uncategorized if force.
   * @param {string} userId
   * @param {string} groupExternalId - The group's _id
   * @param {boolean} force - Force delete even if group has lists
   * @returns {Promise<Object>} { listsUnassigned }
   * @throws {TransactionAbort} on validation failure
   */
  async function deleteGroup(userId, groupExternalId, force = false) {
    const groupResult = await pool.query(
      `SELECT id, name, year FROM list_groups WHERE _id = $1 AND user_id = $2`,
      [groupExternalId, userId]
    );

    if (groupResult.rows.length === 0) {
      throw new TransactionAbort(404, { error: 'Group not found' });
    }

    const group = groupResult.rows[0];

    if (group.year !== null) {
      throw new TransactionAbort(400, {
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
        throw new TransactionAbort(403, {
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

    if (listCount > 0 && !force) {
      throw new TransactionAbort(409, {
        error: 'Collection contains lists',
        listCount,
        requiresConfirmation: true,
      });
    }

    // Move lists to Uncategorized if needed, then delete group
    if (listCount > 0) {
      const uncategorizedId = await findOrCreateUncategorizedGroup(
        pool,
        userId
      );

      await pool.query(
        `UPDATE lists SET group_id = $1, is_main = FALSE, year = NULL, updated_at = NOW() 
         WHERE group_id = $2`,
        [uncategorizedId, group.id]
      );
    }

    await pool.query(`DELETE FROM list_groups WHERE id = $1`, [group.id]);

    logger.info('Collection deleted', {
      userId,
      groupId: groupExternalId,
      groupName: group.name,
      listsUnassigned: listCount,
    });

    return { listsUnassigned: listCount };
  }

  /**
   * Reorder groups (bulk update sort_order).
   * @param {string} userId
   * @param {Array<string>} order - Array of group _ids in desired order
   */
  async function reorderGroups(userId, order) {
    if (!Array.isArray(order)) {
      throw new TransactionAbort(400, {
        error: 'Order must be an array of group IDs',
      });
    }

    await withTransaction(pool, async (client) => {
      const groupsResult = await client.query(
        `SELECT _id FROM list_groups WHERE user_id = $1`,
        [userId]
      );

      const userGroupIds = new Set(groupsResult.rows.map((r) => r._id));

      for (const gId of order) {
        if (!userGroupIds.has(gId)) {
          throw new TransactionAbort(400, {
            error: `Invalid group ID: ${gId}`,
          });
        }
      }

      for (let i = 0; i < order.length; i++) {
        await client.query(
          `UPDATE list_groups SET sort_order = $1, updated_at = NOW() WHERE _id = $2 AND user_id = $3`,
          [i, order[i], userId]
        );
      }
    });
  }

  /**
   * Move a list to a different group.
   * @param {string} userId
   * @param {string} listExternalId - The list's _id
   * @param {Object} target - { groupId?, year? } - one must be provided
   * @returns {Promise<Object>} { oldYear, targetYear, targetGroupId }
   */
  async function moveList(userId, listExternalId, target) {
    const { groupId, year } = target;

    if (groupId && year !== undefined) {
      throw new TransactionAbort(400, {
        error: 'Provide either groupId or year, not both',
      });
    }
    if (!groupId && year === undefined) {
      throw new TransactionAbort(400, {
        error: 'Either groupId or year is required',
      });
    }

    return await withTransaction(pool, async (client) => {
      const listResult = await client.query(
        `SELECT l.id, l._id, l.name, l.year, l.is_main, l.group_id, g.year as current_group_year
         FROM lists l
         LEFT JOIN list_groups g ON l.group_id = g.id
         WHERE l.user_id = $1 AND l._id = $2`,
        [userId, listExternalId]
      );

      if (listResult.rows.length === 0) {
        throw new TransactionAbort(404, { error: 'List not found' });
      }

      const list = listResult.rows[0];
      const oldYear = list.current_group_year;
      let targetGroupId;
      let targetYear;

      if (year !== undefined) {
        const yearGroup = await findOrCreateYearGroup(client, userId, year);
        targetGroupId = yearGroup.groupId;
        targetYear = yearGroup.year;
      } else {
        const groupResult = await client.query(
          `SELECT id, year FROM list_groups WHERE _id = $1 AND user_id = $2`,
          [groupId, userId]
        );

        if (groupResult.rows.length === 0) {
          throw new TransactionAbort(404, {
            error: 'Target group not found',
          });
        }

        targetGroupId = groupResult.rows[0].id;
        targetYear = groupResult.rows[0].year;
      }

      // Check year locks for main lists
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

      // If moving to a collection (no year), clear is_main flag
      if (targetYear === null && list.is_main) {
        await client.query(`UPDATE lists SET is_main = FALSE WHERE id = $1`, [
          list.id,
        ]);
      }

      // Get max sort_order in target group
      const maxOrder = await client.query(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM lists WHERE group_id = $1`,
        [targetGroupId]
      );

      await client.query(
        `UPDATE lists SET group_id = $1, year = $2, sort_order = $3, updated_at = NOW() WHERE id = $4`,
        [targetGroupId, targetYear, maxOrder.rows[0].next_order, list.id]
      );

      // Auto-delete empty year-groups and "Uncategorized"
      await deleteGroupIfEmptyAutoGroup(client, list.group_id);

      return { oldYear, targetYear, targetGroupId };
    });
  }

  /**
   * Reorder lists within a group.
   * @param {string} userId
   * @param {string} groupExternalId - The group's _id
   * @param {Array<string>} order - Array of list _ids in desired order
   */
  async function reorderLists(userId, groupExternalId, order) {
    if (!groupExternalId) {
      throw new TransactionAbort(400, { error: 'groupId is required' });
    }
    if (!Array.isArray(order)) {
      throw new TransactionAbort(400, {
        error: 'order must be an array of list IDs',
      });
    }

    await withTransaction(pool, async (client) => {
      const groupResult = await client.query(
        `SELECT id FROM list_groups WHERE _id = $1 AND user_id = $2`,
        [groupExternalId, userId]
      );

      if (groupResult.rows.length === 0) {
        throw new TransactionAbort(404, { error: 'Group not found' });
      }

      const dbGroupId = groupResult.rows[0].id;

      const listsResult = await client.query(
        `SELECT _id FROM lists WHERE user_id = $1 AND group_id = $2`,
        [userId, dbGroupId]
      );

      const groupListIds = new Set(listsResult.rows.map((r) => r._id));

      for (const listId of order) {
        if (!groupListIds.has(listId)) {
          throw new TransactionAbort(400, {
            error: `List '${listId}' is not in this group`,
          });
        }
      }

      for (let i = 0; i < order.length; i++) {
        await client.query(
          `UPDATE lists SET sort_order = $1, updated_at = NOW() WHERE _id = $2 AND user_id = $3`,
          [i, order[i], userId]
        );
      }
    });
  }

  return {
    getGroups,
    createGroup,
    updateGroup,
    deleteGroup,
    reorderGroups,
    moveList,
    reorderLists,
  };
}

module.exports = { createGroupService };
