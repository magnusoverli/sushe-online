// utils/tidal-auth.js
// Tidal OAuth token refresh utilities

const logger = require('./logger');
const { createOAuthTokenManager } = require('./oauth-token-manager');

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

  // Create shared token management via the OAuth token manager factory
  const tokenManager = createOAuthTokenManager(
    {
      serviceName: 'Tidal',
      tokenUrl: 'https://auth.tidal.com/v1/oauth2/token',
      authField: 'tidalAuth',
      getClientCredentials: (envVars) => {
        const clientId = envVars.TIDAL_CLIENT_ID;
        if (!clientId) {
          return {
            valid: false,
            errorMessage: 'client ID not configured',
          };
        }
        return {
          valid: true,
          params: { client_id: clientId },
        };
      },
      // Tidal uses the default onRefreshSuccess logging (no extra scopes fields)
    },
    { logger: log, fetch: fetchFn, env }
  );

  // Preserve original function names for API compatibility
  const tidalTokenNeedsRefresh = tokenManager.tokenNeedsRefresh;
  const refreshTidalToken = tokenManager.refreshToken;
  const ensureValidTidalToken = tokenManager.ensureValidToken;

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
