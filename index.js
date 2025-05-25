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

// HTML template with Black Metal Spotify-inspired theme
const htmlTemplate = (content, title = 'KVLT Auth') => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link href="/styles/output.css" rel="stylesheet">
  <style>
    /* Custom black metal inspired fonts and effects */
    @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600&family=Inter:wght@300;400;500;600;700&display=swap');
    
    .metal-title {
      font-family: 'Cinzel', serif;
      text-shadow: 0 0 20px rgba(220, 38, 38, 0.5);
    }
    
    .glow-red {
      animation: glow 2s ease-in-out infinite alternate;
    }
    
    @keyframes glow {
      from { text-shadow: 0 0 10px #dc2626, 0 0 20px #dc2626, 0 0 30px #dc2626; }
      to { text-shadow: 0 0 20px #dc2626, 0 0 30px #dc2626, 0 0 40px #dc2626; }
    }
    
    .noise::before {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      opacity: 0.03;
      z-index: 1;
      pointer-events: none;
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.95' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.5'/%3E%3C/svg%3E");
    }
    
    .spotify-input:focus {
      box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.4);
    }
  </style>
</head>
<body class="bg-black text-gray-200 min-h-screen flex items-center justify-center relative overflow-hidden">
  <!-- Atmospheric background -->
  <div class="absolute inset-0 bg-gradient-to-br from-black via-gray-900 to-black"></div>
  <div class="noise absolute inset-0"></div>
  
  <!-- Subtle red accent glow -->
  <div class="absolute top-0 left-1/4 w-96 h-96 bg-red-900 rounded-full filter blur-3xl opacity-10 animate-pulse"></div>
  <div class="absolute bottom-0 right-1/4 w-96 h-96 bg-red-800 rounded-full filter blur-3xl opacity-10 animate-pulse"></div>
  
  <div class="relative z-10 max-w-md w-full px-4">
    ${content}
  </div>
</body>
</html>
`;

// Registration form
app.get('/register', (req, res) => {
  const content = `
    <div class="bg-gray-900/90 backdrop-blur-sm border border-gray-800 rounded-lg p-8 shadow-2xl">
      <div class="text-center mb-8">
        <h1 class="metal-title text-4xl font-bold text-red-600 glow-red mb-2">JOIN THE KVLT</h1>
        <p class="text-gray-400 text-sm">Forge your identity in digital darkness</p>
      </div>
      
      <form method="post" action="/register" class="space-y-6">
        <div>
          <label class="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2" for="email">
            Email Address
          </label>
          <input 
            class="spotify-input w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:border-red-600 transition duration-200"
            name="email" 
            id="email"
            type="email" 
            placeholder="your@email.com" 
            required 
          />
        </div>
        <div>
          <label class="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2" for="password">
            Password
          </label>
          <input 
            class="spotify-input w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:border-red-600 transition duration-200"
            name="password" 
            id="password"
            type="password" 
            placeholder="••••••••" 
            required 
          />
        </div>
        <button 
          class="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-4 rounded transition duration-200 transform hover:scale-105 uppercase tracking-wider"
          type="submit"
        >
          Create Account
        </button>
      </form>
      
      ${req.flash('error').length ? `<p class="text-red-500 text-sm mt-4 text-center">${req.flash('error')}</p>` : ''}
      
      <div class="mt-8 pt-6 border-t border-gray-800">
        <p class="text-center text-gray-500 text-sm">
          Already initiated? 
          <a href="/login" class="text-red-500 hover:text-red-400 font-semibold transition duration-200">Sign in</a>
        </p>
      </div>
    </div>
  `;
  res.send(htmlTemplate(content, 'Join the KVLT - Black Metal Auth'));
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
    <div class="bg-gray-900/90 backdrop-blur-sm border border-gray-800 rounded-lg p-8 shadow-2xl">
      <div class="text-center mb-8">
        <h1 class="metal-title text-4xl font-bold text-red-600 glow-red mb-2">ENTER THE VOID</h1>
        <p class="text-gray-400 text-sm">Return to the darkness</p>
      </div>
      
      <form method="post" action="/login" class="space-y-6">
        <div>
          <label class="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2" for="email">
            Email Address
          </label>
          <input 
            class="spotify-input w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:border-red-600 transition duration-200"
            name="email" 
            id="email"
            type="email" 
            placeholder="your@email.com" 
            required 
          />
        </div>
        <div>
          <label class="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2" for="password">
            Password
          </label>
          <input 
            class="spotify-input w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:border-red-600 transition duration-200"
            name="password" 
            id="password"
            type="password" 
            placeholder="••••••••" 
            required 
          />
        </div>
        
        <div class="flex items-center justify-between">
          <label class="flex items-center">
            <input type="checkbox" class="bg-gray-800 border-gray-700 text-red-600 rounded focus:ring-red-600 focus:ring-offset-0">
            <span class="ml-2 text-sm text-gray-400">Remember me</span>
          </label>
          <a href="/forgot" class="text-sm text-gray-400 hover:text-red-500 transition duration-200">Forgot password?</a>
        </div>
        
        <button 
          class="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-4 rounded transition duration-200 transform hover:scale-105 uppercase tracking-wider"
          type="submit"
        >
          Sign In
        </button>
      </form>
      
      ${req.flash('error').length ? `<p class="text-red-500 text-sm mt-4 text-center">${req.flash('error')}</p>` : ''}
      
      <div class="mt-8 pt-6 border-t border-gray-800">
        <p class="text-center text-gray-500 text-sm">
          New to the darkness? 
          <a href="/register" class="text-red-500 hover:text-red-400 font-semibold transition duration-200">Join the kvlt</a>
        </p>
      </div>
    </div>
  `;
  res.send(htmlTemplate(content, 'Enter the Void - Black Metal Auth'));
});

app.post('/login',
  passport.authenticate('local', { failureRedirect: '/login', failureFlash: true }),
  (req, res) => res.redirect('/')
);

// Home (protected)
app.get('/', ensureAuth, (req, res) => {
  const content = `
    <div class="bg-gray-900/90 backdrop-blur-sm border border-gray-800 rounded-lg p-8 shadow-2xl">
      <div class="text-center mb-8">
        <h1 class="metal-title text-3xl font-bold text-red-600 glow-red mb-4">WELCOME TO THE INNER CIRCLE</h1>
        <p class="text-gray-400">You have crossed the threshold, <span class="text-red-500 font-semibold">${req.user.email}</span></p>
      </div>
      
      <div class="bg-gray-800/50 rounded-lg p-6 mb-6">
        <h2 class="text-gray-300 font-semibold mb-3 uppercase tracking-wider text-sm">Your Kvlt Status</h2>
        <div class="space-y-2">
          <div class="flex justify-between text-sm">
            <span class="text-gray-400">Initiation Date</span>
            <span class="text-gray-300">${new Date().toLocaleDateString()}</span>
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-gray-400">Darkness Level</span>
            <span class="text-red-500">∞</span>
          </div>
        </div>
      </div>
      
      <a 
        href="/logout" 
        class="block w-full text-center bg-gray-800 hover:bg-gray-700 text-gray-300 font-bold py-3 px-4 rounded transition duration-200 uppercase tracking-wider border border-gray-700"
      >
        Return to the Light
      </a>
    </div>
  `;
  res.send(htmlTemplate(content, 'Inner Circle - Black Metal Auth'));
});

// Logout
app.get('/logout', (req, res) => {
  req.logout(() => res.redirect('/login'));
});

// Forgot password request
app.get('/forgot', (req, res) => {
  const content = `
    <div class="bg-gray-900/90 backdrop-blur-sm border border-gray-800 rounded-lg p-8 shadow-2xl">
      <div class="text-center mb-8">
        <h1 class="metal-title text-3xl font-bold text-red-600 mb-2">LOST IN THE ABYSS?</h1>
        <p class="text-gray-400 text-sm">We'll guide you back to the darkness</p>
      </div>
      
      <form method="post" action="/forgot" class="space-y-6">
        <div>
          <label class="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2" for="email">
            Email Address
          </label>
          <input 
            class="spotify-input w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:border-red-600 transition duration-200"
            name="email" 
            id="email"
            type="email" 
            placeholder="your@email.com" 
            required 
          />
        </div>
        <button 
          class="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-4 rounded transition duration-200 transform hover:scale-105 uppercase tracking-wider"
          type="submit"
        >
          Send Recovery Rune
        </button>
      </form>
      
      ${req.flash('info').length ? `<p class="text-blue-400 text-sm mt-4 text-center">${req.flash('info')}</p>` : ''}
      
      <div class="mt-8 pt-6 border-t border-gray-800">
        <p class="text-center text-gray-500 text-sm">
          Found your way? 
          <a href="/login" class="text-red-500 hover:text-red-400 font-semibold transition duration-200">Return to login</a>
        </p>
      </div>
    </div>
  `;
  res.send(htmlTemplate(content, 'Password Recovery - Black Metal Auth'));
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
        subject: 'Password Reset - Return to the Darkness',
        text: `A password reset has been requested for your account.
        
Click here to reset your password: ${resetUrl}

If you did not request this, ignore this email and your password will remain unchanged.

Stay kvlt,
The Inner Circle`
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
        <div class="bg-gray-900/90 backdrop-blur-sm border border-gray-800 rounded-lg p-8 shadow-2xl">
          <p class="text-red-500 text-center mb-4">This recovery rune has expired or been corrupted</p>
          <a href="/forgot" class="block text-center text-red-500 hover:text-red-400 font-semibold">Request new recovery rune</a>
        </div>
      `;
      return res.send(htmlTemplate(content, 'Invalid Token - Black Metal Auth'));
    }
    const content = `
      <div class="bg-gray-900/90 backdrop-blur-sm border border-gray-800 rounded-lg p-8 shadow-2xl">
        <div class="text-center mb-8">
          <h1 class="metal-title text-3xl font-bold text-red-600 mb-2">FORGE NEW DARKNESS</h1>
          <p class="text-gray-400 text-sm">Create a new password to secure your soul</p>
        </div>
        
        <form method="post" action="/reset/${req.params.token}" class="space-y-6">
          <div>
            <label class="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2" for="password">
              New Password
            </label>
            <input 
              class="spotify-input w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:border-red-600 transition duration-200"
              name="password" 
              id="password"
              type="password" 
              placeholder="••••••••" 
              required 
            />
          </div>
          <button 
            class="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-4 rounded transition duration-200 transform hover:scale-105 uppercase tracking-wider"
            type="submit"
          >
            Seal the Pact
          </button>
        </form>
      </div>
    `;
    res.send(htmlTemplate(content, 'Reset Password - Black Metal Auth'));
  });
});

// Handle password reset
app.post('/reset/:token', (req, res) => {
  users.findOne({ resetToken: req.params.token, resetExpires: { $gt: Date.now() } }, (err, user) => {
    if (!user) {
      const content = `
        <div class="bg-gray-900/90 backdrop-blur-sm border border-gray-800 rounded-lg p-8 shadow-2xl">
          <p class="text-red-500 text-center mb-4">This recovery rune has expired or been corrupted</p>
          <a href="/forgot" class="block text-center text-red-500 hover:text-red-400 font-semibold">Request new recovery rune</a>
        </div>
      `;
      return res.send(htmlTemplate(content, 'Invalid Token - Black Metal Auth'));
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
app.listen(PORT, () => console.log(`🔥 Server burning at http://localhost:${PORT} 🔥`));