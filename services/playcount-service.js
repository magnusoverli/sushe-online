/**
 * Playcount Service
 *
 * Handles background refreshing of Last.fm play counts for albums.
 * Uses rate limiting to respect Last.fm API limits.
 */

const {
  getAlbumInfo: getLastfmAlbumInfo,
  normalizeForLastfm,
} = require('../utils/lastfm-auth');
const { normalizeAlbumKey } = require('../utils/fuzzy-match');

/**
 * Refresh playcounts for albums in background
 * @param {string} userId - User ID
 * @param {string} lastfmUsername - User's Last.fm username
 * @param {Array} albums - Array of album objects with itemId, artist, album, albumId
 * @param {Object} pool - Database connection pool
 * @param {Object} logger - Logger instance
 * @returns {Promise<Object>} - Map of itemId -> playcount
 */
async function refreshPlaycountsInBackground(
  userId,
  lastfmUsername,
  albums,
  pool,
  logger
) {
  const results = {};

  // Process in batches with rate limiting (~5 req/sec for Last.fm)
  const BATCH_SIZE = 5;
  const DELAY_MS = 1100; // Just over 1 second between batches

  for (let i = 0; i < albums.length; i += BATCH_SIZE) {
    const batch = albums.slice(i, i + BATCH_SIZE);

    const batchPromises = batch.map(async (album) => {
      try {
        logger.debug('Fetching Last.fm playcount', {
          artist: album.artist,
          album: album.album,
          lastfmUsername,
        });

        const info = await getLastfmAlbumInfo(
          album.artist,
          album.album,
          lastfmUsername,
          process.env.LASTFM_API_KEY
        );

        const playcount = parseInt(info.userplaycount || 0);

        // Log if Last.fm returned a different artist name (indicates potential mismatch).
        // Compare using normalizeForLastfm so encoding-only differences (e.g. U+2026 … vs ...)
        // are not reported as differs.
        if (
          info.artist &&
          normalizeForLastfm(info.artist) !== normalizeForLastfm(album.artist)
        ) {
          logger.info('Last.fm artist name differs from request', {
            requested: album.artist,
            returned: info.artist,
            album: album.album,
          });
        }

        // Canonicalize artist/album so "…and oceans", "...and oceans", " and oceans" etc.
        // all map to one row. Prevents duplicate rows for the same logical album.
        const canonicalArtist = normalizeForLastfm(album.artist)
          .toLowerCase()
          .trim();
        const canonicalAlbum = normalizeForLastfm(album.album)
          .toLowerCase()
          .trim();
        const normalizedKey = normalizeAlbumKey(
          canonicalArtist,
          canonicalAlbum
        );

        // Upsert into user_album_stats. Store canonical artist/album so the unique
        // (user_id, LOWER(artist), LOWER(album_name)) maps one row per logical album.
        await pool.query(
          `INSERT INTO user_album_stats (user_id, album_id, artist, album_name, normalized_key, lastfm_playcount, lastfm_updated_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
           ON CONFLICT (user_id, LOWER(artist), LOWER(album_name))
           DO UPDATE SET
             album_id = COALESCE(EXCLUDED.album_id, user_album_stats.album_id),
             normalized_key = EXCLUDED.normalized_key,
             lastfm_playcount = EXCLUDED.lastfm_playcount,
             lastfm_updated_at = NOW(),
             updated_at = NOW()`,
          [
            userId,
            album.albumId || null,
            canonicalArtist,
            canonicalAlbum,
            normalizedKey,
            playcount,
          ]
        );

        results[album.itemId] = playcount;
        logger.debug('Fetched playcount', {
          artist: album.artist,
          album: album.album,
          playcount,
        });
      } catch (err) {
        logger.warn(
          `Failed to fetch playcount for ${album.artist} - ${album.album}:`,
          err.message
        );

        // Store 0 playcount on failure so the album is not retried every request
        // It will be marked as stale and retried after 24 hours.
        // Use same canonical artist/album as success path.
        try {
          const canonicalArtist = normalizeForLastfm(album.artist)
            .toLowerCase()
            .trim();
          const canonicalAlbum = normalizeForLastfm(album.album)
            .toLowerCase()
            .trim();
          const normalizedKey = normalizeAlbumKey(
            canonicalArtist,
            canonicalAlbum
          );
          await pool.query(
            `INSERT INTO user_album_stats (user_id, album_id, artist, album_name, normalized_key, lastfm_playcount, lastfm_updated_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, 0, NOW(), NOW())
             ON CONFLICT (user_id, LOWER(artist), LOWER(album_name))
             DO UPDATE SET
               album_id = COALESCE(EXCLUDED.album_id, user_album_stats.album_id),
               normalized_key = EXCLUDED.normalized_key,
               lastfm_updated_at = NOW(),
               updated_at = NOW()`,
            [
              userId,
              album.albumId || null,
              canonicalArtist,
              canonicalAlbum,
              normalizedKey,
            ]
          );
          results[album.itemId] = 0;
        } catch (dbErr) {
          logger.error('Failed to store fallback playcount:', dbErr.message);
          results[album.itemId] = null;
        }
      }
    });

    await Promise.all(batchPromises);

    // Rate limit delay between batches (except for last batch)
    if (i + BATCH_SIZE < albums.length) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
  }

  const successCount = Object.values(results).filter((v) => v !== null).length;
  logger.info('Background playcount refresh completed', {
    total: albums.length,
    successful: successCount,
    failed: albums.length - successCount,
  });

  return results;
}

module.exports = { refreshPlaycountsInBackground };
