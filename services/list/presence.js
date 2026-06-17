const { ensureDb } = require('../../db/postgres');

function createListPresence(deps = {}) {
  const db = ensureDb(deps.db, 'list/presence');

  async function getAlbumPresence(userId) {
    const result = await db.raw(
      `SELECT l._id AS list_id,
              l.name AS list_name,
              l.year,
              li.album_id,
              a.artist,
              a.album
       FROM lists l
       JOIN list_items li ON li.list_id = l._id
       JOIN albums a ON a.album_id = li.album_id
       WHERE l.user_id = $1
       ORDER BY l.sort_order, l.name, li.position`,
      [userId],
      { name: 'list-presence-albums', retryable: true }
    );

    return result.rows.map((row) => ({
      listId: row.list_id,
      listName: row.list_name,
      year: row.year || null,
      albumId: row.album_id,
      artist: row.artist,
      album: row.album,
    }));
  }

  return { getAlbumPresence };
}

module.exports = { createListPresence };
