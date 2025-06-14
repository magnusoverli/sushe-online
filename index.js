require('dotenv').config();
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const Datastore = require('@seald-io/nedb');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const path = require('path');
const compression = require('compression');
const helmet = require('helmet');
const csrf = require('csurf');
const multer = require('multer');
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});
const { composeForgotPasswordEmail } = require('./forgot_email');
const { isValidEmail, isValidUsername, isValidPassword } = require('./validators');

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
  spotifyTemplate
} = require('./templates');

// Import the new settings template
const { settingsTemplate } = require('./settings-template');
const { isTokenValid } = require('./auth-utils');

// Create data directory if it doesn't exist
const dataDir = process.env.DATA_DIR || './data';
if (!require('fs').existsSync(dataDir)) {
  require('fs').mkdirSync(dataDir, { recursive: true });
}

// Initialize NeDB databases
const users = new Datastore({ 
  filename: path.join(dataDir, 'users.db'), 
  autoload: true 
});
const lists = new Datastore({
  filename: path.join(dataDir, 'lists.db'),
  autoload: true
});

// Promisified DB helpers for async/await
const promisifyDatastore = require('./db-utils');
const usersAsync = promisifyDatastore(users);
const listsAsync = promisifyDatastore(lists);

// Create indexes for better performance
lists.ensureIndex({ fieldName: 'userId' });
lists.ensureIndex({ fieldName: 'name' });

// Map of SSE subscribers keyed by `${userId}:${listName}`
const listSubscribers = new Map();

function broadcastListUpdate(userId, name, data) {
  const key = `${userId}:${name}`;
  const subs = listSubscribers.get(key);
  if (subs) {
    const payload = JSON.stringify(data);
    for (const res of subs) {
      res.write(`event: update\ndata: ${payload}\n\n`);
      if (typeof res.flush === 'function') {
        res.flush();
      }
    }
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
    lastSelectedList,
    role,
    spotifyAuth: !!user.spotifyAuth,
    tidalAuth: !!user.tidalAuth
  };
}

// Admin code variables
const adminCodeAttempts = new Map(); // Track failed attempts
let adminCode = null;
let adminCodeExpiry = null;

// Enhanced admin code generation
function generateAdminCode() {
  try {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    adminCode = Array.from({length: 8}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
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
      gray: '\x1b[90m'
    };
    
    // Format time
    const timeOptions = { 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit',
      hour12: true 
    };
    const timeString = adminCodeExpiry.toLocaleTimeString('en-US', timeOptions);
    
    // Box configuration
    const BOX_WIDTH = 45;
    const INNER_WIDTH = BOX_WIDTH - 2;
    
    // Helper functions
    const centerText = (text) => {
      const visibleLength = text.replace(/\x1b\[[0-9;]*m/g, '').length;
      const totalPadding = INNER_WIDTH - visibleLength;
      const leftPad = Math.floor(totalPadding / 2);
      const rightPad = totalPadding - leftPad;
      return ' '.repeat(leftPad) + text + ' '.repeat(rightPad);
    };
    
    const leftAlignText = (label, value, labelColor = '', valueColor = '') => {
      const fullText = `  ${label}: ${value}`;
      const padding = INNER_WIDTH - fullText.length;
      return `  ${label}: ${valueColor}${value}${colors.reset}${' '.repeat(padding)}`;
    };
    
    // Build the box
    console.log('\n' + colors.cyan + '╔' + '═'.repeat(INNER_WIDTH) + '╗' + colors.reset);
    console.log(colors.cyan + '║' + colors.reset + centerText(colors.bright + colors.yellow + '🔐 ADMIN ACCESS CODE 🔐' + colors.reset) + colors.cyan + '║' + colors.reset);
    console.log(colors.cyan + '╠' + '═'.repeat(INNER_WIDTH) + '╣' + colors.reset);
    console.log(colors.cyan + '║' + colors.reset + leftAlignText('Code', adminCode, '', colors.bright + colors.green) + colors.cyan + '║' + colors.reset);
    console.log(colors.cyan + '║' + colors.reset + leftAlignText('Valid until', timeString, '', colors.yellow) + colors.cyan + '║' + colors.reset);
    
    // Show last usage info if available
    if (lastCodeUsedBy && lastCodeUsedAt) {
      console.log(colors.cyan + '╟' + '─'.repeat(INNER_WIDTH) + '╢' + colors.reset);
      const usedTimeAgo = Math.floor((Date.now() - lastCodeUsedAt) / 1000);
      const timeAgoStr = usedTimeAgo < 60 ? `${usedTimeAgo}s ago` : `${Math.floor(usedTimeAgo / 60)}m ago`;
      console.log(colors.cyan + '║' + colors.reset + leftAlignText('Previous code used by', lastCodeUsedBy, '', colors.gray) + colors.cyan + '║' + colors.reset);
      console.log(colors.cyan + '║' + colors.reset + leftAlignText('Used', timeAgoStr, '', colors.gray) + colors.cyan + '║' + colors.reset);
    }
    
    console.log(colors.cyan + '╚' + '═'.repeat(INNER_WIDTH) + '╝' + colors.reset + '\n');
    
    // Reset tracking for new code
    lastCodeUsedBy = null;
    lastCodeUsedAt = null;
    
  } catch (error) {
    console.error('Error generating admin code:', error);
  }
}

// Generate initial code and rotate every 5 minutes
generateAdminCode();
setInterval(generateAdminCode, 5 * 60 * 1000);

// Passport configuration
passport.use(new LocalStrategy({ usernameField: 'email' }, (email, password, done) => {
  console.log('Login attempt for email:', email);
  
  users.findOne({ email }, (err, user) => {
    if (err) {
      console.error('Database error during login:', err);
      return done(err);
    }
    
    if (!user) {
      console.log('Login failed: Unknown email -', email);
      // Don't reveal that the email doesn't exist
      return done(null, false, { message: 'Invalid email or password' });
    }
    
    console.log('User found:', { email: user.email, hasHash: !!user.hash });
    
    bcrypt.compare(password, user.hash, (err, isMatch) => {
      if (err) {
        console.error('Bcrypt compare error:', err);
        return done(err);
      }
      
      console.log('Password comparison result:', isMatch);
      
      if (!isMatch) {
        console.log('Login failed: Bad password for', email);
        // Same message as unknown email for security
        return done(null, false, { message: 'Invalid email or password' });
      }
      
      console.log('Login successful for:', email);
      return done(null, user);
    });
  });
}));

passport.serializeUser((user, done) => done(null, user._id));
passport.deserializeUser((id, done) => users.findOne({ _id: id }, done));

// Create Express app
const app = express();
const csrfProtection = csrf();

// Disable Helmet's default Content Security Policy as it blocks external CDN scripts used in the UI
app.use(helmet({ contentSecurityPolicy: false }));

// Basic Express middleware
app.use(express.static('public', { maxAge: '1y', immutable: true }));
app.use(compression());
app.use((req, res, next) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
    Expires: '0'
  });
  next();
});
app.use(express.urlencoded({ extended: false, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

// Session middleware
app.use(session({
  store: new FileStore({
    path: path.join(dataDir, 'sessions'),
    ttl: 86400, // 1 day in seconds
    retries: 0,
    reapInterval: 600, // Clean up expired sessions every 10 minutes
    reapAsync: true,
    reapSyncFallback: true,
    // Add these options for Windows compatibility
    logFn: function(){}, // Disable verbose logging
    fallbackSessionFn: function() {
      // Provide a minimal session object to avoid errors
      return {
        cookie: {
          originalMaxAge: null,
          expires: null,
          secure: false,
          httpOnly: true,
          path: '/'
        }
      };
    }
  }),
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 // 24 hours
  },
  // Add this to handle session save errors gracefully
  genid: function(req) {
    return require('crypto').randomBytes(16).toString('hex');
  }
}));

// Custom flash middleware
app.use((req, res, next) => {
  // Initialize flash in session if it doesn't exist
  if (!req.session.flash) {
    req.session.flash = {};
  }
  
  // Make flash messages available to templates via res.locals
  res.locals.flash = req.session.flash;
  
  // Clear flash messages after making them available
  req.session.flash = {};
  
  // Add flash method to request object
  req.flash = (type, message) => {
    // If called with just type, return messages of that type (getter)
    if (message === undefined) {
      return res.locals.flash[type] || [];
    }
    
    // Otherwise, add message (setter)
    if (!req.session.flash[type]) {
      req.session.flash[type] = [];
    }
    req.session.flash[type].push(message);
  };
  
  next();
});


// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

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
  if (req.isAuthenticated()) return next();
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
  const attempts = adminCodeAttempts.get(userKey) || { count: 0, firstAttempt: Date.now() };
  
  // Reset if more than 30 minutes since first attempt
  if (Date.now() - attempts.firstAttempt > 30 * 60 * 1000) {
    attempts.count = 0;
    attempts.firstAttempt = Date.now();
  }
  
  // Block if too many attempts
  if (attempts.count >= 5) {
    console.warn(`⚠️  User ${req.user.email} blocked from admin requests (too many attempts)`);
    req.flash('error', 'Too many failed attempts. Please wait 30 minutes.');
    return res.redirect('/settings');
  }
  
  req.adminAttempts = attempts;
  next();
}

const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const apiRoutes = require("./routes/api");

const deps = {
  htmlTemplate, registerTemplate, loginTemplate, forgotPasswordTemplate, resetPasswordTemplate, invalidTokenTemplate, spotifyTemplate, settingsTemplate, isTokenValid,
  csrfProtection, ensureAuth, ensureAuthAPI, ensureAdmin, rateLimitAdminRequest,
  users, lists, usersAsync, listsAsync, upload, bcrypt, crypto, nodemailer,
  composeForgotPasswordEmail, isValidEmail, isValidUsername, isValidPassword,
  broadcastListUpdate, listSubscribers, sanitizeUser, adminCodeAttempts, adminCode, adminCodeExpiry, generateAdminCode, lastCodeUsedBy, lastCodeUsedAt
};

authRoutes(app, deps);
adminRoutes(app, deps);
apiRoutes(app, deps);


// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Application error:', err);
  
  // Check if headers were already sent
  if (res.headersSent) {
    console.error('Headers already sent, cannot send error response');
    return;
  }
  
  // For session-related errors, try to continue
  if (err.code === 'EPERM' && err.path && err.path.includes('sessions')) {
    console.warn('Session file error, attempting to continue...');
    // Don't send error response for session file issues
    return;
  }
  
  res.status(500).send('Something went wrong!');
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🔥 Server burning at http://localhost:${PORT} 🔥`);
  console.log(`🔥 Environment: ${process.env.NODE_ENV || 'development'} 🔥`);
});