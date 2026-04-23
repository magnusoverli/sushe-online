const { reorderItems } = require('./write/reorder-items');

function createListWriteOperations(deps = {}) {
  const {
    db,
    TransactionAbort,
    crypto,
    managementOperations,
    itemOperations,
    findListByIdOrThrow,
    findOrCreateYearGroup,
    findOrCreateUncategorizedGroup,
    logger,
  } = deps;

  if (!db) throw new Error('db is required');
  if (!TransactionAbort) throw new Error('TransactionAbort is required');
  if (!crypto) throw new Error('crypto is required');
  if (!managementOperations)
    throw new Error('managementOperations is required');
  if (!itemOperations) throw new Error('itemOperations is required');
  if (typeof findListByIdOrThrow !== 'function') {
    throw new Error('findListByIdOrThrow is required');
  }
  if (typeof findOrCreateYearGroup !== 'function') {
    throw new Error('findOrCreateYearGroup is required');
  }
  if (typeof findOrCreateUncategorizedGroup !== 'function') {
    throw new Error('findOrCreateUncategorizedGroup is required');
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

    const listYear = await db.withTransaction(async (client) => {
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

    logger?.info('List created', {
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

  async function replaceListItems(listId, userId, rawAlbums) {
    const list = await findListByIdOrThrow(listId, userId, 'modify list items');
    const timestamp = new Date();

    await db.withTransaction(async (client) => {
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

    logger?.info('List items replaced', {
      userId,
      listId,
      listName: list.name,
      albumCount: rawAlbums.length,
    });

    return { list, count: rawAlbums.length };
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

    await db.withTransaction(async (client) => {
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

    logger?.info('List incrementally updated', {
      userId,
      listId,
      listName: list.name,
      added: added?.length || 0,
      removed: removed?.length || 0,
      updated: updated?.length || 0,
      totalChanges: changeCount,
      duplicates: duplicateAlbums?.length || 0,
    });

    itemOperations.triggerPlaycountRefresh(user, addedItems);

    return { list, changeCount, addedItems, duplicateAlbums };
  }

  return {
    createList,
    replaceListItems,
    reorderItems: (listId, userId, order) =>
      reorderItems(
        {
          db,
          TransactionAbort,
          findListByIdOrThrow,
          logger,
        },
        listId,
        userId,
        order
      ),
    incrementalUpdate,
  };
}

module.exports = {
  createListWriteOperations,
};
