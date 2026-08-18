const { coverImageUrl } = require('./list/item-mapper');

function buildCurrentPatch(row, requestedPatch) {
  const currentValues = {};
  for (const field of [
    'album',
    'artist',
    'country',
    'tracks',
    'cover_image_format',
    'cover_image_updated_at',
    'cover_thumbnail_format',
    'cover_thumbnail_updated_at',
  ]) {
    if (Object.hasOwn(row, field)) currentValues[field] = row[field];
  }

  if (Object.hasOwn(row, 'cover_image_updated_at')) {
    currentValues.cover_image_url = coverImageUrl(
      row.album_id,
      row.cover_image_updated_at
    );
  }
  if (
    Object.hasOwn(row, 'cover_thumbnail_updated_at') ||
    Object.hasOwn(row, 'cover_image_updated_at')
  ) {
    currentValues.cover_thumb_url = coverImageUrl(
      row.album_id,
      row.cover_thumbnail_updated_at || row.cover_image_updated_at,
      { size: 'thumb' }
    );
  }

  return Object.fromEntries(
    Object.entries(requestedPatch).map(([field, value]) => [
      field,
      Object.hasOwn(currentValues, field) ? currentValues[field] : value,
    ])
  );
}

async function publishAlbumMetadataUpdate({
  db,
  responseCache,
  broadcast,
  logger,
  albumId,
  patch,
  operation,
}) {
  if (!albumId || !patch || typeof patch !== 'object') return 0;

  try {
    const result = await db.raw(
      `WITH album_snapshot AS MATERIALIZED (
         SELECT a.album_id,
                a.artist,
                a.album,
                a.country,
                a.tracks,
                a.cover_image_format,
                a.cover_image_updated_at,
                a.cover_thumbnail_format,
                a.cover_thumbnail_updated_at
         FROM albums a
         WHERE a.album_id = $1
         FOR UPDATE
       ),
       versioned_snapshot AS MATERIALIZED (
         SELECT nextval('album_metadata_event_version_seq')::text AS metadata_version,
                album_snapshot.*
         FROM album_snapshot
       ),
       affected_users AS (
         SELECT DISTINCT l.user_id
         FROM lists l
         JOIN list_items li ON li.list_id = l._id
         WHERE li.album_id = $1
       )
       SELECT affected_users.user_id, versioned_snapshot.*
       FROM affected_users
       CROSS JOIN versioned_snapshot`,
      [albumId],
      {
        name: `${operation || 'album'}-publish-metadata-update`,
        retryable: true,
      }
    );

    for (const row of result.rows) {
      responseCache?.invalidate?.(`:${row.user_id}`);
      const currentPatch = buildCurrentPatch(row, patch);
      if (row.metadata_version == null) {
        broadcast?.albumMetadataUpdated?.(row.user_id, albumId, currentPatch);
      } else {
        broadcast?.albumMetadataUpdated?.(
          row.user_id,
          albumId,
          currentPatch,
          row.metadata_version
        );
      }
    }
    return result.rows.length;
  } catch (error) {
    logger?.warn('Failed to publish album metadata update', {
      albumId,
      operation,
      error: error.message,
    });
    return 0;
  }
}

module.exports = { publishAlbumMetadataUpdate };
