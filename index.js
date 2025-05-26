require('dotenv').config();
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const Datastore = require('@seald-io/nedb');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

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

// Initialize NeDB
const users = new Datastore({ filename: 'users.db', autoload: true });

// Passport configuration
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
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-here',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
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

// Registration form
app.get('/register', (req, res) => {
  res.send(htmlTemplate(registerTemplate(req), 'Join the KVLT - Black Metal Auth'));
});

app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Validate input
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

// Login form
app.get('/login', (req, res) => {
  res.send(htmlTemplate(loginTemplate(req), 'Enter the Void - Black Metal Auth'));
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

// Forgot password request
app.get('/forgot', (req, res) => {
  res.send(htmlTemplate(forgotPasswordTemplate(req), 'Password Recovery - Black Metal Auth'));
});

app.post('/forgot', (req, res) => {
  const { email } = req.body;
  users.findOne({ email }, (err, user) => {
    req.flash('info', 'If that email exists, you will receive a reset link');
    if (!user) return res.redirect('/forgot');

    // Generate reset token
    const token = crypto.randomBytes(20).toString('hex');
    const expires = Date.now() + 3600000; // 1 hour
    users.update({ _id: user._id }, { $set: { resetToken: token, resetExpires: expires } }, {}, () => {
      // Configure email transport
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
        
        // Get email configuration from forgot_email.js
        const emailOptions = composeForgotPasswordEmail(user.email, resetUrl);
        
        // Send email with error handling
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

// Reset password form
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