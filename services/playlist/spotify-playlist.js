/**
 * Spotify Playlist Service
 *
 * Handles Spotify-specific playlist creation, track searching,
 * and playlist management.
 */

/**
 * Create Spotify playlist service
 * @param {Object} deps - Dependencies
 * @param {Object} deps.logger - Logger instance
 * @returns {Object} - Spotify playlist service functions
 */
// eslint-disable-next-line max-lines-per-function -- Factory function with complex playlist handling logic extracted from api.js
function createSpotifyPlaylistService(deps) {
  const { logger } = deps;

  const BASE_URL = 'https://api.spotify.com/v1';

  /**
   * Check if playlist exists in Spotify
   * @param {string} playlistName - Name of the playlist
   * @param {Object} auth - Authentication object with access_token
   * @returns {Promise<boolean>} - Whether playlist exists
   */
  async function checkPlaylistExists(playlistName, auth) {
    const headers = {
      Authorization: `Bearer ${auth.access_token}`,
    };

    let offset = 0;
    let hasMore = true;
    let totalChecked = 0;
    let allPlaylistNames = [];

    while (hasMore) {
      try {
        const url = `${BASE_URL}/me/playlists?limit=50&offset=${offset}`;
        logger.info('Fetching Spotify playlists:', { url, offset });

        const resp = await fetch(url, { headers });

        if (resp.ok) {
          const playlists = await resp.json();
          totalChecked += playlists.items.length;

          // Collect all playlist names for debugging
          allPlaylistNames = allPlaylistNames.concat(
            playlists.items.map((p) => p.name)
          );

          // Log details about this batch
          logger.info('Spotify playlists batch:', {
            count: playlists.items.length,
            total: playlists.total,
            offset,
            hasNext: playlists.next !== null,
            nextUrl: playlists.next,
            searchingFor: playlistName,
            batchNames: playlists.items.map((p) => ({
              name: p.name,
              owner: p.owner.display_name || p.owner.id,
              collaborative: p.collaborative,
              public: p.public,
            })),
          });

          const exists = playlists.items.some((p) => {
            // Log every comparison for debugging
            logger.debug('Comparing playlist names:', {
              searchName: playlistName,
              searchNameLength: playlistName.length,
              searchNameType: typeof playlistName,
              spotifyName: p.name,
              spotifyNameLength: p.name.length,
              spotifyNameType: typeof p.name,
              exactMatch: p.name === playlistName,
              caseInsensitiveMatch:
                p.name.toLowerCase() === playlistName.toLowerCase(),
              trimmedMatch: p.name.trim() === playlistName.trim(),
            });

            const match = p.name === playlistName;
            if (match) {
              logger.info('Found matching Spotify playlist:', {
                searchName: playlistName,
                foundName: p.name,
                playlistId: p.id,
              });
            }
            return match;
          });

          if (exists) return true;

          hasMore = playlists.next !== null;
          offset += 50;
        } else {
          logger.error('Failed to fetch Spotify playlists:', {
            status: resp.status,
            statusText: resp.statusText,
          });
          return false;
        }
      } catch (err) {
        logger.error('Error fetching Spotify playlists:', err);
        return false;
      }
    }

    logger.info('Playlist search complete', {
      totalChecked,
      searchName: playlistName,
      searchNameLength: playlistName.length,
      found: false,
      allPlaylistNames: allPlaylistNames.slice(0, 100), // Log first 100 names
      totalPlaylists: allPlaylistNames.length,
    });
    return false;
  }

  /**
   * Find Spotify track URI with caching
   * @param {Object} item - Album item with artist, album, trackPick
   * @param {Object} auth - Authentication object
   * @param {Map} albumCache - Cache for album data
   * @param {string} trackIdentifier - Specific track to search for
   * @returns {Promise<string|null>} - Spotify track URI or null
   */
  async function findTrack(
    item,
    auth,
    albumCache = new Map(),
    trackIdentifier = null
  ) {
    // Use explicit trackIdentifier if provided, otherwise fall back to item's track picks
    const trackPick =
      trackIdentifier ||
      item.primaryTrack ||
      item.primary_track ||
      item.trackPick ||
      item.track_pick;
    const headers = {
      Authorization: `Bearer ${auth.access_token}`,
    };

    // First try to get album tracks if we have album_id
    if (item.albumId) {
      try {
        const cacheKey = `${item.artist}::${item.album}`;
        let albumData = albumCache.get(cacheKey);

        if (!albumData) {
          const albumResp = await fetch(
            `${BASE_URL}/search?q=album:${encodeURIComponent(item.album)} artist:${encodeURIComponent(item.artist)}&type=album&limit=1`,
            { headers }
          );
          if (albumResp.ok) {
            const data = await albumResp.json();
            if (data.albums.items.length > 0) {
              const spotifyAlbumId = data.albums.items[0].id;
              const tracksResp = await fetch(
                `${BASE_URL}/albums/${spotifyAlbumId}/tracks`,
                { headers }
              );
              if (tracksResp.ok) {
                const tracksData = await tracksResp.json();
                albumData = {
                  id: spotifyAlbumId,
                  // Spotify /albums/{id}/tracks returns items directly, not nested under tracks
                  tracks: tracksData.items,
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
            return albumData.tracks[trackNum - 1].uri;
          }

          // Try to match by track name
          const matchingTrack = albumData.tracks.find(
            (t) =>
              t.name.toLowerCase().includes(trackPick.toLowerCase()) ||
              trackPick.toLowerCase().includes(t.name.toLowerCase())
          );
          if (matchingTrack) {
            return matchingTrack.uri;
          }
        }
      } catch (err) {
        logger.debug('Album-based track search failed:', err);
      }
    }

    // Fallback to general track search
    try {
      const query = `track:${trackPick} album:${item.album} artist:${item.artist}`;
      const searchResp = await fetch(
        `${BASE_URL}/search?q=${encodeURIComponent(query)}&type=track&limit=1`,
        { headers }
      );
      if (searchResp.ok) {
        const searchData = await searchResp.json();
        if (searchData.tracks.items.length > 0) {
          return searchData.tracks.items[0].uri;
        }
      }
    } catch (err) {
      logger.debug('Track search failed:', err);
    }

    return null;
  }

  /**
   * Handle Spotify playlist creation/update
   * @param {string} playlistName - Name of the playlist
   * @param {Array} items - List items with track picks
   * @param {Object} auth - Authentication object
   * @param {Object} user - User object
   * @param {Object} result - Result object to populate
   * @returns {Promise<Object>} - Updated result object
   */
  // eslint-disable-next-line max-lines-per-function -- Complex playlist handling with multiple API calls
  async function handlePlaylist(playlistName, items, auth, user, result) {
    logger.debug('Starting Spotify playlist creation', {
      playlistName,
      itemCount: items.length,
    });

    const headers = {
      Authorization: `Bearer ${auth.access_token}`,
      'Content-Type': 'application/json',
    };

    // Get user's Spotify profile
    logger.debug('Fetching Spotify profile');
    const profileResp = await fetch(`${BASE_URL}/me`, { headers });
    if (!profileResp.ok) {
      const errorText = await profileResp.text();
      logger.error('Spotify profile fetch failed', {
        status: profileResp.status,
        error: errorText,
      });
      throw new Error(
        `Failed to get Spotify profile: ${profileResp.status} - ${errorText}`
      );
    }
    const profile = await profileResp.json();
    logger.debug('Spotify profile fetched', { userId: profile.id });

    // Check if playlist exists
    let playlistId = null;
    let existingPlaylist = null;

    logger.debug('Checking for existing playlists');
    const playlistsResp = await fetch(`${BASE_URL}/me/playlists?limit=50`, {
      headers,
    });
    if (playlistsResp.ok) {
      const playlists = await playlistsResp.json();
      existingPlaylist = playlists.items.find((p) => p.name === playlistName);
      if (existingPlaylist) {
        playlistId = existingPlaylist.id;
        logger.debug('Found existing playlist', { playlistId });
      } else {
        logger.debug('No existing playlist found');
      }
    } else {
      const errorText = await playlistsResp.text();
      logger.error('Failed to fetch playlists', {
        status: playlistsResp.status,
        error: errorText,
      });
    }

    // Create playlist if it doesn't exist
    if (!playlistId) {
      logger.debug('Creating new playlist');
      const createResp = await fetch(
        `${BASE_URL}/users/${profile.id}/playlists`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            name: playlistName,
            description: `Created from SuShe Online list "${playlistName}"`,
            public: false,
          }),
        }
      );

      if (!createResp.ok) {
        const errorText = await createResp.text();
        logger.error('Failed to create playlist', {
          status: createResp.status,
          error: errorText,
        });
        throw new Error(
          `Failed to create Spotify playlist: ${createResp.status} - ${errorText}`
        );
      }

      const newPlaylist = await createResp.json();
      playlistId = newPlaylist.id;
      result.playlistUrl = newPlaylist.external_urls.spotify;
    } else {
      result.playlistUrl = existingPlaylist.external_urls.spotify;
    }

    // Collect track URIs with parallel processing
    // Process both primary and secondary tracks for each album
    const trackUris = [];
    const albumCache = new Map();

    // Process albums in parallel batches to respect rate limits
    const batchSize = 10;
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);

      const batchResults = await Promise.allSettled(
        batch.map(async (item) => {
          result.processed++;

          // Get primary and secondary tracks from normalized fields or legacy
          const primaryTrack =
            item.primaryTrack ||
            item.primary_track ||
            item.trackPick ||
            item.track_pick;
          const secondaryTrack = item.secondaryTrack || item.secondary_track;

          const itemResults = [];

          // Process primary track
          if (primaryTrack && primaryTrack.trim()) {
            try {
              const trackUri = await findTrack(
                item,
                auth,
                albumCache,
                primaryTrack
              );
              if (trackUri) {
                itemResults.push({
                  success: true,
                  item,
                  trackUri,
                  trackPick: primaryTrack,
                  isPrimary: true,
                });
              } else {
                itemResults.push({
                  success: false,
                  item,
                  trackPick: primaryTrack,
                  isPrimary: true,
                  error: `Track not found: "${item.artist} - ${item.album}" - Primary: ${primaryTrack}`,
                });
              }
            } catch (err) {
              itemResults.push({
                success: false,
                item,
                trackPick: primaryTrack,
                isPrimary: true,
                error: `Error searching for "${item.artist} - ${item.album}" primary: ${err.message}`,
              });
            }
          } else {
            itemResults.push({
              success: false,
              item,
              isPrimary: true,
              error: `Skipped "${item.artist} - ${item.album}": no track selected`,
            });
          }

          // Process secondary track if it exists
          if (secondaryTrack && secondaryTrack.trim()) {
            try {
              const trackUri = await findTrack(
                item,
                auth,
                albumCache,
                secondaryTrack
              );
              if (trackUri) {
                itemResults.push({
                  success: true,
                  item,
                  trackUri,
                  trackPick: secondaryTrack,
                  isPrimary: false,
                });
              } else {
                itemResults.push({
                  success: false,
                  item,
                  trackPick: secondaryTrack,
                  isPrimary: false,
                  error: `Track not found: "${item.artist} - ${item.album}" - Secondary: ${secondaryTrack}`,
                });
              }
            } catch (err) {
              itemResults.push({
                success: false,
                item,
                trackPick: secondaryTrack,
                isPrimary: false,
                error: `Error searching for "${item.artist} - ${item.album}" secondary: ${err.message}`,
              });
            }
          }

          return itemResults;
        })
      );

      // Process batch results - flatten since each item can have multiple tracks
      for (const promiseResult of batchResults) {
        if (promiseResult.status === 'fulfilled') {
          const trackResults = promiseResult.value;
          for (const trackResult of trackResults) {
            if (trackResult.success) {
              trackUris.push(trackResult.trackUri);
              result.successful++;
              result.tracks.push({
                artist: trackResult.item.artist,
                album: trackResult.item.album,
                track: trackResult.trackPick,
                isPrimary: trackResult.isPrimary,
                found: true,
              });
            } else {
              result.failed++;
              result.errors.push(trackResult.error);
              if (trackResult.trackPick) {
                result.tracks.push({
                  artist: trackResult.item.artist,
                  album: trackResult.item.album,
                  track: trackResult.trackPick,
                  isPrimary: trackResult.isPrimary,
                  found: false,
                });
              }
            }
          }
        } else {
          result.failed++;
          result.errors.push(`Unexpected error: ${promiseResult.reason}`);
        }
      }
    }

    // Update playlist with tracks
    if (trackUris.length > 0) {
      // Clear existing tracks
      await fetch(`${BASE_URL}/playlists/${playlistId}/tracks`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ uris: [] }),
      });

      // Add new tracks in batches of 100 (Spotify limit)
      for (let i = 0; i < trackUris.length; i += 100) {
        const batch = trackUris.slice(i, i + 100);
        const addResp = await fetch(
          `${BASE_URL}/playlists/${playlistId}/tracks`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ uris: batch }),
          }
        );

        if (!addResp.ok) {
          logger.warn(
            `Failed to add tracks batch ${i}-${i + batch.length}: ${addResp.status}`
          );
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

module.exports = { createSpotifyPlaylistService };
