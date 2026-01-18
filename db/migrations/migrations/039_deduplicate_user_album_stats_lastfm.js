const logger = require('../../../utils/logger');
const { normalizeForLastfm } = require('../../../utils/lastfm-auth');
const { normalizeAlbumKey } = require('../../../utils/fuzzy-match');

// Deduplicate user_album_stats where the same logical album exists as multiple rows
// because of encoding differences: "…and oceans" (U+2026), "...and oceans" (ASCII),
// " and oceans" (leading space), etc. LOWER(artist) treats these as distinct, so
// (user_id, LOWER(artist), LOWER(album_name)) allowed duplicates.
//
// 1) Merge: group by (user_id, normalizeAlbumKey(artist, album_name)); for each
//    group with >1 row, keep the one with highest lastfm_playcount (then most
//    recent lastfm_updated_at), delete the others.
// 2) Canonicalize: for every row, set artist = LOWER(normalizeForLastfm(artist)).trim(),
//    album_name = LOWER(normalizeForLastfm(album_name)).trim(), and normalized_key
//    from those. This ensures one row per logical album and matches the new write path.

async function up(client) {
  logger.info('Deduplicating user_album_stats (merge encoding variants)...');

  const { rows } = await client.query(
    `SELECT id, user_id, artist, album_name, lastfm_playcount, lastfm_updated_at
     FROM user_album_stats`
  );

  const groups = new Map();
  for (const row of rows) {
    const key = `${row.user_id}\t${normalizeAlbumKey(row.artist, row.album_name)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const toDelete = [];
  for (const [, group] of groups) {
    if (group.length <= 1) continue;
    group.sort((a, b) => {
      const pa = a.lastfm_playcount ?? 0;
      const pb = b.lastfm_playcount ?? 0;
      if (pb !== pa) return pb - pa;
      const ta = a.lastfm_updated_at
        ? new Date(a.lastfm_updated_at).getTime()
        : 0;
      const tb = b.lastfm_updated_at
        ? new Date(b.lastfm_updated_at).getTime()
        : 0;
      return tb - ta;
    });
    for (let i = 1; i < group.length; i++) toDelete.push(group[i].id);
  }

  if (toDelete.length > 0) {
    await client.query(
      `DELETE FROM user_album_stats WHERE id = ANY($1::int[])`,
      [toDelete]
    );
    logger.info(
      { deleted: toDelete.length },
      'Merged duplicate user_album_stats rows'
    );
  }

  const { rows: remaining } = await client.query(
    `SELECT id, artist, album_name FROM user_album_stats`
  );

  for (const row of remaining) {
    const ca = normalizeForLastfm(row.artist ?? '')
      .toLowerCase()
      .trim();
    const cb = normalizeForLastfm(row.album_name ?? '')
      .toLowerCase()
      .trim();
    const nk = normalizeAlbumKey(ca, cb);
    await client.query(
      `UPDATE user_album_stats SET artist = $1, album_name = $2, normalized_key = $3 WHERE id = $4`,
      [ca || row.artist, cb || row.album_name, nk, row.id]
    );
  }

  if (remaining.length > 0) {
    logger.info(
      { canonicalized: remaining.length },
      'Canonicalized user_album_stats artist/album'
    );
  }

  logger.info('user_album_stats deduplication complete');
}

async function down(_client) {
  logger.info(
    '039_deduplicate_user_album_stats_lastfm: down is a no-op (cannot restore merged rows)'
  );
}

module.exports = { up, down };
