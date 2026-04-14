const {
  mapListRowToItem,
  mapAlbumDataItemToResponse,
} = require('./item-mapper');

function createListFetchers(deps = {}) {
  const {
    listsAsync,
    listItemsAsync,
    fetchRecommendationMaps,
    findListById,
    getPointsForPosition,
  } = deps;

  if (!listsAsync) throw new Error('listsAsync is required');
  if (!listItemsAsync) throw new Error('listItemsAsync is required');
  if (typeof listsAsync.findAllUserListsWithItems !== 'function') {
    throw new Error('listsAsync.findAllUserListsWithItems is required');
  }
  if (typeof listsAsync.findWithCounts !== 'function') {
    throw new Error('listsAsync.findWithCounts is required');
  }
  if (typeof listsAsync.find !== 'function') {
    throw new Error('listsAsync.find is required');
  }
  if (typeof listItemsAsync.findWithAlbumData !== 'function') {
    throw new Error('listItemsAsync.findWithAlbumData is required');
  }
  if (!fetchRecommendationMaps) {
    throw new Error('fetchRecommendationMaps is required');
  }
  if (!findListById) throw new Error('findListById is required');
  if (!getPointsForPosition) {
    throw new Error('getPointsForPosition is required');
  }

  async function buildFullListData(userId, userLists) {
    const allRows = await listsAsync.findAllUserListsWithItems(userId);
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

    return listsObj;
  }

  async function getAllLists(userId, { full = false } = {}) {
    const userLists = await listsAsync.find({ userId });

    if (full) {
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

    const items = await listItemsAsync.findWithAlbumData(list._id, userId);
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
