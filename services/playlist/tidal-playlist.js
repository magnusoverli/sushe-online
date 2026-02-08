/**
 * Tidal Playlist Service
 *
 * Handles Tidal-specific playlist creation, track searching,
 * and playlist management.
 */

const {
  resolveTrackPicks,
  processTrackBatches,
} = require('./playlist-helpers');

/**
 * Create Tidal playlist service
 * @param {Object} deps - Dependencies
 * @param {Object} deps.logger - Logger instance
 * @returns {Object} - Tidal playlist service functions
 */
// eslint-disable-next-line max-lines-per-function -- Factory function with complex playlist handling logic extracted from api.js
function createTidalPlaylistService(deps) {
  const { logger } = deps;

  const BASE_URL = 'https://openapi.tidal.com/v2';

  /**
   * Check if playlist exists in Tidal
   * @param {string} playlistName - Name of the playlist
   * @param {Object} auth - Authentication object with access_token
   * @returns {Promise<boolean>} - Whether playlist exists
   */
  async function checkPlaylistExists(playlistName, auth) {
    const headers = {
      Authorization: `Bearer ${auth.access_token}`,
      Accept: 'application/vnd.api+json',
    };

    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      try {
        const resp = await fetch(
          `${BASE_URL}/me/playlists?limit=50&offset=${offset}`,
          { headers }
        );

        if (resp.ok) {
          const playlists = await resp.json();
          const exists = playlists.data.some(
            (p) => p.attributes.title === playlistName
          );
          if (exists) return true;

          hasMore = playlists.data.length === 50;
          offset += 50;
        } else {
          return false;
        }
      } catch (_err) {
        return false;
      }
    }
    return false;
  }

  /**
   * Find Tidal track ID with caching
   * @param {Object} item - Album item with artist, album, trackPick
   * @param {Object} auth - Authentication object
   * @param {string} countryCode - User's country code
   * @param {Map} albumCache - Cache for album data
   * @param {string} trackIdentifier - Specific track to search for
   * @returns {Promise<string|null>} - Tidal track ID or null
   */
  async function findTrack(
    item,
    auth,
    countryCode = 'US',
    albumCache = new Map(),
    trackIdentifier = null
  ) {
    // Use explicit trackIdentifier if provided, otherwise fall back to item's track picks
    const { primaryTrack } = resolveTrackPicks(item);
    const trackPick = trackIdentifier || primaryTrack;
    const headers = {
      Authorization: `Bearer ${auth.access_token}`,
      Accept: 'application/vnd.api+json',
    };

    // First try to search for the album and get tracks
    try {
      const cacheKey = `${item.artist}::${item.album}`;
      let albumData = albumCache.get(cacheKey);

      if (!albumData) {
        const albumQuery = `${item.artist} ${item.album}`;
        const albumSearchResp = await fetch(
          `https://openapi.tidal.com/v2/searchresults/albums?query=${encodeURIComponent(albumQuery)}&countryCode=${countryCode}&limit=1`,
          { headers }
        );

        if (albumSearchResp.ok) {
          const searchData = await albumSearchResp.json();
          if (searchData.data && searchData.data.length > 0) {
            const tidalAlbumId = searchData.data[0].id;

            // Get album tracks
            const tracksResp = await fetch(
              `https://openapi.tidal.com/v2/albums/${tidalAlbumId}/items?countryCode=${countryCode}`,
              { headers }
            );

            if (tracksResp.ok) {
              const tracksData = await tracksResp.json();
              albumData = {
                id: tidalAlbumId,
                tracks: tracksData.data || [],
              };
              albumCache.set(cacheKey, albumData);
            }
          }
        }
      }

      if (albumData && albumData.tracks) {
        // Try to match by track number
        const trackNum = parseInt(trackPick);
        if (
          !isNaN(trackNum) &&
          trackNum > 0 &&
          trackNum <= albumData.tracks.length
        ) {
          return albumData.tracks[trackNum - 1].id;
        }

        // Try to match by track name
        const matchingTrack = albumData.tracks.find(
          (t) =>
            t.attributes.title
              .toLowerCase()
              .includes(trackPick.toLowerCase()) ||
            trackPick.toLowerCase().includes(t.attributes.title.toLowerCase())
        );
        if (matchingTrack) {
          return matchingTrack.id;
        }
      }
    } catch (err) {
      logger.debug('Tidal album-based track search failed:', err);
    }

    // Fallback to general track search
    try {
      const query = `${trackPick} ${item.album} ${item.artist}`;
      const searchResp = await fetch(
        `https://openapi.tidal.com/v2/searchresults/tracks?query=${encodeURIComponent(query)}&countryCode=${countryCode}&limit=1`,
        { headers }
      );

      if (searchResp.ok) {
        const searchData = await searchResp.json();
        if (searchData.data && searchData.data.length > 0) {
          return searchData.data[0].id;
        }
      }
    } catch (err) {
      logger.debug('Tidal track search failed:', err);
    }

    return null;
  }

  /**
   * Handle Tidal playlist creation/update
   * @param {string} playlistName - Name of the playlist
   * @param {Array} items - List items with track picks
   * @param {Object} auth - Authentication object
   * @param {Object} user - User object
   * @param {Object} result - Result object to populate
   * @returns {Promise<Object>} - Updated result object
   */
  async function handlePlaylist(playlistName, items, auth, user, result) {
    const headers = {
      Authorization: `Bearer ${auth.access_token}`,
      'Content-Type': 'application/vnd.api+json',
      Accept: 'application/vnd.api+json',
    };

    // Get user's Tidal profile
    const profileResp = await fetch(`${BASE_URL}/me`, { headers });
    if (!profileResp.ok) {
      throw new Error(`Failed to get Tidal profile: ${profileResp.status}`);
    }
    const profile = await profileResp.json();
    const _userId = profile.data.id;

    // Check if playlist exists
    let playlistId = null;
    let existingPlaylist;

    try {
      const playlistsResp = await fetch(`${BASE_URL}/me/playlists?limit=50`, {
        headers,
      });
      if (playlistsResp.ok) {
        const playlists = await playlistsResp.json();
        existingPlaylist = playlists.data.find(
          (p) => p.attributes.title === playlistName
        );
        if (existingPlaylist) {
          playlistId = existingPlaylist.id;
        }
      }
    } catch (err) {
      logger.debug('Error fetching Tidal playlists:', err);
    }

    // Create playlist if it doesn't exist
    if (!playlistId) {
      const createResp = await fetch(`${BASE_URL}/playlists`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          data: {
            type: 'playlists',
            attributes: {
              title: playlistName,
              description: `Created from SuShe Online list "${playlistName}"`,
              public: false,
            },
          },
        }),
      });

      if (!createResp.ok) {
        const errorText = await createResp.text();
        logger.error(
          'Tidal playlist creation failed:',
          createResp.status,
          errorText
        );
        throw new Error(
          `Failed to create Tidal playlist: ${createResp.status}`
        );
      }

      const newPlaylist = await createResp.json();
      playlistId = newPlaylist.data.id;
      result.playlistUrl = `https://tidal.com/browse/playlist/${playlistId}`;
    } else {
      result.playlistUrl = `https://tidal.com/browse/playlist/${playlistId}`;
    }

    // Collect track IDs with parallel processing
    // Process both primary and secondary tracks for each album
    const albumCache = new Map();
    const countryCode = user.tidalCountry || 'US';
    const boundFindTrack = (item, trackIdentifier) =>
      findTrack(item, auth, countryCode, albumCache, trackIdentifier);

    const trackIds = await processTrackBatches(items, boundFindTrack, result);

    // Update playlist with tracks
    if (trackIds.length > 0) {
      // Clear existing tracks first
      try {
        await fetch(`${BASE_URL}/playlists/${playlistId}/items`, {
          method: 'DELETE',
          headers,
        });
      } catch (err) {
        logger.debug('Error clearing Tidal playlist:', err);
      }

      // Add new tracks in batches
      for (let i = 0; i < trackIds.length; i += 50) {
        const batch = trackIds.slice(i, i + 50);
        const trackData = batch.map((id) => ({
          type: 'tracks',
          id: id,
        }));

        try {
          const addResp = await fetch(
            `${BASE_URL}/playlists/${playlistId}/items`,
            {
              method: 'POST',
              headers,
              body: JSON.stringify({
                data: trackData,
              }),
            }
          );

          if (!addResp.ok) {
            logger.warn(
              `Failed to add Tidal tracks batch ${i}-${i + batch.length}: ${addResp.status}`
            );
          }
        } catch (err) {
          logger.warn(`Error adding Tidal tracks batch:`, err);
        }
      }
    }

    return result;
  }

  return {
    checkPlaylistExists,
    findTrack,
    handlePlaylist,
  };
}

module.exports = { createTidalPlaylistService };
