/**
 * CSRF Protection Middleware
 *
 * Provides CSRF token creation and verification.
 * Skips validation for safe HTTP methods and Bearer token authentication
 * (browser extensions that use JWT tokens).
 */

const csrf = require('csrf');
const logger = require('../utils/logger');

/**
 * Create CSRF protection middleware.
 * Must be applied after session middleware (uses req.session.csrfSecret).
 * @returns {Function} Express middleware
 */
function createCsrfProtection() {
  const csrfTokens = new csrf();

  return (req, res, next) => {
    if (!req.session.csrfSecret) {
      req.session.csrfSecret = csrfTokens.secretSync();
      // Force session save when CSRF secret is created
      req.session.save((err) => {
        if (err) {
          logger.error('Failed to save session with CSRF secret', {
            error: err.message,
          });
        }
      });
    }

    req.csrfToken = () => csrfTokens.create(req.session.csrfSecret);

    if (
      req.method === 'GET' ||
      req.method === 'HEAD' ||
      req.method === 'OPTIONS'
    ) {
      return next();
    }

    // Skip CSRF validation for Bearer token authentication (browser extensions)
    // These requests are already authenticated via JWT tokens stored securely
    // and don't have access to session-based CSRF tokens
    const authHeader = req.get('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = req.body._csrf || req.headers['x-csrf-token'];

    // Debug CSRF token issues
    logger.debug('CSRF Debug', {
      hasSession: !!req.session,
      hasSecret: !!req.session?.csrfSecret,
      hasToken: !!token,
      tokenLength: token?.length,
      secretLength: req.session?.csrfSecret?.length,
      userAgent: req.get('User-Agent'),
      url: req.url,
      method: req.method,
    });

    if (!token || !csrfTokens.verify(req.session.csrfSecret, token)) {
      logger.warn('CSRF token validation failed', {
        hasToken: !!token,
        hasSecret: !!req.session?.csrfSecret,
        tokenPreview: token?.substring(0, 8) + '...',
        secretPreview: req.session?.csrfSecret?.substring(0, 8) + '...',
        userAgent: req.get('User-Agent'),
        sessionId: req.sessionID,
        tokenFull: token, // Log full token for debugging
        secretFull: req.session?.csrfSecret, // Log full secret for debugging
      });
      const err = new Error('Invalid CSRF token');
      err.code = 'EBADCSRFTOKEN';
      err.status = 403;
      return next(err);
    }

    next();
  };
}

module.exports = { createCsrfProtection };
