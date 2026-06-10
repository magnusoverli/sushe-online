const {
  mapListRowToItem,
  mapAlbumDataItemToResponse,
} = require('./item-mapper');
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
    { isExport = false } = {}
  ) {
    const list = await findListById(listId, userId);
    if (!list) return null;

    const itemsResult = await db.raw(
      `SELECT li._id,
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
              a.tracks,
              ${isExport ? 'a.cover_image,' : ''}
              a.cover_image_format,
              a.cover_image_updated_at,
              a.summary,
              a.summary_source,
              COALESCE((
                SELECT json_agg(m.service)
                FROM album_service_mappings m
                WHERE m.album_id = li.album_id
                  AND m.strategy LIKE 'availability:%'
                  AND m.service = ANY($2)
              ), '[]'::json) AS availability
       FROM list_items li
       LEFT JOIN albums a ON li.album_id = a.album_id
       WHERE li.list_id = $1
       ORDER BY li.position`,
      [list._id, AVAILABILITY_SERVICES],
      {
        name: isExport
          ? 'list-fetchers-list-items-with-album-data-export'
          : 'list-fetchers-list-items-with-album-data',
        retryable: true,
      }
    );
    const items = itemsResult.rows.map((row) => ({
      _id: row._id,
      listId: row.list_id,
      position: row.position,
      artist: row.artist || '',
      album: row.album || '',
      albumId: row.album_id || '',
      releaseDate: row.release_date || '',
      country: row.country || '',
      genre1: row.genre_1 || '',
      genre2: row.genre_2 || '',
      primaryTrack: row.primary_track || null,
      secondaryTrack: row.secondary_track || null,
      comments: row.comments || '',
      comments2: row.comments_2 || '',
      tracks: row.tracks || null,
      coverImage: row.cover_image || '',
      coverImageFormat: row.cover_image_format || '',
      coverImageUpdatedAt: row.cover_image_updated_at || null,
      summary: row.summary || '',
      summarySource: row.summary_source || '',
      availability: row.availability || [],
    }));
    const recMaps = await fetchRecommendationMaps(
      list.year ? [list.year] : [],
      {
        listId,
      }
    );
    const recommendationMap = recMaps.get(list.year) || new Map();

    const data = items.map((item, index) =>
      mapAlbumDataItemToResponse(item, {
        recommendationMap,
        isExport,
        index,
        getPointsForPosition,
      })
    );

    return { list, items: data };
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
