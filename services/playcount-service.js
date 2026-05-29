/**
 * Playcount Service (Tier 2 — list view)
 *
 * Reads cached Last.fm play counts for a list, decides which are stale, and
 * launches a background refresh for those. Cached values are ALWAYS displayed
 * regardless of age; staleness only governs how often we ask Last.fm for
 * fresher numbers.
 *
 * The Last.fm fetch, cache writes, batching and in-flight dedup all live in
 * playcount-engine.js — this module only does read/match/launch.
 *
 * Uses a createPlaycountService(deps) factory so tests can inject a mock
 * refreshAlbumPlaycount; production uses the engine default.
 */

const { ensureDb } = require('../db/postgres');
const { normalizeAlbumKey } = require('../utils/fuzzy-match');
const { canonicalAlbumKey } = require('../utils/playcount-key');
const { LIST_VIEW_STALE_MS } = require('./playcount-constants');
const {
  refreshAlbumPlaycount: defaultRefreshAlbumPlaycount,
  refreshAlbumsBatched,
  claimAlbumsForRefresh,
} = require('./playcount-engine');

/**
 * Build a lookup map of cache key -> cached stats row. When duplicate keys
 * exist, keeps the row with the highest playcount (most recent update as
 * tiebreaker). Rows already carry a canonical `normalized_key`; the raw
 * normalizeAlbumKey fallback only covers legacy rows written before that
 * column existed (their artist/album_name are already canonicalized).
 *
 * @param {Array} statsRows - Rows from user_album_stats
 * @returns {Map<string, Object>}
 */
function buildStatsMap(statsRows) {
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
 * @param {Map} statsMap - Cache-key -> stats lookup
 * @param {Function} keyOf - Canonical cache-key function (artist, album) => key
 * @param {boolean} [forceRefresh=false]
 * @returns {{ playcounts: Object, albumsToRefresh: Array }}
 */
function matchAndFindStale(listItems, statsMap, keyOf, forceRefresh = false) {
  const playcounts = {};
  const albumsToRefresh = [];
  const staleThreshold = new Date(Date.now() - LIST_VIEW_STALE_MS);

  for (const item of listItems) {
    if (!item.artist || !item.album) continue;

    const key = keyOf(item.artist, item.album);
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
 * @param {Function} keyOf - Canonical cache-key function
 * @returns {{albumIds: string[], normalizedKeys: string[]}}
 */
function buildStatsLookupInputs(listItems, keyOf) {
  const albumIds = new Set();
  const normalizedKeys = new Set();

  for (const item of listItems) {
    if (item.album_id) {
      albumIds.add(item.album_id);
    }

    if (item.artist && item.album) {
      normalizedKeys.add(keyOf(item.artist, item.album));
    }
  }

  return {
    albumIds: [...albumIds],
    normalizedKeys: [...normalizedKeys],
  };
}

/**
 * Factory that creates the playcount read service with injectable deps.
 *
 * @param {Object} deps
 * @param {Function} [deps.refreshAlbumPlaycount] - single-album refresh (defaults to engine)
 * @returns {{ refreshPlaycountsInBackground: Function, getListPlaycounts: Function }}
 */
function createPlaycountService(deps = {}) {
  const refreshAlbumPlaycount =
    deps.refreshAlbumPlaycount || defaultRefreshAlbumPlaycount;

  /**
   * Refresh playcounts for a set of albums in the background.
   * @returns {Promise<Object>} Map of itemId -> { playcount, status } | null
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
    return refreshAlbumsBatched(
      datastore,
      logger,
      userId,
      lastfmUsername,
      albums,
      refreshAlbumPlaycount
    );
  }

  /**
   * Get playcounts for all albums in a list, returning cached data and
   * triggering a background refresh for stale entries.
   *
   * @param {Object} params
   * @param {string} params.listId
   * @param {string} params.userId
   * @param {string} params.lastfmUsername
   * @param {import('../db/types').DbFacade} params.db
   * @param {Object} params.logger
   * @param {Function} params.normalizeAlbumKey
   * @param {boolean} [params.forceRefresh=false]
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

    // Canonical key used for both cache lookups and matching, kept consistent
    // with the write path so accented/special-char names match.
    const keyOf = (artist, album) =>
      canonicalAlbumKey(normalizeAlbumKey, artist, album);

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

    const statsMap = buildStatsMap(statsRows);
    const { playcounts, albumsToRefresh } = matchAndFindStale(
      listItems,
      statsMap,
      keyOf,
      forceRefresh
    );

    // Skip albums already being refreshed (by any tier) so concurrent list
    // views / poll cycles don't pile up duplicate Last.fm fetches.
    const { toLaunch, release } = claimAlbumsForRefresh(
      userId,
      albumsToRefresh
    );

    if (toLaunch.length > 0) {
      logger.debug('Triggering background playcount refresh for stale albums', {
        staleCount: albumsToRefresh.length,
        launching: toLaunch.length,
        totalCount: listItems.length,
        lastfmUsername,
      });
      refreshPlaycountsInBackground(
        userId,
        lastfmUsername,
        toLaunch,
        datastore,
        logger
      )
        .catch((err) => {
          logger.error('Background playcount refresh failed:', err);
        })
        .finally(release);
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
