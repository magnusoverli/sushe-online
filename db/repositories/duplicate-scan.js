/** @param {Pick<import('../types').DbFacade, 'raw'>} db */
function createDuplicateScanRepository(db) {
  return {
    listCandidates: () =>
      db.raw(`
      SELECT
        album_id,
        artist,
        album,
        release_date,
        country,
        genre_1,
        genre_2,
        album_taxonomy,
        taxonomy_updated_at,
        tracks,
        summary,
        COALESCE(jsonb_array_length(tracks), 0) as track_count,
        cover_image IS NOT NULL as has_cover,
        created_at
      FROM albums
      WHERE artist IS NOT NULL AND artist != ''
        AND album IS NOT NULL AND album != ''
        AND album_id IS NOT NULL
      ORDER BY artist, album
    `),
    listDistinctPairs: () =>
      db.raw('SELECT album_id_1, album_id_2 FROM album_distinct_pairs'),
    /** @param {string[]} albumIds */
    countListReferences: (albumIds) =>
      db.raw(
        `SELECT album_id, COUNT(*)::int AS list_refs
         FROM list_items
         WHERE album_id = ANY($1::text[])
         GROUP BY album_id`,
        [albumIds]
      ),
  };
}

module.exports = { createDuplicateScanRepository };
