/**
 * Security Configuration
 *
 * Configures Helmet security headers and CORS middleware.
 */

const helmet = require('helmet');
const cors = require('cors');

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
  const corsOptions = {
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps, curl, Postman)
      if (!origin) return callback(null, true);

      // Allow chrome-extension:// origins (browser extensions)
      if (origin.startsWith('chrome-extension://')) {
        return callback(null, true);
      }

      // Allow moz-extension:// origins (Firefox extensions)
      if (origin.startsWith('moz-extension://')) {
        return callback(null, true);
      }

      // Allow localhost for development
      if (
        origin.includes('localhost') ||
        origin.includes('127.0.0.1') ||
        origin.includes('[::1]')
      ) {
        return callback(null, true);
      }

      // Allow private network IP addresses (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
      // Also allow CGNAT range (100.64-127.x.x) used by Tailscale and other VPNs
      // This allows direct IP access for admin operations bypassing Cloudflare
      const ipMatch = origin.match(
        // eslint-disable-next-line security/detect-unsafe-regex
        /^https?:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2[0-9]|3[0-1])\.\d{1,3}\.\d{1,3}|100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\.\d{1,3}\.\d{1,3})(:\d+)?$/
      );
      if (ipMatch) {
        return callback(null, true);
      }

      // In production, you might want to whitelist specific domains
      // For now, allow all HTTPS origins for flexibility
      if (origin.startsWith('https://')) {
        return callback(null, true);
      }

      // Reject all other origins
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
