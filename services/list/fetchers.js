const { mapListRowToItem } = require('./item-mapper');
const { mapSingleListRowsToResponse } = require('./single-list-mapper');
const { ensureDb } = require('../../db/postgres');
const { AVAILABILITY_SERVICES } = require('../availability/platforms');

// eslint-disable-next-line max-lines-per-function -- List fetchers keep related read-path SQL together for shared mapping behavior
function createListFetchers(deps = {}) {
  const { fetchRecommendationMaps, findListById, getPointsForPosition } = deps;
  const db = ensureDb(deps.db, 'list/fetchers');

  if (!fetchRecommendationMaps) {
    throw new Error('fetchRecommendationMaps is required');
  }
  if (!findListById) throw new Error('findListById is required');
  if (!getPointsForPosition) {
    throw new Error('getPointsForPosition is required');
  }

  async function buildFullListData(userId, userLists) {
    const allRowsResult = await db.raw(
      `SELECT 
         l._id as list_id,
         l.name as list_name,
         l.year,
         l.is_main,
         l.group_id,
         l.sort_order,
         li._id as item_id,
         li.position,
         li.album_id,
         li.comments,
         li.comments_2,
         li.primary_track,
         li.secondary_track,
         a.artist,
         a.album,
         a.release_date,
         a.country,
         a.genre_1,
         a.genre_2,
         a.tracks,
          a.cover_image_format,
           a.cover_image_updated_at,
           a.cover_thumbnail_updated_at,
          a.summary,
         a.summary_source,
         COALESCE((
           SELECT json_agg(m.service)
           FROM album_service_mappings m
            WHERE m.album_id = li.album_id
              AND m.strategy LIKE 'availability:%'
              AND m.service = ANY($2)
          ), '[]'::json) AS availability
       FROM lists l
       LEFT JOIN list_items li ON li.list_id = l._id
       LEFT JOIN albums a ON li.album_id = a.album_id
       WHERE l.user_id = $1
       ORDER BY l.sort_order, l.name, li.position`,
      [userId, AVAILABILITY_SERVICES],
      { name: 'list-fetchers-all-user-lists-with-items', retryable: true }
    );
    const allRows = allRowsResult.rows;
    const listMap = new Map();
    const listsObj = {};

    for (const list of userLists) {
      listMap.set(list._id, { ...list, items: [] });
    }

    const yearsSet = new Set();
    for (const list of userLists) {
      if (list.year) yearsSet.add(list.year);
    }
    const recommendationsByYear = await fetchRecommendationMaps(
      Array.from(yearsSet),
      { userId }
    );

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
        const listEntry = listMap.get(row.list_id);
        const yearRecMap = recommendationsByYear.get(listEntry.year) || null;
        listEntry.items.push(mapListRowToItem(row, yearRecMap));
      }
    }

    for (const [listId, listData] of listMap) {
      listsObj[listId] = listData.items;
    }

    return listsObj;
  }

  async function buildMetadataListData(userId) {
    const listsObj = {};

    const listsWithCountsResult = await db.raw(
      `SELECT l._id,
              l.name,
              l.year,
              l.is_main,
              l.sort_order,
              l.created_at,
              l.updated_at,
              COUNT(li._id) AS item_count,
              g._id AS group_external_id
       FROM lists l
       LEFT JOIN list_items li ON li.list_id = l._id
       LEFT JOIN list_groups g ON l.group_id = g.id
       WHERE l.user_id = $1
       GROUP BY l.id, g.id
       ORDER BY l.sort_order, l.name`,
      [userId],
      { name: 'list-fetchers-lists-with-counts', retryable: true }
    );

    for (const row of listsWithCountsResult.rows) {
      listsObj[row._id] = {
        _id: row._id,
        name: row.name,
        year: row.year || null,
        isMain: row.is_main || false,
        count: parseInt(row.item_count, 10) || 0,
        groupId: row.group_external_id || null,
        sortOrder: row.sort_order || 0,
        updatedAt: row.updated_at,
        createdAt: row.created_at,
      };
    }

    return listsObj;
  }

  async function getAllLists(userId, { full = false } = {}) {
    if (full) {
      const userListsResult = await db.raw(
        `SELECT _id, name, year, is_main, group_id, sort_order, created_at, updated_at
         FROM lists
         WHERE user_id = $1
         ORDER BY sort_order, name`,
        [userId],
        { name: 'list-fetchers-user-lists', retryable: true }
      );
      const userLists = userListsResult.rows.map((row) => ({
        _id: row._id,
        name: row.name,
        year: row.year,
        isMain: row.is_main,
        groupId: row.group_id,
        sortOrder: row.sort_order,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));

      return buildFullListData(userId, userLists);
    }
    return buildMetadataListData(userId);
  }

  async function getListByIdWithItems(
    listId,
    userId,
    { isExport = false, profile = 'full' } = {}
  ) {
    const includeDetails = isExport || profile !== 'core';
    // Availability is small metadata, so core fetches include it for first-paint
    // badges while scoping the aggregate to this list's albums.
    const availabilityCte = `,
      availability AS (
        SELECT album_id, json_agg(service ORDER BY service) AS services
        FROM album_service_mappings
        WHERE strategy LIKE 'availability:%'
          AND service = ANY($3)
          AND album_id IN (
            SELECT album_id FROM list_items WHERE list_id = $1
          )
        GROUP BY album_id
      )`;
    const availabilityJoin =
      'LEFT JOIN availability av ON av.album_id = li.album_id';
    const recommendationJoin = includeDetails
      ? `LEFT JOIN recommendations r ON r.year = tl.year AND r.album_id = li.album_id
        LEFT JOIN users u ON r.recommended_by = u._id`
      : '';
    const detailsColumns = includeDetails
      ? `a.tracks,
              a.summary,
              a.summary_source,
              COALESCE(av.services, '[]'::json) AS availability,
              u.username AS recommended_by,
              r.created_at AS recommended_at,`
      : `NULL AS tracks,
              '' AS summary,
              '' AS summary_source,
              COALESCE(av.services, '[]'::json) AS availability,
              NULL AS recommended_by,
              NULL AS recommended_at,`;

    const queryParams = [listId, userId, AVAILABILITY_SERVICES];

    const itemsResult = await db.raw(
      `WITH target_list AS (
         SELECT l.id,
                l._id,
                l.user_id,
                l.name,
                l.year,
                l.is_main,
                l.group_id,
                l.sort_order,
                l.created_at,
                l.updated_at,
                g._id AS group_external_id,
                g.name AS group_name,
                g.year AS group_year
         FROM lists l
         LEFT JOIN list_groups g ON l.group_id = g.id
         WHERE l._id = $1 AND l.user_id = $2
       )${availabilityCte}
       SELECT tl.id AS list_internal_id,
              tl._id AS list_external_id,
              tl.user_id AS list_user_id,
              tl.name AS list_name,
              tl.year AS list_year,
              tl.is_main AS list_is_main,
              tl.group_id AS list_group_id,
              tl.group_external_id,
              tl.group_name,
              tl.group_year,
              tl.sort_order AS list_sort_order,
              tl.created_at AS list_created_at,
              tl.updated_at AS list_updated_at,
              li._id,
              li.list_id,
              li.position,
              li.comments,
              li.comments_2,
              li.album_id,
              li.primary_track,
              li.secondary_track,
              a.artist,
              a.album,
              a.release_date,
              a.country,
              a.genre_1,
              a.genre_2,
              ${detailsColumns}
              ${isExport ? 'a.cover_image,' : ''}
              a.cover_image_format,
              a.cover_image_updated_at,
              a.cover_thumbnail_updated_at
       FROM target_list tl
       LEFT JOIN list_items li ON li.list_id = tl._id
       LEFT JOIN albums a ON li.album_id = a.album_id
       ${availabilityJoin}
       ${recommendationJoin}
       ORDER BY li.position`,
      queryParams,
      {
        name: isExport
          ? 'list-fetchers-list-with-items-export'
          : includeDetails
            ? 'list-fetchers-list-with-items-full'
            : 'list-fetchers-list-with-items-core',
        retryable: true,
      }
    );

    if (itemsResult.rows.length === 0) return null;

    return mapSingleListRowsToResponse(itemsResult.rows, {
      isExport,
      getPointsForPosition,
    });
  }

  return {
    buildFullListData,
    getAllLists,
    getListByIdWithItems,
  };
}

module.exports = {
  createListFetchers,
};
