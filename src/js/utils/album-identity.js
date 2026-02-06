/**
 * Album identity utilities for creating and verifying album identity strings.
 * Used to verify that an album at a given index hasn't been moved/removed.
 */

/**
 * Create an identity string for an album.
 * Format: "artist::album::release_date" (lowercased)
 * @param {Object} album - Album object with artist, album, and optional release_date
 * @returns {string} Identity string
 */
export function createAlbumIdentity(album) {
  return `${album.artist}::${album.album}::${album.release_date || ''}`.toLowerCase();
}

/**
 * Verify that an album at the given index matches the expected identity,
 * with fallback to identity-based search if the index is stale.
 *
 * @param {Array} albums - The album array to search
 * @param {number} index - Expected index of the album
 * @param {string} expectedIdentityId - The expected identity string
 * @param {Function} findAlbumByIdentity - Function to search by identity (returns {album, index} or null)
 * @returns {{ album: Object, index: number } | null} Resolved album and index, or null if not found
 */
export function verifyAlbumAtIndex(
  albums,
  index,
  expectedIdentityId,
  findAlbumByIdentity
) {
  const album = albums && albums[index];

  if (album && expectedIdentityId) {
    const actualId = createAlbumIdentity(album);
    if (actualId === expectedIdentityId) {
      return { album, index };
    }
    // Index is stale, search by identity
    const result = findAlbumByIdentity(expectedIdentityId);
    if (result) {
      return result;
    }
    return null;
  }

  if (!album) {
    // No album at index, try identity search
    if (expectedIdentityId) {
      return findAlbumByIdentity(expectedIdentityId);
    }
    return null;
  }

  // Album exists but no identity to verify against
  return { album, index };
}
