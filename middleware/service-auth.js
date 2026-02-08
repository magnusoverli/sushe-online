/**
 * Service Authentication Middleware
 *
 * Provides middleware for validating and refreshing tokens for
 * external music services (Spotify, Tidal, Last.fm).
 *
 * Uses dependency injection pattern for testability.
 */

/**
 * Create service authentication middleware
 * @param {Object} deps - Dependencies
 * @param {Function} deps.ensureValidSpotifyToken - Spotify token validation function
 * @param {Function} deps.ensureValidTidalToken - Tidal token validation function
 * @param {Object} deps.users - Users database instance
 * @param {Object} deps.logger - Logger instance
 * @returns {Object} - Middleware functions
 */
function createServiceAuthMiddleware(deps) {
  const { ensureValidSpotifyToken, ensureValidTidalToken, users, logger } =
    deps;

  /**
   * Factory to create token validation middleware for an external service.
   * Validates/refreshes the token and attaches it to the request.
   *
   * @param {Object} options
   * @param {string} options.service - Service name ('spotify' or 'tidal')
   * @param {Function} options.ensureValidToken - Token validation function
   * @param {string} options.authProp - Property name on tokenResult (e.g. 'spotifyAuth')
   * @param {string} options.reqProp - Property name to set on req (e.g. 'spotifyAuth')
   * @returns {Function} Express middleware
   */
  function createTokenMiddleware({
    service,
    ensureValidToken,
    authProp,
    reqProp,
  }) {
    return async (req, res, next) => {
      try {
        const tokenResult = await ensureValidToken(req.user, users);
        if (!tokenResult.success) {
          logger.warn(`${service} auth check failed`, {
            error: tokenResult.error,
          });
          return res.status(401).json({
            error: tokenResult.message,
            code: tokenResult.error,
            service,
          });
        }
        req[reqProp] = tokenResult[authProp];
        next();
      } catch (err) {
        logger.error(`${service} auth middleware error`, {
          error: err.message,
        });
        return res.status(500).json({ error: 'Authentication service error' });
      }
    };
  }

  const requireSpotifyAuth = createTokenMiddleware({
    service: 'spotify',
    ensureValidToken: ensureValidSpotifyToken,
    authProp: 'spotifyAuth',
    reqProp: 'spotifyAuth',
  });

  const requireTidalAuth = createTokenMiddleware({
    service: 'tidal',
    ensureValidToken: ensureValidTidalToken,
    authProp: 'tidalAuth',
    reqProp: 'tidalAuth',
  });

  /**
   * Middleware to ensure user has connected their Last.fm account
   * Checks for lastfmUsername on the user object
   */
  const requireLastfmAuth = (req, res, next) => {
    if (!req.user.lastfmUsername) {
      return res.status(401).json({
        error: 'Last.fm not connected',
        code: 'NOT_AUTHENTICATED',
        service: 'lastfm',
      });
    }
    next();
  };

  /**
   * Middleware to ensure user has a valid Last.fm session key
   * Required for write operations (scrobble, now-playing)
   */
  const requireLastfmSessionKey = (req, res, next) => {
    if (!req.user.lastfmAuth?.session_key) {
      return res.status(401).json({
        error: 'Last.fm not connected',
        code: 'NOT_AUTHENTICATED',
        service: 'lastfm',
      });
    }
    next();
  };

  return {
    requireSpotifyAuth,
    requireTidalAuth,
    requireLastfmAuth,
    requireLastfmSessionKey,
    createTokenMiddleware,
  };
}

module.exports = { createServiceAuthMiddleware };
