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

/**
 * Staleness threshold for triggering a background refresh. Cached values are
 * ALWAYS displayed regardless of age — this only controls how often we ask
 * Last.fm for fresher numbers.
 */
const STALE_THRESHOLD_MS = 5 * 60 * 1000;
const { ensureDb } = require('../db/postgres');
const { normalizeForExternalApi } = require('../utils/normalization');

/**
 * Build the canonical cache key for a list item, matching exactly how the
 * write path (upsertPlaycount) computes `normalized_key`: canonicalize for
 * external APIs (strips diacritics, normalizes punctuation), lowercase, then
 * apply normalizeAlbumKey. Without this, accented names like "Sigur Rós" are
 * stored under one key but looked up under another and never match.
 *
 * @param {Function} normalizeAlbumKey - Album key function
 * @param {string} artist
 * @param {string} album
 * @returns {string}
 */
function buildCanonicalKey(normalizeAlbumKey, artist, album) {
  return normalizeAlbumKey(
    normalizeForExternalApi(artist).toLowerCase().trim(),
    normalizeForExternalApi(album).toLowerCase().trim()
  );
}

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
function matchAndFindStale(
  listItems,
  statsMap,
  normalizeAlbumKey,
  forceRefresh = false
) {
  const playcounts = {};
  const albumsToRefresh = [];
  const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS);

  for (const item of listItems) {
    if (!item.artist || !item.album) continue;

    const key = normalizeAlbumKey(item.artist, item.album);
    const cached = statsMap.get(key);

    const needsRefresh =
      forceRefresh ||
      !cached ||
      !cached.lastfm_updated_at ||
      cached.lastfm_status === 'error' ||
      new Date(cached.lastfm_updated_at) < staleThreshold;

    // Always show the last-known cached value (even if stale) while a refresh
    // happens in the background. Hiding stale values made the list go blank on
    // every load older than the staleness window.
    if (cached) {
      playcounts[item._id] = {
        playcount: cached.lastfm_playcount,
        status: cached.lastfm_status || null,
      };
    } else {
      playcounts[item._id] = null;
    }

    if (needsRefresh) {
      albumsToRefresh.push({
        itemId: item._id,
        artist: item.artist,
        album: item.album,
        album_id: item.album_id,
      });
    }
  }

  return { playcounts, albumsToRefresh };
}

/**
 * Build scoped lookup inputs for fetching cached stats for a specific list.
 *
 * @param {Array} listItems - Rows with album_id, artist, album
 * @param {Function} normalizeAlbumKey - Normalization function
 * @returns {{albumIds: string[], normalizedKeys: string[]}}
 */
function buildStatsLookupInputs(listItems, normalizeAlbumKey) {
  const albumIds = new Set();
  const normalizedKeys = new Set();

  for (const item of listItems) {
    if (item.album_id) {
      albumIds.add(item.album_id);
    }

    if (item.artist && item.album) {
      normalizedKeys.add(normalizeAlbumKey(item.artist, item.album));
    }
  }

  return {
    albumIds: [...albumIds],
    normalizedKeys: [...normalizedKeys],
  };
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

  // Tracks albums currently being refreshed (keyed by `${userId}::${cacheKey}`)
  // so repeated list views / poll cycles don't spawn duplicate, overlapping
  // background refreshes that thrash the Last.fm rate limit.
  const inFlightRefreshes = new Set();

  /**
   * Refresh playcounts for albums in background
   * @param {string} userId - User ID
   * @param {string} lastfmUsername - User's Last.fm username
   * @param {Array} albums - Array of album objects with itemId, artist, album, album_id
   * @param {import('../db/types').DbFacade} db - Canonical datastore
   * @param {Object} logger - Logger instance
   * @returns {Promise<Object>} - Map of itemId -> { playcount, status }
   */
  async function refreshPlaycountsInBackground(
    userId,
    lastfmUsername,
    albums,
    db,
    logger
  ) {
    const datastore = ensureDb(
      db,
      'playcount-service.refreshPlaycountsInBackground'
    );
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
          datastore,
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
   * @param {import('../db/types').DbFacade} params.db - Canonical datastore
   * @param {Object} params.logger - Logger instance
   * @param {Function} params.normalizeAlbumKey - Normalization function
   * @param {boolean} [params.forceRefresh=false] - Refresh all albums regardless of cache age
   * @returns {Promise<{ playcounts: Object, refreshing: number } | { error: Object }>}
   */
  async function getListPlaycounts({
    listId,
    userId,
    lastfmUsername,
    db,
    logger,
    normalizeAlbumKey,
    forceRefresh = false,
  }) {
    const datastore = ensureDb(db, 'playcount-service.getListPlaycounts');

    // Canonical key used for both cache lookups and de-dup, kept consistent
    // with the write path so accented/special-char names match.
    const keyOf = (artist, album) =>
      buildCanonicalKey(normalizeAlbumKey, artist, album);

    // Verify list exists
    const list = await datastore.raw(
      `SELECT _id FROM lists WHERE _id = $1 AND user_id = $2`,
      [listId, userId]
    );
    if (list.rows.length === 0) {
      return { error: { status: 404, message: 'List not found' } };
    }

    // Get all albums in the list
    const listItemsResult = await datastore.raw(
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

    // Fetch only cached playcounts relevant to albums in this list.
    const { albumIds, normalizedKeys } = buildStatsLookupInputs(
      listItems,
      keyOf
    );

    let statsRows = [];
    const statsPredicates = [];
    const statsParams = [userId];

    if (albumIds.length > 0) {
      statsPredicates.push(
        `album_id = ANY($${statsParams.length + 1}::text[])`
      );
      statsParams.push(albumIds);
    }

    if (normalizedKeys.length > 0) {
      statsPredicates.push(
        `normalized_key = ANY($${statsParams.length + 1}::text[])`
      );
      statsParams.push(normalizedKeys);
    }

    if (statsPredicates.length > 0) {
      const statsResult = await datastore.raw(
        `SELECT artist, album_name, album_id, normalized_key, lastfm_playcount, lastfm_status, lastfm_updated_at
         FROM user_album_stats
         WHERE user_id = $1
           AND (${statsPredicates.join(' OR ')})`,
        statsParams
      );
      statsRows = statsResult.rows;
    }

    const statsMap = buildStatsMap(statsRows, keyOf);
    const { playcounts, albumsToRefresh } = matchAndFindStale(
      listItems,
      statsMap,
      keyOf,
      forceRefresh
    );

    // Skip albums already being refreshed so concurrent list views / poll
    // cycles don't pile up duplicate Last.fm fetches.
    const albumsToLaunch = albumsToRefresh.filter((album) => {
      const inflightKey = `${userId}::${keyOf(album.artist, album.album)}`;
      if (inFlightRefreshes.has(inflightKey)) return false;
      inFlightRefreshes.add(inflightKey);
      return true;
    });

    if (albumsToLaunch.length > 0) {
      logger.debug('Triggering background playcount refresh for stale albums', {
        staleCount: albumsToRefresh.length,
        launching: albumsToLaunch.length,
        totalCount: listItems.length,
        lastfmUsername,
      });
      refreshPlaycountsInBackground(
        userId,
        lastfmUsername,
        albumsToLaunch,
        datastore,
        logger
      )
        .catch((err) => {
          logger.error('Background playcount refresh failed:', err);
        })
        .finally(() => {
          for (const album of albumsToLaunch) {
            inFlightRefreshes.delete(
              `${userId}::${keyOf(album.artist, album.album)}`
            );
          }
        });
    }

    // Report the full stale count (not just what we launched) so the client
    // keeps polling until in-flight refreshes from any caller complete.
    return { playcounts, refreshing: albumsToRefresh.length };
  }

  return { refreshPlaycountsInBackground, getListPlaycounts };
}

// Default instance for production use — callers import as before
const defaultInstance = createPlaycountService();

module.exports = {
  createPlaycountService,
  ...defaultInstance,
};
