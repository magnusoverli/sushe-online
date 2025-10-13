require('dotenv').config();
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
const helmet = require('helmet');
const csrf = require('csrf');
const multer = require('multer');
const os = require('os');
const logger = require('./utils/logger');
const { errorHandler, notFoundHandler } = require('./middleware/error-handler');
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

// Import the new settings template
const { settingsTemplate } = require('./settings-template');
const { isTokenValid } = require('./auth-utils');
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

// Map of SSE subscribers keyed by `${userId}:${listName}`
const listSubscribers = new Map();

function broadcastListUpdate(userId, name, data) {
  const key = `${userId}:${name}`;
  const subs = listSubscribers.get(key);
  if (subs) {
    const payload = JSON.stringify(data);

    // Clean up dead connections while broadcasting
    const activeConnections = new Set();
    for (const res of subs) {
      try {
        if (!res.destroyed && res.writable) {
          res.write(`event: update\ndata: ${payload}\n\n`);
          if (typeof res.flush === 'function') {
            res.flush();
          }
          activeConnections.add(res);
        }
      } catch {
        // Connection is dead, will be cleaned up
      }
    }

    // Update the subscribers set to only include active connections
    listSubscribers.set(key, activeConnections);
  }
}
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
  };
}

function recordActivity(req) {
  if (req.user) {
    const timestamp = new Date();
    req.user.lastActivity = timestamp;
    users.update(
      { _id: req.user._id },
      { $set: { lastActivity: timestamp } },
      () => {}
    );
  }
}

// Admin code variables
const adminCodeAttempts = new Map(); // Track failed attempts
let adminCode = null;
let adminCodeExpiry = null;

// Enhanced admin code generation
function generateAdminCode() {
  try {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    adminCode = Array.from(
      { length: 8 },
      () => chars[Math.floor(Math.random() * chars.length)]
    ).join('');
    adminCodeExpiry = new Date(Date.now() + 5 * 60 * 1000);

    // ANSI color codes
    const colors = {
      reset: '\x1b[0m',
      bright: '\x1b[1m',
      red: '\x1b[31m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      blue: '\x1b[34m',
      cyan: '\x1b[36m',
      white: '\x1b[37m',
      gray: '\x1b[90m',
    };

    // Format time
    const timeOptions = {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    };
    const timeString = adminCodeExpiry.toLocaleTimeString('en-US', timeOptions);

    // Box configuration
    const BOX_WIDTH = 45;
    const INNER_WIDTH = BOX_WIDTH - 2;

    // Helper functions
    const centerText = (text) => {
      const ansiEscape = '\u001B';
      const visibleLength = text.replace(
        new RegExp(`${ansiEscape}\\[[0-9;]*m`, 'gu'),
        ''
      ).length;
      const totalPadding = INNER_WIDTH - visibleLength;
      const leftPad = Math.floor(totalPadding / 2);
      const rightPad = totalPadding - leftPad;
      return ' '.repeat(leftPad) + text + ' '.repeat(rightPad);
    };

    const leftAlignText = (label, value, _labelColor = '', valueColor = '') => {
      const fullText = `  ${label}: ${value}`;
      const padding = INNER_WIDTH - fullText.length;
      return `  ${label}: ${valueColor}${value}${colors.reset}${' '.repeat(padding)}`;
    };

    // Build the box
    const boxLines = [];
    boxLines.push(
      '\n' + colors.cyan + '╔' + '═'.repeat(INNER_WIDTH) + '╗' + colors.reset
    );
    boxLines.push(
      colors.cyan +
        '║' +
        colors.reset +
        centerText(
          colors.bright +
            colors.yellow +
            '🔐 ADMIN ACCESS CODE 🔐' +
            colors.reset
        ) +
        colors.cyan +
        '║' +
        colors.reset
    );
    boxLines.push(
      colors.cyan + '╠' + '═'.repeat(INNER_WIDTH) + '╣' + colors.reset
    );
    boxLines.push(
      colors.cyan +
        '║' +
        colors.reset +
        leftAlignText('Code', adminCode, '', colors.bright + colors.green) +
        colors.cyan +
        '║' +
        colors.reset
    );
    boxLines.push(
      colors.cyan +
        '║' +
        colors.reset +
        leftAlignText('Valid until', timeString, '', colors.yellow) +
        colors.cyan +
        '║' +
        colors.reset
    );

    // Show last usage info if available
    if (lastCodeUsedBy && lastCodeUsedAt) {
      boxLines.push(
        colors.cyan + '╟' + '─'.repeat(INNER_WIDTH) + '╢' + colors.reset
      );
      const usedTimeAgo = Math.floor((Date.now() - lastCodeUsedAt) / 1000);
      const timeAgoStr =
        usedTimeAgo < 60
          ? `${usedTimeAgo}s ago`
          : `${Math.floor(usedTimeAgo / 60)}m ago`;
      boxLines.push(
        colors.cyan +
          '║' +
          colors.reset +
          leftAlignText(
            'Previous code used by',
            lastCodeUsedBy,
            '',
            colors.gray
          ) +
          colors.cyan +
          '║' +
          colors.reset
      );
      boxLines.push(
        colors.cyan +
          '║' +
          colors.reset +
          leftAlignText('Used', timeAgoStr, '', colors.gray) +
          colors.cyan +
          '║' +
          colors.reset
      );
    }

    boxLines.push(
      colors.cyan + '╚' + '═'.repeat(INNER_WIDTH) + '╝' + colors.reset + '\n'
    );

    // Output the admin code box to console (this is intentional UI output)
    // eslint-disable-next-line no-console
    console.log(boxLines.join('\n'));

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
          logger.debug('User found', { email: user.email, hasHash: !!user.hash });
          isMatch = await bcrypt.compare(password, user.hash);
        }

        // Always return the same message regardless of whether email or password was wrong
        if (isMatch && user) {
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
    const user = await usersAsync.findOne({ _id: id });
    done(null, user);
  } catch (err) {
    done(err);
  }
});

// Create Express app
const app = express();

// Configure EJS view engine with caching
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.set('view cache', process.env.NODE_ENV === 'production');

// Conditional middleware application for performance
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

  // Apply helmet for all other requests
  helmet({ contentSecurityPolicy: false })(req, res, next);
});

// Basic Express middleware
app.use(express.static('public', { maxAge: '1y', immutable: true }));

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
app.use(express.urlencoded({ extended: false, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

// Request logging is handled by logger.requestLogger() middleware

// Session middleware with PostgreSQL store
app.use(
  session({
    store: new pgSession({
      pool: pool,
      tableName: 'session',
      createTableIfMissing: true,
      pruneSessionInterval: 600, // Clean up expired sessions every 10 minutes (in seconds)
      errorLog: (err) =>
        logger.error('Session store error', { error: err.message }),
    }),
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
  })
);

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

// Middleware to protect routes
function ensureAuth(req, res, next) {
  if (req.user || (req.isAuthenticated && req.isAuthenticated())) {
    return next();
  }
  res.redirect('/login');
}

// API middleware to ensure authentication
function ensureAuthAPI(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}

// Middleware to ensure admin
function ensureAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') {
    return next();
  }
  res.status(403).send('Access denied');
}

// Rate limiting middleware for admin requests
function rateLimitAdminRequest(req, res, next) {
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
}

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const apiRoutes = require('./routes/api');

const deps = {
  htmlTemplate,
  registerTemplate,
  loginTemplate,
  forgotPasswordTemplate,
  resetPasswordTemplate,
  invalidTokenTemplate,
  spotifyTemplate,
  settingsTemplate,
  isTokenValid,
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
  broadcastListUpdate,
  listSubscribers,
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
};

// Database health check endpoint
const { healthCheck } = require('./db/retry-wrapper');

app.get('/health/db', async (req, res) => {
  try {
    const health = await healthCheck(pool);
    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
  } catch (error) {
    logger.error('Health check endpoint error:', error);
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
    logger.error('General health check error:', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
    });
  }
});

authRoutes(app, deps);
adminRoutes(app, deps);
apiRoutes(app, deps);

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
ready
  .then(() => {
    app.listen(PORT, () => {
      logger.info('Server started', {
        port: PORT,
        environment: process.env.NODE_ENV || 'development',
        url: `http://localhost:${PORT}`,
      });
    });
  })
  .catch((err) => {
    logger.error('Failed to initialize database', { error: err.message });
    process.exit(1);
  });
