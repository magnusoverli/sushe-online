require('dotenv').config();
const http = require('http');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
// Datastore setup is handled in ./db which uses PostgreSQL
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const path = require('path');
const compression = require('compression');
const cors = require('cors');
const helmet = require('helmet');
const csrf = require('csrf');
const multer = require('multer');
const os = require('os');
const logger = require('./utils/logger');
const { errorHandler, notFoundHandler } = require('./middleware/error-handler');
const requestIdMiddleware = require('./middleware/request-id');
const {
  metricsMiddleware,
  getMetrics,
  getContentType,
} = require('./utils/metrics');
const { createPreferenceSyncService } = require('./utils/preference-sync');
const {
  setup: setupWebSocket,
  broadcast,
  shutdown: shutdownWebSocket,
} = require('./utils/websocket');
const {
  SessionCache,
  wrapSessionStore,
} = require('./middleware/session-cache');
const upload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (req, file, cb) => {
      const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(null, file.fieldname + '-' + unique + '.dump');
    },
  }),
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB limit
});
// Log any unhandled errors so the server doesn't fail silently
process.on('unhandledRejection', (err) => {
  logger.error('Unhandled promise rejection', {
    error: err.message,
    stack: err.stack,
  });
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
});

// Graceful shutdown handling for async logger and cache
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await logger.shutdown();

  // Shutdown WebSocket server
  shutdownWebSocket();

  // Shutdown response cache if it exists
  try {
    const { responseCache } = require('./middleware/response-cache');
    responseCache.shutdown();
  } catch (_e) {
    // Cache module might not be loaded yet
  }

  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await logger.shutdown();

  // Shutdown WebSocket server
  shutdownWebSocket();

  // Shutdown response cache if it exists
  try {
    const { responseCache } = require('./middleware/response-cache');
    responseCache.shutdown();
  } catch (_e) {
    // Cache module might not be loaded yet
  }

  process.exit(0);
});
const { composeForgotPasswordEmail } = require('./forgot_email');
const {
  isValidEmail,
  isValidUsername,
  isValidPassword,
} = require('./validators');

//
let lastCodeUsedBy = null;
let lastCodeUsedAt = null;

// Import templates
const {
  htmlTemplate,
  registerTemplate,
  loginTemplate,
  forgotPasswordTemplate,
  resetPasswordTemplate,
  invalidTokenTemplate,
  spotifyTemplate,
} = require('./templates');

const { isTokenValid, isTokenUsable } = require('./auth-utils');
// Databases are initialized in ./db using PostgreSQL
const {
  users,
  lists,
  listItems,
  albums,
  usersAsync,
  listsAsync,
  listItemsAsync,
  albumsAsync,
  dataDir,
  ready,
  pool,
} = require('./db');

// Import auth middleware utilities
const {
  sanitizeUser,
  recordActivity: recordActivityBase,
  ensureAuth,
  createEnsureAuthAPI,
  ensureAdmin,
  createRateLimitAdminRequest,
} = require('./middleware/auth');

// Wrapper to use with the users datastore from this module
function recordActivity(req) {
  recordActivityBase(req, users);
}

// Admin code variables
const adminCodeAttempts = new Map(); // Track failed attempts
let adminCode = null;
let adminCodeExpiry = null;

// ============ USER CACHE FOR PASSPORT DESERIALIZATION ============
// Reduces database queries by caching user objects with 5-minute TTL
const userCache = new Map();
const USER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const USER_CACHE_MAX_SIZE = 1000; // Maximum cached users to prevent unbounded growth

function getCachedUser(id) {
  const cached = userCache.get(id);
  if (cached && Date.now() - cached.timestamp < USER_CACHE_TTL) {
    return cached.user;
  }
  userCache.delete(id);
  return null;
}

function setCachedUser(id, user) {
  // Evict oldest entry if cache is full
  if (userCache.size >= USER_CACHE_MAX_SIZE) {
    const firstKey = userCache.keys().next().value;
    userCache.delete(firstKey);
  }
  userCache.set(id, { user, timestamp: Date.now() });
}

/**
 * Invalidate user cache entry - call when user data changes
 * @param {string} userId - User ID to invalidate
 */
function invalidateUserCache(userId) {
  userCache.delete(userId);
}

// Admin code generation - outputs structured JSON log for Loki/Grafana parsing
function generateAdminCode() {
  try {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    adminCode = Array.from(
      { length: 8 },
      () => chars[Math.floor(Math.random() * chars.length)]
    ).join('');
    adminCodeExpiry = new Date(Date.now() + 5 * 60 * 1000);

    // Log admin code using structured logging (parseable by Loki)
    const logData = {
      code: adminCode,
      expiresAt: adminCodeExpiry.toISOString(),
      ttlSeconds: 300,
    };

    // Include previous usage info if available
    if (lastCodeUsedBy && lastCodeUsedAt) {
      logData.previousUsage = {
        usedBy: lastCodeUsedBy,
        usedAt: new Date(lastCodeUsedAt).toISOString(),
      };
    }

    logger.info('Admin access code generated', logData);

    // Reset tracking for new code
    lastCodeUsedBy = null;
    lastCodeUsedAt = null;
  } catch (error) {
    logger.error('Error generating admin code', { error: error.message });
  }
}

// Generate initial code and rotate every 5 minutes
generateAdminCode();
setInterval(generateAdminCode, 5 * 60 * 1000);

// Passport configuration
passport.use(
  new LocalStrategy(
    { usernameField: 'email' },
    async (email, password, done) => {
      logger.info('Login attempt', { email });

      try {
        const user = await usersAsync.findOne({ email });

        // TIMING ATTACK MITIGATION:
        // Always perform bcrypt comparison, even for non-existent users.
        // This ensures constant-time response regardless of whether the email exists.
        let isMatch = false;

        if (!user) {
          // User doesn't exist - compare against a dummy hash to maintain constant timing
          // This prevents attackers from using timing analysis to enumerate valid emails
          const dummyHash =
            '$2a$12$ZIJfCqcmsmY3xNqmJGFJh.vKMF3rKXSgPp/mDgpjLfSUJJ1oiGdX.'; // Pre-computed bcrypt hash
          await bcrypt.compare(password, dummyHash);
          logger.warn('Login failed: Unknown email', { email });
        } else {
          logger.debug('User found', {
            email: user.email,
            hasHash: !!user.hash,
          });
          isMatch = await bcrypt.compare(password, user.hash);
        }

        // Always return the same message regardless of whether email or password was wrong
        if (isMatch && user) {
          // Check approval status before allowing login
          // Treat null/undefined as 'approved' for backwards compatibility with existing users
          const approvalStatus = user.approvalStatus || 'approved';

          if (approvalStatus === 'pending') {
            logger.warn('Login blocked: Account pending approval', { email });
            return done(null, false, {
              message: 'Your account is pending admin approval',
            });
          }

          if (approvalStatus === 'rejected') {
            logger.warn('Login blocked: Registration rejected', { email });
            return done(null, false, {
              message: 'Your registration was not approved',
            });
          }

          logger.info('Login successful', { email });
          return done(null, user);
        } else {
          logger.warn('Login failed: Invalid credentials', { email });
          return done(null, false, { message: 'Invalid email or password' });
        }
      } catch (err) {
        logger.error('Database error during login', { error: err.message });
        return done(err);
      }
    }
  )
);

passport.serializeUser((user, done) => done(null, user._id));
passport.deserializeUser(async (id, done) => {
  try {
    // Check user cache first to avoid database query on every request
    let user = getCachedUser(id);
    if (!user) {
      user = await usersAsync.findOne({ _id: id });
      if (user) {
        setCachedUser(id, user);
      }
    }
    done(null, user);
  } catch (err) {
    done(err);
  }
});

// Create Express app
const app = express();

// Trust proxy - REQUIRED when behind reverse proxy (nginx, cloudflare, etc.)
// This allows express to get real client IPs from X-Forwarded-For headers
// which is critical for rate limiting to work correctly
if (process.env.TRUST_PROXY) {
  // Allow manual override via environment variable
  app.set('trust proxy', process.env.TRUST_PROXY);
  logger.info('Trust proxy enabled via TRUST_PROXY env var', {
    value: process.env.TRUST_PROXY,
  });
} else if (process.env.NODE_ENV === 'production') {
  // In production, assume we're behind a proxy (common for Docker/cloud deployments)
  app.set('trust proxy', 1);
  logger.info('Trust proxy auto-enabled for production environment');
}

// Configure EJS view engine with caching
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.set('view cache', process.env.NODE_ENV === 'production');

// Security headers configuration with comprehensive CSP
const helmetConfig = {
  // Disable CSP for hobby project - makes debugging easier
  contentSecurityPolicy: false,

  // HTTP Strict Transport Security (HSTS)
  // Only enabled in production when behind HTTPS
  strictTransportSecurity:
    process.env.NODE_ENV === 'production' && process.env.ENABLE_HSTS === 'true'
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

// Apply security headers with performance optimization for static assets
app.use((req, res, next) => {
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
  helmet(helmetConfig)(req, res, next);
});

// CORS configuration for browser extension support
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

// Apply CORS middleware
app.use(cors(corsOptions));

// Basic Express middleware
app.use(express.static('public', { maxAge: '1y', immutable: true }));

// Handle .well-known requests (Android Asset Links, iOS Universal Links, etc.)
// We don't have native Android/iOS apps, but Google still checks for these files
app.use('/.well-known', (req, res) => {
  // For assetlinks.json (Android), return empty array per spec
  if (req.path === '/.well-known/assetlinks.json') {
    return res.json([]);
  }
  // For apple-app-site-association (iOS) or other .well-known paths, return 204
  res.status(204).end();
});

// Smart HTTP caching for static assets (before compression and no-cache middleware)
app.use((req, res, next) => {
  const path = req.path;

  if (path.match(/\.(js|css|png|jpg|jpeg|gif|webp|svg|woff2?|ttf|eot|ico)$/)) {
    res.set({
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Cache-Strategy': 'static-asset',
    });
  } else if (path.match(/\.html?$/)) {
    res.set({
      'Cache-Control': 'public, max-age=300',
      'X-Cache-Strategy': 'html-short',
    });
  } else if (path.startsWith('/api/')) {
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      Pragma: 'no-cache',
      Expires: '0',
      'X-Cache-Strategy': 'api-no-cache',
    });
  } else if (path === '/' || !path.includes('.')) {
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      Pragma: 'no-cache',
      Expires: '0',
      'X-Cache-Strategy': 'dynamic-no-cache',
    });
  }

  next();
});

// Conditional compression - skip for small API responses
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') && req.method === 'GET') {
    const originalJson = res.json;
    res.json = function (data) {
      const jsonString = JSON.stringify(data);
      if (jsonString.length > 1024) {
        compression()(req, res, () => {
          originalJson.call(this, data);
        });
      } else {
        originalJson.call(this, data);
      }
    };
  }
  next();
});

// Apply compression for all other requests
app.use(compression());
app.use(express.urlencoded({ extended: false, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));

// Request ID middleware - must be early to ensure all logs have request ID
app.use(requestIdMiddleware());

// Prometheus metrics middleware
app.use(metricsMiddleware());

// Request logging is handled by logger.requestLogger() middleware

// Session middleware with PostgreSQL store and caching layer
// Cache reduces database reads by ~80-90% for session lookups
const sessionCache = new SessionCache({ ttl: 30000, maxSize: 1000 }); // 30 sec TTL
const pgStore = new pgSession({
  pool: pool,
  tableName: 'session',
  createTableIfMissing: true,
  pruneSessionInterval: 600, // Clean up expired sessions every 10 minutes (in seconds)
  errorLog: (err) =>
    logger.error('Session store error', { error: err.message }),
});

// Create named session middleware for sharing with Socket.io
const sessionMiddleware = session({
  store: wrapSessionStore(pgStore, sessionCache),
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24, // 24 hours
    sameSite: 'lax',
  },
  genid: function (_req) {
    return require('crypto').randomBytes(16).toString('hex');
  },
});

app.use(sessionMiddleware);

// Custom flash middleware
app.use((req, res, next) => {
  // Initialize flash in session if it doesn't exist
  if (!req.session.flash) {
    req.session.flash = {};
  }

  // Make flash messages available to templates via res.locals
  // Clone the flash object to avoid reference issues
  res.locals.flash = { ...req.session.flash };

  // Clear flash messages after making them available
  // This ensures they're only shown once
  delete req.session.flash;

  // Add flash method to request object
  req.flash = (type, message) => {
    // Ensure session.flash exists
    if (!req.session.flash) {
      req.session.flash = {};
    }
    // If called with just type, return messages of that type (getter)
    if (message === undefined) {
      return req.session.flash[type] || [];
    }

    // Otherwise, add message (setter)
    if (!req.session.flash[type]) {
      req.session.flash[type] = [];
    }
    req.session.flash[type].push(message);
  };

  next();
});

// Request logging middleware
app.use(logger.requestLogger());

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// CSRF Protection (must be after session middleware)
const csrfTokens = new csrf();
const csrfProtection = (req, res, next) => {
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

// Record user activity for every authenticated request
app.use((req, res, next) => {
  recordActivity(req);
  next();
});

// ============ MIDDLEWARE FUNCTIONS ============

// ensureAuth is imported from middleware/auth.js

// Create API auth middleware with dependencies
const { validateExtensionToken } = require('./auth-utils');
const ensureAuthAPI = createEnsureAuthAPI({
  usersAsync,
  pool,
  validateExtensionToken,
  recordActivity: recordActivityBase,
  logger,
});

// ensureAdmin is imported from middleware/auth.js

// Create rate limiting middleware for admin requests
const rateLimitAdminRequest = createRateLimitAdminRequest({
  adminCodeAttempts,
  logger,
});

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const apiRoutes = require('./routes/api/index');
const preferencesRoutes = require('./routes/preferences');
const aggregateListRoutes = require('./routes/aggregate-list');

const deps = {
  htmlTemplate,
  registerTemplate,
  loginTemplate,
  forgotPasswordTemplate,
  resetPasswordTemplate,
  invalidTokenTemplate,
  spotifyTemplate,
  isTokenValid,
  isTokenUsable,
  csrfProtection,
  ensureAuth,
  ensureAuthAPI,
  ensureAdmin,
  rateLimitAdminRequest,
  users,
  lists,
  listItems,
  albums,
  usersAsync,
  listsAsync,
  listItemsAsync,
  albumsAsync,
  upload,
  bcrypt,
  crypto,
  nodemailer,
  composeForgotPasswordEmail,
  isValidEmail,
  isValidUsername,
  isValidPassword,
  sanitizeUser,
  adminCodeAttempts,
  adminCode,
  adminCodeExpiry,
  generateAdminCode,
  lastCodeUsedBy,
  lastCodeUsedAt,
  dataDir,
  pool,
  passport,
  invalidateUserCache,
};

// Database health check endpoint
const { healthCheck } = require('./db/retry-wrapper');

app.get('/health/db', async (req, res) => {
  try {
    const health = await healthCheck(pool);
    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
  } catch (error) {
    logger.error('Health check endpoint error', { error: error.message });
    res.status(503).json({
      status: 'unhealthy',
      database: 'error',
      error: 'Health check failed',
      timestamp: new Date().toISOString(),
    });
  }
});

// Health monitoring UI page
app.get('/health', (req, res) => {
  res.render('health');
});

// General health check API endpoint
app.get('/api/health', async (req, res) => {
  try {
    const dbHealth = await healthCheck(pool);
    const health = {
      status: dbHealth.status === 'healthy' ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      database: dbHealth,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: process.version,
    };

    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
  } catch (error) {
    logger.error('General health check error', { error: error.message });
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
    });
  }
});

// Prometheus metrics endpoint
// Protected by IP whitelist: only localhost and private network IPs
app.get('/metrics', async (req, res) => {
  // Simple IP-based protection for metrics endpoint
  const clientIp = req.ip || req.connection.remoteAddress || '';
  const isLocalhost =
    clientIp === '127.0.0.1' ||
    clientIp === '::1' ||
    clientIp === '::ffff:127.0.0.1';
  const isPrivateNetwork =
    /^(::ffff:)?(10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.|100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\.)/.test(
      clientIp
    );

  // In development, allow all access
  const isDevelopment = process.env.NODE_ENV !== 'production';

  if (!isLocalhost && !isPrivateNetwork && !isDevelopment) {
    logger.warn('Metrics endpoint access denied', { ip: clientIp });
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    res.set('Content-Type', getContentType());
    res.end(await getMetrics());
  } catch (error) {
    logger.error('Error generating metrics', { error: error.message });
    res.status(500).json({ error: 'Failed to generate metrics' });
  }
});

authRoutes(app, deps);
adminRoutes(app, deps);
apiRoutes(app, deps);
preferencesRoutes(app, deps);
const { aggregateList } = aggregateListRoutes(app, deps);

// Store aggregateList instance for use in triggers (e.g., main list updates)
app.locals.aggregateList = aggregateList;

// Icon routes for iOS/Safari compatibility
app.get('/favicon.ico', (req, res) => {
  res.redirect('/icons/ios/32.png');
});

app.get('/apple-touch-icon.png', (req, res) => {
  res.redirect('/icons/ios/180.png'); // Standard iOS touch icon size
});

app.get('/apple-touch-icon-precomposed.png', (req, res) => {
  res.redirect('/icons/ios/180.png');
});

// Additional common iOS icon sizes
app.get('/apple-touch-icon-120x120.png', (req, res) => {
  res.redirect('/icons/ios/120.png');
});

app.get('/apple-touch-icon-152x152.png', (req, res) => {
  res.redirect('/icons/ios/152.png');
});

app.get('/apple-touch-icon-180x180.png', (req, res) => {
  res.redirect('/icons/ios/180.png');
});

// 404 handler for unmatched routes
app.use(notFoundHandler);

// Centralized error handling middleware
app.use((err, req, res, next) => {
  // Check if headers were already sent
  if (res.headersSent) {
    logger.error('Headers already sent, cannot send error response', {
      error: err.message,
    });
    return;
  }

  // Use centralized error handler
  errorHandler(err, req, res, next);
});

// Start server once database is ready
const PORT = process.env.PORT || 3000;
const MigrationManager = require('./db/migrations');

// Create HTTP server for Express and Socket.io
const httpServer = http.createServer(app);

ready
  .then(async () => {
    // Run pending migrations automatically on startup
    try {
      const migrationManager = new MigrationManager(pool);
      await migrationManager.runMigrations();
    } catch (migrationErr) {
      logger.error('Migration failed during startup', {
        error: migrationErr.message,
      });
      // Don't exit - allow server to start even if migrations fail
      // This prevents downtime if a migration has issues
    }

    // Initialize cover fetch queue for async album cover fetching
    const { initializeCoverFetchQueue } = require('./utils/cover-fetch-queue');
    initializeCoverFetchQueue(pool);

    // Initialize track fetch queue for async album track fetching
    const { initializeTrackFetchQueue } = require('./utils/track-fetch-queue');
    initializeTrackFetchQueue(pool);

    // Set up WebSocket server with session middleware
    setupWebSocket(httpServer, sessionMiddleware);

    // Store broadcast service on app.locals for access in routes
    app.locals.broadcast = broadcast;

    httpServer.listen(PORT, () => {
      logger.info('Server started', {
        port: PORT,
        environment: process.env.NODE_ENV || 'development',
        url: `http://localhost:${PORT}`,
        websocket: 'enabled',
      });

      // Start preference sync service (only in production or if explicitly enabled)
      if (
        process.env.NODE_ENV === 'production' ||
        process.env.ENABLE_PREFERENCE_SYNC === 'true'
      ) {
        try {
          const syncService = createPreferenceSyncService({ pool, logger });
          syncService.start();

          // Clean shutdown
          const shutdown = () => {
            logger.info('Shutting down preference sync service...');
            syncService.stop();
          };
          process.on('SIGTERM', shutdown);
          process.on('SIGINT', shutdown);

          logger.info('Preference sync service initialized');
        } catch (syncErr) {
          logger.error('Failed to start preference sync service', {
            error: syncErr.message,
          });
          // Don't exit - sync service is not critical for app operation
        }
      }
    });
  })
  .catch((err) => {
    logger.error('Failed to initialize database', { error: err.message });
    process.exit(1);
  });
