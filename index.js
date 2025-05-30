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
const multer = require('multer');
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

const { composeForgotPasswordEmail } = require('./forgot_email');

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

// Create indexes for better performance
lists.ensureIndex({ fieldName: 'userId' });
lists.ensureIndex({ fieldName: 'name' });

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

// Basic Express middleware
app.use(express.static('public'));
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
      // Fallback session if file operations fail
      return {};
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

// ============ ROUTES ============

// Registration routes
app.get('/register', (req, res) => {
  res.send(htmlTemplate(registerTemplate(req, res.locals.flash), 'Join the KVLT - Black Metal Auth'));
});

app.post('/register', async (req, res) => {
  try {
    const { email, username, password, confirmPassword } = req.body;
    
    // Validate all fields are present
    if (!email || !username || !password || !confirmPassword) {
      req.flash('error', 'All fields are required');
      return res.redirect('/register');
    }
    
    // Check passwords match
    if (password !== confirmPassword) {
      req.flash('error', 'Passwords do not match');
      return res.redirect('/register');
    }
    
    // Validate email format (basic check)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      req.flash('error', 'Please enter a valid email address');
      return res.redirect('/register');
    }
    
    // Validate username length
    if (username.length < 3 || username.length > 30) {
      req.flash('error', 'Username must be between 3 and 30 characters');
      return res.redirect('/register');
    }
    
    // Validate username format (alphanumeric and underscores only)
    const usernameRegex = /^[a-zA-Z0-9_]+$/;
    if (!usernameRegex.test(username)) {
      req.flash('error', 'Username can only contain letters, numbers, and underscores');
      return res.redirect('/register');
    }
    
    // Validate password length
    if (password.length < 8) {
      req.flash('error', 'Password must be at least 8 characters');
      return res.redirect('/register');
    }
    
    // Check if email already exists
    users.findOne({ email }, async (err, existingEmailUser) => {
      if (err) {
        console.error('Database error during registration:', err);
        req.flash('error', 'Registration error. Please try again.');
        return res.redirect('/register');
      }
      
      if (existingEmailUser) {
        req.flash('error', 'Email already registered');
        return res.redirect('/register');
      }
      
      // Check if username already exists
      users.findOne({ username }, async (err, existingUsernameUser) => {
        if (err) {
          console.error('Database error during registration:', err);
          req.flash('error', 'Registration error. Please try again.');
          return res.redirect('/register');
        }
        
        if (existingUsernameUser) {
          req.flash('error', 'Username already taken');
          return res.redirect('/register');
        }
        
        try {
          // Hash the password
          const hash = await bcrypt.hash(password, 12);
          
          // Create the new user
          users.insert({ 
            email, 
            username, 
            hash,
            createdAt: new Date(),
            updatedAt: new Date()
          }, (err, newUser) => {
            if (err) {
              console.error('Insert error during registration:', err);
              req.flash('error', 'Registration error. Please try again.');
              return res.redirect('/register');
            }
            
            console.log('New user registered:', email, 'username:', username);
            req.flash('success', 'Registration successful! Please login.');
            res.redirect('/login');
          });
        } catch (hashErr) {
          console.error('Password hashing error during registration:', hashErr);
          req.flash('error', 'Registration error. Please try again.');
          res.redirect('/register');
        }
      });
    });
  } catch (error) {
    console.error('Registration error:', error);
    req.flash('error', 'Registration error. Please try again.');
    res.redirect('/register');
  }
});

app.post('/api/user/last-list', ensureAuthAPI, (req, res) => {
  const { listName } = req.body;
  
  users.update(
    { _id: req.user._id },
    { $set: { lastSelectedList: listName, updatedAt: new Date() } },
    {},
    (err) => {
      if (err) {
        console.error('Error updating last selected list:', err);
        return res.status(500).json({ error: 'Error updating last selected list' });
      }
      
      // Update the session user object
      req.user.lastSelectedList = listName;
      req.session.save();
      
      res.json({ success: true });
    }
  );
});

// Login routes
app.get('/login', (req, res) => {
  res.send(htmlTemplate(loginTemplate(req, res.locals.flash), 'SuShe Online'));
});

app.post('/login', (req, res, next) => {
  console.log('Login POST request received for:', req.body.email);
  
  passport.authenticate('local', (err, user, info) => {
    if (err) {
      console.error('Authentication error:', err);
      req.flash('error', 'An error occurred during login');
      return res.redirect('/login');
    }
    
    if (!user) {
      console.log('Authentication failed:', info);
      req.flash('error', info.message || 'Invalid credentials');
      return res.redirect('/login');
    }
    
    req.logIn(user, (err) => {
      if (err) {
        console.error('Login error:', err);
        req.flash('error', 'Login failed');
        return res.redirect('/login');
      }
      
      console.log('User logged in successfully:', user.email);
      
      // Force session save and handle errors
      req.session.save((err) => {
        if (err) {
          console.error('Session save error:', err);
          // Continue anyway - session might still work
        }
        return res.redirect('/');
      });
    });
  })(req, res, next);
});

// Logout
app.get('/logout', (req, res) => {
  req.logout(() => res.redirect('/login'));
});

// Home (protected) - Spotify-like interface
app.get('/', ensureAuth, (req, res) => {
  res.send(spotifyTemplate(req));
});

// Unified Settings Page
app.get('/settings', ensureAuth, async (req, res) => {
  try {
    // Get user's personal stats
    const getUserStats = new Promise((resolve) => {
      lists.find({ userId: req.user._id }, (err, userLists) => {
        if (err) {
          resolve({ listCount: 0, totalAlbums: 0 });
          return;
        }
        
        let totalAlbums = 0;
        userLists.forEach(list => {
          if (Array.isArray(list.data)) {
            totalAlbums += list.data.length;
          }
        });
        
        resolve({ listCount: userLists.length, totalAlbums });
      });
    });

    const userStats = await getUserStats;
    
    // If admin, get admin data
    let adminData = null;
    let stats = null;
    
    if (req.user.role === 'admin') {
      // Get all users with their list counts
      const getAdminData = new Promise((resolve) => {
        users.find({}, (err, allUsers) => {
          if (err) {
            resolve({ users: [], stats: {} });
            return;
          }

          // Get list counts for each user
          const userPromises = allUsers.map(user => {
            return new Promise((res) => {
              lists.count({ userId: user._id }, (err, count) => {
                res({
                  ...user,
                  listCount: err ? 0 : count
                });
              });
            });
          });

          Promise.all(userPromises).then(usersWithCounts => {
            // Calculate all statistics
            lists.find({}, async (err, allLists) => {
              let totalAlbums = 0;
              const genreCounts = new Map();
              
              // Calculate active users (last 7 days)
              const sevenDaysAgo = new Date();
              sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
              let activeUsers = 0;
              
              // Calculate user growth (compare this week vs last week)
              const twoWeeksAgo = new Date();
              twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
              
              const usersThisWeek = allUsers.filter(u => new Date(u.createdAt) >= sevenDaysAgo).length;
              const usersLastWeek = allUsers.filter(u => {
                const createdAt = new Date(u.createdAt);
                return createdAt >= twoWeeksAgo && createdAt < sevenDaysAgo;
              }).length;
              
              const userGrowth = usersLastWeek > 0 
                ? Math.round(((usersThisWeek - usersLastWeek) / usersLastWeek) * 100)
                : (usersThisWeek > 0 ? 100 : 0);
              
              if (!err && allLists) {
                // Process all lists
                allLists.forEach(list => {
                  // Check if list was updated in last 7 days (active user)
                  if (list.updatedAt && new Date(list.updatedAt) >= sevenDaysAgo) {
                    const userIndex = allUsers.findIndex(u => u._id === list.userId);
                    if (userIndex !== -1 && !allUsers[userIndex].counted) {
                      allUsers[userIndex].counted = true;
                      activeUsers++;
                    }
                  }
                  
                  if (Array.isArray(list.data)) {
                    totalAlbums += list.data.length;
                    
                    // Count genres
                    list.data.forEach(album => {
                      // Count primary genre
                      if (album.genre_1 || album.genre) {
                        const genre = album.genre_1 || album.genre;
                        if (genre && genre !== '' && genre !== 'Genre 1') {
                          genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
                        }
                      }
                      
                      // Count secondary genre
                      if (album.genre_2 && album.genre_2 !== '' && album.genre_2 !== 'Genre 2' && album.genre_2 !== '-') {
                        genreCounts.set(album.genre_2, (genreCounts.get(album.genre_2) || 0) + 1);
                      }
                    });
                  }
                });
              }

              // Get top genres
              const topGenres = Array.from(genreCounts.entries())
                .map(([name, count]) => ({ name, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 5);

              // Get top users by list count
              const topUsers = usersWithCounts
                .filter(u => u.listCount > 0)
                .sort((a, b) => b.listCount - a.listCount)
                .slice(0, 5);

              // Calculate database size (approximate)
              let dbSize = 'N/A';
              try {
                const fs = require('fs');
                const dbPath = path.join(dataDir, 'users.db');
                const listsDbPath = path.join(dataDir, 'lists.db');
                
                if (fs.existsSync(dbPath) && fs.existsSync(listsDbPath)) {
                  const usersSize = fs.statSync(dbPath).size;
                  const listsSize = fs.statSync(listsDbPath).size;
                  const totalSize = usersSize + listsSize;
                  
                  // Convert to human readable
                  if (totalSize < 1024 * 1024) {
                    dbSize = `${Math.round(totalSize / 1024)} KB`;
                  } else {
                    dbSize = `${(totalSize / (1024 * 1024)).toFixed(1)} MB`;
                  }
                }
              } catch (e) {
                console.error('Error calculating DB size:', e);
              }

              // Count active sessions
              let activeSessions = 0;
              try {
                const sessionPath = path.join(dataDir, 'sessions');
                if (require('fs').existsSync(sessionPath)) {
                  const sessionFiles = require('fs').readdirSync(sessionPath);
                  activeSessions = sessionFiles.filter(f => f.endsWith('.json')).length;
                }
              } catch (e) {
                console.error('Error counting sessions:', e);
              }

              const stats = {
                totalUsers: allUsers.length,
                totalLists: err ? 0 : allLists.length,
                totalAlbums: totalAlbums,
                adminUsers: allUsers.filter(u => u.role === 'admin').length,
                activeUsers,
                userGrowth,
                dbSize,
                activeSessions,
                topGenres,
                topUsers
              };

              // Generate real recent activity based on actual data
              const recentActivity = [];
              
              // Find recent user registrations
              const recentUsers = allUsers
                .filter(u => u.createdAt)
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                .slice(0, 2);
              
              recentUsers.forEach(user => {
                const timeAgo = getTimeAgo(new Date(user.createdAt));
                recentActivity.push({
                  icon: 'fa-user-plus',
                  color: 'green',
                  message: `New user: ${user.username}`,
                  time: timeAgo
                });
              });
              
              // Find recent list creations
              const recentLists = allLists
                .filter(l => l.createdAt)
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                .slice(0, 2);
              
              recentLists.forEach(list => {
                const timeAgo = getTimeAgo(new Date(list.createdAt));
                recentActivity.push({
                  icon: 'fa-list',
                  color: 'blue',
                  message: `New list: ${list.name}`,
                  time: timeAgo
                });
              });
              
              // Find recent admin grants
              const recentAdmins = allUsers
                .filter(u => u.role === 'admin' && u.adminGrantedAt)
                .sort((a, b) => new Date(b.adminGrantedAt) - new Date(a.adminGrantedAt))
                .slice(0, 1);
              
              recentAdmins.forEach(admin => {
                const timeAgo = getTimeAgo(new Date(admin.adminGrantedAt));
                recentActivity.push({
                  icon: 'fa-user-shield',
                  color: 'yellow',
                  message: `Admin granted: ${admin.username}`,
                  time: timeAgo
                });
              });
              
              // Sort by time and take the most recent 4
              recentActivity.sort((a, b) => {
                // This is a simplified sort - in production you'd want to store actual timestamps
                const timeValues = { 'just now': 0, 'minutes ago': 1, 'hour': 2, 'hours ago': 3, 'day': 4, 'days ago': 5 };
                const aValue = Object.keys(timeValues).find(key => a.time.includes(key)) || 6;
                const bValue = Object.keys(timeValues).find(key => b.time.includes(key)) || 6;
                return timeValues[aValue] - timeValues[bValue];
              });
              
              // Ensure we have at least 4 items (pad with defaults if needed)
              while (recentActivity.length < 4) {
                recentActivity.push({
                  icon: 'fa-clock',
                  color: 'gray',
                  message: 'No recent activity',
                  time: '-'
                });
              }

              resolve({
                users: usersWithCounts,
                stats,
                recentActivity: recentActivity.slice(0, 4)
              });
            });
          });
        });
      });

      const data = await getAdminData;
      adminData = data;
      stats = data.stats;
    }

    res.send(settingsTemplate(req, {
      user: req.user,
      userStats,
      stats,
      adminData,
      flash: res.locals.flash
    }));
    
  } catch (error) {
    console.error('Settings page error:', error);
    req.flash('error', 'Error loading settings');
    res.redirect('/');
  }
});

function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  }
  if (seconds < 2592000) {
    const days = Math.floor(seconds / 86400);
    return days === 1 ? '1 day ago' : `${days} days ago`;
  }
  
  // For "recent activity", cap at months - anything older isn't really "recent"
  const months = Math.floor(seconds / 2592000);
  if (months === 0) return '< 1 month ago';
  if (months === 1) return '1 month ago';
  if (months < 12) return `${months} months ago`;
  
  // For anything over a year, just show "over a year ago" for recent activity
  return 'over a year ago';
}

// Change password endpoint
app.post('/settings/change-password', ensureAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    
    // Validate inputs
    if (!currentPassword || !newPassword || !confirmPassword) {
      req.flash('error', 'All fields are required');
      return res.redirect('/settings');
    }
    
    if (newPassword !== confirmPassword) {
      req.flash('error', 'New passwords do not match');
      return res.redirect('/settings');
    }
    
    if (newPassword.length < 8) {
      req.flash('error', 'New password must be at least 8 characters');
      return res.redirect('/settings');
    }
    
    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, req.user.hash);
    if (!isMatch) {
      req.flash('error', 'Current password is incorrect');
      return res.redirect('/settings');
    }
    
    // Hash new password
    const newHash = await bcrypt.hash(newPassword, 12);
    
    // Update user
    users.update(
      { _id: req.user._id },
      { $set: { hash: newHash, updatedAt: new Date() } },
      {},
      (err) => {
        if (err) {
          console.error('Error updating password:', err);
          req.flash('error', 'Error updating password');
          return res.redirect('/settings');
        }
        
        req.flash('success', 'Password updated successfully');
        res.redirect('/settings');
      }
    );
  } catch (error) {
    console.error('Password change error:', error);
    req.flash('error', 'Error changing password');
    res.redirect('/settings');
  }
});

// Admin request endpoint
app.post('/settings/request-admin', ensureAuth, rateLimitAdminRequest, async (req, res) => {
  console.log('Admin request received from:', req.user.email);
  
  try {
    const { code } = req.body;
    
    // Validate code
    if (!code || code.toUpperCase() !== adminCode || new Date() > adminCodeExpiry) {
      console.log('Invalid code attempt');
      
      // Increment failed attempts
      const attempts = req.adminAttempts;
      attempts.count++;
      adminCodeAttempts.set(req.user._id, attempts);
      
      req.flash('error', 'Invalid or expired admin code');
      return res.redirect('/settings');
    }
    
    // Clear failed attempts on success
    adminCodeAttempts.delete(req.user._id);
    
    // Grant admin
    users.update(
      { _id: req.user._id },
      { 
        $set: { 
          role: 'admin',
          adminGrantedAt: new Date()
        }
      },
      {},
      (err, numUpdated) => {
        if (err) {
          console.error('Error granting admin:', err);
          req.flash('error', 'Error granting admin access');
          return res.redirect('/settings');
        }
        
        console.log(`✅ Admin access granted to: ${req.user.email}`);
        
        // >>>>>>> ADD THE TRACKING CODE HERE <<<<<
        // Track code usage
        lastCodeUsedBy = req.user.email;
        lastCodeUsedAt = Date.now();
        
        // REGENERATE CODE IMMEDIATELY after successful use
        console.log('🔄 Regenerating admin code after successful use...');
        generateAdminCode();
        
        // Update the session
        req.user.role = 'admin';
        req.session.save((err) => {
          if (err) console.error('Session save error:', err);
          req.flash('success', 'Admin access granted!');
          res.redirect('/settings');
        });
      }
    );
  } catch (error) {
    console.error('Admin request error:', error);
    req.flash('error', 'Error processing admin request');
    res.redirect('/settings');
  }
});

// Update email endpoint
app.post('/settings/update-email', ensureAuth, async (req, res) => {
  try {
    const { email } = req.body;
    
    // Validate email
    if (!email || !email.trim()) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    
    // Check if email is already taken by another user
    users.findOne({ email, _id: { $ne: req.user._id } }, (err, existingUser) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (existingUser) {
        return res.status(400).json({ error: 'Email already in use' });
      }
      
      // Update user email
      users.update(
        { _id: req.user._id },
        { $set: { email: email.trim(), updatedAt: new Date() } },
        {},
        (err) => {
          if (err) {
            console.error('Error updating email:', err);
            return res.status(500).json({ error: 'Error updating email' });
          }
          
          // Update session
          req.user.email = email.trim();
          req.session.save((err) => {
            if (err) console.error('Session save error:', err);
            req.flash('success', 'Email updated successfully');
            res.json({ success: true });
          });
        }
      );
    });
  } catch (error) {
    console.error('Update email error:', error);
    res.status(500).json({ error: 'Error updating email' });
  }
});

// Update username endpoint
app.post('/settings/update-username', ensureAuth, async (req, res) => {
  try {
    const { username } = req.body;
    
    // Validate username
    if (!username || !username.trim()) {
      return res.status(400).json({ error: 'Username is required' });
    }
    
    if (username.length < 3 || username.length > 30) {
      return res.status(400).json({ error: 'Username must be between 3 and 30 characters' });
    }
    
    const usernameRegex = /^[a-zA-Z0-9_]+$/;
    if (!usernameRegex.test(username)) {
      return res.status(400).json({ error: 'Username can only contain letters, numbers, and underscores' });
    }
    
    // Check if username is already taken by another user
    users.findOne({ username, _id: { $ne: req.user._id } }, (err, existingUser) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (existingUser) {
        return res.status(400).json({ error: 'Username already taken' });
      }
      
      // Update username
      users.update(
        { _id: req.user._id },
        { $set: { username: username.trim(), updatedAt: new Date() } },
        {},
        (err) => {
          if (err) {
            console.error('Error updating username:', err);
            return res.status(500).json({ error: 'Error updating username' });
          }
          
          // Update session
          req.user.username = username.trim();
          req.session.save((err) => {
            if (err) console.error('Session save error:', err);
            req.flash('success', 'Username updated successfully');
            res.json({ success: true });
          });
        }
      );
    });
  } catch (error) {
    console.error('Update username error:', error);
    res.status(500).json({ error: 'Error updating username' });
  }
});

// ============ ADMIN API ENDPOINTS ============

// Admin: Delete user
app.post('/admin/delete-user', ensureAuth, ensureAdmin, (req, res) => {
  const { userId } = req.body;
  
  if (userId === req.user._id) {
    return res.status(400).json({ error: 'Cannot delete yourself' });
  }

  // Delete user's lists first
  lists.remove({ userId }, { multi: true }, (err) => {
    if (err) {
      console.error('Error deleting user lists:', err);
      return res.status(500).json({ error: 'Error deleting user data' });
    }

    // Then delete the user
    users.remove({ _id: userId }, {}, (err, numRemoved) => {
      if (err) {
        console.error('Error deleting user:', err);
        return res.status(500).json({ error: 'Error deleting user' });
      }

      if (numRemoved === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      console.log(`Admin ${req.user.email} deleted user with ID: ${userId}`);
      res.json({ success: true });
    });
  });
});

// Admin: Make user admin
app.post('/admin/make-admin', ensureAuth, ensureAdmin, (req, res) => {
  const { userId } = req.body;

  users.update(
    { _id: userId },
    { $set: { role: 'admin', adminGrantedAt: new Date() } },
    {},
    (err, numUpdated) => {
      if (err) {
        console.error('Error granting admin:', err);
        return res.status(500).json({ error: 'Error granting admin privileges' });
      }

      if (numUpdated === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      console.log(`Admin ${req.user.email} granted admin to user ID: ${userId}`);
      res.json({ success: true });
    }
  );
});

// Admin: Revoke admin
app.post('/admin/revoke-admin', ensureAuth, ensureAdmin, (req, res) => {
  const { userId } = req.body;

  // Prevent revoking your own admin rights
  if (userId === req.user._id) {
    return res.status(400).json({ error: 'Cannot revoke your own admin privileges' });
  }

  users.update(
    { _id: userId },
    { $unset: { role: true, adminGrantedAt: true } },
    {},
    (err, numUpdated) => {
      if (err) {
        console.error('Error revoking admin:', err);
        return res.status(500).json({ error: 'Error revoking admin privileges' });
      }

      if (numUpdated === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      console.log(`Admin ${req.user.email} revoked admin from user ID: ${userId}`);
      res.json({ success: true });
    }
  );
});

// Admin: Export users as CSV
app.get('/admin/export-users', ensureAuth, ensureAdmin, (req, res) => {
  users.find({}, (err, allUsers) => {
    if (err) {
      console.error('Error exporting users:', err);
      return res.status(500).send('Error exporting users');
    }

    // Create CSV content
    let csv = 'Email,Username,Role,Created At\n';
    allUsers.forEach(user => {
      csv += `"${user.email}","${user.username}","${user.role || 'user'}","${new Date(user.createdAt).toISOString()}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="users-export.csv"');
    res.send(csv);
  });
});

// Admin: Get user lists
app.get('/admin/user-lists/:userId', ensureAuth, ensureAdmin, (req, res) => {
  const { userId } = req.params;
  
  lists.find({ userId }, (err, userLists) => {
    if (err) {
      console.error('Error fetching user lists:', err);
      return res.status(500).json({ error: 'Error fetching user lists' });
    }
    
    const listsData = userLists.map(list => ({
      name: list.name,
      albumCount: Array.isArray(list.data) ? list.data.length : 0,
      createdAt: list.createdAt,
      updatedAt: list.updatedAt
    }));
    
    res.json({ lists: listsData });
  });
});

// Admin: Database backup
app.get('/admin/backup', ensureAuth, ensureAdmin, async (req, res) => {
  try {
    const backup = {
      exportDate: new Date().toISOString(),
      users: [],
      lists: []
    };

    // Get all users
    users.find({}, (err, allUsers) => {
      if (err) {
        console.error('Error backing up users:', err);
        return res.status(500).send('Error creating backup');
      }

      backup.users = allUsers;

      // Get all lists
      lists.find({}, (err, allLists) => {
        if (err) {
          console.error('Error backing up lists:', err);
          return res.status(500).send('Error creating backup');
        }

        backup.lists = allLists;

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename="sushe-backup.json"');
        res.send(JSON.stringify(backup, null, 2));
      });
    });
  } catch (error) {
    console.error('Backup error:', error);
    res.status(500).send('Error creating backup');
  }
});

// Admin: Restore database
app.post('/admin/restore', ensureAuth, ensureAdmin, upload.single('backup'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Parse the JSON backup
    let backup;
    try {
      backup = JSON.parse(req.file.buffer.toString());
    } catch (parseError) {
      console.error('Invalid backup file:', parseError);
      return res.status(400).json({ error: 'Invalid backup file format' });
    }

    // Validate backup structure
    if (!backup.users || !backup.lists || !Array.isArray(backup.users) || !Array.isArray(backup.lists)) {
      return res.status(400).json({ error: 'Invalid backup structure' });
    }

    console.log(`Restoring backup from ${backup.exportDate}`);
    console.log(`Contains ${backup.users.length} users and ${backup.lists.length} lists`);

    // Clear existing data
    await new Promise((resolve, reject) => {
      users.remove({}, { multi: true }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    await new Promise((resolve, reject) => {
      lists.remove({}, { multi: true }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Restore users
    await new Promise((resolve, reject) => {
      users.insert(backup.users, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Restore lists
    await new Promise((resolve, reject) => {
      lists.insert(backup.lists, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Clear all sessions after restore
    req.sessionStore.clear((err) => {
      if (err) {
        console.error('Error clearing sessions after restore:', err);
      }
    });

    console.log(`Database restored successfully by ${req.user.email}`);
    res.json({ success: true, message: 'Database restored successfully' });

  } catch (error) {
    console.error('Restore error:', error);
    res.status(500).json({ error: 'Error restoring database' });
  }
});

// Admin: Clear all sessions
app.post('/admin/clear-sessions', ensureAuth, ensureAdmin, (req, res) => {
  const sessionStore = req.sessionStore;
  
  sessionStore.clear((err) => {
    if (err) {
      console.error('Error clearing sessions:', err);
      return res.status(500).json({ error: 'Error clearing sessions' });
    }

    console.log(`Admin ${req.user.email} cleared all sessions`);
    res.json({ success: true });
  });
});

// Admin status endpoint (for debugging)
app.get('/api/admin/status', ensureAuth, (req, res) => {
  res.json({
    isAdmin: req.user.role === 'admin',
    codeValid: new Date() < adminCodeExpiry,
    codeExpiresIn: Math.max(0, Math.floor((adminCodeExpiry - new Date()) / 1000)) + ' seconds'
  });
});

// ============ API ENDPOINTS FOR LISTS ============

// Get all lists for current user
app.get('/api/lists', ensureAuthAPI, (req, res) => {
  lists.find({ userId: req.user._id }, (err, userLists) => {
    if (err) {
      console.error('Error fetching lists:', err);
      return res.status(500).json({ error: 'Error fetching lists' });
    }
    
    // Transform to simple object format
    const listsObj = {};
    userLists.forEach(list => {
      listsObj[list.name] = list.data;
    });
    
    res.json(listsObj);
  });
});

// Create or update a list
app.post('/api/lists/:name', ensureAuthAPI, (req, res) => {
  const { name } = req.params;
  const { data } = req.body;
  
  if (!data || !Array.isArray(data)) {
    return res.status(400).json({ error: 'Invalid list data' });
  }
  
  // Check if list exists
  lists.findOne({ userId: req.user._id, name }, (err, existingList) => {
    if (err) {
      console.error('Error checking list:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (existingList) {
      // Update existing list
      lists.update(
        { _id: existingList._id },
        { $set: { data, updatedAt: new Date() } },
        {},
        (err) => {
          if (err) {
            console.error('Error updating list:', err);
            return res.status(500).json({ error: 'Error updating list' });
          }
          res.json({ success: true, message: 'List updated' });
        }
      );
    } else {
      // Create new list
      lists.insert({
        userId: req.user._id,
        name,
        data,
        createdAt: new Date(),
        updatedAt: new Date()
      }, (err, newList) => {
        if (err) {
          console.error('Error creating list:', err);
          return res.status(500).json({ error: 'Error creating list' });
        }
        res.json({ success: true, message: 'List created' });
      });
    }
  });
});

// Delete a specific list
app.delete('/api/lists/:name', ensureAuthAPI, (req, res) => {
  const { name } = req.params;
  
  lists.remove({ userId: req.user._id, name }, {}, (err, numRemoved) => {
    if (err) {
      console.error('Error deleting list:', err);
      return res.status(500).json({ error: 'Error deleting list' });
    }
    
    if (numRemoved === 0) {
      return res.status(404).json({ error: 'List not found' });
    }
    
    // If this was the user's last selected list, clear it
    if (req.user.lastSelectedList === name) {
      users.update(
        { _id: req.user._id },
        { $unset: { lastSelectedList: true } },
        {},
        (updateErr) => {
          if (updateErr) {
            console.error('Error clearing last selected list:', updateErr);
          }
          req.user.lastSelectedList = null;
          req.session.save();
        }
      );
    }
    
    res.json({ success: true, message: 'List deleted' });
  });
});

// Delete all lists for current user
app.delete('/api/lists', ensureAuthAPI, (req, res) => {
  lists.remove({ userId: req.user._id }, { multi: true }, (err, numRemoved) => {
    if (err) {
      console.error('Error clearing lists:', err);
      return res.status(500).json({ error: 'Error clearing lists' });
    }
    
    res.json({ success: true, message: `Deleted ${numRemoved} lists` });
  });
});

// ============ PASSWORD RESET ROUTES ============

// Forgot password page
app.get('/forgot', (req, res) => {
  res.send(htmlTemplate(forgotPasswordTemplate(req, res.locals.flash), 'Password Recovery - Black Metal Auth'));
});

// Handle forgot password submission
app.post('/forgot', (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    req.flash('error', 'Please provide an email address');
    return res.redirect('/forgot');
  }
  
  users.findOne({ email }, (err, user) => {
    if (err) {
      console.error('Database error during forgot password:', err);
      req.flash('error', 'An error occurred. Please try again.');
      return res.redirect('/forgot');
    }
    
    // Always show the same message for security reasons
    req.flash('info', 'If that email exists, you will receive a reset link');
    
    if (!user) {
      // Don't reveal that the email doesn't exist
      return res.redirect('/forgot');
    }

    const token = crypto.randomBytes(20).toString('hex');
    const expires = Date.now() + 3600000; // 1 hour
    
    users.update(
      { _id: user._id }, 
      { $set: { resetToken: token, resetExpires: expires } }, 
      {}, 
      (err, numReplaced) => {
        if (err) {
          console.error('Failed to set reset token:', err);
          // Don't show error to user for security reasons
          return res.redirect('/forgot');
        }
        
        if (numReplaced === 0) {
          console.error('No user updated when setting reset token');
          // Don't show error to user for security reasons
          return res.redirect('/forgot');
        }
        
        console.log('Reset token set for user:', user.email);
        
        if (process.env.SENDGRID_API_KEY) {
          const transporter = nodemailer.createTransport({
            host: 'smtp.sendgrid.net',
            port: 587,
            auth: {
              user: 'apikey',
              pass: process.env.SENDGRID_API_KEY
            }
          });
          
          const resetUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/reset/${token}`;
          const emailOptions = composeForgotPasswordEmail(user.email, resetUrl);
          
          transporter.sendMail(emailOptions, (error, info) => {
            if (error) {
              console.error('Failed to send password reset email:', error.message);
            } else {
              console.log('Password reset email sent successfully to:', user.email);
            }
          });
        } else {
          console.warn('SENDGRID_API_KEY not configured - password reset email not sent');
          console.log('Reset token for testing:', token);
        }
        
        res.redirect('/forgot');
      }
    );
  });
});

// Reset password page
app.get('/reset/:token', (req, res) => {
  users.findOne({ resetToken: req.params.token, resetExpires: { $gt: Date.now() } }, (err, user) => {
    if (!user) {
      return res.send(htmlTemplate(invalidTokenTemplate(), 'Invalid Token - Black Metal Auth'));
    }
    res.send(htmlTemplate(resetPasswordTemplate(req.params.token), 'Reset Password - Black Metal Auth'));
  });
});

// Handle password reset
app.post('/reset/:token', async (req, res) => {
  users.findOne({ resetToken: req.params.token, resetExpires: { $gt: Date.now() } }, async (err, user) => {
    if (err) {
      console.error('Error finding user with reset token:', err);
      return res.send(htmlTemplate(invalidTokenTemplate(), 'Invalid Token - Black Metal Auth'));
    }
    
    if (!user) {
      return res.send(htmlTemplate(invalidTokenTemplate(), 'Invalid Token - Black Metal Auth'));
    }
    
    try {
      const hash = await bcrypt.hash(req.body.password, 12);
      
      users.update(
        { _id: user._id }, 
        { $set: { hash }, $unset: { resetToken: true, resetExpires: true } }, 
        {}, 
        (err, numReplaced) => {
          if (err) {
            console.error('Password reset update error:', err);
            req.flash('error', 'Error updating password. Please try again.');
            return res.redirect('/reset/' + req.params.token);
          }
          
          if (numReplaced === 0) {
            console.error('No user updated during password reset');
            req.flash('error', 'Error updating password. Please try again.');
            return res.redirect('/reset/' + req.params.token);
          }
          
          console.log('Password successfully updated for user:', user.email);
          req.flash('success', 'Password updated successfully. Please login with your new password.');
          res.redirect('/login');
        }
      );
    } catch (error) {
      console.error('Password hashing error:', error);
      req.flash('error', 'Error processing password. Please try again.');
      res.redirect('/reset/' + req.params.token);
    }
  });
});

// Proxy for Deezer API to avoid CORS issues
app.get('/api/proxy/deezer', ensureAuthAPI, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ error: 'Query parameter q is required' });
    }
    
    const url = `https://api.deezer.com/search/album?q=${encodeURIComponent(q)}&limit=5`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Deezer API responded with status ${response.status}`);
    }
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Deezer proxy error:', error);
    res.status(500).json({ error: 'Failed to fetch from Deezer' });
  }
});

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