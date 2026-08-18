const { AVAILABILITY_SERVICES } = require('./availability/platforms');

async function publishAlbumAvailabilityUpdate({
  db,
  broadcast,
  logger,
  albumId,
  operation,
}) {
  if (!db || typeof broadcast?.albumAvailabilityUpdated !== 'function') {
    return 0;
  }

  try {
    const result = await db.raw(
      `WITH affected_users AS (
         SELECT DISTINCT l.user_id
         FROM lists l
         JOIN list_items li ON li.list_id = l._id
         WHERE li.album_id = $1
       )
       SELECT affected_users.user_id,
              COALESCE((
                SELECT json_agg(m.service ORDER BY m.service)
                FROM album_service_mappings m
                WHERE m.album_id = $1
                  AND (m.strategy LIKE 'availability:%' OR m.external_url IS NOT NULL)
                  AND m.service = ANY($2)
              ), '[]'::json) AS availability,
              COALESCE((
                SELECT json_agg(
                  json_build_object('service', m.service, 'url', m.external_url)
                  ORDER BY m.service
                )
                FROM album_service_mappings m
                WHERE m.album_id = $1
                  AND m.service = ANY($2)
                  AND m.external_url IS NOT NULL
              ), '[]'::json) AS availability_links
       FROM affected_users`,
      [albumId, AVAILABILITY_SERVICES],
      {
        name: `${operation || 'album'}-publish-availability-update`,
        retryable: true,
      }
    );

    for (const row of result.rows) {
      broadcast.albumAvailabilityUpdated(
        row.user_id,
        albumId,
        row.availability || [],
        row.availability_links || []
      );
    }
    return result.rows.length;
  } catch (error) {
    logger?.warn('Failed to broadcast album availability update', {
      albumId,
      operation,
      error: error.message,
    });
    return 0;
  }
}

module.exports = { publishAlbumAvailabilityUpdate };
