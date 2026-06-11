/**
 * List item mapping helpers.
 *
 * Keeps row/object-to-API-shape mapping logic in one place so list-service
 * can focus on orchestration and validation.
 */

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * Build the cover-image URL for an album, or '' when there is no album id.
 * Lets list payloads carry a lightweight URL instead of inlining BYTEA blobs.
 */
function coverImageUrl(albumId, coverImageUpdatedAt, options = {}) {
  if (!albumId) return '';
  const params = new URLSearchParams();
  if (options.size) params.set('size', options.size);
  if (coverImageUpdatedAt) {
    params.set('v', new Date(coverImageUpdatedAt).getTime().toString());
  }
  const query = params.toString();
  return `/api/albums/${encodeURIComponent(albumId)}/cover${query ? `?${query}` : ''}`;
}

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
    cover_image_url: coverImageUrl(row.album_id, row.cover_image_updated_at),
    cover_thumb_url: coverImageUrl(
      row.album_id,
      row.cover_thumbnail_updated_at || row.cover_image_updated_at,
      { size: 'thumb' }
    ),
    cover_image_format: row.cover_image_format || '',
    cover_image_updated_at: row.cover_image_updated_at,
    cover_thumbnail_updated_at: row.cover_thumbnail_updated_at,
    summary: row.summary || '',
    summary_source: row.summary_source || '',
    availability: asArray(row.availability),
    recommended_by: recommendation?.recommendedBy || null,
    recommended_at: recommendation?.recommendedAt || null,
  };
}

function resolveRecommendation(item, recommendationMap) {
  const mappedRecommendation = recommendationMap?.get(item.albumId);
  if (mappedRecommendation) return mappedRecommendation;
  if (!item.recommendedBy) return null;

  return {
    recommendedBy: item.recommendedBy,
    recommendedAt: item.recommendedAt,
  };
}

function serializeCoverImage(coverImage) {
  if (!coverImage) return '';
  return Buffer.isBuffer(coverImage)
    ? coverImage.toString('base64')
    : coverImage;
}

function getExportPoints(index, getPointsForPosition) {
  return getPointsForPosition ? getPointsForPosition(index + 1) : null;
}

function mapAlbumDataItemToResponse(item, options = {}) {
  const {
    recommendationMap = null,
    isExport = false,
    index = 0,
    getPointsForPosition = null,
  } = options;

  const recommendation = resolveRecommendation(item, recommendationMap);

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
    cover_image_updated_at: item.coverImageUpdatedAt || null,
    cover_thumb_url: coverImageUrl(
      item.albumId,
      item.coverThumbnailUpdatedAt || item.coverImageUpdatedAt,
      { size: 'thumb' }
    ),
    cover_thumbnail_updated_at: item.coverThumbnailUpdatedAt || null,
    summary: item.summary || '',
    summary_source: item.summarySource || '',
    availability: asArray(item.availability),
    recommended_by: recommendation?.recommendedBy || null,
    recommended_at: recommendation?.recommendedAt || null,
  };

  if (isExport) {
    return {
      ...base,
      cover_image: serializeCoverImage(item.coverImage),
      rank: index + 1,
      points: getExportPoints(index, getPointsForPosition),
    };
  }

  if (item.albumId) {
    return {
      ...base,
      cover_image_url: coverImageUrl(item.albumId, item.coverImageUpdatedAt),
    };
  }

  return base;
}

module.exports = {
  coverImageUrl,
  mapListRowToItem,
  mapAlbumDataItemToResponse,
};
