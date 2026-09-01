const { ensureDb } = require('../db/postgres');
const { coverImageUrl: defaultCoverImageUrl } = require('./list/item-mapper');

function createCommunityListService(deps = {}) {
  const db = ensureDb(deps.db, 'community-list-service');
  const coverImageUrl = deps.coverImageUrl || defaultCoverImageUrl;

  async function getMainListSummaries(viewerId) {
    const result = await db.raw(
      `SELECT l._id AS list_id,
              l.name,
              l.year,
               u.username,
              COUNT(li._id)::int AS item_count
       FROM lists l
       JOIN users u ON u._id = l.user_id
       JOIN master_lists aggregate
         ON aggregate.year = l.year AND aggregate.revealed = TRUE
       LEFT JOIN list_items li ON li.list_id = l._id
       WHERE l.is_main = TRUE
         AND l.user_id <> $1
         AND u.approval_status = 'approved'
       GROUP BY l.id, u.username
       ORDER BY u.username ASC, l.year DESC`,
      [viewerId],
      { name: 'community-list-main-summaries', retryable: true }
    );
    return result.rows.map((row) => ({
      id: row.list_id,
      name: row.name,
      year: row.year,
      owner: { username: row.username },
      itemCount: Number(row.item_count) || 0,
    }));
  }

  function mapDetailItem(row) {
    return {
      position: row.position,
      albumId: row.album_id,
      artist: row.artist || '',
      album: row.album || '',
      releaseDate: row.release_date || '',
      country: row.country || '',
      genre1: row.genre_1 || '',
      genre2: row.genre_2 || '',
      coverImageUrl: coverImageUrl(row.album_id, row.cover_image_updated_at),
      coverThumbnailUrl: coverImageUrl(
        row.album_id,
        row.cover_thumbnail_updated_at || row.cover_image_updated_at,
        { size: 'thumb' }
      ),
      isDisqualified: row.is_disqualified === true,
      disqualificationReason: row.disqualification_reason || null,
    };
  }

  async function getMainListDetail(listId, viewerId) {
    const result = await db.raw(
      `WITH revealed_years AS (
         SELECT year
          FROM master_lists
          WHERE revealed = TRUE
        )
       SELECT l._id AS list_id,
              l.name,
              l.year,
               u.username,
              li.position,
              li.album_id,
              li.is_disqualified,
              li.disqualification_reason,
              a.artist,
              a.album,
              a.release_date,
              a.country,
              a.genre_1,
              a.genre_2,
               a.cover_image_updated_at,
              a.cover_thumbnail_updated_at
       FROM lists l
       JOIN revealed_years ON revealed_years.year = l.year
       JOIN users u ON u._id = l.user_id
       LEFT JOIN list_items li ON li.list_id = l._id
       LEFT JOIN albums a ON a.album_id = li.album_id
       WHERE l._id = $1
         AND l.user_id <> $2
         AND l.is_main = TRUE
         AND u.approval_status = 'approved'
       ORDER BY li.position ASC NULLS LAST, li.id ASC`,
      [listId, viewerId],
      { name: 'community-list-main-detail', retryable: true }
    );
    if (result.rows.length === 0) return null;
    const [list] = result.rows;
    return {
      id: list.list_id,
      name: list.name,
      year: list.year,
      owner: { username: list.username },
      items: result.rows
        .filter((row) => row.position !== null)
        .map(mapDetailItem),
    };
  }

  return {
    getMainListSummaries,
    getMainListDetail,
  };
}

module.exports = { createCommunityListService };
