require('dotenv').config();
const express = require('express');
const session = require('express-session');
const NedbStore = require('connect-nedb-session')(session);
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const Datastore = require('@seald-io/nedb');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const path = require('path');

const { composeForgotPasswordEmail } = require('./forgot_email');

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
      return done(null, false, { message: 'Unknown email' });
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
        return done(null, false, { message: 'Bad password' });
      }
      
      console.log('Login successful for:', email);
      return done(null, user);
    });
  });
}));

passport.serializeUser((user, done) => done(null, user._id));
passport.deserializeUser((id, done) => users.findOne({ _id: id }, done));

const app = express();
app.use(express.static('public'));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

// Updated session configuration with NeDB store
app.use(session({
  store: new NedbStore({
    filename: path.join(dataDir, 'sessions.db'),
    autoCompactInterval: 300000 // compact every 5 minutes
  }),
  secret: process.env.SESSION_SECRET || 'your-secret-key-here',
  resave: false,
  saveUninitialized: false,
  cookie: {
    // Only set secure in production if using HTTPS
    secure: false, // Set to true only if using HTTPS
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax' // Add this for better compatibility
  },
  name: 'sushe.sid' // Custom session name
}));

// Custom flash middleware (replaces connect-flash)
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

app.use(passport.initialize());
app.use(passport.session());

// Middleware to protect routes
function ensureAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/login');
}

// API middleware to ensure authentication
function ensureAuthAPI(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// Registration form
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

// Login form
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
      return res.redirect('/');
    });
  })(req, res, next);
});

// Home (protected) - Spotify-like interface
app.get('/', ensureAuth, (req, res) => {
  res.send(spotifyTemplate(req));
});

// Logout
app.get('/logout', (req, res) => {
  req.logout(() => res.redirect('/login'));
});

// API ENDPOINTS FOR LISTS

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

// Forgot password routes
app.get('/forgot', (req, res) => {
  res.send(htmlTemplate(forgotPasswordTemplate(req, res.locals.flash), 'Password Recovery - Black Metal Auth'));
});

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

// Reset password routes
app.get('/reset/:token', (req, res) => {
  users.findOne({ resetToken: req.params.token, resetExpires: { $gt: Date.now() } }, (err, user) => {
    if (!user) {
      return res.send(htmlTemplate(invalidTokenTemplate(), 'Invalid Token - Black Metal Auth'));
    }
    res.send(htmlTemplate(resetPasswordTemplate(req.params.token), 'Reset Password - Black Metal Auth'));
  });
});

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
  res.status(500).send('Something went wrong!');
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🔥 Server burning at http://localhost:${PORT} 🔥`);
  console.log(`🔥 Environment: ${process.env.NODE_ENV || 'development'} 🔥`);
});