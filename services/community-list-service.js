const { ensureDb } = require('../db/postgres');
const { coverImageUrl: defaultCoverImageUrl } = require('./list/item-mapper');

function mapVisibility(row) {
  return {
    year: row.year,
    revealed: row.revealed === true,
    revealedAt: row.revealed_at || null,
    revealedBy: row.revealed_by || null,
    updatedAt: row.updated_at || null,
  };
}

function createCommunityListService(deps = {}) {
  const db = ensureDb(deps.db, 'community-list-service');
  const coverImageUrl = deps.coverImageUrl || defaultCoverImageUrl;

  async function getVisibilityForYears(years) {
    if (!Array.isArray(years) || years.length === 0) return new Map();
    const uniqueYears = [...new Set(years)];
    const result = await db.raw(
      `SELECT year, revealed, revealed_at, revealed_by, updated_at
       FROM user_list_year_visibility
       WHERE year = ANY($1::int[])`,
      [uniqueYears],
      { name: 'community-list-year-visibility', retryable: true }
    );
    const visibilityByYear = new Map(
      result.rows.map((row) => [row.year, mapVisibility(row)])
    );
    for (const year of uniqueYears) {
      if (!visibilityByYear.has(year)) {
        visibilityByYear.set(year, {
          year,
          revealed: false,
          revealedAt: null,
          revealedBy: null,
          updatedAt: null,
        });
      }
    }
    return visibilityByYear;
  }

  async function setYearVisibility(year, revealed, adminId) {
    const result = await db.raw(
      `INSERT INTO user_list_year_visibility (
         year, revealed, revealed_at, revealed_by, updated_at
       )
       VALUES (
         $1,
         $2,
         CASE WHEN $2 THEN NOW() ELSE NULL END,
         CASE WHEN $2 THEN $3 ELSE NULL END,
         NOW()
       )
       ON CONFLICT (year) DO UPDATE
       SET revealed = EXCLUDED.revealed,
           revealed_at = EXCLUDED.revealed_at,
           revealed_by = EXCLUDED.revealed_by,
           updated_at = NOW()
       RETURNING year, revealed, revealed_at, revealed_by, updated_at`,
      [year, revealed, adminId],
      { name: 'community-list-set-year-visibility' }
    );
    return mapVisibility(result.rows[0]);
  }

  async function getMainListSummaries(viewerId) {
    const result = await db.raw(
      `SELECT l._id AS list_id,
              l.name,
              l.year,
               u.username,
              COUNT(li._id)::int AS item_count
       FROM lists l
       JOIN users u ON u._id = l.user_id
       JOIN user_list_year_visibility visibility
         ON visibility.year = l.year AND visibility.revealed = TRUE
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
      `WITH visibility AS (
         SELECT year
         FROM user_list_year_visibility
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
       JOIN visibility ON visibility.year = l.year
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
    getVisibilityForYears,
    setYearVisibility,
    getMainListSummaries,
    getMainListDetail,
  };
}

module.exports = { createCommunityListService };
