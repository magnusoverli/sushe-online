const { reorderItems } = require('./write/reorder-items');
const {
  LOCK_NAMESPACES,
  acquireTransactionLocks,
} = require('../../db/advisory-locks');
const { prepareExplicitCovers } = require('./cover-preparation');

function preserveDisqualificationState(albums, existingItems) {
  const byItemId = new Map(existingItems.map((item) => [item._id, item]));
  const byAlbumId = new Map(existingItems.map((item) => [item.album_id, item]));
  return albums.map((album) => {
    if (Object.hasOwn(album, 'is_disqualified')) return album;
    const existing = byItemId.get(album._id) || byAlbumId.get(album.album_id);
    if (!existing) return album;
    return {
      ...album,
      is_disqualified: existing.is_disqualified === true,
      disqualification_reason: existing.disqualification_reason || null,
    };
  });
}

// eslint-disable-next-line max-lines-per-function -- Coordinates list creation and item mutations around one transactional dependency set
function createListWriteOperations(deps = {}) {
  const {
    db,
    TransactionAbort,
    crypto,
    managementOperations,
    itemOperations,
    triggerAlbumBackgroundFetches,
    findListByIdOrThrow,
    findOrCreateYearGroup,
    findOrCreateUncategorizedGroup,
    acquireYearLocks,
    validateMainListNotLocked,
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
  if (typeof acquireYearLocks !== 'function') {
    throw new Error('acquireYearLocks is required');
  }
  if (typeof validateMainListNotLocked !== 'function') {
    throw new Error('validateMainListNotLocked is required');
  }

  async function createList(
    userId,
    { name, groupId: requestGroupId, year, albums: rawAlbums, isMain = false }
  ) {
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new TransactionAbort(400, { error: 'List name is required' });
    }

    const trimmedName = name.trim();
    const listId = crypto.randomBytes(12).toString('hex');
    const timestamp = new Date();

    await prepareExplicitCovers(rawAlbums, TransactionAbort);

    let observationResult = { sourceObservationResults: [], warnings: [] };
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

      if (isMain && !resultYear) {
        throw new TransactionAbort(400, {
          error: 'A main list must be assigned to a year',
        });
      }
      if (isMain) {
        await acquireYearLocks(client, [resultYear]);
        await validateMainListNotLocked(
          client,
          resultYear,
          true,
          'create main list'
        );
      }

      await managementOperations.checkDuplicateListName(
        client,
        userId,
        trimmedName,
        groupIdInternal
      );

      await acquireTransactionLocks(client, LOCK_NAMESPACES.LISTS_GROUP, [
        groupIdInternal,
      ]);

      const maxListOrder = await client.query(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM lists WHERE group_id = $1`,
        [groupIdInternal]
      );

      if (isMain) {
        await client.query(
          `UPDATE lists SET is_main = FALSE, updated_at = NOW()
           WHERE user_id = $1
             AND id IN (
               SELECT l.id FROM lists l
               LEFT JOIN list_groups g ON l.group_id = g.id
               WHERE l.user_id = $1 AND (l.year = $2 OR g.year = $2)
             )`,
          [userId, resultYear]
        );
      }

      await client.query(
        `INSERT INTO lists (_id, user_id, name, year, group_id, is_main, sort_order, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          listId,
          userId,
          trimmedName,
          resultYear,
          groupIdInternal,
          isMain,
          maxListOrder.rows[0].next_order,
          timestamp,
          timestamp,
        ]
      );

      if (rawAlbums && Array.isArray(rawAlbums)) {
        observationResult = await itemOperations.insertListItems(
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
      isMain,
      albumCount: rawAlbums?.length || 0,
    });

    if (typeof triggerAlbumBackgroundFetches === 'function') {
      triggerAlbumBackgroundFetches(observationResult.backgroundItems);
    }

    return {
      listId,
      name: trimmedName,
      year: listYear,
      isMain,
      groupId: requestGroupId || null,
      count: rawAlbums?.length || 0,
      sourceObservationResults: observationResult.sourceObservationResults,
      warnings: observationResult.warnings,
    };
  }

  async function replaceListItems(listId, userId, rawAlbums) {
    const timestamp = new Date();
    let list;
    let observationResult = { sourceObservationResults: [], warnings: [] };

    await prepareExplicitCovers(rawAlbums, TransactionAbort);

    await db.withTransaction(async (client) => {
      list = await findListByIdOrThrow(
        listId,
        userId,
        'modify list items',
        client
      );

      await validateMainListNotLocked(
        client,
        list.year,
        list.is_main,
        'modify list items'
      );

      const existingResult = await client.query(
        `SELECT _id, album_id, is_disqualified, disqualification_reason
         FROM list_items
         WHERE list_id = $1`,
        [list._id]
      );
      const albums = preserveDisqualificationState(
        rawAlbums,
        existingResult.rows
      );

      await client.query('DELETE FROM list_items WHERE list_id = $1', [
        list._id,
      ]);

      observationResult = await itemOperations.insertListItems(
        client,
        list._id,
        albums,
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

    if (typeof triggerAlbumBackgroundFetches === 'function') {
      triggerAlbumBackgroundFetches(observationResult.backgroundItems);
    }

    return {
      list,
      count: rawAlbums.length,
      sourceObservationResults: observationResult.sourceObservationResults,
      warnings: observationResult.warnings,
    };
  }

  async function incrementalUpdate(
    listId,
    userId,
    { added, removed, updated },
    user
  ) {
    const timestamp = new Date();
    let changeCount = 0;
    const addedItems = [];
    const duplicateAlbums = [];
    const sourceObservationResults = [];
    const warnings = [];
    const backgroundItems = [];
    let list;

    await prepareExplicitCovers(added, TransactionAbort);

    await db.withTransaction(async (client) => {
      list = await findListByIdOrThrow(
        listId,
        userId,
        'modify list items',
        client
      );

      await validateMainListNotLocked(
        client,
        list.year,
        list.is_main,
        'modify list items'
      );

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
      sourceObservationResults.push(...addResult.sourceObservationResults);
      warnings.push(...addResult.warnings);
      backgroundItems.push(...addResult.backgroundItems);
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

    if (typeof triggerAlbumBackgroundFetches === 'function') {
      triggerAlbumBackgroundFetches(backgroundItems);
    }

    itemOperations.triggerPlaycountRefresh(user, addedItems);

    return {
      list,
      changeCount,
      addedItems,
      duplicateAlbums,
      sourceObservationResults,
      warnings,
    };
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
  preserveDisqualificationState,
};
