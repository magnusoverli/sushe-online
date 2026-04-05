/**
 * Session Configuration
 *
 * Configures Express session with PostgreSQL store and an in-memory caching layer
 * that reduces database reads by ~80-90% for session lookups.
 * Also includes custom flash middleware.
 */

const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const logger = require('../utils/logger');
const {
  SessionCache,
  wrapSessionStore,
} = require('../middleware/session-cache');

const FALLBACK_SESSION_SECRET = 'your-secret-key';

function resolveSessionSettings(env = process.env, log = logger) {
  const isProduction = env.NODE_ENV === 'production';
  const strictSecretRequired = env.SESSION_SECRET_REQUIRED === 'true';
  const secretFromEnv = env.SESSION_SECRET;
  const sessionSecret = secretFromEnv || FALLBACK_SESSION_SECRET;
  const usingFallbackSecret =
    !secretFromEnv || secretFromEnv === FALLBACK_SESSION_SECRET;

  if (isProduction && usingFallbackSecret) {
    log.error('Insecure SESSION_SECRET configuration detected in production', {
      strictMode: strictSecretRequired,
    });

    if (strictSecretRequired) {
      throw new Error(
        'SESSION_SECRET is required in production when SESSION_SECRET_REQUIRED=true'
      );
    }
  }

  return {
    sessionSecret,
    cookieSecure: isProduction ? 'auto' : false,
  };
}

/**
 * Create session middleware with PostgreSQL store and caching.
 * @param {Object} pool - PostgreSQL connection pool
 * @returns {Function} Express session middleware
 */
function createSessionMiddleware(pool) {
  const settings = resolveSessionSettings(process.env, logger);

  const sessionCache = new SessionCache({ ttl: 30000, maxSize: 1000 }); // 30 sec TTL
  const pgStore = new pgSession({
    pool: pool,
    tableName: 'session',
    createTableIfMissing: true,
    pruneSessionInterval: 600, // Clean up expired sessions every 10 minutes (in seconds)
    errorLog: (err) =>
      logger.error('Session store error', { error: err.message }),
  });

  const sessionMiddleware = session({
    store: wrapSessionStore(pgStore, sessionCache),
    secret: settings.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: settings.cookieSecure,
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24, // 24 hours
      sameSite: 'lax',
    },
    genid: function (_req) {
      return require('crypto').randomBytes(16).toString('hex');
    },
  });

  return sessionMiddleware;
}

/**
 * Custom flash middleware.
 * Makes flash messages available to templates and provides req.flash() method.
 * @returns {Function} Express middleware
 */
function flashMiddleware() {
  return (req, res, next) => {
    const existingFlash = req.session?.flash;

    // Make flash messages available to templates
    res.locals.flash = existingFlash ? { ...existingFlash } : {};

    // Clear only when there is something to clear to avoid unnecessary session writes
    if (existingFlash) {
      delete req.session.flash;
    }

    // Add flash method to request object
    req.flash = (type, message) => {
      // If called with just type, return messages of that type (getter)
      if (message === undefined) {
        return req.session?.flash?.[type] || [];
      }

      // Otherwise, add message (setter)
      if (!req.session.flash) {
        req.session.flash = {};
      }
      if (!req.session.flash[type]) {
        req.session.flash[type] = [];
      }
      req.session.flash[type].push(message);
    };

    next();
  };
}

module.exports = {
  createSessionMiddleware,
  flashMiddleware,
  resolveSessionSettings,
  FALLBACK_SESSION_SECRET,
};
