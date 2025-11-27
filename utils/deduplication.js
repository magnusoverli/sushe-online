/**
 * Deduplication Utilities
 *
 * Helpers for comparing list_item values with albums table to avoid storing
 * duplicate data. Returns NULL if values match (save storage), returns value
 * if different (custom override).
 *
 * Follows dependency injection pattern for testability.
 */

/**
 * Factory function to create deduplication helpers with injectable cache
 * @param {Object} deps - Dependencies
 * @param {Map} deps.cache - Cache instance (default: new Map())
 * @returns {Object} - Deduplication helper functions
 */
function createDeduplicationHelpers(deps = {}) {
  // Cache for album data during batch operations
  const albumCache = deps.cache || new Map();

  /**
   * Get album data from database with caching
   * @param {string} albumId - Album ID to look up
   * @param {Object} pool - Database pool
   * @returns {Promise<Object|null>} - Album data or null if not found
   */
  async function getAlbumData(albumId, pool) {
    if (!albumId) return null;

    if (albumCache.has(albumId)) {
      return albumCache.get(albumId);
    }

    const result = await pool.query(
      'SELECT artist, album, release_date, country, genre_1, genre_2, tracks, cover_image, cover_image_format FROM albums WHERE album_id = $1',
      [albumId]
    );

    const albumData = result.rows[0] || null;
    albumCache.set(albumId, albumData);
    return albumData;
  }

  /**
   * Clear the album cache (useful between batch operations)
   */
  function clearAlbumCache() {
    albumCache.clear();
  }

  /**
   * Get the cache size (for testing/monitoring)
   * @returns {number}
   */
  function getCacheSize() {
    return albumCache.size;
  }

  /**
   * Compare list_item value with albums table value
   * Returns NULL if they match (to save storage), or the value if different (custom override)
   *
   * @param {*} listItemValue - Value from list item
   * @param {string} albumId - Album ID to compare against
   * @param {string} field - Field name in album data
   * @param {Object} pool - Database pool
   * @returns {Promise<*>} - NULL if duplicate, value if different
   */
  async function getStorableValue(listItemValue, albumId, field, pool) {
    // No album reference or no value - store as-is
    if (!albumId || listItemValue === null || listItemValue === undefined) {
      return listItemValue || null;
    }

    // Fetch album data
    const albumData = await getAlbumData(albumId, pool);
    if (!albumData) {
      // No matching album in database - store the value
      return listItemValue || null;
    }

    // Compare values: if identical, return NULL (save space)
    // Handle both null/undefined and empty string as "no value"
    const albumValue = albumData[field];
    const normalizedListValue = listItemValue === '' ? null : listItemValue;
    const normalizedAlbumValue = albumValue === '' ? null : albumValue;

    if (normalizedListValue === normalizedAlbumValue) {
      return null; // Duplicate - don't store
    }

    return listItemValue; // Different - store custom value
  }

  /**
   * Special handler for tracks field (JSONB - needs deep comparison)
   *
   * @param {Array} listItemTracks - Tracks array from list item
   * @param {string} albumId - Album ID to compare against
   * @param {Object} pool - Database pool
   * @returns {Promise<string|null>} - JSON string if different, NULL if duplicate
   */
  async function getStorableTracksValue(listItemTracks, albumId, pool) {
    if (!albumId || !listItemTracks) {
      // JSONB columns need JSON string, not raw array
      return listItemTracks ? JSON.stringify(listItemTracks) : null;
    }

    const albumData = await getAlbumData(albumId, pool);
    if (!albumData || !albumData.tracks) {
      return JSON.stringify(listItemTracks);
    }

    // Deep comparison for JSONB
    const tracksEqual =
      JSON.stringify(listItemTracks) === JSON.stringify(albumData.tracks);
    // Return JSON string for JSONB column, or null if duplicate
    return tracksEqual ? null : JSON.stringify(listItemTracks);
  }

  return {
    getAlbumData,
    clearAlbumCache,
    getCacheSize,
    getStorableValue,
    getStorableTracksValue,
  };
}

// Create default instance for production use
const defaultHelpers = createDeduplicationHelpers();

module.exports = {
  createDeduplicationHelpers,
  ...defaultHelpers,
};
