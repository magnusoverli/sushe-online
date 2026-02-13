/**
 * Spotify Service
 *
 * Business logic for Spotify API interactions:
 * - Album search with normalization
 * - Track search with multi-step matching (number → name → fallback)
 * - Device listing and filtering
 * - Play with background playcount refresh scheduling
 *
 * Uses dependency injection via createSpotifyService(deps) factory.
 *
 * @module services/spotify-service
 */

const { normalizeForExternalApi } = require('../utils/normalization');
const {
  matchTrackByNumber,
  extractTrackName,
  matchTrackByName,
} = require('../utils/track-matching');

/**
 * @param {Object} deps
 * @param {Object} deps.fetch - Fetch implementation
 * @param {Object} [deps.logger] - Logger instance
 * @returns {Object} Spotify service methods
 */
function createSpotifyService(deps = {}) {
  const fetch = deps.fetch || globalThis.fetch;
  const logger = deps.logger || require('../utils/logger');

  /**
   * Search for an album on Spotify.
   * @param {string} artist
   * @param {string} album
   * @param {string} accessToken
   * @returns {Promise<{ id: string, error?: undefined } | { id?: undefined, error: Object }>}
   */
  async function searchAlbum(artist, album, accessToken) {
    const normalizedArtist = normalizeForExternalApi(artist);
    const normalizedAlbum = normalizeForExternalApi(album);
    const query = `album:${normalizedAlbum} artist:${normalizedArtist}`;
    const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=album&limit=1`;

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!resp.ok) {
      const errorData = await resp.json().catch(() => ({}));
      const errorMsg =
        errorData?.error?.message || `Spotify API error ${resp.status}`;
      logger.error('Spotify search API error:', {
        status: resp.status,
        error: errorMsg,
        artist,
        album,
      });
      return { error: { status: resp.status, message: errorMsg } };
    }

    const data = await resp.json();
    if (!data.albums || !data.albums.items.length) {
      logger.info('Album not found on Spotify', { artist, album });
      return { error: { status: 404, message: 'Album not found' } };
    }

    const albumId = data.albums.items[0].id;
    logger.info('Spotify search result', { albumId, artist, album });
    return { id: albumId };
  }

  /**
   * Search for a track on Spotify using multi-step matching:
   * 1. Find album → get tracks → match by number
   * 2. Match by name
   * 3. Fallback: general track search
   *
   * @param {string} artist
   * @param {string} album
   * @param {string} track - Track identifier (e.g. "3. Track Name")
   * @param {string} accessToken
   * @returns {Promise<{ id: string, name?: string } | { error: Object }>}
   */
  async function searchTrack(artist, album, track, accessToken) {
    const headers = { Authorization: `Bearer ${accessToken}` };
    const normalizedArtist = normalizeForExternalApi(artist);
    const normalizedAlbum = normalizeForExternalApi(album);

    // Step 1: Find the album
    const albumQuery = `album:${normalizedAlbum} artist:${normalizedArtist}`;
    const albumResp = await fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(albumQuery)}&type=album&limit=1`,
      { headers }
    );

    if (!albumResp.ok) {
      const errorText = await albumResp.text();
      logger.error('Spotify album search failed:', {
        status: albumResp.status,
        error: errorText,
      });
      return { error: { status: albumResp.status, message: errorText } };
    }

    const albumData = await albumResp.json();
    if (!albumData.albums || !albumData.albums.items.length) {
      logger.info('Album not found on Spotify', { artist, album });
      return { error: { status: 404, message: 'Album not found' } };
    }
    const spotifyAlbumId = albumData.albums.items[0].id;

    // Step 2: Get album tracks
    const tracksResp = await fetch(
      `https://api.spotify.com/v1/albums/${spotifyAlbumId}/tracks?limit=50`,
      { headers }
    );
    if (!tracksResp.ok) {
      return {
        error: {
          status: 502,
          message: `Spotify API error: ${tracksResp.statusText}`,
        },
      };
    }
    const tracksData = await tracksResp.json();
    const tracks = tracksData.items;

    if (!tracks || !Array.isArray(tracks) || tracks.length === 0) {
      return { error: { status: 404, message: 'Album has no tracks' } };
    }

    // Step 3: Match by track number
    const numberMatch = matchTrackByNumber(tracks, track);
    if (numberMatch) {
      logger.info('Spotify track matched by number:', {
        trackId: numberMatch.id,
        trackName: numberMatch.name,
      });
      return { id: numberMatch.id, name: numberMatch.name };
    }

    // Step 4: Match by track name
    const searchName = extractTrackName(track);
    const matchingTrack = matchTrackByName(tracks, searchName);
    if (matchingTrack) {
      logger.info('Spotify track matched by name:', {
        trackId: matchingTrack.id,
        trackName: matchingTrack.name,
      });
      return { id: matchingTrack.id, name: matchingTrack.name };
    }

    // Step 5: Fallback general track search
    const normalizedTrack = normalizeForExternalApi(searchName);
    const fallbackQuery = `track:${normalizedTrack} album:${normalizedAlbum} artist:${normalizedArtist}`;
    const fallbackResp = await fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(fallbackQuery)}&type=track&limit=1`,
      { headers }
    );
    if (fallbackResp.ok) {
      const fallbackData = await fallbackResp.json();
      if (fallbackData.tracks.items.length > 0) {
        const found = fallbackData.tracks.items[0];
        logger.info('Spotify track matched by fallback search:', {
          trackId: found.id,
          trackName: found.name,
        });
        return { id: found.id, name: found.name };
      }
    }

    logger.info('Track not found on Spotify:', { artist, album, track });
    return { error: { status: 404, message: 'Track not found' } };
  }

  /**
   * Get usable Spotify Connect devices (filters out restricted and ID-less).
   *
   * @param {string} accessToken
   * @returns {Promise<{ devices: Array } | { error: Object }>}
   */
  async function getDevices(accessToken) {
    const resp = await fetch('https://api.spotify.com/v1/me/player/devices', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!resp.ok) {
      const errorData = await resp.json().catch(() => ({}));
      return { error: { status: resp.status, errorData } };
    }

    const data = await resp.json();

    logger.info('Spotify API returned devices (raw):', {
      count: data.devices?.length || 0,
      devices: (data.devices || []).map((d) => ({
        name: d.name,
        id: d.id ? `${d.id.substring(0, 8)}...` : null,
        type: d.type,
        is_restricted: d.is_restricted,
        is_active: d.is_active,
      })),
    });

    const usableDevices = (data.devices || []).filter(
      (d) => !d.is_restricted && d.id
    );

    const filteredOut = (data.devices || []).filter(
      (d) => d.is_restricted || !d.id
    );
    if (filteredOut.length > 0) {
      logger.info('Devices filtered out:', {
        devices: filteredOut.map((d) => ({
          name: d.name,
          reason: !d.id ? 'no device ID' : 'is_restricted',
        })),
      });
    }

    logger.info(
      'Spotify devices found:',
      usableDevices.map((d) => d.name)
    );

    return { devices: usableDevices };
  }

  /**
   * Schedule a background playcount refresh after playback starts.
   * Fire-and-forget — errors are logged but never thrown.
   *
   * @param {Object} params
   * @param {string} params.spotifyAlbumId - Spotify album ID
   * @param {string} params.userId - User ID
   * @param {string} params.lastfmUsername - Last.fm username
   * @param {Object} params.pool - Database pool
   * @param {Function} params.refreshPlaycountsInBackground - Playcount refresh function
   */
  function schedulePlaycountRefresh({
    spotifyAlbumId,
    userId,
    lastfmUsername,
    pool,
    refreshPlaycountsInBackground,
  }) {
    const PLAY_REFRESH_DELAY_MS = 60000; // 60 seconds

    pool
      .query(
        `SELECT album_id, artist, album FROM albums WHERE spotify_id = $1`,
        [spotifyAlbumId]
      )
      .then((result) => {
        if (result.rows.length > 0) {
          const albumRow = result.rows[0];
          logger.debug('Scheduling playcount refresh after play', {
            artist: albumRow.artist,
            album: albumRow.album,
            delayMs: PLAY_REFRESH_DELAY_MS,
          });

          setTimeout(() => {
            refreshPlaycountsInBackground(
              userId,
              lastfmUsername,
              [
                {
                  itemId: albumRow.album_id,
                  artist: albumRow.artist,
                  album: albumRow.album,
                  albumId: albumRow.album_id,
                },
              ],
              pool,
              logger
            ).catch((err) => {
              logger.warn('Playcount refresh after play failed', {
                error: err.message,
              });
            });
          }, PLAY_REFRESH_DELAY_MS);
        }
      })
      .catch((err) => {
        logger.warn('Failed to look up album for playcount refresh', {
          spotifyAlbumId,
          error: err.message,
        });
      });
  }

  return {
    searchAlbum,
    searchTrack,
    getDevices,
    schedulePlaycountRefresh,
  };
}

module.exports = { createSpotifyService };
