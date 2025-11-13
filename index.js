require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;

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
  limits: { fileSize: 1024 * 1024 * 1024 }, 
});

process.on('unhandledRejection', (err) => {
  logger.error('Unhandled promise rejection', {
    error: err.message,
    stack: err.stack,
  });
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
});


process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await logger.shutdown();

  
  try {
    const { responseCache } = require('./middleware/response-cache');
    responseCache.shutdown();
  } catch (_e) {
    
  }

  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await logger.shutdown();

  
  try {
    const { responseCache } = require('./middleware/response-cache');
    responseCache.shutdown();
  } catch (_e) {
    
  }

  process.exit(0);
});
const { composeForgotPasswordEmail } = require('./forgot_email');
const {
  isValidEmail,
  isValidUsername,
  isValidPassword,
} = require('./validators');


let lastCodeUsedBy = null;
let lastCodeUsedAt = null;


const {
  htmlTemplate,
  registerTemplate,
  loginTemplate,
  forgotPasswordTemplate,
  resetPasswordTemplate,
  invalidTokenTemplate,
  spotifyTemplate,
} = require('./templates');


const { settingsTemplate } = require('./settings-template');
const { isTokenValid } = require('./auth-utils');

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


const listSubscribers = new Map();

function broadcastListUpdate(userId, name, data) {
  const key = `${userId}:${name}`;
  const subs = listSubscribers.get(key);
  if (subs) {
    const payload = JSON.stringify(data);

    
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
        
      }
    }

    
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


const adminCodeAttempts = new Map(); 
let adminCode = null;
let adminCodeExpiry = null;


function generateAdminCode() {
  try {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    adminCode = Array.from(
      { length: 8 },
      () => chars[Math.floor(Math.random() * chars.length)]
    ).join('');
    adminCodeExpiry = new Date(Date.now() + 5 * 60 * 1000);

    
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

    
    const timeOptions = {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    };
    const timeString = adminCodeExpiry.toLocaleTimeString('en-US', timeOptions);

    
    const BOX_WIDTH = 45;
    const INNER_WIDTH = BOX_WIDTH - 2;

    
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

    
    
    console.log(boxLines.join('\n'));

    
    lastCodeUsedBy = null;
    lastCodeUsedAt = null;
  } catch (error) {
    logger.error('Error generating admin code', { error: error.message });
  }
}


generateAdminCode();
setInterval(generateAdminCode, 5 * 60 * 1000);


passport.use(
  new LocalStrategy(
    { usernameField: 'email' },
    async (email, password, done) => {
      logger.info('Login attempt', { email });

      try {
        const user = await usersAsync.findOne({ email });

        
        
        
        let isMatch = false;

        if (!user) {
          
          
          const dummyHash =
            '$2a$12$ZIJfCqcmsmY3xNqmJGFJh.vKMF3rKXSgPp/mDgpjLfSUJJ1oiGdX.'; 
          await bcrypt.compare(password, dummyHash);
          logger.warn('Login failed: Unknown email', { email });
        } else {
          logger.debug('User found', {
            email: user.email,
            hasHash: !!user.hash,
          });
          isMatch = await bcrypt.compare(password, user.hash);
        }

        
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


const app = express();


app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.set('view cache', process.env.NODE_ENV === 'production');


const helmetConfig = {
  
  contentSecurityPolicy: false,

  
  
  strictTransportSecurity:
    process.env.NODE_ENV === 'production' && process.env.ENABLE_HSTS === 'true'
      ? {
          maxAge: 31536000, 
          includeSubDomains: true,
          preload: true,
        }
      : false,

  
  referrerPolicy: {
    policy: 'strict-origin-when-cross-origin',
  },

  
  permissionsPolicy: {
    camera: [],
    microphone: [],
    geolocation: [],
    payment: [],
    usb: [],
    magnetometer: [],
    'browsing-topics': [],
    'interest-cohort': [],
  },

  
  crossOriginEmbedderPolicy: false, 
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }, 
  crossOriginResourcePolicy: { policy: 'cross-origin' }, 
};


app.use((req, res, next) => {
  
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

  
  helmet(helmetConfig)(req, res, next);
});


app.use(express.static('public', { maxAge: '1y', immutable: true }));


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


app.use(compression());
app.use(express.urlencoded({ extended: false, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));




app.use(
  session({
    store: new pgSession({
      pool: pool,
      tableName: 'session',
      createTableIfMissing: true,
      pruneSessionInterval: 600, 
      errorLog: (err) =>
        logger.error('Session store error', { error: err.message }),
    }),
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24, 
      sameSite: 'lax',
    },
    genid: function (_req) {
      return require('crypto').randomBytes(16).toString('hex');
    },
  })
);


app.use((req, res, next) => {
  
  if (!req.session.flash) {
    req.session.flash = {};
  }

  
  
  res.locals.flash = { ...req.session.flash };

  
  
  delete req.session.flash;

  
  req.flash = (type, message) => {
    
    if (!req.session.flash) {
      req.session.flash = {};
    }
    
    if (message === undefined) {
      return req.session.flash[type] || [];
    }

    
    if (!req.session.flash[type]) {
      req.session.flash[type] = [];
    }
    req.session.flash[type].push(message);
  };

  next();
});


app.use(logger.requestLogger());


app.use(passport.initialize());
app.use(passport.session());


const csrfTokens = new csrf();
const csrfProtection = (req, res, next) => {
  if (!req.session.csrfSecret) {
    req.session.csrfSecret = csrfTokens.secretSync();
    
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
      tokenFull: token, 
      secretFull: req.session?.csrfSecret, 
    });
    const err = new Error('Invalid CSRF token');
    err.code = 'EBADCSRFTOKEN';
    err.status = 403;
    return next(err);
  }

  next();
};


app.use((req, res, next) => {
  recordActivity(req);
  next();
});




function ensureAuth(req, res, next) {
  if (req.user || (req.isAuthenticated && req.isAuthenticated())) {
    return next();
  }
  res.redirect('/login');
}


function ensureAuthAPI(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}


function ensureAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') {
    return next();
  }
  res.status(403).send('Access denied');
}


function rateLimitAdminRequest(req, res, next) {
  const userKey = req.user._id;
  const attempts = adminCodeAttempts.get(userKey) || {
    count: 0,
    firstAttempt: Date.now(),
  };

  
  if (Date.now() - attempts.firstAttempt > 30 * 60 * 1000) {
    attempts.count = 0;
    attempts.firstAttempt = Date.now();
  }

  
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


app.get('/health', (req, res) => {
  res.render('health');
});


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


app.use(notFoundHandler);


app.use((err, req, res, next) => {
  
  if (res.headersSent) {
    logger.error('Headers already sent, cannot send error response', {
      error: err.message,
    });
    return;
  }

  
  errorHandler(err, req, res, next);
});


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
