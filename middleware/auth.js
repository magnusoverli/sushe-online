/**
 * Authentication Middleware
 *
 * Provides middleware functions for authentication, authorization, and user management.
 * Follows dependency injection pattern for testability.
 */

/**
 * Sanitize user object for client consumption
 * Removes sensitive fields like password hash
 *
 * @param {Object} user - User object from database
 * @returns {Object|null} - Sanitized user object or null
 */
function sanitizeUser(user) {
  if (!user) return null;
  const { _id, email, username, accentColor, lastSelectedList, role } = user;
  return {
    _id,
    email,
    username,
    accentColor,
    timeFormat: user.timeFormat || '24h',
    dateFormat: user.dateFormat || 'MM/DD/YYYY',
    lastSelectedList,
    role,
    spotifyAuth: !!user.spotifyAuth,
    tidalAuth: !!user.tidalAuth,
    musicService: user.musicService || null,
    lastfmUsername: user.lastfmUsername || null,
  };
}

/**
 * Record user activity timestamp with debouncing
 * Only updates database if more than ACTIVITY_UPDATE_INTERVAL has passed
 * This dramatically reduces DB writes (from every request to ~once per 5 min)
 *
 * @param {Object} req - Express request object
 * @param {Object} users - Users datastore
 */
const ACTIVITY_UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes in milliseconds

function recordActivity(req, users) {
  if (!req.user) return;

  const now = Date.now();
  const lastUpdate = req.session?.lastActivityUpdatedAt || 0;

  // Always update in-memory timestamp for current request context
  req.user.lastActivity = new Date(now);

  // Only write to database if debounce interval has passed
  if (now - lastUpdate > ACTIVITY_UPDATE_INTERVAL) {
    // Update session timestamp (in-memory, no DB write)
    if (req.session) {
      req.session.lastActivityUpdatedAt = now;
    }

    // Fire-and-forget DB update using prepared statement (non-blocking)
    // Use updateFieldById if available (prepared statement), fallback to update
    if (typeof users.updateFieldById === 'function') {
      users.updateFieldById(
        req.user._id,
        'lastActivity',
        new Date(now),
        () => {} // Ignore result - non-critical operation
      );
    } else {
      users.update(
        { _id: req.user._id },
        { $set: { lastActivity: new Date(now) } },
        () => {} // Ignore result - non-critical operation
      );
    }
  }
}

/**
 * Middleware to ensure user is authenticated (session-based)
 * Redirects to /login if not authenticated
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 */
function ensureAuth(req, res, next) {
  if (req.user || (req.isAuthenticated && req.isAuthenticated())) {
    return next();
  }
  res.redirect('/login');
}

/**
 * Factory to create API authentication middleware
 * Supports both session and bearer token authentication
 *
 * @param {Object} deps - Dependencies
 * @param {Object} deps.usersAsync - Users datastore (async)
 * @param {Object} deps.pool - Database pool
 * @param {Function} deps.validateExtensionToken - Token validation function
 * @param {Function} deps.recordActivity - Activity recording function
 * @param {Object} deps.logger - Logger instance
 * @returns {Function} - Express middleware
 */
function createEnsureAuthAPI(deps) {
  const {
    usersAsync,
    pool,
    validateExtensionToken,
    recordActivity: recordActivityFn,
    logger,
  } = deps;

  return async function ensureAuthAPI(req, res, next) {
    // First check if authenticated via session
    if (req.isAuthenticated && req.isAuthenticated()) {
      recordActivityFn(req, usersAsync);
      return next();
    }

    // Check for bearer token
    const authHeader = req.get('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);

      try {
        const userId = await validateExtensionToken(token, pool);

        if (userId) {
          // Load user and attach to request
          const user = await usersAsync.findOne({ _id: userId });
          if (user) {
            req.user = user;
            // Mark this as token-based auth for logging
            req.authMethod = 'token';
            return next();
          }
        }
      } catch (error) {
        logger.error('Token validation error in middleware:', error);
      }
    }

    res.status(401).json({ error: 'Unauthorized' });
  };
}

/**
 * Middleware to ensure user has admin role
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 */
function ensureAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') {
    return next();
  }
  res.status(403).send('Access denied');
}

/**
 * Factory to create rate limiting middleware for admin requests
 *
 * @param {Object} deps - Dependencies
 * @param {Map} deps.adminCodeAttempts - Map to track attempts
 * @param {Object} deps.logger - Logger instance
 * @param {Object} deps.flash - Flash message function (optional)
 * @returns {Function} - Express middleware
 */
function createRateLimitAdminRequest(deps) {
  const { adminCodeAttempts, logger } = deps;

  return function rateLimitAdminRequest(req, res, next) {
    const userKey = req.user._id;
    const attempts = adminCodeAttempts.get(userKey) || {
      count: 0,
      firstAttempt: Date.now(),
    };

    // Reset if more than 30 minutes since first attempt
    if (Date.now() - attempts.firstAttempt > 30 * 60 * 1000) {
      attempts.count = 0;
      attempts.firstAttempt = Date.now();
    }

    // Block if too many attempts
    if (attempts.count >= 5) {
      logger.warn('User blocked from admin requests', {
        email: req.user.email,
        reason: 'too many attempts',
      });
      req.flash('error', 'Too many failed attempts. Please wait 30 minutes.');
      return res.redirect('/settings');
    }

    req.adminAttempts = attempts;
    next();
  };
}

module.exports = {
  sanitizeUser,
  recordActivity,
  ensureAuth,
  createEnsureAuthAPI,
  ensureAdmin,
  createRateLimitAdminRequest,
};
