/**
 * Playcount Service
 *
 * Handles background refreshing of Last.fm play counts for albums.
 * Uses rate limiting to respect Last.fm API limits.
 *
 * Delegates to shared helpers in playcount-sync-service for upsert
 * and single-album refresh logic (DRY).
 *
 * Uses dependency injection via createPlaycountService(deps) factory.
 * Tests can inject a mock refreshAlbumPlaycount; production uses the default.
 */

/** Staleness threshold: only refresh albums older than 2 hours */
const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000;

/**
 * Build a lookup map of normalized artist+album keys to cached stats.
 * When duplicate keys exist, keeps the row with the highest playcount
 * (or most recent update as tiebreaker).
 *
 * @param {Array} statsRows - Rows from user_album_stats
 * @param {Function} normalizeAlbumKey - Normalization function
 * @returns {Map<string, Object>}
 */
function buildStatsMap(statsRows, normalizeAlbumKey) {
  const statsMap = new Map();
  for (const row of statsRows) {
    const key =
      row.normalized_key || normalizeAlbumKey(row.artist, row.album_name);
    const existing = statsMap.get(key);
    const rowCount = row.lastfm_playcount ?? 0;
    const existingCount = existing?.lastfm_playcount ?? 0;
    const rowNewer =
      existing &&
      row.lastfm_updated_at &&
      existing.lastfm_updated_at &&
      new Date(row.lastfm_updated_at) > new Date(existing.lastfm_updated_at);
    if (
      !existing ||
      rowCount > existingCount ||
      (rowCount === existingCount && rowNewer)
    ) {
      statsMap.set(key, row);
    }
  }
  return statsMap;
}

/**
 * Match list items to cached stats and determine which need refreshing.
 *
 * @param {Array} listItems - Rows with _id, album_id, artist, album
 * @param {Map} statsMap - Normalized stats lookup
 * @param {Function} normalizeAlbumKey - Normalization function
 * @returns {{ playcounts: Object, albumsToRefresh: Array }}
 */
function matchAndFindStale(listItems, statsMap, normalizeAlbumKey) {
  const playcounts = {};
  const albumsToRefresh = [];
  const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS);

  for (const item of listItems) {
    if (!item.artist || !item.album) continue;

    const key = normalizeAlbumKey(item.artist, item.album);
    const cached = statsMap.get(key);

    if (cached) {
      playcounts[item._id] = {
        playcount: cached.lastfm_playcount,
        status: cached.lastfm_status || null,
      };
    } else {
      playcounts[item._id] = null;
    }

    const needsRefresh =
      !cached ||
      !cached.lastfm_updated_at ||
      cached.lastfm_status === 'error' ||
      new Date(cached.lastfm_updated_at) < staleThreshold;

    if (needsRefresh) {
      albumsToRefresh.push({
        itemId: item._id,
        artist: item.artist,
        album: item.album,
        albumId: item.album_id,
      });
    }
  }

  return { playcounts, albumsToRefresh };
}

/**
 * Factory that creates playcount service with injectable dependencies.
 *
 * @param {Object} deps - Dependencies
 * @param {Function} deps.refreshAlbumPlaycount - Function to refresh a single album's playcount
 * @returns {{ refreshPlaycountsInBackground: Function, getListPlaycounts: Function }}
 */
function createPlaycountService(deps = {}) {
  const refreshAlbumPlaycount =
    deps.refreshAlbumPlaycount ||
    require('./playcount-sync-service').refreshAlbumPlaycount;

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

  /**
   * Get playcounts for all albums in a list, returning cached data
   * and triggering background refresh for stale entries.
   *
   * @param {Object} params
   * @param {string} params.listId - List ID
   * @param {string} params.userId - User ID
   * @param {string} params.lastfmUsername - Last.fm username
   * @param {Object} params.pool - Database pool
   * @param {Object} params.logger - Logger instance
   * @param {Function} params.normalizeAlbumKey - Normalization function
   * @returns {Promise<{ playcounts: Object, refreshing: number } | { error: Object }>}
   */
  async function getListPlaycounts({
    listId,
    userId,
    lastfmUsername,
    pool,
    logger,
    normalizeAlbumKey,
  }) {
    // Verify list exists
    const list = await pool.query(`SELECT _id FROM lists WHERE _id = $1`, [
      listId,
    ]);
    if (list.rows.length === 0) {
      return { error: { status: 404, message: 'List not found' } };
    }

    // Get all albums in the list
    const listItemsResult = await pool.query(
      `SELECT li._id, li.album_id, a.artist, a.album
       FROM list_items li
       LEFT JOIN albums a ON li.album_id = a.album_id
       WHERE li.list_id = $1`,
      [listId]
    );
    const listItems = listItemsResult.rows;

    if (listItems.length === 0) {
      return { playcounts: {}, refreshing: 0 };
    }

    // Get cached playcounts from user_album_stats
    const statsResult = await pool.query(
      `SELECT artist, album_name, album_id, normalized_key, lastfm_playcount, lastfm_status, lastfm_updated_at
       FROM user_album_stats
       WHERE user_id = $1`,
      [userId]
    );

    const statsMap = buildStatsMap(statsResult.rows, normalizeAlbumKey);
    const { playcounts, albumsToRefresh } = matchAndFindStale(
      listItems,
      statsMap,
      normalizeAlbumKey
    );

    if (albumsToRefresh.length > 0) {
      logger.debug('Triggering background playcount refresh for stale albums', {
        staleCount: albumsToRefresh.length,
        totalCount: listItems.length,
        lastfmUsername,
      });
      refreshPlaycountsInBackground(
        userId,
        lastfmUsername,
        albumsToRefresh,
        pool,
        logger
      ).catch((err) => {
        logger.error('Background playcount refresh failed:', err);
      });
    }

    return { playcounts, refreshing: albumsToRefresh.length };
  }

  return { refreshPlaycountsInBackground, getListPlaycounts };
}

// Default instance for production use — callers import as before
const defaultInstance = createPlaycountService();

module.exports = {
  createPlaycountService,
  buildStatsMap,
  matchAndFindStale,
  STALE_THRESHOLD_MS,
  ...defaultInstance,
};
