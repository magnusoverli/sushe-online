/**
 * Now Playing Module
 *
 * Handles visual indication of currently playing album in the list.
 * Shows a border around the album cover that matches current Spotify playback.
 * Uses dependency injection for testability.
 *
 * @module now-playing
 */

/**
 * Factory function to create the now-playing module with injected dependencies
 *
 * @param {Object} deps - Dependencies
 * @param {Function} deps.getListData - Get album array for a list
 * @param {Function} deps.getCurrentList - Get current list name
 * @returns {Object} Now playing module API
 */
export function createNowPlaying(deps = {}) {
  const { getListData, getCurrentList } = deps;

  // Module-level state
  let currentNowPlayingElements = [];
  let lastKnownPlayback = null;

  /**
   * Normalize a string for fuzzy matching (remove diacritics, punctuation, lowercase)
   * @param {string} str - String to normalize
   * @returns {string} Normalized string
   */
  function normalizeForMatch(str) {
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
   * @param {Object} listAlbum - Album from the list
   * @param {string} playingAlbumName - Currently playing album name
   * @param {string} playingArtistName - Currently playing artist name
   * @returns {boolean} True if album matches playback
   */
  function isAlbumMatchingPlayback(
    listAlbum,
    playingAlbumName,
    playingArtistName
  ) {
    if (!listAlbum || !playingAlbumName || !playingArtistName) return false;

    const albumMatch =
      normalizeForMatch(listAlbum.album) ===
      normalizeForMatch(playingAlbumName);
    const artistMatch =
      normalizeForMatch(listAlbum.artist) ===
      normalizeForMatch(playingArtistName);

    return albumMatch && artistMatch;
  }

  /**
   * Find the album cover DOM element for a given album index
   * @param {number} index - Album index in the list
   * @returns {HTMLElement|null} Cover element or null if not found
   */
  function findAlbumCoverElement(index) {
    const isMobile = window.innerWidth < 1024;

    if (isMobile) {
      // Mobile: album-card has data-index (not the wrapper)
      const card = document.querySelector(`.album-card[data-index="${index}"]`);
      // The cover wrapper div (not the img, since img can't have ::before)
      return card?.querySelector('.mobile-album-cover');
    } else {
      // Desktop: album rows have data-index
      const row = document.querySelector(`.album-row[data-index="${index}"]`);
      return row?.querySelector('.album-cover-container');
    }
  }

  /**
   * Update now-playing border based on playback state
   * Called when playback changes or when list is rendered
   * @param {Object} playbackDetail - Playback state from Spotify
   * @param {boolean} playbackDetail.hasPlayback - Whether there is active playback
   * @param {string} playbackDetail.albumName - Currently playing album name
   * @param {string} playbackDetail.artistName - Currently playing artist name
   */
  function updateNowPlayingBorder(playbackDetail) {
    // Remove existing borders from all previously marked elements
    currentNowPlayingElements.forEach((el) => {
      if (el) el.classList.remove('now-playing');
    });
    currentNowPlayingElements = [];

    // Cache the playback detail for re-application after list renders
    lastKnownPlayback = playbackDetail;

    // Exit if no playback or playback stopped (not paused)
    if (!playbackDetail || !playbackDetail.hasPlayback) {
      console.log('[Now Playing] No playback or stopped');
      return;
    }

    const currentList = getCurrentList();

    console.log('[Now Playing] Looking for:', {
      album: playbackDetail.albumName,
      artist: playbackDetail.artistName,
      currentList,
    });

    // Get current list albums
    const albums = getListData(currentList);
    if (!albums || !Array.isArray(albums)) {
      console.log('[Now Playing] No albums in current list');
      return;
    }

    // Find matching album(s) and apply the now-playing class
    let matchCount = 0;
    albums.forEach((album, index) => {
      if (
        isAlbumMatchingPlayback(
          album,
          playbackDetail.albumName,
          playbackDetail.artistName
        )
      ) {
        matchCount++;
        const coverEl = findAlbumCoverElement(index);
        console.log(
          '[Now Playing] Match found at index',
          index,
          '- element:',
          coverEl
        );
        if (coverEl) {
          coverEl.classList.add('now-playing');
          currentNowPlayingElements.push(coverEl);
        }
      }
    });

    if (matchCount === 0) {
      console.log(
        '[Now Playing] No matches in',
        albums.length,
        'albums. Sample album:',
        albums[0]
      );
    }
  }

  /**
   * Re-apply now-playing border after list render
   * Called from displayAlbums after DOM is updated
   */
  function reapplyNowPlayingBorder() {
    if (lastKnownPlayback) {
      // Small delay to ensure DOM is fully rendered
      requestAnimationFrame(() => {
        updateNowPlayingBorder(lastKnownPlayback);
      });
    }
  }

  /**
   * Get the last known playback state
   * @returns {Object|null} Last known playback detail
   */
  function getLastKnownPlayback() {
    return lastKnownPlayback;
  }

  /**
   * Initialize event listeners for playback changes
   */
  function initialize() {
    // Listen for playback changes from Spotify player module
    window.addEventListener('spotify-playback-change', (e) => {
      updateNowPlayingBorder(e.detail);
    });

    // Expose for manual triggering if needed
    window.updateNowPlayingBorder = updateNowPlayingBorder;
    window.reapplyNowPlayingBorder = reapplyNowPlayingBorder;
  }

  return {
    normalizeForMatch,
    isAlbumMatchingPlayback,
    findAlbumCoverElement,
    updateNowPlayingBorder,
    reapplyNowPlayingBorder,
    getLastKnownPlayback,
    initialize,
  };
}
