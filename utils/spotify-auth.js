// utils/spotify-auth.js
// Spotify OAuth token refresh utilities

const logger = require('./logger');

/**
 * Create Spotify auth utilities with injected dependencies
 * @param {Object} deps - Dependencies
 * @param {Object} deps.logger - Logger instance
 * @param {Function} deps.fetch - Fetch function (defaults to global fetch)
 * @param {Object} deps.env - Environment variables (defaults to process.env)
 */
function createSpotifyAuth(deps = {}) {
  const log = deps.logger || logger;
  const fetchFn = deps.fetch || global.fetch;
  const env = deps.env || process.env;

  /**
   * Check if Spotify token needs refresh (expired or expiring within buffer)
   * @param {Object} spotifyAuth - Spotify auth object with expires_at
   * @param {number} bufferMs - Buffer time in milliseconds (default 5 minutes)
   * @returns {boolean}
   */
  function spotifyTokenNeedsRefresh(spotifyAuth, bufferMs = 5 * 60 * 1000) {
    if (!spotifyAuth?.access_token) return false;
    if (!spotifyAuth.expires_at) return false;
    return spotifyAuth.expires_at <= Date.now() + bufferMs;
  }

  /**
   * Refresh Spotify access token using the refresh token
   * @param {Object} spotifyAuth - Current spotify auth object with refresh_token
   * @returns {Object|null} - New token object or null if refresh failed
   */
  async function refreshSpotifyToken(spotifyAuth) {
    if (!spotifyAuth?.refresh_token) {
      log.warn('Cannot refresh Spotify token: no refresh_token available');
      return null;
    }

    const clientId = env.SPOTIFY_CLIENT_ID;
    const clientSecret = env.SPOTIFY_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      log.error('Spotify client credentials not configured');
      return null;
    }

    try {
      const params = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: spotifyAuth.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
      });

      log.info('Attempting to refresh Spotify token...');

      const resp = await fetchFn('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      if (!resp.ok) {
        const errorText = await resp.text();
        log.error('Spotify token refresh failed:', {
          status: resp.status,
          error: errorText,
        });

        // If refresh token is invalid/revoked, return null to trigger re-auth
        if (resp.status === 400 || resp.status === 401) {
          return null;
        }

        throw new Error(`Token refresh failed: ${resp.status}`);
      }

      const newToken = await resp.json();

      // Spotify may or may not return a new refresh_token
      // If not provided, keep using the existing one
      const result = {
        access_token: newToken.access_token,
        token_type: newToken.token_type || 'Bearer',
        expires_in: newToken.expires_in,
        expires_at: Date.now() + newToken.expires_in * 1000,
        refresh_token: newToken.refresh_token || spotifyAuth.refresh_token,
        scope: newToken.scope || spotifyAuth.scope,
      };

      log.info('Spotify token refreshed successfully', {
        expires_in: newToken.expires_in,
        new_refresh_token: !!newToken.refresh_token,
        scopes_returned: newToken.scope || 'using_old_scopes',
        scopes_count: result.scope?.split(' ').length || 0,
      });

      return result;
    } catch (error) {
      log.error('Error refreshing Spotify token:', error);
      return null;
    }
  }

  /**
   * Ensure user has valid Spotify token, refreshing if needed
   * This is the main function to call before making Spotify API requests
   *
   * @param {Object} user - User object with spotifyAuth
   * @param {Object} usersDb - Users database interface (NeDB style)
   * @returns {Object} - { success: boolean, spotifyAuth: Object|null, error: string|null }
   */
  async function ensureValidSpotifyToken(user, usersDb) {
    // Check if user has Spotify auth at all
    if (!user.spotifyAuth?.access_token) {
      return {
        success: false,
        spotifyAuth: null,
        error: 'NOT_AUTHENTICATED',
        message: 'Not authenticated with Spotify',
      };
    }

    // Check if token is still valid (with 5 minute buffer)
    if (!spotifyTokenNeedsRefresh(user.spotifyAuth)) {
      return {
        success: true,
        spotifyAuth: user.spotifyAuth,
        error: null,
      };
    }

    // Check if we have a refresh token
    if (!user.spotifyAuth.refresh_token) {
      log.warn('Spotify token expired but no refresh token available');
      return {
        success: false,
        spotifyAuth: null,
        error: 'TOKEN_EXPIRED',
        message: 'Spotify connection expired and cannot be refreshed',
      };
    }

    // Attempt to refresh the token
    log.info(
      'Spotify token expired/expiring, attempting refresh for user:',
      user.email
    );
    const newToken = await refreshSpotifyToken(user.spotifyAuth);

    if (!newToken) {
      log.warn('Spotify token refresh failed for user:', user.email);
      return {
        success: false,
        spotifyAuth: null,
        error: 'TOKEN_REFRESH_FAILED',
        message: 'Failed to refresh Spotify connection. Please reconnect.',
      };
    }

    // Update the token in the database
    try {
      await new Promise((resolve, reject) => {
        usersDb.update(
          { _id: user._id },
          { $set: { spotifyAuth: newToken, updatedAt: new Date() } },
          {},
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      // Update the user object in memory as well
      user.spotifyAuth = newToken;

      log.info('Spotify token refreshed and saved for user:', user.email);

      return {
        success: true,
        spotifyAuth: newToken,
        error: null,
      };
    } catch (dbError) {
      log.error('Failed to save refreshed Spotify token:', dbError);
      // Still return the new token even if DB save failed
      // It will work for this request, and we'll try to save again next time
      return {
        success: true,
        spotifyAuth: newToken,
        error: null,
      };
    }
  }

  // ============================================
  // SPOTIFY WEB API - DATA FETCHING
  // ============================================

  const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

  /**
   * Make an authenticated request to Spotify Web API
   * @param {string} endpoint - API endpoint (without base URL)
   * @param {string} accessToken - Valid access token
   * @param {Object} options - Additional fetch options
   * @returns {Object} - Response data
   */
  async function spotifyApiRequest(endpoint, accessToken, options = {}) {
    const url = endpoint.startsWith('http')
      ? endpoint
      : `${SPOTIFY_API_BASE}${endpoint}`;

    const response = await fetchFn(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error('Spotify API request failed:', {
        endpoint,
        status: response.status,
        error: errorText,
      });
      throw new Error(`Spotify API error: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Get user's top artists from Spotify
   * Requires scope: user-top-read
   * @param {string} accessToken - Valid access token
   * @param {string} timeRange - short_term (4 weeks), medium_term (6 months), long_term (years)
   * @param {number} limit - Number of items (1-50)
   * @param {number} offset - Offset for pagination
   * @returns {Object} - { items: Artist[], total, limit, offset }
   */
  async function getTopArtists(
    accessToken,
    timeRange = 'medium_term',
    limit = 50,
    offset = 0
  ) {
    const params = new URLSearchParams({
      time_range: timeRange,
      limit: String(Math.min(limit, 50)),
      offset: String(offset),
    });

    const data = await spotifyApiRequest(
      `/me/top/artists?${params}`,
      accessToken
    );

    return {
      items: data.items.map((artist) => ({
        id: artist.id,
        name: artist.name,
        genres: artist.genres || [],
        popularity: artist.popularity,
        images: artist.images || [],
        external_url: artist.external_urls?.spotify,
      })),
      total: data.total,
      limit: data.limit,
      offset: data.offset,
      time_range: timeRange,
    };
  }

  /**
   * Get user's top tracks from Spotify
   * Requires scope: user-top-read
   * @param {string} accessToken - Valid access token
   * @param {string} timeRange - short_term (4 weeks), medium_term (6 months), long_term (years)
   * @param {number} limit - Number of items (1-50)
   * @param {number} offset - Offset for pagination
   * @returns {Object} - { items: Track[], total, limit, offset }
   */
  async function getTopTracks(
    accessToken,
    timeRange = 'medium_term',
    limit = 50,
    offset = 0
  ) {
    const params = new URLSearchParams({
      time_range: timeRange,
      limit: String(Math.min(limit, 50)),
      offset: String(offset),
    });

    const data = await spotifyApiRequest(
      `/me/top/tracks?${params}`,
      accessToken
    );

    return {
      items: data.items.map((track) => ({
        id: track.id,
        name: track.name,
        artist: track.artists?.[0]?.name || 'Unknown',
        artists: track.artists?.map((a) => ({ id: a.id, name: a.name })) || [],
        album: track.album?.name || 'Unknown',
        album_id: track.album?.id,
        popularity: track.popularity,
        duration_ms: track.duration_ms,
        external_url: track.external_urls?.spotify,
      })),
      total: data.total,
      limit: data.limit,
      offset: data.offset,
      time_range: timeRange,
    };
  }

  /**
   * Get user's saved albums (library)
   * Requires scope: user-library-read
   * @param {string} accessToken - Valid access token
   * @param {number} limit - Number of items (1-50)
   * @param {number} offset - Offset for pagination
   * @returns {Object} - { items: SavedAlbum[], total, limit, offset }
   */
  async function getSavedAlbums(accessToken, limit = 50, offset = 0) {
    const params = new URLSearchParams({
      limit: String(Math.min(limit, 50)),
      offset: String(offset),
    });

    const data = await spotifyApiRequest(`/me/albums?${params}`, accessToken);

    return {
      items: data.items.map((item) => ({
        added_at: item.added_at,
        album: {
          id: item.album.id,
          name: item.album.name,
          artist: item.album.artists?.[0]?.name || 'Unknown',
          artists:
            item.album.artists?.map((a) => ({ id: a.id, name: a.name })) || [],
          release_date: item.album.release_date,
          total_tracks: item.album.total_tracks,
          genres: item.album.genres || [],
          images: item.album.images || [],
          external_url: item.album.external_urls?.spotify,
        },
      })),
      total: data.total,
      limit: data.limit,
      offset: data.offset,
    };
  }

  /**
   * Get user's recently played tracks
   * Requires scope: user-read-recently-played
   * @param {string} accessToken - Valid access token
   * @param {number} limit - Number of items (1-50)
   * @param {number} before - Unix timestamp in ms - returns items before this
   * @param {number} after - Unix timestamp in ms - returns items after this
   * @returns {Object} - { items: PlayHistory[], cursors }
   */
  async function getRecentlyPlayed(
    accessToken,
    limit = 50,
    before = null,
    after = null
  ) {
    const params = new URLSearchParams({
      limit: String(Math.min(limit, 50)),
    });

    if (before) params.set('before', String(before));
    if (after) params.set('after', String(after));

    const data = await spotifyApiRequest(
      `/me/player/recently-played?${params}`,
      accessToken
    );

    return {
      items: data.items.map((item) => ({
        played_at: item.played_at,
        track: {
          id: item.track.id,
          name: item.track.name,
          artist: item.track.artists?.[0]?.name || 'Unknown',
          artists:
            item.track.artists?.map((a) => ({ id: a.id, name: a.name })) || [],
          album: item.track.album?.name || 'Unknown',
          album_id: item.track.album?.id,
          duration_ms: item.track.duration_ms,
          external_url: item.track.external_urls?.spotify,
        },
      })),
      cursors: data.cursors || null,
      next: data.next || null,
    };
  }

  /**
   * Fetch all items from a paginated Spotify endpoint
   * @param {Function} fetchFn - Function that fetches a page (receives offset)
   * @param {number} maxItems - Maximum items to fetch (default 200)
   * @returns {Array} - All items
   */
  async function fetchAllPages(fetchPageFn, maxItems = 200) {
    const allItems = [];
    let offset = 0;
    const limit = 50;

    while (offset < maxItems) {
      const page = await fetchPageFn(offset);
      allItems.push(...page.items);

      if (page.items.length < limit || allItems.length >= page.total) {
        break;
      }

      offset += limit;
    }

    return allItems.slice(0, maxItems);
  }

  /**
   * Get comprehensive top artists across all time ranges
   * @param {string} accessToken - Valid access token
   * @param {number} limitPerRange - Items per time range
   * @returns {Object} - { short_term, medium_term, long_term }
   */
  async function getAllTopArtists(accessToken, limitPerRange = 50) {
    const [shortTerm, mediumTerm, longTerm] = await Promise.all([
      getTopArtists(accessToken, 'short_term', limitPerRange),
      getTopArtists(accessToken, 'medium_term', limitPerRange),
      getTopArtists(accessToken, 'long_term', limitPerRange),
    ]);

    return {
      short_term: shortTerm.items,
      medium_term: mediumTerm.items,
      long_term: longTerm.items,
    };
  }

  /**
   * Get comprehensive top tracks across all time ranges
   * @param {string} accessToken - Valid access token
   * @param {number} limitPerRange - Items per time range
   * @returns {Object} - { short_term, medium_term, long_term }
   */
  async function getAllTopTracks(accessToken, limitPerRange = 50) {
    const [shortTerm, mediumTerm, longTerm] = await Promise.all([
      getTopTracks(accessToken, 'short_term', limitPerRange),
      getTopTracks(accessToken, 'medium_term', limitPerRange),
      getTopTracks(accessToken, 'long_term', limitPerRange),
    ]);

    return {
      short_term: shortTerm.items,
      medium_term: mediumTerm.items,
      long_term: longTerm.items,
    };
  }

  return {
    spotifyTokenNeedsRefresh,
    refreshSpotifyToken,
    ensureValidSpotifyToken,
    // Spotify Web API
    spotifyApiRequest,
    getTopArtists,
    getTopTracks,
    getSavedAlbums,
    getRecentlyPlayed,
    fetchAllPages,
    getAllTopArtists,
    getAllTopTracks,
  };
}

// Default instance for the app (uses real logger, fetch, and env)
const defaultInstance = createSpotifyAuth();

module.exports = {
  // Factory for testing
  createSpotifyAuth,
  // Default instance for app usage
  ensureValidSpotifyToken: defaultInstance.ensureValidSpotifyToken,
  // Spotify Web API functions
  spotifyApiRequest: defaultInstance.spotifyApiRequest,
  getTopArtists: defaultInstance.getTopArtists,
  getTopTracks: defaultInstance.getTopTracks,
  getSavedAlbums: defaultInstance.getSavedAlbums,
  getRecentlyPlayed: defaultInstance.getRecentlyPlayed,
  fetchAllPages: defaultInstance.fetchAllPages,
  getAllTopArtists: defaultInstance.getAllTopArtists,
  getAllTopTracks: defaultInstance.getAllTopTracks,
};
