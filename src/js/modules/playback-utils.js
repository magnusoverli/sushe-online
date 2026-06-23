/**
 * Playback matching utilities
 * Used by spotify-player.js to match albums against current playback
 */

// Import normalizeForMatch from centralized normalization module
import { normalizeForMatch } from './normalization.js';

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
