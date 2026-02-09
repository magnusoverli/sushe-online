require('dotenv').config();
const http = require('http');
const express = require('express');
const passport = require('passport');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const path = require('path');
const compression = require('compression');
const multer = require('multer');
const os = require('os');

// ============ CONFIGURATION MODULES ============
const { registerProcessHandlers } = require('./config/process-handlers');
const { configurePassport, invalidateUserCache } = require('./config/passport');
const {
  getAdminCodeState,
  startAdminCodeRotation,
} = require('./config/admin-code');
const {
  createHelmetMiddleware,
  createCorsMiddleware,
} = require('./config/security');
const {
  createSessionMiddleware,
  flashMiddleware,
} = require('./config/session');
const { createCsrfProtection } = require('./middleware/csrf');
const { registerHealthRoutes } = require('./routes/health');
const {
  initializeQueues,
  startSyncServices,
} = require('./config/startup-services');

// ============ INTERNAL MODULES ============
const logger = require('./utils/logger');
const { errorHandler, notFoundHandler } = require('./middleware/error-handler');
const requestIdMiddleware = require('./middleware/request-id');
const { metricsMiddleware } = require('./utils/metrics');
const { setup: setupWebSocket, broadcast } = require('./utils/websocket');
const { composeForgotPasswordEmail } = require('./utils/forgot_email');
const {
  isValidEmail,
  isValidUsername,
  isValidPassword,
} = require('./utils/validators');
const {
  htmlTemplate,
  registerTemplate,
  loginTemplate,
  forgotPasswordTemplate,
  resetPasswordTemplate,
  invalidTokenTemplate,
  spotifyTemplate,
  extensionAuthTemplate,
} = require('./templates');
const { isTokenValid, isTokenUsable } = require('./utils/auth-utils');
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
const {
  sanitizeUser,
  recordActivity: recordActivityBase,
  ensureAuth,
  createEnsureAuthAPI,
  ensureAdmin,
  createRateLimitAdminRequest,
} = require('./middleware/auth');

// ============ EARLY INITIALIZATION ============

// Register process-level error and signal handlers
registerProcessHandlers();

// Multer upload configuration
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

// Start admin code rotation (generates initial code + 5-minute interval)
startAdminCodeRotation();
const adminCodeState = getAdminCodeState();

// Wrapper to use with the users datastore from this module
function recordActivity(req) {
  recordActivityBase(req, users);
}

// Configure Passport authentication
configurePassport(passport, { usersAsync, bcrypt });

// ============ EXPRESS APP SETUP ============

const app = express();

// Trust proxy - REQUIRED when behind reverse proxy (nginx, cloudflare, etc.)
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', process.env.TRUST_PROXY);
  logger.info('Trust proxy enabled via TRUST_PROXY env var', {
    value: process.env.TRUST_PROXY,
  });
} else if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
  logger.info('Trust proxy auto-enabled for production environment');
}

// Configure EJS view engine with caching
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.set('view cache', process.env.NODE_ENV === 'production');

// ============ MIDDLEWARE PIPELINE ============

// Security headers (Helmet) with static-asset bypass
app.use(createHelmetMiddleware());

// CORS for browser extension support
app.use(createCorsMiddleware());

// Static files
app.use(express.static('public', { maxAge: '1y', immutable: true }));

// Handle .well-known requests (Android Asset Links, iOS Universal Links, etc.)
app.use('/.well-known', (req, res) => {
  if (req.path === '/.well-known/assetlinks.json') {
    return res.json([]);
  }
  res.status(204).end();
});

// Smart HTTP caching for static assets
app.use((req, res, next) => {
  const reqPath = req.path;

  if (
    reqPath.match(/\.(js|css|png|jpg|jpeg|gif|webp|svg|woff2?|ttf|eot|ico)$/)
  ) {
    res.set({
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Cache-Strategy': 'static-asset',
    });
  } else if (reqPath.match(/\.html?$/)) {
    res.set({
      'Cache-Control': 'public, max-age=300',
      'X-Cache-Strategy': 'html-short',
    });
  } else if (reqPath.startsWith('/api/')) {
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      Pragma: 'no-cache',
      Expires: '0',
      'X-Cache-Strategy': 'api-no-cache',
    });
  } else if (reqPath === '/' || !reqPath.includes('.')) {
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

// Session middleware with PostgreSQL store and caching
const sessionMiddleware = createSessionMiddleware(pool);
app.use(sessionMiddleware);

// Custom flash middleware
app.use(flashMiddleware());

// Request logging middleware
app.use(logger.requestLogger());

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// CSRF Protection (must be after session middleware)
const csrfProtection = createCsrfProtection();

// Record user activity for every authenticated request
app.use((req, res, next) => {
  recordActivity(req);
  next();
});

// ============ AUTH MIDDLEWARE ============

const { validateExtensionToken } = require('./utils/auth-utils');
const ensureAuthAPI = createEnsureAuthAPI({
  usersAsync,
  pool,
  validateExtensionToken,
  recordActivity: recordActivityBase,
  logger,
});

const rateLimitAdminRequest = createRateLimitAdminRequest({
  adminCodeAttempts: adminCodeState.adminCodeAttempts,
  logger,
});

// ============ ROUTE REGISTRATION ============

const authRoutes = require('./routes/auth');
const oauthRoutes = require('./routes/oauth');
const adminRoutes = require('./routes/admin');
const apiRoutes = require('./routes/api/index');
const preferencesRoutes = require('./routes/preferences');
const aggregateListRoutes = require('./routes/aggregate-list');

// Create service instances for auth routes
const { createAuthService } = require('./services/auth-service');
const { createUserService } = require('./services/user-service');
const { createDuplicateService } = require('./services/duplicate-service');
const { createReidentifyService } = require('./services/reidentify-service');

const authService = createAuthService({ usersAsync, bcrypt, logger });
const userService = createUserService({ users, usersAsync, logger });
const duplicateService = createDuplicateService({ pool, logger });
const reidentifyService = createReidentifyService({ pool, logger });

const deps = {
  htmlTemplate,
  registerTemplate,
  loginTemplate,
  forgotPasswordTemplate,
  resetPasswordTemplate,
  invalidTokenTemplate,
  spotifyTemplate,
  extensionAuthTemplate,
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
  adminCodeState,
  dataDir,
  pool,
  passport,
  invalidateUserCache,
  authService,
  userService,
  duplicateService,
  reidentifyService,
};

// Health check and metrics routes
registerHealthRoutes(app, pool);

// Application routes
authRoutes(app, deps);
oauthRoutes(app, deps);
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
  res.redirect('/icons/ios/180.png');
});

app.get('/apple-touch-icon-precomposed.png', (req, res) => {
  res.redirect('/icons/ios/180.png');
});

app.get('/apple-touch-icon-120x120.png', (req, res) => {
  res.redirect('/icons/ios/120.png');
});

app.get('/apple-touch-icon-152x152.png', (req, res) => {
  res.redirect('/icons/ios/152.png');
});

app.get('/apple-touch-icon-180x180.png', (req, res) => {
  res.redirect('/icons/ios/180.png');
});

// ============ ERROR HANDLING ============

// 404 handler for unmatched routes
app.use(notFoundHandler);

// Centralized error handling middleware
app.use((err, req, res, next) => {
  if (res.headersSent) {
    logger.error('Headers already sent, cannot send error response', {
      error: err.message,
    });
    return;
  }
  errorHandler(err, req, res, next);
});

// ============ SERVER STARTUP ============

const PORT = process.env.PORT || 3000;
const MigrationManager = require('./db/migrations');
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
    }

    // Initialize background queues
    initializeQueues(pool);

    // Set up WebSocket server with session middleware
    setupWebSocket(httpServer, sessionMiddleware);
    app.locals.broadcast = broadcast;

    httpServer.listen(PORT, () => {
      logger.info('Server started', {
        port: PORT,
        environment: process.env.NODE_ENV || 'development',
        url: `http://localhost:${PORT}`,
        websocket: 'enabled',
      });

      // Start background sync services
      startSyncServices(pool);
    });
  })
  .catch((err) => {
    logger.error('Failed to initialize database', { error: err.message });
    process.exit(1);
  });
