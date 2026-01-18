/**
 * Shared Helper Functions for API Routes
 *
 * These helpers are used across multiple route modules.
 */

// Import shared utilities
const { createAggregateList } = require('../../utils/aggregate-list');
const { createAlbumCanonical } = require('../../utils/album-canonical');

/**
 * Create helper functions with injected dependencies
 * @param {Object} deps - Dependencies
 * @param {Object} deps.pool - Database connection pool
 * @param {Object} deps.logger - Logger instance
 * @param {Object} deps.responseCache - Response cache instance
 * @param {Object} deps.app - Express app instance
 * @returns {Object} - Helper functions
 */
function createHelpers(deps) {
  const { pool, logger, responseCache, app } = deps;

  // Create aggregate list instance for recomputation triggers
  const aggregateList = createAggregateList({ pool, logger });

  // Create album canonical instance for deduplication
  const albumCanonical = createAlbumCanonical({ pool, logger });

  /**
   * Helper to trigger aggregate list recomputation for a year (non-blocking)
   * @param {number} year - The year to recompute
   */
  function triggerAggregateListRecompute(year) {
    if (!year) return;
    // Fire and forget - don't block the response
    aggregateList.recompute(year).catch((err) => {
      logger.error(`Failed to recompute aggregate list for year ${year}:`, err);
    });
  }

  /**
   * Helper to trigger album summary fetch for a new album (non-blocking)
   * @param {string} albumId - The album_id
   * @param {string} artist - The artist name
   * @param {string} albumName - The album name
   */
  function triggerAlbumSummaryFetch(albumId, artist, albumName) {
    // Get the album summary service from app.locals (set by admin.js)
    const albumSummaryService = app.locals?.albumSummaryService;
    if (albumSummaryService) {
      albumSummaryService.fetchSummaryAsync(albumId, artist, albumName);
    }
  }

  /**
   * Upsert an album record with canonical deduplication.
   *
   * This ensures only ONE entry per unique artist/album name exists in the
   * albums table, regardless of source (Spotify, MusicBrainz, Tidal, manual).
   *
   * @param {Object} album - Album data to upsert
   * @param {Date} timestamp - Timestamp for created_at/updated_at
   * @param {Object} client - Database client (optional, for transactions)
   * @returns {Promise<string>} - The canonical album_id to use
   */
  async function upsertAlbumRecord(album, timestamp, client = null) {
    const result = await albumCanonical.upsertCanonical(
      album,
      timestamp,
      client
    );

    // Trigger async summary fetch if needed
    if (result.needsSummaryFetch) {
      triggerAlbumSummaryFetch(result.albumId, album.artist, album.album);
    }

    return result.albumId;
  }

  /**
   * Invalidate list caches for all users who have a specific album in their lists.
   * This ensures that when canonical album data (e.g., genres) is updated,
   * all users who rely on the canonical data (stored NULL in list_items) see the update.
   *
   * @param {string} albumId - The album_id to find affected users for
   */
  async function invalidateCachesForAlbumUsers(albumId) {
    if (!albumId) return;

    try {
      // Find all users who have this album in any of their lists
      const result = await pool.query(
        `SELECT DISTINCT l.user_id 
         FROM lists l 
         JOIN list_items li ON li.list_id = l._id 
         WHERE li.album_id = $1`,
        [albumId]
      );

      // Invalidate list caches for each affected user
      for (const row of result.rows) {
        // Invalidate all list-related caches for this user
        // The pattern match will catch /api/lists and /api/lists/:name
        responseCache.invalidate(`GET:/api/lists:${row.user_id}`);
      }

      if (result.rows.length > 0) {
        logger.debug(
          `Invalidated caches for ${result.rows.length} users with album ${albumId}`
        );
      }
    } catch (error) {
      // Log but don't fail the request - cache invalidation is not critical
      logger.warn(`Failed to invalidate caches for album ${albumId}:`, error);
    }
  }

  return {
    triggerAggregateListRecompute,
    triggerAlbumSummaryFetch,
    upsertAlbumRecord,
    invalidateCachesForAlbumUsers,
    aggregateList,
    albumCanonical,
  };
}

module.exports = { createHelpers };
