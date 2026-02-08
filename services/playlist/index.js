/**
 * Playlist Service
 *
 * Coordinates playlist creation and management across music services
 * (Spotify and Tidal).
 *
 * Uses dependency injection pattern for testability.
 */

const { createSpotifyPlaylistService } = require('./spotify-playlist');
const { createTidalPlaylistService } = require('./tidal-playlist');
const { resolveTrackPicks } = require('./playlist-helpers');

/**
 * Create playlist service
 * @param {Object} deps - Dependencies
 * @param {Object} deps.logger - Logger instance
 * @returns {Object} - Playlist service functions
 */
function createPlaylistService(deps) {
  const { logger } = deps;

  const spotifyService = createSpotifyPlaylistService({ logger });
  const tidalService = createTidalPlaylistService({ logger });

  /**
   * Check if playlist exists in the music service
   * @param {string} playlistName - Name of the playlist
   * @param {string} targetService - 'spotify' or 'tidal'
   * @param {Object} auth - Authentication object with access_token
   * @returns {Promise<boolean>} - Whether playlist exists
   */
  async function checkPlaylistExists(playlistName, targetService, auth) {
    logger.info('checkPlaylistExists called:', { playlistName, targetService });

    if (targetService === 'spotify') {
      return spotifyService.checkPlaylistExists(playlistName, auth);
    } else if (targetService === 'tidal') {
      return tidalService.checkPlaylistExists(playlistName, auth);
    }

    return false;
  }

  /**
   * Pre-flight validation for playlist creation
   * @param {Array} items - List items with track picks
   * @param {string} _service - Target service (unused but kept for signature compatibility)
   * @param {Object} _auth - Auth object (unused but kept for signature compatibility)
   * @returns {Promise<Object>} - Validation result
   */
  async function validatePlaylistData(items, _service, _auth) {
    const validation = {
      totalAlbums: items.length,
      albumsWithTracks: 0,
      albumsWithPrimaryOnly: 0,
      albumsWithBothTracks: 0,
      albumsWithoutTracks: 0,
      estimatedTracks: 0,
      warnings: [],
      canProceed: true,
    };

    for (const item of items) {
      const { primaryTrack, secondaryTrack } = resolveTrackPicks(item);

      if (primaryTrack && primaryTrack.trim()) {
        validation.albumsWithTracks++;
        validation.estimatedTracks++;

        if (secondaryTrack && secondaryTrack.trim()) {
          validation.albumsWithBothTracks++;
          validation.estimatedTracks++; // Secondary adds another track
        } else {
          validation.albumsWithPrimaryOnly++;
        }
      } else {
        validation.albumsWithoutTracks++;
        validation.warnings.push(
          `"${item.artist} - ${item.album}" has no selected track`
        );
      }
    }

    if (validation.albumsWithoutTracks > 0) {
      validation.warnings.unshift(
        `${validation.albumsWithoutTracks} albums will be skipped (no selected tracks)`
      );
    }

    if (validation.estimatedTracks === 0) {
      validation.canProceed = false;
      validation.warnings.push(
        'No tracks selected. Please select tracks from your albums first.'
      );
    }

    return validation;
  }

  /**
   * Create or update playlist in the specified service
   * @param {string} playlistName - Name of the playlist
   * @param {Array} items - List items with track picks
   * @param {string} service - 'spotify' or 'tidal'
   * @param {Object} auth - Authentication object
   * @param {Object} user - User object
   * @param {Object} _validation - Validation result (unused)
   * @returns {Promise<Object>} - Result object with tracks, errors, etc.
   */
  async function createOrUpdatePlaylist(
    playlistName,
    items,
    service,
    auth,
    user,
    _validation
  ) {
    const result = {
      service,
      playlistName,
      processed: 0,
      successful: 0,
      failed: 0,
      tracks: [],
      errors: [],
      playlistUrl: null,
    };

    try {
      if (service === 'spotify') {
        return await spotifyService.handlePlaylist(
          playlistName,
          items,
          auth,
          user,
          result
        );
      } else if (service === 'tidal') {
        return await tidalService.handlePlaylist(
          playlistName,
          items,
          auth,
          user,
          result
        );
      }
    } catch (err) {
      logger.error(`${service} playlist error:`, err);
      logger.error(`${service} error stack:`, err.stack);
      throw err;
    }
  }

  return {
    checkPlaylistExists,
    validatePlaylistData,
    createOrUpdatePlaylist,
    // Expose individual services for direct access if needed
    spotify: spotifyService,
    tidal: tidalService,
  };
}

module.exports = { createPlaylistService };
