async function invalidateResponseCacheForAlbumUsers({
  db,
  responseCache,
  logger,
  albumIds,
  operation,
}) {
  if (!responseCache || typeof responseCache.invalidate !== 'function')
    return 0;

  const ids = Array.from(
    new Set((Array.isArray(albumIds) ? albumIds : [albumIds]).filter(Boolean))
  );
  if (ids.length === 0) return 0;

  try {
    const result = await db.raw(
      `SELECT DISTINCT l.user_id
       FROM lists l
       JOIN list_items li ON li.list_id = l._id
       WHERE li.album_id = ANY($1)`,
      [ids],
      {
        name: `${operation || 'album'}-find-users-with-albums`,
        retryable: true,
      }
    );

    for (const row of result.rows) {
      responseCache.invalidate(`:${row.user_id}`);
    }
    return result.rows.length;
  } catch (error) {
    logger?.warn('Failed to invalidate response caches for album users', {
      albumIds: ids,
      operation,
      error: error.message,
    });
    return 0;
  }
}

module.exports = { invalidateResponseCacheForAlbumUsers };
