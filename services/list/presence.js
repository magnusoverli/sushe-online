const { ensureDb } = require('../../db/postgres');

function createListPresence(deps = {}) {
  const db = ensureDb(deps.db, 'list/presence');

  async function getAlbumPresence(userId) {
    const result = await db.raw(
      `SELECT l._id AS list_id,
               l.name AS list_name,
               COALESCE(l.year, g.year) AS year,
               l.is_main,
               li.album_id,
               a.artist,
                a.album,
                rym.external_album_id AS rym_album_id,
                rym.external_url AS rym_url
        FROM lists l
        LEFT JOIN list_groups g ON l.group_id = g.id
        JOIN list_items li ON li.list_id = l._id
       JOIN albums a ON a.album_id = li.album_id
       LEFT JOIN album_service_mappings rym
         ON rym.album_id = li.album_id AND rym.service = 'rateyourmusic'
       WHERE l.user_id = $1
       ORDER BY l.sort_order, l.name, li.position`,
      [userId],
      { name: 'list-presence-albums', retryable: true }
    );

    return result.rows.map((row) => ({
      listId: row.list_id,
      listName: row.list_name,
      year: row.year || null,
      isMain: !!row.is_main,
      albumId: row.album_id,
      artist: row.artist,
      album: row.album,
      rymNumericId: row.rym_album_id || null,
      rymCanonicalUrl: row.rym_url || null,
    }));
  }

  return { getAlbumPresence };
}

module.exports = { createListPresence };
