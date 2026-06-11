const { mapAlbumDataItemToResponse } = require('./item-mapper');

function mapSingleListRowToList(listRow) {
  return {
    id: listRow.list_internal_id,
    _id: listRow.list_external_id,
    userId: listRow.list_user_id,
    name: listRow.list_name,
    year: listRow.list_year,
    isMain: listRow.list_is_main,
    groupId: listRow.list_group_id,
    groupExternalId: listRow.group_external_id,
    groupName: listRow.group_name,
    groupYear: listRow.group_year,
    sortOrder: listRow.list_sort_order,
    createdAt: listRow.list_created_at,
    updatedAt: listRow.list_updated_at,
  };
}

function mapSingleListRowToItem(row) {
  return {
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
    coverThumbnailUpdatedAt: row.cover_thumbnail_updated_at || null,
    summary: row.summary || '',
    summarySource: row.summary_source || '',
    availability: row.availability || [],
    recommendedBy: row.recommended_by || null,
    recommendedAt: row.recommended_at || null,
  };
}

function mapSingleListRowsToResponse(
  rows,
  { isExport = false, getPointsForPosition } = {}
) {
  const list = mapSingleListRowToList(rows[0]);
  const recommendationMap = new Map();
  const items = rows
    .filter((row) => row._id)
    .map(mapSingleListRowToItem)
    .map((item, index) =>
      mapAlbumDataItemToResponse(item, {
        recommendationMap,
        isExport,
        index,
        getPointsForPosition,
      })
    );

  return { list, items };
}

module.exports = {
  mapSingleListRowsToResponse,
};
