/**
 * Album API utilities.
 *
 * Shared API calls for album operations that are used across multiple modals
 * (similar-album-modal, duplicate-review-modal, manual-album-audit-modal).
 *
 * @module album-api
 */

import { apiCall } from '../modules/utils.js';

/**
 * Mark two albums as distinct so they won't be suggested as duplicates again.
 *
 * @param {string} albumId1 - First album ID
 * @param {string} albumId2 - Second album ID
 * @returns {Promise<{ok: boolean, error?: string}>} Result with ok flag and optional error
 */
export async function markAlbumsDistinct(albumId1, albumId2) {
  try {
    await apiCall('/api/albums/mark-distinct', {
      method: 'POST',
      body: JSON.stringify({
        album_id_1: albumId1,
        album_id_2: albumId2,
      }),
    });

    return { ok: true };
  } catch (err) {
    console.error('Failed to mark albums as distinct:', err);
    return { ok: false, error: err.error || err.message };
  }
}
