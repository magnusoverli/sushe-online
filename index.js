require('dotenv').config();
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const Datastore = require('nedb');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

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
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
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
  res.send(`
    <h2>Register</h2>
    <form method="post" action="/register">
      <input name="email" type="email" placeholder="Email" required />
      <input name="password" type="password" placeholder="Password" required />
      <button>Sign Up</button>
    </form>
    <p style="color:red;">${req.flash('error')}</p>
    <p><a href="/login">Already have an account? Log in</a></p>
  `);
});

app.post('/register', (req, res) => {
  const { email, password } = req.body;
  users.findOne({ email }, (err, existing) => {
    if (existing) {
      req.flash('error', 'Email already registered');
      return res.redirect('/register');
    }
    bcrypt.hash(password, 12, (err, hash) => {
      users.insert({ email, hash }, (err) => {
        if (err) req.flash('error', 'Registration error');
        return res.redirect('/login');
      });
    });
  });
});

// Login form
app.get('/login', (req, res) => {
  res.send(`
    <h2>Login</h2>
    <form method="post" action="/login">
      <input name="email" type="email" placeholder="Email" required />
      <input name="password" type="password" placeholder="Password" required />
      <button>Log In</button>
    </form>
    <p style="color:red;">${req.flash('error')}</p>
    <p><a href="/register">Don't have an account? Sign up</a></p>
    <p><a href="/forgot">Forgot password?</a></p>
  `);
});

app.post('/login',
  passport.authenticate('local', { failureRedirect: '/login', failureFlash: true }),
  (req, res) => res.redirect('/')
);

// Home (protected)
app.get('/', ensureAuth, (req, res) => {
  res.send(`
    <h2>Welcome, ${req.user.email}!</h2>
    <p><a href="/logout">Logout</a></p>
  `);
});

// Logout
app.get('/logout', (req, res) => {
  req.logout(() => res.redirect('/login'));
});

// Forgot password request
app.get('/forgot', (req, res) => {
  res.send(`
    <h2>Forgot Password</h2>
    <form method="post" action="/forgot">
      <input name="email" type="email" placeholder="Your email" required />
      <button>Request Reset</button>
    </form>
    <p>${req.flash('info')}</p>
    <p><a href="/login">Back to login</a></p>
  `);
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
      // Configure SendGrid via SMTP
      const transporter = nodemailer.createTransport({
        host: 'smtp.sendgrid.net',
        port: 587,
        auth: {
          user: 'apikey',
          pass: process.env.SENDGRID_API_KEY
        }
      });
      const resetUrl = `${process.env.BASE_URL}/reset/${token}`;
      transporter.sendMail({
        to: user.email,
        from: process.env.EMAIL_FROM,
        subject: 'Password Reset',
        text: `Click here to reset your password: ${resetUrl}`
      });
      res.redirect('/forgot');
    });
  });
});

// Reset password form
app.get('/reset/:token', (req, res) => {
  users.findOne({ resetToken: req.params.token, resetExpires: { $gt: Date.now() } }, (err, user) => {
    if (!user) return res.send('Reset link is invalid or has expired');
    res.send(`
      <h2>Reset Password</h2>
      <form method="post" action="/reset/${req.params.token}">
        <input name="password" type="password" placeholder="New password" required />
        <button>Reset</button>
      </form>
    `);
  });
});

// Handle password reset
app.post('/reset/:token', (req, res) => {
  users.findOne({ resetToken: req.params.token, resetExpires: { $gt: Date.now() } }, (err, user) => {
    if (!user) return res.send('Reset link is invalid or has expired');
    bcrypt.hash(req.body.password, 12, (err, hash) => {
      users.update({ _id: user._id }, { $set: { hash }, $unset: { resetToken: true, resetExpires: true } }, {}, () => {
        res.redirect('/login');
      });
    });
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));