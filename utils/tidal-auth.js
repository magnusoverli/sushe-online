// utils/tidal-auth.js
// Tidal OAuth token refresh utilities

const logger = require('./logger');

/**
 * Create Tidal auth utilities with injected dependencies
 * @param {Object} deps - Dependencies
 * @param {Object} deps.logger - Logger instance
 * @param {Function} deps.fetch - Fetch function (defaults to global fetch)
 * @param {Object} deps.env - Environment variables (defaults to process.env)
 */
function createTidalAuth(deps = {}) {
  const log = deps.logger || logger;
  const fetchFn = deps.fetch || global.fetch;
  const env = deps.env || process.env;

  /**
   * Check if Tidal token needs refresh (expired or expiring within buffer)
   * @param {Object} tidalAuth - Tidal auth object with expires_at
   * @param {number} bufferMs - Buffer time in milliseconds (default 5 minutes)
   * @returns {boolean}
   */
  function tidalTokenNeedsRefresh(tidalAuth, bufferMs = 5 * 60 * 1000) {
    if (!tidalAuth?.access_token) return false;
    if (!tidalAuth.expires_at) return false;
    return tidalAuth.expires_at <= Date.now() + bufferMs;
  }

  /**
   * Refresh Tidal access token using the refresh token
   * Per Tidal docs: POST to https://auth.tidal.com/v1/oauth2/token
   * with grant_type=refresh_token and refresh_token
   *
   * @param {Object} tidalAuth - Current tidal auth object with refresh_token
   * @returns {Object|null} - New token object or null if refresh failed
   */
  async function refreshTidalToken(tidalAuth) {
    if (!tidalAuth?.refresh_token) {
      log.warn('Cannot refresh Tidal token: no refresh_token available');
      return null;
    }

    const clientId = env.TIDAL_CLIENT_ID;

    if (!clientId) {
      log.error('Tidal client ID not configured');
      return null;
    }

    try {
      const params = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tidalAuth.refresh_token,
        client_id: clientId,
      });

      log.info('Attempting to refresh Tidal token...');

      const resp = await fetchFn('https://auth.tidal.com/v1/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      if (!resp.ok) {
        const errorText = await resp.text();
        log.error('Tidal token refresh failed:', {
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

      // Tidal may or may not return a new refresh_token
      // If not provided, keep using the existing one
      const result = {
        access_token: newToken.access_token,
        token_type: newToken.token_type || 'Bearer',
        expires_in: newToken.expires_in,
        expires_at: Date.now() + newToken.expires_in * 1000,
        refresh_token: newToken.refresh_token || tidalAuth.refresh_token,
        scope: newToken.scope || tidalAuth.scope,
      };

      log.info('Tidal token refreshed successfully', {
        expires_in: newToken.expires_in,
        new_refresh_token: !!newToken.refresh_token,
      });

      return result;
    } catch (error) {
      log.error('Error refreshing Tidal token:', error);
      return null;
    }
  }

  /**
   * Ensure user has valid Tidal token, refreshing if needed
   * This is the main function to call before making Tidal API requests
   *
   * @param {Object} user - User object with tidalAuth
   * @param {Object} usersDb - Users database interface (NeDB style)
   * @returns {Object} - { success: boolean, tidalAuth: Object|null, error: string|null }
   */
  async function ensureValidTidalToken(user, usersDb) {
    // Check if user has Tidal auth at all
    if (!user.tidalAuth?.access_token) {
      return {
        success: false,
        tidalAuth: null,
        error: 'NOT_AUTHENTICATED',
        message: 'Not authenticated with Tidal',
      };
    }

    // Check if token is still valid (with 5 minute buffer)
    if (!tidalTokenNeedsRefresh(user.tidalAuth)) {
      return {
        success: true,
        tidalAuth: user.tidalAuth,
        error: null,
      };
    }

    // Check if we have a refresh token
    if (!user.tidalAuth.refresh_token) {
      log.warn('Tidal token expired but no refresh token available');
      return {
        success: false,
        tidalAuth: null,
        error: 'TOKEN_EXPIRED',
        message: 'Tidal connection expired and cannot be refreshed',
      };
    }

    // Attempt to refresh the token
    log.info(
      'Tidal token expired/expiring, attempting refresh for user:',
      user.email
    );
    const newToken = await refreshTidalToken(user.tidalAuth);

    if (!newToken) {
      log.warn('Tidal token refresh failed for user:', user.email);
      return {
        success: false,
        tidalAuth: null,
        error: 'TOKEN_REFRESH_FAILED',
        message: 'Failed to refresh Tidal connection. Please reconnect.',
      };
    }

    // Update the token in the database
    try {
      await new Promise((resolve, reject) => {
        usersDb.update(
          { _id: user._id },
          { $set: { tidalAuth: newToken, updatedAt: new Date() } },
          {},
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      // Update the user object in memory as well
      user.tidalAuth = newToken;

      log.info('Tidal token refreshed and saved for user:', user.email);

      return {
        success: true,
        tidalAuth: newToken,
        error: null,
      };
    } catch (dbError) {
      log.error('Failed to save refreshed Tidal token:', dbError);
      // Still return the new token even if DB save failed
      // It will work for this request, and we'll try to save again next time
      return {
        success: true,
        tidalAuth: newToken,
        error: null,
      };
    }
  }

  return {
    tidalTokenNeedsRefresh,
    refreshTidalToken,
    ensureValidTidalToken,
  };
}

// Default instance for the app (uses real logger, fetch, and env)
const defaultInstance = createTidalAuth();

module.exports = {
  // Factory for testing
  createTidalAuth,
  // Default instance for app usage
  tidalTokenNeedsRefresh: defaultInstance.tidalTokenNeedsRefresh,
  refreshTidalToken: defaultInstance.refreshTidalToken,
  ensureValidTidalToken: defaultInstance.ensureValidTidalToken,
};
