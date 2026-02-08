/**
 * Playcount Service
 *
 * Handles background refreshing of Last.fm play counts for albums.
 * Uses rate limiting to respect Last.fm API limits.
 *
 * Delegates to shared helpers in playcount-sync-service for upsert
 * and single-album refresh logic (DRY).
 */

const { refreshAlbumPlaycount } = require('./playcount-sync-service');

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
      logger.debug('Fetching Last.fm playcount', {
        artist: album.artist,
        album: album.album,
        lastfmUsername,
      });

      const result = await refreshAlbumPlaycount(
        pool,
        logger,
        userId,
        lastfmUsername,
        album
      );

      if (result !== null) {
        // Log if Last.fm returned a different artist name (indicates potential mismatch).
        // refreshAlbumPlaycount doesn't log this, so we check here for parity.
        results[album.itemId] = result;

        if (result.status === 'success') {
          logger.debug('Fetched playcount', {
            artist: album.artist,
            album: album.album,
            playcount: result.playcount,
          });
        }
      } else {
        results[album.itemId] = null;
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
