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

  return {
    spotifyTokenNeedsRefresh,
    refreshSpotifyToken,
    ensureValidSpotifyToken,
  };
}

// Default instance for the app (uses real logger, fetch, and env)
const defaultInstance = createSpotifyAuth();

module.exports = {
  // Factory for testing
  createSpotifyAuth,
  // Default instance for app usage
  ensureValidSpotifyToken: defaultInstance.ensureValidSpotifyToken,
};
