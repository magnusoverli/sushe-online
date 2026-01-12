/**
 * Playback matching utilities
 * Consolidated from spotify-player.js and now-playing.js
 */

/**
 * Normalize a string for fuzzy matching
 * Removes diacritics, punctuation, and normalizes whitespace
 * @param {string} str - String to normalize
 * @returns {string} Normalized string
 */
export function normalizeForMatch(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/[^a-z0-9\s]/g, '') // Remove non-alphanumeric (keep spaces)
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

/**
 * Check if a list album matches the currently playing Spotify track
 * @param {Object} listAlbum - Album from the list with .album and .artist properties
 * @param {string} playingAlbumName - Currently playing album name
 * @param {string} playingArtistName - Currently playing artist name
 * @returns {boolean} True if album matches playback
 */
export function isAlbumMatchingPlayback(
  listAlbum,
  playingAlbumName,
  playingArtistName
) {
  if (!listAlbum || !playingAlbumName || !playingArtistName) return false;

  const albumMatch =
    normalizeForMatch(listAlbum.album) === normalizeForMatch(playingAlbumName);
  const artistMatch =
    normalizeForMatch(listAlbum.artist) ===
    normalizeForMatch(playingArtistName);

  return albumMatch && artistMatch;
}
