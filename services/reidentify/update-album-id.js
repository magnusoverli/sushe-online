async function countListReferences(db, albumId) {
  const result = await db.raw(
    `SELECT COUNT(*)::int AS count FROM list_items WHERE album_id = $1`,
    [albumId]
  );
  return result.rows[0].count;
}

async function updateAlbumIdentity(
  db,
  { currentAlbumId, newAlbumId, tracks, artist, album }
) {
  let listItemsUpdated = 0;
  if (currentAlbumId && currentAlbumId !== newAlbumId) {
    listItemsUpdated = await countListReferences(db, currentAlbumId);
  }

  const updateResult = currentAlbumId
    ? await db.raw(
        `UPDATE albums
         SET album_id = $1, tracks = $2, updated_at = NOW()
         WHERE album_id = $3
         RETURNING id, artist, album, album_id`,
        [newAlbumId, JSON.stringify(tracks), currentAlbumId]
      )
    : await db.raw(
        `UPDATE albums
         SET album_id = $1, tracks = $2, updated_at = NOW()
         WHERE LOWER(artist) = LOWER($3) AND LOWER(album) = LOWER($4)
         RETURNING id, artist, album, album_id`,
        [newAlbumId, JSON.stringify(tracks), artist, album]
      );

  return { updateResult, listItemsUpdated };
}

module.exports = { updateAlbumIdentity };
