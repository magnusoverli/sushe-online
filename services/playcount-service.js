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
 * @returns {Promise<Object>} - Map of itemId -> { playcount, status }
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

        // Check if album was not found on Last.fm
        if (info.notFound) {
          logger.debug('Album not found on Last.fm', {
            artist: album.artist,
            album: album.album,
          });

          await pool.query(
            `INSERT INTO user_album_stats (user_id, album_id, artist, album_name, normalized_key, lastfm_playcount, lastfm_status, lastfm_updated_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, NULL, 'not_found', NOW(), NOW())
             ON CONFLICT (user_id, LOWER(artist), LOWER(album_name))
             DO UPDATE SET
               album_id = COALESCE(EXCLUDED.album_id, user_album_stats.album_id),
               normalized_key = EXCLUDED.normalized_key,
               lastfm_playcount = NULL,
               lastfm_status = 'not_found',
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

          results[album.itemId] = { playcount: null, status: 'not_found' };
          return;
        }

        const playcount = parseInt(info.userplaycount || 0);

        // Log if Last.fm returned a different artist name (indicates potential mismatch).
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

        // Upsert into user_album_stats with success status
        await pool.query(
          `INSERT INTO user_album_stats (user_id, album_id, artist, album_name, normalized_key, lastfm_playcount, lastfm_status, lastfm_updated_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'success', NOW(), NOW())
           ON CONFLICT (user_id, LOWER(artist), LOWER(album_name))
           DO UPDATE SET
             album_id = COALESCE(EXCLUDED.album_id, user_album_stats.album_id),
             normalized_key = EXCLUDED.normalized_key,
             lastfm_playcount = EXCLUDED.lastfm_playcount,
             lastfm_status = 'success',
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

        results[album.itemId] = { playcount, status: 'success' };
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

        // Store error status so the album is retried later
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
            `INSERT INTO user_album_stats (user_id, album_id, artist, album_name, normalized_key, lastfm_playcount, lastfm_status, lastfm_updated_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, NULL, 'error', NOW(), NOW())
             ON CONFLICT (user_id, LOWER(artist), LOWER(album_name))
             DO UPDATE SET
               album_id = COALESCE(EXCLUDED.album_id, user_album_stats.album_id),
               normalized_key = EXCLUDED.normalized_key,
               lastfm_status = 'error',
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
          results[album.itemId] = { playcount: null, status: 'error' };
        } catch (dbErr) {
          logger.error('Failed to store error status:', dbErr.message);
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

  const successCount = Object.values(results).filter(
    (v) => v && v.status === 'success'
  ).length;
  const notFoundCount = Object.values(results).filter(
    (v) => v && v.status === 'not_found'
  ).length;
  logger.info('Background playcount refresh completed', {
    total: albums.length,
    successful: successCount,
    notFound: notFoundCount,
    failed: albums.length - successCount - notFoundCount,
  });

  return results;
}

module.exports = { refreshPlaycountsInBackground };
