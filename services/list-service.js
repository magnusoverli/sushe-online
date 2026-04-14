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
const { createListWriteOperations } = require('./list/write-operations');
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
  const writeOperations = createListWriteOperations({
    pool,
    withTransaction,
    TransactionAbort,
    crypto,
    managementOperations,
    itemOperations,
    findListByIdOrThrow,
    findOrCreateYearGroup,
    findOrCreateUncategorizedGroup,
    logger: log,
  });

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
    return writeOperations.createList(userId, {
      name,
      groupId: requestGroupId,
      year,
      albums: rawAlbums,
    });
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
    return writeOperations.replaceListItems(listId, userId, rawAlbums);
  }

  async function reorderItems(listId, userId, order) {
    return writeOperations.reorderItems(listId, userId, order);
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
    return writeOperations.incrementalUpdate(
      listId,
      userId,
      { added, removed, updated },
      user
    );
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
