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
app.use(express.static('public')); // Serve static files from public directory
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

// HTML template with Tailwind CSS
const htmlTemplate = (content, title = 'Auth App') => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link href="/styles/output.css" rel="stylesheet">
</head>
<body class="bg-gray-100 min-h-screen flex items-center justify-center">
  <div class="max-w-md w-full">
    ${content}
  </div>
</body>
</html>
`;

// Registration form
app.get('/register', (req, res) => {
  const content = `
    <div class="bg-white shadow-lg rounded-lg px-8 pt-6 pb-8 mb-4">
      <h2 class="text-2xl font-bold text-center mb-6 text-gray-800">Create Account</h2>
      <form method="post" action="/register" class="space-y-4">
        <div>
          <label class="block text-gray-700 text-sm font-bold mb-2" for="email">
            Email
          </label>
          <input 
            class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            name="email" 
            id="email"
            type="email" 
            placeholder="your@email.com" 
            required 
          />
        </div>
        <div>
          <label class="block text-gray-700 text-sm font-bold mb-2" for="password">
            Password
          </label>
          <input 
            class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            name="password" 
            id="password"
            type="password" 
            placeholder="••••••••" 
            required 
          />
        </div>
        <button 
          class="w-full bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline transition duration-200"
          type="submit"
        >
          Sign Up
        </button>
      </form>
      ${req.flash('error').length ? `<p class="text-red-500 text-xs mt-4 text-center">${req.flash('error')}</p>` : ''}
      <p class="text-center text-gray-600 text-sm mt-6">
        Already have an account? 
        <a href="/login" class="text-blue-500 hover:text-blue-700 font-semibold">Log in</a>
      </p>
    </div>
  `;
  res.send(htmlTemplate(content, 'Register - Auth App'));
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
  const content = `
    <div class="bg-white shadow-lg rounded-lg px-8 pt-6 pb-8 mb-4">
      <h2 class="text-2xl font-bold text-center mb-6 text-gray-800">Welcome Back</h2>
      <form method="post" action="/login" class="space-y-4">
        <div>
          <label class="block text-gray-700 text-sm font-bold mb-2" for="email">
            Email
          </label>
          <input 
            class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            name="email" 
            id="email"
            type="email" 
            placeholder="your@email.com" 
            required 
          />
        </div>
        <div>
          <label class="block text-gray-700 text-sm font-bold mb-2" for="password">
            Password
          </label>
          <input 
            class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            name="password" 
            id="password"
            type="password" 
            placeholder="••••••••" 
            required 
          />
        </div>
        <button 
          class="w-full bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline transition duration-200"
          type="submit"
        >
          Log In
        </button>
      </form>
      ${req.flash('error').length ? `<p class="text-red-500 text-xs mt-4 text-center">${req.flash('error')}</p>` : ''}
      <div class="text-center mt-6 space-y-2">
        <p class="text-gray-600 text-sm">
          Don't have an account? 
          <a href="/register" class="text-blue-500 hover:text-blue-700 font-semibold">Sign up</a>
        </p>
        <p>
          <a href="/forgot" class="text-gray-500 hover:text-gray-700 text-sm">Forgot password?</a>
        </p>
      </div>
    </div>
  `;
  res.send(htmlTemplate(content, 'Login - Auth App'));
});

app.post('/login',
  passport.authenticate('local', { failureRedirect: '/login', failureFlash: true }),
  (req, res) => res.redirect('/')
);

// Home (protected)
app.get('/', ensureAuth, (req, res) => {
  const content = `
    <div class="bg-white shadow-lg rounded-lg px-8 pt-6 pb-8">
      <h2 class="text-2xl font-bold text-center mb-6 text-gray-800">Welcome!</h2>
      <p class="text-gray-600 text-center mb-6">You're logged in as <span class="font-semibold">${req.user.email}</span></p>
      <a 
        href="/logout" 
        class="block w-full text-center bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline transition duration-200"
      >
        Logout
      </a>
    </div>
  `;
  res.send(htmlTemplate(content, 'Dashboard - Auth App'));
});

// Logout
app.get('/logout', (req, res) => {
  req.logout(() => res.redirect('/login'));
});

// Forgot password request
app.get('/forgot', (req, res) => {
  const content = `
    <div class="bg-white shadow-lg rounded-lg px-8 pt-6 pb-8 mb-4">
      <h2 class="text-2xl font-bold text-center mb-6 text-gray-800">Forgot Password</h2>
      <form method="post" action="/forgot" class="space-y-4">
        <div>
          <label class="block text-gray-700 text-sm font-bold mb-2" for="email">
            Email Address
          </label>
          <input 
            class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            name="email" 
            id="email"
            type="email" 
            placeholder="your@email.com" 
            required 
          />
        </div>
        <button 
          class="w-full bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline transition duration-200"
          type="submit"
        >
          Request Reset
        </button>
      </form>
      ${req.flash('info').length ? `<p class="text-blue-500 text-sm mt-4 text-center">${req.flash('info')}</p>` : ''}
      <p class="text-center text-gray-600 text-sm mt-6">
        Remember your password? 
        <a href="/login" class="text-blue-500 hover:text-blue-700 font-semibold">Back to login</a>
      </p>
    </div>
  `;
  res.send(htmlTemplate(content, 'Forgot Password - Auth App'));
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
    if (!user) {
      const content = `
        <div class="bg-white shadow-lg rounded-lg px-8 pt-6 pb-8">
          <p class="text-red-500 text-center">Reset link is invalid or has expired</p>
          <a href="/forgot" class="block text-center text-blue-500 hover:text-blue-700 mt-4">Request new reset link</a>
        </div>
      `;
      return res.send(htmlTemplate(content, 'Invalid Reset Link'));
    }
    const content = `
      <div class="bg-white shadow-lg rounded-lg px-8 pt-6 pb-8 mb-4">
        <h2 class="text-2xl font-bold text-center mb-6 text-gray-800">Reset Password</h2>
        <form method="post" action="/reset/${req.params.token}" class="space-y-4">
          <div>
            <label class="block text-gray-700 text-sm font-bold mb-2" for="password">
              New Password
            </label>
            <input 
              class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              name="password" 
              id="password"
              type="password" 
              placeholder="••••••••" 
              required 
            />
          </div>
          <button 
            class="w-full bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline transition duration-200"
            type="submit"
          >
            Reset Password
          </button>
        </form>
      </div>
    `;
    res.send(htmlTemplate(content, 'Reset Password - Auth App'));
  });
});

// Handle password reset
app.post('/reset/:token', (req, res) => {
  users.findOne({ resetToken: req.params.token, resetExpires: { $gt: Date.now() } }, (err, user) => {
    if (!user) {
      const content = `
        <div class="bg-white shadow-lg rounded-lg px-8 pt-6 pb-8">
          <p class="text-red-500 text-center">Reset link is invalid or has expired</p>
          <a href="/forgot" class="block text-center text-blue-500 hover:text-blue-700 mt-4">Request new reset link</a>
        </div>
      `;
      return res.send(htmlTemplate(content, 'Invalid Reset Link'));
    }
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