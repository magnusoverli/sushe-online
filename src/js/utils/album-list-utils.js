/**
 * Album list comparison utilities.
 *
 * Standalone file (no heavy imports) so it can be used by modules
 * that are tested under the Node.js test runner without Vite aliases.
 *
 * @module album-list-utils
 */

/**
 * Creates a normalized key for album comparison (case-insensitive).
 * @param {Object} album - Album object with artist and album properties
 * @returns {string} Normalized key for comparison
 */
export function getAlbumKey(album) {
  return `${album.artist}::${album.album}`.toLowerCase();
}

/**
 * Checks if an album already exists in a list (case-insensitive by artist::album key).
 * @param {Object} album - Album to check
 * @param {Array} list - List of albums to check against
 * @returns {boolean} True if album exists in list
 */
export function isAlbumInList(album, list) {
  const key = getAlbumKey(album);
  return list.some((item) => getAlbumKey(item) === key);
}
