/**
 * List Service
 *
 * Owns all list-related business logic:
 * - CRUD operations for lists
 * - Item management (add, remove, reorder, comments)
 * - Main list status toggling with mutual exclusion
 * - Setup wizard (status check, bulk update, dismiss)
 * - Group resolution (year groups, uncategorized)
 * - Year-lock validation
 *
 * This service encapsulates database access and business rules,
 * keeping route handlers thin (request parsing + response formatting).
 */

const logger = require('../utils/logger');
const { withTransaction, TransactionAbort } = require('../db/transaction');
const { buildPartialUpdate } = require('../routes/api/_helpers');
const {
  validateYearNotLocked,
  validateMainListNotLocked,
  isYearLocked,
} = require('../utils/year-lock');

// ============================================
// FACTORY
// ============================================

/**
 * Create a list service instance with injected dependencies.
 * @param {Object} deps - Dependencies
 * @param {Object} deps.pool - PostgreSQL connection pool (required)
 * @param {Object} [deps.logger] - Logger instance
 * @param {Object} deps.listsAsync - Async lists datastore
 * @param {Object} deps.listItemsAsync - Async list items datastore
 * @param {Object} deps.crypto - Node.js crypto module
 * @param {Function} deps.validateYear - Year validation function
 * @param {Object} deps.helpers - Shared route helpers (upsertAlbumRecord, etc.)
 * @param {Function} deps.getPointsForPosition - Scoring function
 * @param {Function} [deps.refreshPlaycountsInBackground] - Playcount refresh function
 * @returns {Object} List service methods
 */
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

  // ============================================
  // INTERNAL HELPERS
  // ============================================

  /**
   * Find a list by ID and verify ownership.
   * @param {string} listId - The list _id
   * @param {string} userId - The user _id
   * @returns {Object|null} The list or null if not found/unauthorized
   */
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

  /**
   * Process item removals from a list.
   * @param {Object} client - Database transaction client
   * @param {string} listId - The list _id
   * @param {Array<string>} removed - Array of album_id values to remove
   * @returns {Promise<number>} Number of items removed
   */
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

  /**
   * Process item additions to a list using batch operations.
   * Handles deduplication against existing items.
   * @param {Object} client - Database transaction client
   * @param {Object} list - The list object from findListById
   * @param {Array<Object>} added - Array of album items to add
   * @param {Date} timestamp - Timestamp for created_at/updated_at
   * @returns {Promise<{addedItems: Array, duplicateAlbums: Array, changeCount: number}>}
   */
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
      const primaryTracks = itemsToInsert.map((i) => i.primary_track);
      const secondaryTracks = itemsToInsert.map((i) => i.secondary_track);
      const createdAts = itemsToInsert.map(() => timestamp);
      const updatedAts = itemsToInsert.map(() => timestamp);

      await client.query(
        `INSERT INTO list_items (
          _id, list_id, album_id, position, comments, primary_track, secondary_track, 
          created_at, updated_at
        )
        SELECT * FROM UNNEST(
          $1::text[], $2::text[], $3::text[], $4::int[], $5::text[], 
          $6::text[], $7::text[], $8::timestamptz[], $9::timestamptz[]
        ) AS t(_id, list_id, album_id, position, comments, primary_track, secondary_track, created_at, updated_at)`,
        [
          itemIds,
          listIds,
          albumIdsToInsert,
          positions,
          comments,
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

  /**
   * Process position updates for existing items.
   * @param {Object} client - Database transaction client
   * @param {string} listId - The list _id
   * @param {Array<Object>} updated - Array of {album_id, position} objects
   * @param {Date} timestamp - Timestamp for updated_at
   * @returns {Promise<number>} Number of items updated
   */
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

  /**
   * Trigger async playcount refresh for newly added albums (fire-and-forget).
   * @param {Object} user - User object with _id and lastfmUsername
   * @param {Array<Object>} addedItems - Array of {album_id, _id} objects
   */
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

  // ============================================
  // PUBLIC SERVICE METHODS
  // ============================================

  /**
   * Build full-mode list data with all album details.
   * @param {string} userId - User ID
   * @param {Array} userLists - Pre-fetched user lists
   * @returns {Promise<Object>} Lists keyed by _id with album items
   */
  async function buildFullListData(userId, userLists) {
    if (typeof listsAsync.findAllUserListsWithItems !== 'function') {
      log.error('Full list fetch requires optimized DB method', { userId });
      throw new Error('Error fetching lists');
    }

    const allRows = await listsAsync.findAllUserListsWithItems(userId);
    const listMap = new Map();
    const listsObj = {};

    for (const list of userLists) {
      listMap.set(list._id, { ...list, items: [] });
    }

    for (const row of allRows) {
      if (!row.list_id) continue;
      if (!listMap.has(row.list_id)) {
        listMap.set(row.list_id, {
          _id: row.list_id,
          name: row.list_name,
          year: row.year,
          isMain: row.is_main,
          items: [],
        });
      }
      if (row.position !== null && row.item_id !== null) {
        listMap.get(row.list_id).items.push({
          _id: row.item_id,
          artist: row.artist || '',
          album: row.album || '',
          album_id: row.album_id || '',
          release_date: row.release_date || '',
          country: row.country || '',
          genre_1: row.genre_1 || '',
          genre_2: row.genre_2 || '',
          track_pick: row.primary_track || '',
          primary_track: row.primary_track || null,
          secondary_track: row.secondary_track || null,
          comments: row.comments || '',
          tracks: row.tracks || null,
          cover_image: row.cover_image || '',
          cover_image_format: row.cover_image_format || '',
          summary: row.summary || '',
          summary_source: row.summary_source || '',
        });
      }
    }

    for (const [listId, listData] of listMap) {
      listsObj[listId] = listData.items;
    }

    return listsObj;
  }

  /**
   * Build metadata-mode list data (no album details).
   * @param {string} userId - User ID
   * @param {Array} userLists - Pre-fetched user lists
   * @returns {Promise<Object>} Lists keyed by _id with metadata only
   */
  async function buildMetadataListData(userId, userLists) {
    const listsObj = {};

    if (typeof listsAsync.findWithCounts === 'function') {
      const listsWithCounts = await listsAsync.findWithCounts({ userId });
      for (const list of listsWithCounts) {
        listsObj[list._id] = {
          _id: list._id,
          name: list.name,
          year: list.year || null,
          isMain: list.isMain || false,
          count: list.itemCount,
          groupId: list.group?._id || null,
          sortOrder: list.sortOrder || 0,
          updatedAt: list.updatedAt,
          createdAt: list.createdAt,
        };
      }
    } else {
      for (const list of userLists) {
        const count = await listItemsAsync.count({ listId: list._id });
        listsObj[list._id] = {
          _id: list._id,
          name: list.name,
          year: list.year || null,
          isMain: list.isMain || false,
          count: count,
          groupId: list.groupId || null,
          sortOrder: list.sortOrder || 0,
          updatedAt: list.updatedAt,
          createdAt: list.createdAt,
        };
      }
    }

    return listsObj;
  }

  /**
   * Get all lists for a user.
   * @param {string} userId - User ID
   * @param {Object} options - Options
   * @param {boolean} [options.full=false] - Return full album data
   * @returns {Promise<Object>} Lists keyed by _id
   */
  async function getAllLists(userId, { full = false } = {}) {
    const userLists = await listsAsync.find({ userId });

    if (full) {
      return buildFullListData(userId, userLists);
    }
    return buildMetadataListData(userId, userLists);
  }

  /**
   * Get a single list by ID with items.
   * @param {string} listId - List ID
   * @param {string} userId - User ID
   * @param {Object} [options] - Options
   * @param {boolean} [options.isExport=false] - Include base64 cover images and points
   * @returns {Promise<{list: Object, items: Array}|null>} List data or null
   */
  async function getListById(listId, userId, { isExport = false } = {}) {
    const list = await findListById(listId, userId);
    if (!list) return null;

    const items = await listItemsAsync.findWithAlbumData(list._id, userId);

    const data = items.map((item, index) => ({
      _id: item._id,
      artist: item.artist,
      album: item.album,
      album_id: item.albumId,
      release_date: item.releaseDate,
      country: item.country,
      genre_1: item.genre1,
      genre_2: item.genre2,
      track_pick: item.primaryTrack || '',
      primary_track: item.primaryTrack || null,
      secondary_track: item.secondaryTrack || null,
      comments: item.comments,
      tracks: item.tracks,
      cover_image_format: item.coverImageFormat,
      summary: item.summary || '',
      summary_source: item.summarySource || '',
      ...(isExport
        ? {
            cover_image: item.coverImage
              ? Buffer.isBuffer(item.coverImage)
                ? item.coverImage.toString('base64')
                : item.coverImage
              : '',
            rank: index + 1,
            points: getPointsForPosition(index + 1),
          }
        : (() => {
            if (item.albumId) {
              return {
                cover_image_url: `/api/albums/${item.albumId}/cover`,
              };
            } else {
              return {};
            }
          })()),
    }));

    return { list, items: data };
  }

  /**
   * Get setup wizard status for a user.
   * @param {string} userId - User ID
   * @param {Object} user - User object (for dismissedUntil)
   * @returns {Promise<Object>} Setup status data
   */
  async function getSetupStatus(userId, user) {
    const result = await pool.query(
      `SELECT l._id, l.name, l.year, l.is_main, l.group_id, g.year as group_year
       FROM lists l
       LEFT JOIN list_groups g ON l.group_id = g.id
       WHERE l.user_id = $1`,
      [userId]
    );

    const listRows = result.rows;

    const listsWithoutYear = listRows.filter(
      (l) => l.year === null && l.group_id !== null && l.group_year !== null
    );
    const yearsWithLists = [
      ...new Set(listRows.filter((l) => l.year !== null).map((l) => l.year)),
    ];

    const yearsWithMainList = listRows
      .filter((l) => l.is_main && l.year !== null)
      .map((l) => l.year);

    const yearsNeedingMain = yearsWithLists.filter(
      (year) => !yearsWithMainList.includes(year)
    );

    const needsSetup =
      listsWithoutYear.length > 0 || yearsNeedingMain.length > 0;

    return {
      needsSetup,
      listsWithoutYear: listsWithoutYear.map((l) => ({
        id: l._id,
        name: l.name,
      })),
      yearsNeedingMain,
      yearsSummary: yearsWithLists.map((year) => ({
        year,
        hasMain: yearsWithMainList.includes(year),
        lists: listRows
          .filter((l) => l.year === year)
          .map((l) => ({
            id: l._id,
            name: l.name,
            isMain: l.is_main,
          })),
      })),
      dismissedUntil: user.listSetupDismissedUntil || null,
    };
  }

  /**
   * Bulk update lists (year assignment and main list designation).
   * @param {string} userId - User ID
   * @param {Array<Object>} updates - Array of {listId, year, isMain}
   * @returns {Promise<{results: Array, yearsToRecompute: Set}>}
   */
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

  /**
   * Dismiss setup wizard for 24 hours.
   * @param {string} userId - User ID
   * @returns {Promise<Date>} When the dismissal expires
   */
  async function dismissSetup(userId) {
    const dismissedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await pool.query(
      `UPDATE users SET list_setup_dismissed_until = $1 WHERE _id = $2`,
      [dismissedUntil, userId]
    );
    return dismissedUntil;
  }

  /**
   * Create a new list.
   * @param {string} userId - User ID
   * @param {Object} data - List data
   * @param {string} data.name - List name
   * @param {string} [data.groupId] - Target group external ID
   * @param {number} [data.year] - Year for list
   * @param {Array<Object>} [data.albums] - Initial albums
   * @returns {Promise<{listId: string, name: string, year: number|null, count: number}>}
   */
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
      let groupIdInternal = null;

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

      const duplicateCheck = await client.query(
        `SELECT 1 FROM lists WHERE user_id = $1 AND name = $2 AND group_id = $3`,
        [userId, trimmedName, groupIdInternal]
      );

      if (duplicateCheck.rows.length > 0) {
        throw new TransactionAbort(409, {
          error: 'A list with this name already exists in this category',
        });
      }

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
        for (let i = 0; i < rawAlbums.length; i++) {
          const album = rawAlbums[i];
          const albumId = await upsertAlbumRecord(album, timestamp, client);

          const itemId = crypto.randomBytes(12).toString('hex');
          await client.query(
            `INSERT INTO list_items (
              _id, list_id, album_id, position, comments, primary_track, secondary_track, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              itemId,
              listId,
              albumId,
              i + 1,
              album.comments || null,
              album.primary_track || null,
              album.secondary_track || null,
              timestamp,
              timestamp,
            ]
          );
        }
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

  /**
   * Update list metadata (rename, change year, move to group).
   * @param {string} listId - List ID
   * @param {string} userId - User ID
   * @param {Object} changes - Changes to apply
   * @param {string} [changes.name] - New name
   * @param {number} [changes.year] - New year
   * @param {string} [changes.groupId] - New group external ID
   * @returns {Promise<{list: Object, targetYear: number|null}>}
   */
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
          error: lockErr.message,
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
          const duplicateCheck = await client.query(
            `SELECT 1 FROM lists WHERE user_id = $1 AND name = $2 AND group_id = $3 AND _id != $4`,
            [userId, trimmedName, targetGroupId, listId]
          );

          if (duplicateCheck.rows.length > 0) {
            throw new TransactionAbort(409, {
              error: 'A list with this name already exists in this category',
            });
          }
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

  /**
   * Replace all items in a list.
   * @param {string} listId - List ID
   * @param {string} userId - User ID
   * @param {Array<Object>} rawAlbums - New album list
   * @returns {Promise<{list: Object, count: number}>}
   */
  async function replaceListItems(listId, userId, rawAlbums) {
    const list = await findListById(listId, userId);
    if (!list) {
      throw new TransactionAbort(404, { error: 'List not found' });
    }

    await validateMainListNotLocked(
      pool,
      list.year,
      list.isMain,
      'modify list items'
    );

    const timestamp = new Date();

    await withTransaction(pool, async (client) => {
      await client.query('DELETE FROM list_items WHERE list_id = $1', [
        list._id,
      ]);

      for (let i = 0; i < rawAlbums.length; i++) {
        const album = rawAlbums[i];
        const albumId = await upsertAlbumRecord(album, timestamp, client);

        const itemId = crypto.randomBytes(12).toString('hex');
        await client.query(
          `INSERT INTO list_items (
            _id, list_id, album_id, position, comments, primary_track, secondary_track, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            itemId,
            list._id,
            albumId,
            i + 1,
            album.comments || null,
            album.primary_track || null,
            album.secondary_track || null,
            timestamp,
            timestamp,
          ]
        );
      }

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

  /**
   * Reorder list items (drag-and-drop).
   * @param {string} listId - List ID
   * @param {string} userId - User ID
   * @param {Array} order - Order array (strings or objects with _id)
   * @returns {Promise<{list: Object, itemCount: number}>}
   */
  async function reorderItems(listId, userId, order) {
    const list = await findListById(listId, userId);
    if (!list) {
      throw new TransactionAbort(404, { error: 'List not found' });
    }

    await validateMainListNotLocked(
      pool,
      list.year,
      list.isMain,
      'reorder list items'
    );

    let effectivePos = 0;

    await withTransaction(pool, async (client) => {
      const now = new Date();
      const byAlbumId = [];
      const byItemId = [];

      for (const entry of order) {
        if (typeof entry === 'string') {
          effectivePos += 1;
          byAlbumId.push({ albumId: entry, position: effectivePos });
        } else if (entry && typeof entry === 'object' && entry._id) {
          effectivePos += 1;
          byItemId.push({ itemId: entry._id, position: effectivePos });
        }
      }

      if (byAlbumId.length > 0) {
        await client.query(
          `UPDATE list_items SET position = t.position, updated_at = $1
           FROM UNNEST($2::text[], $3::int[]) AS t(album_id, position)
           WHERE list_items.list_id = $4 AND list_items.album_id = t.album_id`,
          [
            now,
            byAlbumId.map((i) => i.albumId),
            byAlbumId.map((i) => i.position),
            list._id,
          ]
        );
      }

      if (byItemId.length > 0) {
        await client.query(
          `UPDATE list_items SET position = t.position, updated_at = $1
           FROM UNNEST($2::text[], $3::int[]) AS t(item_id, position)
           WHERE list_items._id = t.item_id AND list_items.list_id = $4`,
          [
            now,
            byItemId.map((i) => i.itemId),
            byItemId.map((i) => i.position),
            list._id,
          ]
        );
      }
    });

    log.info('List reordered', {
      userId,
      listId,
      listName: list.name,
      itemCount: effectivePos,
    });

    return { list, itemCount: effectivePos };
  }

  /**
   * Update a single album's comment.
   * @param {string} listId - List ID
   * @param {string} userId - User ID
   * @param {string} identifier - Album ID or item ID
   * @param {string|null} comment - New comment
   * @returns {Promise<void>}
   */
  async function updateItemComment(listId, userId, identifier, comment) {
    const list = await findListById(listId, userId);
    if (!list) {
      throw new TransactionAbort(404, { error: 'List not found' });
    }

    await validateMainListNotLocked(
      pool,
      list.year,
      list.isMain,
      'update comment'
    );

    const trimmedComment = comment ? comment.trim() : null;

    await withTransaction(pool, async (client) => {
      let updateResult = await client.query(
        'UPDATE list_items SET comments = $1, updated_at = $2 WHERE list_id = $3 AND album_id = $4 RETURNING _id',
        [trimmedComment, new Date(), list._id, identifier]
      );

      if (updateResult.rowCount === 0) {
        updateResult = await client.query(
          'UPDATE list_items SET comments = $1, updated_at = $2 WHERE _id = $3 AND list_id = $4 RETURNING _id',
          [trimmedComment, new Date(), identifier, list._id]
        );
      }

      if (updateResult.rowCount === 0) {
        throw new TransactionAbort(404, {
          error: 'Album not found in list',
        });
      }
    });

    log.info('Comment updated', { userId, listId, identifier });
  }

  /**
   * Incremental list update (add/remove/update items without full rebuild).
   * @param {string} listId - List ID
   * @param {string} userId - User ID
   * @param {Object} changes - Changes
   * @param {Array} [changes.added] - Albums to add
   * @param {Array} [changes.removed] - Album IDs to remove
   * @param {Array} [changes.updated] - Position updates
   * @param {Object} user - User object (for playcount refresh)
   * @returns {Promise<{list: Object, changeCount: number, addedItems: Array, duplicateAlbums: Array}>}
   */
  async function incrementalUpdate(
    listId,
    userId,
    { added, removed, updated },
    user
  ) {
    const list = await findListById(listId, userId);
    if (!list) {
      throw new TransactionAbort(404, { error: 'List not found' });
    }

    await validateMainListNotLocked(
      pool,
      list.year,
      list.isMain,
      'modify list items'
    );

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

  /**
   * Toggle main list status for a year.
   * @param {string} listId - List ID
   * @param {string} userId - User ID
   * @param {boolean} isMain - Whether to set or unset main
   * @returns {Promise<Object>} Result with list, year, and previous main info
   */
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
          error: lockErr.message,
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

  /**
   * Delete a list.
   * @param {string} listId - List ID
   * @param {string} userId - User ID
   * @returns {Promise<Object>} The deleted list data
   */
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

  // ============================================
  // EXPORTS
  // ============================================

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
    incrementalUpdate,
    toggleMainStatus,
    deleteList,
  };
}

module.exports = { createListService };
