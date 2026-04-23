const {
  checkDuplicateListName,
} = require('./management/check-duplicate-list-name');
const { bulkUpdate } = require('./management/bulk-update');
const { updateListMetadata } = require('./management/update-list-metadata');
const { toggleMainStatus, deleteList } = require('./management/main-status');

function createListManagementOperations(deps = {}) {
  const ctx = {
    db: deps.db,
    TransactionAbort: deps.TransactionAbort,
    validateYear: deps.validateYear,
    validateMainListNotLocked: deps.validateMainListNotLocked,
    validateYearNotLocked: deps.validateYearNotLocked,
    isYearLocked: deps.isYearLocked,
    buildPartialUpdate: deps.buildPartialUpdate,
    deleteGroupIfEmptyAutoGroup: deps.deleteGroupIfEmptyAutoGroup,
  };

  if (!ctx.db) throw new Error('db is required');
  if (!ctx.TransactionAbort) throw new Error('TransactionAbort is required');
  if (typeof ctx.validateYear !== 'function') {
    throw new Error('validateYear is required');
  }
  if (typeof ctx.validateMainListNotLocked !== 'function') {
    throw new Error('validateMainListNotLocked is required');
  }
  if (typeof ctx.validateYearNotLocked !== 'function') {
    throw new Error('validateYearNotLocked is required');
  }
  if (typeof ctx.isYearLocked !== 'function') {
    throw new Error('isYearLocked is required');
  }
  if (typeof ctx.buildPartialUpdate !== 'function') {
    throw new Error('buildPartialUpdate is required');
  }
  if (typeof ctx.deleteGroupIfEmptyAutoGroup !== 'function') {
    throw new Error('deleteGroupIfEmptyAutoGroup is required');
  }

  return {
    checkDuplicateListName: (client, userId, name, groupId, excludeListId) =>
      checkDuplicateListName(
        client,
        ctx.TransactionAbort,
        userId,
        name,
        groupId,
        excludeListId
      ),
    bulkUpdate: (userId, updates) => bulkUpdate(ctx, userId, updates),
    updateListMetadata: (listId, userId, updates) =>
      updateListMetadata(ctx, listId, userId, updates),
    toggleMainStatus: (listId, userId, isMain) =>
      toggleMainStatus(ctx, listId, userId, isMain),
    deleteList: (listId, userId) => deleteList(ctx, listId, userId),
  };
}

module.exports = {
  createListManagementOperations,
};
