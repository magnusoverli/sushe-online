/**
 * Service Authentication Middleware
 *
 * Provides middleware for validating and refreshing tokens for
 * external music services (Spotify, Tidal).
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
   * Middleware to ensure valid Spotify token
   * Automatically refreshes if needed and attaches to req.spotifyAuth
   */
  const requireSpotifyAuth = async (req, res, next) => {
    try {
      const tokenResult = await ensureValidSpotifyToken(req.user, users);
      if (!tokenResult.success) {
        logger.warn('Spotify auth check failed', { error: tokenResult.error });
        return res.status(401).json({
          error: tokenResult.message,
          code: tokenResult.error,
          service: 'spotify',
        });
      }
      req.spotifyAuth = tokenResult.spotifyAuth;
      next();
    } catch (err) {
      logger.error('Spotify auth middleware error', { error: err.message });
      return res.status(500).json({ error: 'Authentication service error' });
    }
  };

  /**
   * Middleware to ensure valid Tidal token
   * Automatically refreshes if needed and attaches to req.tidalAuth
   */
  const requireTidalAuth = async (req, res, next) => {
    try {
      const tokenResult = await ensureValidTidalToken(req.user, users);
      if (!tokenResult.success) {
        logger.warn('Tidal auth check failed', { error: tokenResult.error });
        return res.status(401).json({
          error: tokenResult.message,
          code: tokenResult.error,
          service: 'tidal',
        });
      }
      req.tidalAuth = tokenResult.tidalAuth;
      next();
    } catch (err) {
      logger.error('Tidal auth middleware error', { error: err.message });
      return res.status(500).json({ error: 'Authentication service error' });
    }
  };

  return {
    requireSpotifyAuth,
    requireTidalAuth,
  };
}

module.exports = { createServiceAuthMiddleware };
