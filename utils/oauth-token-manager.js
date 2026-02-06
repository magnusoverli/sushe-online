// utils/oauth-token-manager.js
// Shared OAuth token management factory for music service integrations
// Used by spotify-auth.js and tidal-auth.js to eliminate duplicated token logic

const logger = require('./logger');

/**
 * Create OAuth token management utilities for a music service.
 *
 * @param {Object} config - Service configuration
 * @param {string} config.serviceName - Display name for log messages (e.g. 'Spotify', 'Tidal')
 * @param {string} config.tokenUrl - OAuth token endpoint URL
 * @param {string} config.authField - Field name on user object (e.g. 'spotifyAuth', 'tidalAuth')
 * @param {Function} config.getClientCredentials - Returns { params, valid } from env
 * @param {Function} [config.onRefreshSuccess] - Optional callback after successful refresh for extra logging
 * @param {Object} [deps] - Injectable dependencies
 * @param {Object} [deps.logger] - Logger instance
 * @param {Function} [deps.fetch] - Fetch function
 * @param {Object} [deps.env] - Environment variables
 * @returns {Object} Token management functions
 */
function createOAuthTokenManager(config, deps = {}) {
  const {
    serviceName,
    tokenUrl,
    authField,
    getClientCredentials,
    onRefreshSuccess,
  } = config;

  const log = deps.logger || logger;
  const fetchFn = deps.fetch || global.fetch;
  const env = deps.env || process.env;

  /**
   * Check if token needs refresh (expired or expiring within buffer)
   * @param {Object} auth - Auth object with access_token and expires_at
   * @param {number} [bufferMs=300000] - Buffer time in milliseconds (default 5 minutes)
   * @returns {boolean}
   */
  function tokenNeedsRefresh(auth, bufferMs = 5 * 60 * 1000) {
    if (!auth?.access_token) return false;
    if (!auth.expires_at) return false;
    return auth.expires_at <= Date.now() + bufferMs;
  }

  /**
   * Refresh access token using the refresh token
   * @param {Object} auth - Current auth object with refresh_token
   * @returns {Object|null} New token object or null if refresh failed
   */
  async function refreshToken(auth) {
    if (!auth?.refresh_token) {
      log.warn(
        `Cannot refresh ${serviceName} token: no refresh_token available`
      );
      return null;
    }

    const credentials = getClientCredentials(env);
    if (!credentials.valid) {
      log.error(`${serviceName} ${credentials.errorMessage}`);
      return null;
    }

    try {
      const params = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: auth.refresh_token,
        ...credentials.params,
      });

      log.info(`Attempting to refresh ${serviceName} token...`);

      const resp = await fetchFn(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      if (!resp.ok) {
        const errorText = await resp.text();
        log.error(`${serviceName} token refresh failed:`, {
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

      const result = {
        access_token: newToken.access_token,
        token_type: newToken.token_type || 'Bearer',
        expires_in: newToken.expires_in,
        expires_at: Date.now() + newToken.expires_in * 1000,
        refresh_token: newToken.refresh_token || auth.refresh_token,
        scope: newToken.scope || auth.scope,
      };

      if (onRefreshSuccess) {
        onRefreshSuccess(log, newToken, result);
      } else {
        log.info(`${serviceName} token refreshed successfully`, {
          expires_in: newToken.expires_in,
          new_refresh_token: !!newToken.refresh_token,
        });
      }

      return result;
    } catch (error) {
      log.error(`Error refreshing ${serviceName} token:`, error);
      return null;
    }
  }

  /**
   * Ensure user has valid token, refreshing if needed
   * @param {Object} user - User object with auth field
   * @param {Object} usersDb - Users database interface (NeDB style)
   * @returns {Object} { success, [authField], error, message }
   */
  async function ensureValidToken(user, usersDb) {
    const auth = user[authField];

    if (!auth?.access_token) {
      return {
        success: false,
        [authField]: null,
        error: 'NOT_AUTHENTICATED',
        message: `Not authenticated with ${serviceName}`,
      };
    }

    if (!tokenNeedsRefresh(auth)) {
      return { success: true, [authField]: auth, error: null };
    }

    if (!auth.refresh_token) {
      log.warn(`${serviceName} token expired but no refresh token available`);
      return {
        success: false,
        [authField]: null,
        error: 'TOKEN_EXPIRED',
        message: `${serviceName} connection expired and cannot be refreshed`,
      };
    }

    log.info(
      `${serviceName} token expired/expiring, attempting refresh for user:`,
      user.email
    );
    const newToken = await refreshToken(auth);

    if (!newToken) {
      log.warn(`${serviceName} token refresh failed for user:`, user.email);
      return {
        success: false,
        [authField]: null,
        error: 'TOKEN_REFRESH_FAILED',
        message: `Failed to refresh ${serviceName} connection. Please reconnect.`,
      };
    }

    // Update the token in the database
    try {
      await new Promise((resolve, reject) => {
        usersDb.update(
          { _id: user._id },
          { $set: { [authField]: newToken, updatedAt: new Date() } },
          {},
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      // Update the user object in memory as well
      user[authField] = newToken;

      log.info(
        `${serviceName} token refreshed and saved for user:`,
        user.email
      );

      return { success: true, [authField]: newToken, error: null };
    } catch (dbError) {
      log.error(`Failed to save refreshed ${serviceName} token:`, dbError);
      // Still return the new token even if DB save failed
      // It will work for this request, and we'll try to save again next time
      return { success: true, [authField]: newToken, error: null };
    }
  }

  return {
    tokenNeedsRefresh,
    refreshToken,
    ensureValidToken,
  };
}

module.exports = { createOAuthTokenManager };
