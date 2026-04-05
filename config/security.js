/**
 * Security Configuration
 *
 * Configures Helmet security headers and CORS middleware.
 */

const helmet = require('helmet');
const cors = require('cors');
const {
  isAllowedOrigin,
  createOriginPolicyFromEnv,
} = require('../utils/origin-policy');

/**
 * Create Helmet security middleware with static-asset bypass optimization.
 * @returns {Function} Express middleware
 */
function createHelmetMiddleware() {
  const helmetConfig = {
    // Disable CSP for hobby project - makes debugging easier
    contentSecurityPolicy: false,

    // HTTP Strict Transport Security (HSTS)
    // Only enabled in production when behind HTTPS
    strictTransportSecurity:
      process.env.NODE_ENV === 'production' &&
      process.env.ENABLE_HSTS === 'true'
        ? {
            maxAge: 31536000, // 1 year in seconds
            includeSubDomains: true,
            preload: true,
          }
        : false,

    // Referrer Policy - balance between privacy and functionality
    referrerPolicy: {
      policy: 'strict-origin-when-cross-origin',
    },

    // Disable Permissions Policy entirely to avoid experimental features
    // Helmet 8.x includes browsing-topics, run-ad-auction, join-ad-interest-group by default
    // These cause console warnings in browsers that don't support them
    permissionsPolicy: false,

    // Cross-Origin policies
    crossOriginEmbedderPolicy: false, // Keep disabled for external resources
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }, // Allow OAuth popups
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow external resources
  };

  const helmetHandler = helmet(helmetConfig);

  // Apply security headers with performance optimization for static assets
  return (req, res, next) => {
    // Skip heavy security middleware for static assets
    if (
      req.path.startsWith('/styles/') ||
      req.path.startsWith('/js/') ||
      req.path.startsWith('/icons/') ||
      req.path.endsWith('.css') ||
      req.path.endsWith('.js') ||
      req.path.endsWith('.png') ||
      req.path.endsWith('.ico')
    ) {
      return next();
    }

    // Apply comprehensive security headers for all other requests
    helmetHandler(req, res, next);
  };
}

/**
 * Create CORS middleware configured for browser extension support.
 * @returns {Function} Express middleware
 */
function createCorsMiddleware() {
  const originPolicy = createOriginPolicyFromEnv(process.env);

  const corsOptions = {
    origin: function (origin, callback) {
      if (isAllowedOrigin(origin, originPolicy)) {
        return callback(null, true);
      }

      callback(new Error('Not allowed by CORS'));
    },
    credentials: true, // Allow cookies and authentication headers
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['Content-Length', 'X-Request-Id'],
  };

  return cors(corsOptions);
}

module.exports = { createHelmetMiddleware, createCorsMiddleware };
