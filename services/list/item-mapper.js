/**
 * List item mapping helpers.
 *
 * Keeps row/object-to-API-shape mapping logic in one place so list-service
 * can focus on orchestration and validation.
 */

function mapListRowToItem(row, recommendationMap = null) {
  const recommendation = recommendationMap?.get(row.album_id) || null;

  return {
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
    comments_2: row.comments_2 || '',
    tracks: row.tracks || null,
    cover_image: row.cover_image || '',
    cover_image_format: row.cover_image_format || '',
    summary: row.summary || '',
    summary_source: row.summary_source || '',
    recommended_by: recommendation?.recommendedBy || null,
    recommended_at: recommendation?.recommendedAt || null,
  };
}

function mapAlbumDataItemToResponse(item, options = {}) {
  const {
    recommendationMap = null,
    isExport = false,
    index = 0,
    getPointsForPosition = null,
  } = options;

  const recommendation = recommendationMap?.get(item.albumId) || null;

  const base = {
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
    comments_2: item.comments2 || '',
    tracks: item.tracks,
    cover_image_format: item.coverImageFormat,
    summary: item.summary || '',
    summary_source: item.summarySource || '',
    recommended_by: recommendation?.recommendedBy || null,
    recommended_at: recommendation?.recommendedAt || null,
  };

  if (isExport) {
    return {
      ...base,
      cover_image: item.coverImage
        ? Buffer.isBuffer(item.coverImage)
          ? item.coverImage.toString('base64')
          : item.coverImage
        : '',
      rank: index + 1,
      points: getPointsForPosition ? getPointsForPosition(index + 1) : null,
    };
  }

  if (item.albumId) {
    return {
      ...base,
      cover_image_url: `/api/albums/${item.albumId}/cover`,
    };
  }

  return base;
}

module.exports = {
  mapListRowToItem,
  mapAlbumDataItemToResponse,
};
