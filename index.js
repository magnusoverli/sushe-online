require('dotenv').config();
const express = require('express');
const session = require('express-session');
const NedbStore = require('connect-nedb-session')(session);
const flash = require('connect-flash');
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

// Passport configuration (same as before)
passport.use(new LocalStrategy({ usernameField: 'email' }, (email, password, done) => {
  users.findOne({ email }, (err, user) => {
    if (err) return done(err);
    if (!user) return done(null, false, { message: 'Unknown email' });
    bcrypt.compare(password, user.hash, (err, isMatch) => {
      if (err) return done(err);
      if (!isMatch) return done(null, false, { message: 'Bad password' });
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
    secure: process.env.NODE_ENV === 'production' && process.env.BASE_URL?.startsWith('https'),
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));
app.use(flash());
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

// Registration form (same as before)
app.get('/register', (req, res) => {
  res.send(htmlTemplate(registerTemplate(req), 'Join the KVLT - Black Metal Auth'));
});

app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      req.flash('error', 'Email and password are required');
      return res.redirect('/register');
    }
    
    if (password.length < 8) {
      req.flash('error', 'Password must be at least 8 characters');
      return res.redirect('/register');
    }
    
    users.findOne({ email }, async (err, existing) => {
      if (err) {
        console.error('Database error:', err);
        req.flash('error', 'Registration error');
        return res.redirect('/register');
      }
      
      if (existing) {
        req.flash('error', 'Email already registered');
        return res.redirect('/register');
      }
      
      try {
        const hash = await bcrypt.hash(password, 12);
        users.insert({ email, hash }, (err) => {
          if (err) {
            console.error('Insert error:', err);
            req.flash('error', 'Registration error');
            return res.redirect('/register');
          }
          req.flash('success', 'Registration successful! Please login.');
          res.redirect('/login');
        });
      } catch (hashErr) {
        console.error('Hashing error:', hashErr);
        req.flash('error', 'Registration error');
        res.redirect('/register');
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    req.flash('error', 'Registration error');
    res.redirect('/register');
  }
});

// Login form (same as before)
app.get('/login', (req, res) => {
  res.send(htmlTemplate(loginTemplate(req), 'SuShe Online'));
});

app.post('/login',
  passport.authenticate('local', { failureRedirect: '/login', failureFlash: true }),
  (req, res) => res.redirect('/')
);

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

// Forgot password routes (same as before)
app.get('/forgot', (req, res) => {
  res.send(htmlTemplate(forgotPasswordTemplate(req), 'Password Recovery - Black Metal Auth'));
});

app.post('/forgot', (req, res) => {
  const { email } = req.body;
  users.findOne({ email }, (err, user) => {
    req.flash('info', 'If that email exists, you will receive a reset link');
    if (!user) return res.redirect('/forgot');

    const token = crypto.randomBytes(20).toString('hex');
    const expires = Date.now() + 3600000; // 1 hour
    users.update({ _id: user._id }, { $set: { resetToken: token, resetExpires: expires } }, {}, () => {
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
      }
      
      res.redirect('/forgot');
    });
  });
});

// Reset password routes (same as before)
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
    if (!user) {
      return res.send(htmlTemplate(invalidTokenTemplate(), 'Invalid Token - Black Metal Auth'));
    }
    
    try {
      const hash = await bcrypt.hash(req.body.password, 12);
      users.update({ _id: user._id }, { $set: { hash }, $unset: { resetToken: true, resetExpires: true } }, {}, () => {
        res.redirect('/login');
      });
    } catch (error) {
      console.error('Password reset error:', error);
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