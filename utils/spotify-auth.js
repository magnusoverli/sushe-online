// utils/spotify-auth.js
// Spotify OAuth token refresh utilities

const logger = require('./logger');
const { observeExternalApiCall, recordExternalApiError } = require('./metrics');

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

// ============================================
// DATA FETCHING METHODS
// ============================================

/**
 * Create data fetching methods for Spotify Web API
 */
function createDataFetchers(spotifyApiRequest) {
  async function getTopArtists(
    accessToken,
    timeRange = 'medium_term',
    limit = 50,
    offset = 0,
    userContext = {}
  ) {
    const params = new URLSearchParams({
      time_range: timeRange,
      limit: String(Math.min(limit, 50)),
      offset: String(offset),
    });

    const data = await spotifyApiRequest(
      `/me/top/artists?${params}`,
      accessToken,
      userContext
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

  async function getTopTracks(
    accessToken,
    timeRange = 'medium_term',
    limit = 50,
    offset = 0,
    userContext = {}
  ) {
    const params = new URLSearchParams({
      time_range: timeRange,
      limit: String(Math.min(limit, 50)),
      offset: String(offset),
    });

    const data = await spotifyApiRequest(
      `/me/top/tracks?${params}`,
      accessToken,
      userContext
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

  async function getSavedAlbums(
    accessToken,
    limit = 50,
    offset = 0,
    userContext = {}
  ) {
    const params = new URLSearchParams({
      limit: String(Math.min(limit, 50)),
      offset: String(offset),
    });

    const data = await spotifyApiRequest(
      `/me/albums?${params}`,
      accessToken,
      userContext
    );

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

  async function getRecentlyPlayed(
    accessToken,
    limit = 50,
    before = null,
    after = null,
    userContext = {}
  ) {
    const params = new URLSearchParams({ limit: String(Math.min(limit, 50)) });
    if (before) params.set('before', String(before));
    if (after) params.set('after', String(after));

    const data = await spotifyApiRequest(
      `/me/player/recently-played?${params}`,
      accessToken,
      userContext
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

  async function getAllTopArtists(
    accessToken,
    limitPerRange = 50,
    userContext = {}
  ) {
    const [shortTerm, mediumTerm, longTerm] = await Promise.all([
      getTopArtists(accessToken, 'short_term', limitPerRange, 0, userContext),
      getTopArtists(accessToken, 'medium_term', limitPerRange, 0, userContext),
      getTopArtists(accessToken, 'long_term', limitPerRange, 0, userContext),
    ]);

    return {
      short_term: shortTerm.items,
      medium_term: mediumTerm.items,
      long_term: longTerm.items,
    };
  }

  async function getAllTopTracks(
    accessToken,
    limitPerRange = 50,
    userContext = {}
  ) {
    const [shortTerm, mediumTerm, longTerm] = await Promise.all([
      getTopTracks(accessToken, 'short_term', limitPerRange, 0, userContext),
      getTopTracks(accessToken, 'medium_term', limitPerRange, 0, userContext),
      getTopTracks(accessToken, 'long_term', limitPerRange, 0, userContext),
    ]);

    return {
      short_term: shortTerm.items,
      medium_term: mediumTerm.items,
      long_term: longTerm.items,
    };
  }

  return {
    getTopArtists,
    getTopTracks,
    getSavedAlbums,
    getRecentlyPlayed,
    fetchAllPages,
    getAllTopArtists,
    getAllTopTracks,
  };
}

// ============================================
// MAIN FACTORY
// ============================================

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
   */
  function spotifyTokenNeedsRefresh(spotifyAuth, bufferMs = 5 * 60 * 1000) {
    if (!spotifyAuth?.access_token) return false;
    if (!spotifyAuth.expires_at) return false;
    return spotifyAuth.expires_at <= Date.now() + bufferMs;
  }

  /**
   * Refresh Spotify access token using the refresh token
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

        if (resp.status === 400 || resp.status === 401) {
          return null;
        }

        throw new Error(`Token refresh failed: ${resp.status}`);
      }

      const newToken = await resp.json();

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
   */
  async function ensureValidSpotifyToken(user, usersDb) {
    if (!user.spotifyAuth?.access_token) {
      return {
        success: false,
        spotifyAuth: null,
        error: 'NOT_AUTHENTICATED',
        message: 'Not authenticated with Spotify',
      };
    }

    if (!spotifyTokenNeedsRefresh(user.spotifyAuth)) {
      return { success: true, spotifyAuth: user.spotifyAuth, error: null };
    }

    if (!user.spotifyAuth.refresh_token) {
      log.warn('Spotify token expired but no refresh token available');
      return {
        success: false,
        spotifyAuth: null,
        error: 'TOKEN_EXPIRED',
        message: 'Spotify connection expired and cannot be refreshed',
      };
    }

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

      user.spotifyAuth = newToken;
      log.info('Spotify token refreshed and saved for user:', user.email);

      return { success: true, spotifyAuth: newToken, error: null };
    } catch (dbError) {
      log.error('Failed to save refreshed Spotify token:', dbError);
      return { success: true, spotifyAuth: newToken, error: null };
    }
  }

  /**
   * Parse Spotify API error response to extract meaningful error information
   * @param {string} errorText - Raw error response text
   * @param {number} statusCode - HTTP status code
   * @returns {Object} Parsed error with message, errorType, and status
   */
  function parseSpotifyError(errorText, statusCode) {
    try {
      const errorJson = JSON.parse(errorText);
      return {
        message:
          errorJson.error?.message ||
          errorJson.message ||
          errorText ||
          `HTTP ${statusCode}`,
        errorType: errorJson.error?.type || 'unknown',
        status: errorJson.error?.status || statusCode,
      };
    } catch {
      // Not JSON, return raw text
      return {
        message: errorText || `HTTP ${statusCode}`,
        errorType: 'unknown',
        status: statusCode,
      };
    }
  }

  /**
   * Make an authenticated request to Spotify Web API
   */
  async function spotifyApiRequest(endpoint, accessToken, options = {}) {
    const url = endpoint.startsWith('http')
      ? endpoint
      : `${SPOTIFY_API_BASE}${endpoint}`;

    // Normalize endpoint for metrics (remove query params and dynamic parts)
    const metricsEndpoint = endpoint
      .split('?')[0]
      .replace(/\/[a-zA-Z0-9]{22}\b/g, '/:id'); // Spotify IDs are 22 chars

    const startTime = Date.now();
    let response;
    try {
      response = await fetchFn(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      const duration = Date.now() - startTime;
      // Handle mock responses that may not have status property
      const statusCode = response.status ?? 200;
      observeExternalApiCall('spotify', metricsEndpoint, duration, statusCode);

      if (!response.ok) {
        const errorText = await response.text();
        const parsedError = parseSpotifyError(errorText, response.status);
        const isClientError =
          response.status >= 400 && response.status < 500;
        const isServerError = response.status >= 500;

        const logData = {
          endpoint,
          status: response.status,
          error: parsedError.message,
          errorType: parsedError.errorType,
          userId: options.userId,
          username: options.username,
        };

        if (isClientError) {
          // 4xx errors: Expected client errors (user not registered, token expired, etc.)
          log.warn('Spotify API client error:', logData);
        } else if (isServerError) {
          // 5xx errors: Unexpected server errors (Spotify API issues)
          log.error('Spotify API server error:', logData);
        } else {
          // Fallback for unexpected status codes
          log.error('Spotify API request failed:', logData);
        }

        recordExternalApiError('spotify', `http_${response.status}`);
        throw new Error(
          `Spotify API error: ${response.status} - ${parsedError.message}`
        );
      }

      return response.json();
    } catch (error) {
      // Record network/timeout errors
      if (!response) {
        const duration = Date.now() - startTime;
        observeExternalApiCall('spotify', metricsEndpoint, duration, 0);
        recordExternalApiError('spotify', 'network_error');
        // Network errors are unexpected and should be logged as errors
        log.error('Spotify API network error:', {
          endpoint,
          error: error.message,
          userId: options.userId,
          username: options.username,
        });
      }
      throw error;
    }
  }

  // Create data fetcher methods
  const dataFetchers = createDataFetchers(spotifyApiRequest);

  return {
    spotifyTokenNeedsRefresh,
    refreshSpotifyToken,
    ensureValidSpotifyToken,
    spotifyApiRequest,
    getTopArtists: dataFetchers.getTopArtists,
    getTopTracks: dataFetchers.getTopTracks,
    getSavedAlbums: dataFetchers.getSavedAlbums,
    getRecentlyPlayed: dataFetchers.getRecentlyPlayed,
    fetchAllPages: dataFetchers.fetchAllPages,
    getAllTopArtists: dataFetchers.getAllTopArtists,
    getAllTopTracks: dataFetchers.getAllTopTracks,
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
