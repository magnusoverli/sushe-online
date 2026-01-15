/**
 * Deduplication Utilities
 *
 * Helpers for comparing list_item values with albums table to avoid storing
 * duplicate data. Returns NULL if values match (save storage), returns value
 * if different (custom override).
 *
 * Special handling:
 * - Genres (genre_1, genre_2): Always return NULL - genres are canonical and
 *   stored only in albums table, never as per-list overrides.
 * - Artist/Album: Sanitized before storage to ensure consistent encoding
 *   (e.g., ellipsis → three periods)
 *
 * Follows dependency injection pattern for testability.
 */

const { sanitizeForStorage } = require('./album-canonical');

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
   * Pre-fetch all album data for a batch of album IDs in a single query
   * Populates the cache so subsequent getStorableValue calls are instant
   *
   * @param {Array<string>} albumIds - Array of album IDs to prefetch
   * @param {Object} pool - Database pool
   * @returns {Promise<number>} - Number of albums fetched
   */
  async function prefetchAlbums(albumIds, pool) {
    // Filter out empty/null IDs and already-cached IDs
    const idsToFetch = albumIds.filter((id) => id && !albumCache.has(id));

    if (idsToFetch.length === 0) {
      return 0;
    }

    // Deduplicate
    const uniqueIds = [...new Set(idsToFetch)];

    // Single batch query for all albums
    const placeholders = uniqueIds.map((_, i) => `$${i + 1}`).join(',');
    const result = await pool.query(
      `SELECT album_id, artist, album, release_date, country, genre_1, genre_2, tracks, cover_image, cover_image_format 
       FROM albums WHERE album_id IN (${placeholders})`,
      uniqueIds
    );

    // Populate cache with results
    for (const row of result.rows) {
      albumCache.set(row.album_id, row);
    }

    // Also cache nulls for IDs not found (prevents re-querying)
    const foundIds = new Set(result.rows.map((r) => r.album_id));
    for (const id of uniqueIds) {
      if (!foundIds.has(id)) {
        albumCache.set(id, null);
      }
    }

    return result.rows.length;
  }

  /**
   * Convert value to Buffer for BYTEA storage
   * @param {*} value - Value to convert
   * @returns {Buffer|null} Buffer or null
   */
  function toBuffer(value) {
    if (!value) return null;
    return Buffer.isBuffer(value) ? value : Buffer.from(value, 'base64');
  }

  /**
   * Compare two cover images for equality
   * @param {*} albumValue - Album cover value
   * @param {*} listValue - List item cover value
   * @returns {boolean} True if images are equal
   */
  function coverImagesEqual(albumValue, listValue) {
    if (!albumValue || !listValue) return false;
    const albumBuffer = toBuffer(albumValue);
    const listBuffer = toBuffer(listValue);
    return albumBuffer && listBuffer && albumBuffer.equals(listBuffer);
  }

  /**
   * Get storable value for cover_image field
   * @param {*} listItemValue - List item cover value
   * @param {*} albumValue - Album cover value (if album exists)
   * @returns {Buffer|null} Buffer to store or null if duplicate
   */
  function getStorableCoverImage(listItemValue, albumValue) {
    if (albumValue && coverImagesEqual(albumValue, listItemValue)) {
      return null; // Duplicate
    }
    return toBuffer(listItemValue);
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
    // Genres are canonical - always use albums table, never store overrides
    if (field === 'genre_1' || field === 'genre_2') {
      return null;
    }

    // Sanitize artist/album names for consistent encoding
    // (e.g., ellipsis "…" → three periods "...")
    const shouldSanitize = field === 'artist' || field === 'album';
    const sanitizedValue = shouldSanitize
      ? sanitizeForStorage(listItemValue)
      : listItemValue;

    // No album reference or no value - store as-is (sanitized if applicable)
    if (!albumId || sanitizedValue === null || sanitizedValue === undefined) {
      if (field === 'cover_image') {
        return toBuffer(listItemValue);
      }
      return sanitizedValue || null;
    }

    // Fetch album data
    const albumData = await getAlbumData(albumId, pool);
    if (!albumData) {
      if (field === 'cover_image') {
        return toBuffer(listItemValue);
      }
      return sanitizedValue || null;
    }

    // Special handling for cover_image
    if (field === 'cover_image') {
      return getStorableCoverImage(listItemValue, albumData[field]);
    }

    // Compare values: if identical, return NULL (save space)
    const albumValue = albumData[field];
    const normalizedListValue = sanitizedValue === '' ? null : sanitizedValue;
    const normalizedAlbumValue = albumValue === '' ? null : albumValue;

    if (normalizedListValue === normalizedAlbumValue) {
      return null; // Duplicate
    }

    return sanitizedValue; // Different - store custom value (sanitized)
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
    prefetchAlbums,
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
