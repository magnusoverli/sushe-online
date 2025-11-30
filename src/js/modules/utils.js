import { apiCall as appApiCall } from '../app.js';
import { showToast as uiShowToast } from './ui-utils.js';

export const showToast = uiShowToast;
export const apiCall = appApiCall;

/**
 * Creates a normalized key for album comparison (case-insensitive)
 * @param {Object} album - Album object with artist and album properties
 * @returns {string} Normalized key for comparison
 */
export function getAlbumKey(album) {
  return `${album.artist}::${album.album}`.toLowerCase();
}

/**
 * Checks if an album already exists in a list
 * @param {Object} album - Album to check
 * @param {Array} list - List of albums to check against
 * @returns {boolean} True if album exists in list
 */
export function isAlbumInList(album, list) {
  const key = getAlbumKey(album);
  return list.some((item) => getAlbumKey(item) === key);
}
