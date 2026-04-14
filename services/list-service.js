const logger = require('../utils/logger');
const { withTransaction, TransactionAbort } = require('../db/transaction');
const { buildPartialUpdate } = require('../utils/query-builder');
const { createItemComments } = require('./list/item-comments');
const { createListFetchers } = require('./list/fetchers');
const { createListItemOperations } = require('./list/item-operations');
const {
  createListManagementOperations,
} = require('./list/management-operations');
const { createSetupStatus } = require('./list/setup-status');
const {
  validateYearNotLocked,
  validateMainListNotLocked,
  isYearLocked,
} = require('../utils/year-lock');

// eslint-disable-next-line max-lines-per-function
function createListService(deps = {}) {
  const pool = deps.pool;
  if (!pool) {
    throw new Error('PostgreSQL pool is required for ListService');
  }

  const log = deps.logger || logger;
  const { listsAsync, listItemsAsync, crypto, validateYear, helpers } = deps;
  const { getPointsForPosition, refreshPlaycountsInBackground } = deps;

  const {
    findOrCreateYearGroup,
    findOrCreateUncategorizedGroup,
    deleteGroupIfEmptyAutoGroup,
  } = helpers;

  async function fetchRecommendationMaps(years, context = {}) {
    const result = new Map();
    if (!years || years.length === 0) return result;

    try {
      const recResult = await pool.query(
        `SELECT r.year, r.album_id, r.created_at, u.username as recommended_by
         FROM recommendations r
         JOIN users u ON r.recommended_by = u._id
         WHERE r.year = ANY($1::int[])`,
        [years]
      );
      for (const row of recResult.rows) {
        if (!result.has(row.year)) {
          result.set(row.year, new Map());
        }
        result.get(row.year).set(row.album_id, {
          recommendedBy: row.recommended_by,
          recommendedAt: row.created_at,
        });
      }
    } catch (err) {
      log.warn('Failed to fetch recommendations for cross-reference', {
        ...context,
        years,
        error: err.message,
      });
    }

    return result;
  }

  async function findListById(listId, userId) {
    const result = await pool.query(
      `SELECT l.*, g._id as group_external_id, g.name as group_name, g.year as group_year
       FROM lists l
       LEFT JOIN list_groups g ON l.group_id = g.id
       WHERE l._id = $1 AND l.user_id = $2`,
      [listId, userId]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      _id: row._id,
      userId: row.user_id,
      name: row.name,
      year: row.year,
      isMain: row.is_main,
      groupId: row.group_id,
      groupExternalId: row.group_external_id,
      groupName: row.group_name,
      groupYear: row.group_year,
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async function findListByIdOrThrow(listId, userId, action) {
    const list = await findListById(listId, userId);
    if (!list) {
      throw new TransactionAbort(404, { error: 'List not found' });
    }
    await validateMainListNotLocked(pool, list.year, list.isMain, action);
    return list;
  }

  const { updateItemCommentField } = createItemComments({
    pool,
    withTransaction,
    TransactionAbort,
    findListByIdOrThrow,
    logger: log,
  });

  const itemOperations = createListItemOperations({
    pool,
    crypto,
    upsertAlbumRecord: helpers.upsertAlbumRecord,
    batchUpsertAlbumRecords: helpers.batchUpsertAlbumRecords,
    refreshPlaycountsInBackground,
    logger: log,
  });

  const listFetchers = createListFetchers({
    listsAsync,
    listItemsAsync,
    fetchRecommendationMaps,
    findListById,
    getPointsForPosition,
  });
  const managementOperations = createListManagementOperations({
    pool,
    withTransaction,
    TransactionAbort,
    validateYear,
    validateMainListNotLocked,
    validateYearNotLocked,
    isYearLocked,
    buildPartialUpdate,
    deleteGroupIfEmptyAutoGroup,
  });
  const setupStatus = createSetupStatus({ pool });

  async function getAllLists(userId, { full = false } = {}) {
    return listFetchers.getAllLists(userId, { full });
  }

  async function getListById(listId, userId, { isExport = false } = {}) {
    return listFetchers.getListByIdWithItems(listId, userId, { isExport });
  }

  async function getSetupStatus(userId, user) {
    return setupStatus.getSetupStatus(userId, user);
  }

  async function bulkUpdate(userId, updates) {
    return managementOperations.bulkUpdate(userId, updates);
  }

  async function dismissSetup(userId) {
    const dismissedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await pool.query(
      `UPDATE users SET list_setup_dismissed_until = $1 WHERE _id = $2`,
      [dismissedUntil, userId]
    );
    return dismissedUntil;
  }

  async function createList(
    userId,
    { name, groupId: requestGroupId, year, albums: rawAlbums }
  ) {
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new TransactionAbort(400, { error: 'List name is required' });
    }

    const trimmedName = name.trim();
    const listId = crypto.randomBytes(12).toString('hex');
    const timestamp = new Date();

    const listYear = await withTransaction(pool, async (client) => {
      let resultYear = null;
      let groupIdInternal;

      if (requestGroupId) {
        const groupResult = await client.query(
          `SELECT id, year FROM list_groups WHERE _id = $1 AND user_id = $2`,
          [requestGroupId, userId]
        );
        if (groupResult.rows.length === 0) {
          throw new TransactionAbort(400, { error: 'Invalid group' });
        }
        groupIdInternal = groupResult.rows[0].id;
        resultYear = groupResult.rows[0].year;
      } else if (year !== undefined && year !== null) {
        const yearGroup = await findOrCreateYearGroup(client, userId, year);
        groupIdInternal = yearGroup.groupId;
        resultYear = yearGroup.year;
      } else {
        groupIdInternal = await findOrCreateUncategorizedGroup(client, userId);
      }

      await managementOperations.checkDuplicateListName(
        client,
        userId,
        trimmedName,
        groupIdInternal
      );

      const maxListOrder = await client.query(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM lists WHERE group_id = $1`,
        [groupIdInternal]
      );

      await client.query(
        `INSERT INTO lists (_id, user_id, name, year, group_id, is_main, sort_order, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, FALSE, $6, $7, $8)`,
        [
          listId,
          userId,
          trimmedName,
          resultYear,
          groupIdInternal,
          maxListOrder.rows[0].next_order,
          timestamp,
          timestamp,
        ]
      );

      if (rawAlbums && Array.isArray(rawAlbums)) {
        await itemOperations.insertListItems(
          client,
          listId,
          rawAlbums,
          timestamp
        );
      }

      return resultYear;
    });

    log.info('List created', {
      userId,
      listId,
      listName: trimmedName,
      year: listYear,
      albumCount: rawAlbums?.length || 0,
    });

    return {
      listId,
      name: trimmedName,
      year: listYear,
      groupId: requestGroupId || null,
      count: rawAlbums?.length || 0,
    };
  }

  async function updateListMetadata(
    listId,
    userId,
    { name: newName, year, groupId: newGroupId }
  ) {
    return managementOperations.updateListMetadata(listId, userId, {
      name: newName,
      year,
      groupId: newGroupId,
    });
  }

  async function replaceListItems(listId, userId, rawAlbums) {
    const list = await findListByIdOrThrow(listId, userId, 'modify list items');
    const timestamp = new Date();

    await withTransaction(pool, async (client) => {
      await client.query('DELETE FROM list_items WHERE list_id = $1', [
        list._id,
      ]);

      await itemOperations.insertListItems(
        client,
        list._id,
        rawAlbums,
        timestamp
      );

      await client.query('UPDATE lists SET updated_at = $1 WHERE _id = $2', [
        timestamp,
        list._id,
      ]);
    });

    log.info('List items replaced', {
      userId,
      listId,
      listName: list.name,
      albumCount: rawAlbums.length,
    });

    return { list, count: rawAlbums.length };
  }

  async function reorderItems(listId, userId, order) {
    if (!Array.isArray(order)) {
      throw new TransactionAbort(400, { error: 'Invalid order array' });
    }

    const list = await findListByIdOrThrow(
      listId,
      userId,
      'reorder list items'
    );

    let effectivePos = 0;

    await withTransaction(pool, async (client) => {
      const now = new Date();

      const listItemsResult = await client.query(
        'SELECT _id, album_id FROM list_items WHERE list_id = $1',
        [list._id]
      );
      const listItems = listItemsResult.rows;

      if (listItems.length === 0) {
        if (order.length > 0) {
          throw new TransactionAbort(400, {
            error: 'Order must be empty for a list with no items',
          });
        }
        effectivePos = 0;
        return;
      }

      const itemIdsByAlbumId = new Map();
      const validItemIds = new Set();
      for (const item of listItems) {
        validItemIds.add(item._id);
        if (item.album_id) {
          itemIdsByAlbumId.set(item.album_id, item._id);
        }
      }

      const orderedItemIds = [];
      for (const entry of order) {
        if (typeof entry === 'string') {
          const resolvedItemId = itemIdsByAlbumId.get(entry);
          if (!resolvedItemId) {
            throw new TransactionAbort(400, {
              error: `Album '${entry}' is not in this list`,
            });
          }
          orderedItemIds.push(resolvedItemId);
          continue;
        }

        if (entry && typeof entry === 'object' && entry._id) {
          if (!validItemIds.has(entry._id)) {
            throw new TransactionAbort(400, {
              error: `Item '${entry._id}' is not in this list`,
            });
          }
          orderedItemIds.push(entry._id);
          continue;
        }

        throw new TransactionAbort(400, {
          error: 'Order contains invalid entries',
        });
      }

      if (new Set(orderedItemIds).size !== orderedItemIds.length) {
        throw new TransactionAbort(400, {
          error: 'Order cannot contain duplicate entries',
        });
      }

      if (orderedItemIds.length !== listItems.length) {
        throw new TransactionAbort(400, {
          error: 'Order must include all list items exactly once',
        });
      }

      const positionValues = orderedItemIds.map((_, index) => index + 1);
      await client.query(
        `UPDATE list_items
         SET position = t.position, updated_at = $1
         FROM UNNEST($2::text[], $3::int[]) AS t(item_id, position)
         WHERE list_items._id = t.item_id AND list_items.list_id = $4`,
        [now, orderedItemIds, positionValues, list._id]
      );

      effectivePos = orderedItemIds.length;
    });

    log.info('List reordered', {
      userId,
      listId,
      listName: list.name,
      itemCount: effectivePos,
    });

    return { list, itemCount: effectivePos };
  }

  async function updateItemComment(listId, userId, identifier, comment) {
    await updateItemCommentField(
      listId,
      userId,
      identifier,
      comment,
      'comments'
    );
  }

  async function updateItemComment2(listId, userId, identifier, comment) {
    await updateItemCommentField(
      listId,
      userId,
      identifier,
      comment,
      'comments_2'
    );
  }

  async function incrementalUpdate(
    listId,
    userId,
    { added, removed, updated },
    user
  ) {
    const list = await findListByIdOrThrow(listId, userId, 'modify list items');

    const timestamp = new Date();
    let changeCount = 0;
    const addedItems = [];
    const duplicateAlbums = [];

    await withTransaction(pool, async (client) => {
      changeCount += await itemOperations.processRemovals(
        client,
        list._id,
        removed
      );

      const addResult = await itemOperations.processAdditions(
        client,
        list,
        added,
        timestamp
      );
      addedItems.push(...addResult.addedItems);
      duplicateAlbums.push(...addResult.duplicateAlbums);
      changeCount += addResult.changeCount;

      changeCount += await itemOperations.processPositionUpdates(
        client,
        list._id,
        updated,
        timestamp
      );

      await client.query('UPDATE lists SET updated_at = $1 WHERE _id = $2', [
        timestamp,
        list._id,
      ]);
    });

    log.info('List incrementally updated', {
      userId,
      listId,
      listName: list.name,
      added: added?.length || 0,
      removed: removed?.length || 0,
      updated: updated?.length || 0,
      totalChanges: changeCount,
      duplicates: duplicateAlbums?.length || 0,
    });

    // Trigger async playcount refresh for newly added albums
    itemOperations.triggerPlaycountRefresh(user, addedItems);

    return { list, changeCount, addedItems, duplicateAlbums };
  }

  async function toggleMainStatus(listId, userId, isMain) {
    return managementOperations.toggleMainStatus(listId, userId, isMain);
  }

  async function deleteList(listId, userId) {
    return managementOperations.deleteList(listId, userId);
  }

  return {
    findListById,
    getAllLists,
    getListById,
    getSetupStatus,
    bulkUpdate,
    dismissSetup,
    createList,
    updateListMetadata,
    replaceListItems,
    reorderItems,
    updateItemComment,
    updateItemComment2,
    incrementalUpdate,
    toggleMainStatus,
    deleteList,
  };
}

module.exports = { createListService };
