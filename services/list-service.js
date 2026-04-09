const logger = require('../utils/logger');
const { withTransaction, TransactionAbort } = require('../db/transaction');
const { buildPartialUpdate } = require('../utils/query-builder');
const { createItemComments } = require('./list/item-comments');
const { createListFetchers } = require('./list/fetchers');
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
    upsertAlbumRecord,
    batchUpsertAlbumRecords,
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

  async function insertListItems(client, listId, albums, timestamp) {
    for (let i = 0; i < albums.length; i++) {
      const album = albums[i];
      const albumId = await upsertAlbumRecord(album, timestamp, client);

      const itemId = crypto.randomBytes(12).toString('hex');
      await client.query(
        `INSERT INTO list_items (
          _id, list_id, album_id, position, comments, comments_2, primary_track, secondary_track, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          itemId,
          listId,
          albumId,
          i + 1,
          album.comments || null,
          album.comments_2 || null,
          album.primary_track || null,
          album.secondary_track || null,
          timestamp,
          timestamp,
        ]
      );
    }
  }

  async function checkDuplicateListName(
    client,
    userId,
    name,
    groupId,
    excludeListId
  ) {
    const params = [userId, name, groupId];
    let query =
      'SELECT 1 FROM lists WHERE user_id = $1 AND name = $2 AND group_id = $3';
    if (excludeListId) {
      query += ' AND _id != $4';
      params.push(excludeListId);
    }
    const duplicateCheck = await client.query(query, params);
    if (duplicateCheck.rows.length > 0) {
      throw new TransactionAbort(409, {
        error: 'A list with this name already exists in this category',
      });
    }
  }

  async function processRemovals(client, listId, removed) {
    if (!removed || !Array.isArray(removed)) return 0;
    const validIds = removed.filter(Boolean);
    if (validIds.length === 0) return 0;
    const result = await client.query(
      'DELETE FROM list_items WHERE list_id = $1 AND album_id = ANY($2::text[])',
      [listId, validIds]
    );
    return result.rowCount;
  }

  async function processAdditions(client, list, added, timestamp) {
    const addedItems = [];
    const duplicateAlbums = [];
    let changeCount = 0;

    if (!added || !Array.isArray(added) || added.length === 0) {
      return { addedItems, duplicateAlbums, changeCount };
    }

    // Get current max position to auto-append new items at the end
    const maxPosResult = await client.query(
      'SELECT COALESCE(MAX(position), 0) as max_pos FROM list_items WHERE list_id = $1',
      [list._id]
    );
    let nextPosition = maxPosResult.rows[0].max_pos + 1;

    // Filter out empty items
    const validItems = added.filter((item) => item);
    if (validItems.length === 0) {
      return { addedItems, duplicateAlbums, changeCount };
    }

    // Use batch operations for all items (1 or more)
    const upsertResults = await batchUpsertAlbumRecords(
      validItems,
      timestamp,
      client
    );

    // Build array of album IDs for duplicate check
    const albumIds = Array.from(upsertResults.values()).map((r) => r.albumId);

    // Batch check for duplicates using ANY
    const duplicateCheck = await client.query(
      `SELECT album_id, _id FROM list_items 
       WHERE list_id = $1 AND album_id = ANY($2::text[])`,
      [list._id, albumIds]
    );

    const duplicateSet = new Set(duplicateCheck.rows.map((r) => r.album_id));

    // Prepare batch insert for non-duplicate items
    const itemsToInsert = [];
    validItems.forEach((item) => {
      const key = `${item.artist}|${item.album}`;
      const upsertResult = upsertResults.get(key);

      if (!upsertResult) {
        log.warn('Album not found in upsert results', {
          artist: item.artist,
          album: item.album,
        });
        return;
      }

      if (duplicateSet.has(upsertResult.albumId)) {
        duplicateAlbums.push({
          album_id: upsertResult.albumId,
          artist: item.artist || '',
          album: item.album || '',
        });
      } else {
        const itemId = crypto.randomBytes(12).toString('hex');
        const position =
          item.position !== undefined && item.position !== null
            ? item.position
            : nextPosition++;

        itemsToInsert.push({
          _id: itemId,
          album_id: upsertResult.albumId,
          position,
          comments: item.comments || null,
          comments_2: item.comments_2 || null,
          primary_track: item.primary_track || null,
          secondary_track: item.secondary_track || null,
        });

        addedItems.push({
          album_id: upsertResult.albumId,
          _id: itemId,
        });
      }
    });

    // Batch insert all list items if any
    if (itemsToInsert.length > 0) {
      const itemIds = itemsToInsert.map((i) => i._id);
      const listIds = itemsToInsert.map(() => list._id);
      const albumIdsToInsert = itemsToInsert.map((i) => i.album_id);
      const positions = itemsToInsert.map((i) => i.position);
      const comments = itemsToInsert.map((i) => i.comments);
      const comments2 = itemsToInsert.map((i) => i.comments_2);
      const primaryTracks = itemsToInsert.map((i) => i.primary_track);
      const secondaryTracks = itemsToInsert.map((i) => i.secondary_track);
      const createdAts = itemsToInsert.map(() => timestamp);
      const updatedAts = itemsToInsert.map(() => timestamp);

      await client.query(
        `INSERT INTO list_items (
          _id, list_id, album_id, position, comments, comments_2, primary_track, secondary_track, 
          created_at, updated_at
        )
        SELECT * FROM UNNEST(
          $1::text[], $2::text[], $3::text[], $4::int[], $5::text[], $6::text[],
          $7::text[], $8::text[], $9::timestamptz[], $10::timestamptz[]
        ) AS t(_id, list_id, album_id, position, comments, comments_2, primary_track, secondary_track, created_at, updated_at)`,
        [
          itemIds,
          listIds,
          albumIdsToInsert,
          positions,
          comments,
          comments2,
          primaryTracks,
          secondaryTracks,
          createdAts,
          updatedAts,
        ]
      );

      changeCount += itemsToInsert.length;

      log.debug('Batch insert list items', {
        listId: list._id,
        count: itemsToInsert.length,
      });
    }

    return { addedItems, duplicateAlbums, changeCount };
  }

  async function processPositionUpdates(client, listId, updated, timestamp) {
    if (!updated || !Array.isArray(updated)) return 0;
    const validItems = updated.filter((item) => item && item.album_id);
    if (validItems.length === 0) return 0;
    const albumIds = validItems.map((i) => i.album_id);
    const positions = validItems.map((i) => i.position);
    const result = await client.query(
      `UPDATE list_items SET position = t.position, updated_at = $1
       FROM UNNEST($2::text[], $3::int[]) AS t(album_id, position)
       WHERE list_items.list_id = $4 AND list_items.album_id = t.album_id`,
      [timestamp, albumIds, positions, listId]
    );
    return result.rowCount;
  }

  function triggerPlaycountRefresh(user, addedItems) {
    if (
      addedItems.length === 0 ||
      !user.lastfmUsername ||
      !refreshPlaycountsInBackground
    )
      return;

    const albumIds = addedItems.map((item) => item.album_id);
    pool
      .query(
        `SELECT album_id, artist, album FROM albums WHERE album_id = ANY($1::text[])`,
        [albumIds]
      )
      .then((result) => {
        if (result.rows.length > 0) {
          const albumsToRefresh = result.rows.map((album) => ({
            itemId: album.album_id,
            artist: album.artist,
            album: album.album,
            albumId: album.album_id,
          }));

          log.debug('Triggering playcount refresh for added albums', {
            userId: user._id,
            albumCount: albumsToRefresh.length,
          });

          refreshPlaycountsInBackground(
            user._id,
            user.lastfmUsername,
            albumsToRefresh,
            pool,
            log
          ).catch((err) => {
            log.warn('Playcount refresh for added albums failed', {
              error: err.message,
            });
          });
        }
      })
      .catch((err) => {
        log.warn('Failed to look up albums for playcount refresh', {
          error: err.message,
        });
      });
  }

  const listFetchers = createListFetchers({
    listsAsync,
    listItemsAsync,
    fetchRecommendationMaps,
    findListById,
    getPointsForPosition,
    logger: log,
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
    const results = [];
    const yearsToRecompute = new Set();

    await withTransaction(pool, async (client) => {
      for (const update of updates) {
        const { listId, year, isMain: updateIsMain } = update;

        if (!listId) {
          results.push({ listId, success: false, error: 'Missing listId' });
          continue;
        }

        const listCheck = await client.query(
          'SELECT _id, year, is_main FROM lists WHERE _id = $1 AND user_id = $2',
          [listId, userId]
        );

        if (listCheck.rows.length === 0) {
          results.push({ listId, success: false, error: 'List not found' });
          continue;
        }

        const oldList = listCheck.rows[0];
        const oldYear = oldList.year;
        const newYear = year !== undefined ? year : oldList.year;
        const newIsMain =
          updateIsMain !== undefined ? updateIsMain : oldList.is_main;

        if (newYear !== null && (newYear < 1000 || newYear > 9999)) {
          results.push({ listId, success: false, error: 'Invalid year' });
          continue;
        }

        // Check year lock rules for main list changes
        const effectiveYear = newYear || oldYear;
        if (effectiveYear) {
          const yearLocked = await isYearLocked(pool, effectiveYear);
          if (yearLocked) {
            if (
              updateIsMain !== undefined &&
              updateIsMain !== oldList.is_main
            ) {
              results.push({
                listId,
                success: false,
                error: `Cannot change main status: Year ${effectiveYear} is locked`,
              });
              continue;
            }
            if (oldList.is_main) {
              results.push({
                listId,
                success: false,
                error: `Cannot update main list: Year ${effectiveYear} is locked`,
              });
              continue;
            }
          }
        }

        if (newIsMain && newYear !== null) {
          await client.query(
            `UPDATE lists SET is_main = FALSE, updated_at = NOW() 
             WHERE user_id = $1 AND year = $2 AND is_main = TRUE AND _id != $3`,
            [userId, newYear, listId]
          );
        }

        await client.query(
          `UPDATE lists SET year = $1, is_main = $2, updated_at = NOW() WHERE _id = $3`,
          [newYear, newIsMain, listId]
        );

        results.push({ listId, success: true });

        if (oldYear !== null) yearsToRecompute.add(oldYear);
        if (newYear !== null && newIsMain) yearsToRecompute.add(newYear);
      }
    });

    return { results, yearsToRecompute };
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

      await checkDuplicateListName(
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
        await insertListItems(client, listId, rawAlbums, timestamp);
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
    return withTransaction(pool, async (client) => {
      const listResult = await client.query(
        `SELECT l.id, l._id, l.name, l.year, l.group_id, l.is_main, g.year as group_year
         FROM lists l
         LEFT JOIN list_groups g ON l.group_id = g.id
         WHERE l._id = $1 AND l.user_id = $2`,
        [listId, userId]
      );

      if (listResult.rows.length === 0) {
        throw new TransactionAbort(404, { error: 'List not found' });
      }

      const list = listResult.rows[0];
      const fields = [];

      let targetGroupId = list.group_id;
      let targetYear = list.year;

      if (newGroupId !== undefined) {
        if (newGroupId === null) {
          throw new TransactionAbort(400, {
            error: 'Lists must belong to a category',
          });
        }

        const groupResult = await client.query(
          `SELECT id, year FROM list_groups WHERE _id = $1 AND user_id = $2`,
          [newGroupId, userId]
        );

        if (groupResult.rows.length === 0) {
          throw new TransactionAbort(400, { error: 'Invalid group' });
        }

        targetGroupId = groupResult.rows[0].id;
        targetYear = groupResult.rows[0].year;

        fields.push({ column: 'group_id', value: targetGroupId });
        fields.push({ column: 'year', value: targetYear });
      } else if (year !== undefined) {
        const yearValidation = validateYear(year);
        if (year !== null && !yearValidation.valid) {
          throw new TransactionAbort(400, { error: yearValidation.error });
        }
        targetYear = year === null ? null : yearValidation.value;

        fields.push({ column: 'year', value: targetYear });
      }

      try {
        await validateMainListNotLocked(
          pool,
          list.year,
          list.is_main,
          'update list'
        );
        if (targetYear !== list.year) {
          await validateMainListNotLocked(
            pool,
            targetYear,
            list.is_main,
            'update list'
          );
        }
      } catch (lockErr) {
        throw new TransactionAbort(403, {
          error: lockErr.body?.error || lockErr.message,
          yearLocked: true,
        });
      }

      if (newName !== undefined) {
        if (typeof newName !== 'string' || newName.trim().length === 0) {
          throw new TransactionAbort(400, {
            error: 'List name cannot be empty',
          });
        }

        const trimmedName = newName.trim();

        if (trimmedName !== list.name) {
          await checkDuplicateListName(
            client,
            userId,
            trimmedName,
            targetGroupId,
            listId
          );
        }

        fields.push({ column: 'name', value: newName.trim() });
      }

      if (fields.length === 0) {
        throw new TransactionAbort(400, { error: 'No updates provided' });
      }

      const update = buildPartialUpdate('lists', 'id', list.id, fields);
      await client.query(update.query, update.values);

      return {
        list: {
          _id: list._id,
          name: list.name,
          year: list.year,
          is_main: list.is_main,
        },
        targetYear,
      };
    });
  }

  async function replaceListItems(listId, userId, rawAlbums) {
    const list = await findListByIdOrThrow(listId, userId, 'modify list items');
    const timestamp = new Date();

    await withTransaction(pool, async (client) => {
      await client.query('DELETE FROM list_items WHERE list_id = $1', [
        list._id,
      ]);

      await insertListItems(client, list._id, rawAlbums, timestamp);

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
      changeCount += await processRemovals(client, list._id, removed);

      const addResult = await processAdditions(client, list, added, timestamp);
      addedItems.push(...addResult.addedItems);
      duplicateAlbums.push(...addResult.duplicateAlbums);
      changeCount += addResult.changeCount;

      changeCount += await processPositionUpdates(
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
    triggerPlaycountRefresh(user, addedItems);

    return { list, changeCount, addedItems, duplicateAlbums };
  }

  async function toggleMainStatus(listId, userId, isMain) {
    return withTransaction(pool, async (client) => {
      const listResult = await client.query(
        `SELECT l.id, l._id, l.name, l.year, l.is_main, g.year as group_year
         FROM lists l
         LEFT JOIN list_groups g ON l.group_id = g.id
         WHERE l._id = $1 AND l.user_id = $2`,
        [listId, userId]
      );

      if (listResult.rows.length === 0) {
        throw new TransactionAbort(404, { error: 'List not found' });
      }

      const list = listResult.rows[0];
      const listYear = list.year || list.group_year;

      try {
        await validateYearNotLocked(pool, listYear, 'change main status');
      } catch (lockErr) {
        throw new TransactionAbort(403, {
          error: lockErr.body?.error || lockErr.message,
          yearLocked: true,
          year: listYear,
        });
      }

      if (isMain === false) {
        await client.query(
          `UPDATE lists SET is_main = FALSE, updated_at = NOW() WHERE id = $1`,
          [list.id]
        );
        return { list, year: listYear, isRemoval: true };
      }

      if (!listYear) {
        throw new TransactionAbort(400, {
          error: 'List must be assigned to a year to be marked as main',
        });
      }

      const previousMainResult = await client.query(
        `SELECT l._id, l.name FROM lists l
         LEFT JOIN list_groups g ON l.group_id = g.id
         WHERE l.user_id = $1 
           AND (l.year = $2 OR g.year = $2)
           AND l.is_main = TRUE
           AND l._id != $3`,
        [userId, listYear, listId]
      );

      await client.query(
        `UPDATE lists SET is_main = FALSE, updated_at = NOW() 
         WHERE user_id = $1 
           AND id IN (
             SELECT l.id FROM lists l
             LEFT JOIN list_groups g ON l.group_id = g.id
             WHERE l.user_id = $1 AND (l.year = $2 OR g.year = $2)
           )`,
        [userId, listYear]
      );

      await client.query(
        `UPDATE lists SET is_main = TRUE, updated_at = NOW() 
         WHERE id = $1`,
        [list.id]
      );

      return {
        list,
        year: listYear,
        isRemoval: false,
        previousMainResult: previousMainResult.rows,
      };
    });
  }

  async function deleteList(listId, userId) {
    return withTransaction(pool, async (client) => {
      const listResult = await client.query(
        `SELECT id, _id, name, year, group_id, is_main FROM lists WHERE _id = $1 AND user_id = $2`,
        [listId, userId]
      );

      if (listResult.rows.length === 0) {
        throw new TransactionAbort(404, { error: 'List not found' });
      }

      const foundList = listResult.rows[0];

      if (foundList.is_main) {
        throw new TransactionAbort(403, {
          error: 'Cannot delete main list. Unset main status first.',
        });
      }

      await client.query('DELETE FROM list_items WHERE list_id = $1', [
        foundList._id,
      ]);

      await client.query('DELETE FROM lists WHERE id = $1', [foundList.id]);

      await deleteGroupIfEmptyAutoGroup(client, foundList.group_id);

      return foundList;
    });
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
