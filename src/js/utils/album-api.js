/**
 * Album API utilities.
 *
 * Shared API calls for album operations that are used across multiple modals
 * (similar-album-modal, duplicate-review-modal, manual-album-audit-modal).
 *
 * @module album-api
 */

/**
 * Mark two albums as distinct so they won't be suggested as duplicates again.
 *
 * @param {string} albumId1 - First album ID
 * @param {string} albumId2 - Second album ID
 * @returns {Promise<{ok: boolean, error?: string}>} Result with ok flag and optional error
 */
export async function markAlbumsDistinct(albumId1, albumId2) {
  try {
    const response = await fetch('/api/albums/mark-distinct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        album_id_1: albumId1,
        album_id_2: albumId2,
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return { ok: false, error: data.error || 'Failed to mark as distinct' };
    }

    return { ok: true };
  } catch (err) {
    console.error('Failed to mark albums as distinct:', err);
    return { ok: false, error: err.message };
  }
}
