/**
 * Auth API Routes
 *
 * JSON endpoints for the mobile SPA authentication flow.
 * These complement the existing HTML form-based auth routes in routes/auth.js.
 *
 * @module routes/api/auth
 */
module.exports = (app, deps) => {
  const logger = require('../../utils/logger');
  const csrf = require('csrf');
  const { recordAuthAttempt } = require('../../utils/metrics');
  const { saveSessionAsync } = require('../../utils/session-helpers');
  const csrfTokens = new csrf();
  const {
    loginRateLimit,
    registerRateLimit,
  } = require('../../middleware/rate-limit');
  const { createAsyncHandler } = require('../../middleware/async-handler');

  const {
    passport,
    authService,
    csrfProtection,
    isValidEmail,
    isValidUsername,
    isValidPassword,
    usersAsync,
  } = deps;

  const asyncHandler = createAsyncHandler(logger);

  /**
   * GET /api/auth/session
   * Check current authentication status.
   * Returns user info + CSRF token if authenticated.
   */
  app.get('/api/auth/session', csrfProtection, (req, res) => {
    if (req.isAuthenticated() && req.user) {
      return res.json({
        authenticated: true,
        user: {
          _id: req.user._id,
          email: req.user.email,
          username: req.user.username,
          role: req.user.role,
          spotifyConnected: !!req.user.spotifyAuth,
          tidalConnected: !!req.user.tidalAuth,
          lastfmConnected: !!req.user.lastfmAuth?.session_key,
          accentColor: req.user.accentColor || null,
          timeFormat: req.user.timeFormat || '24h',
          dateFormat: req.user.dateFormat || 'MM/DD/YYYY',
          musicService: req.user.musicService || null,
          lastfmUsername: req.user.lastfmUsername || null,
          preferredUi: req.user.preferredUi || null,
          createdAt: req.user.createdAt || null,
        },
        csrfToken: req.csrfToken(),
      });
    }

    return res.status(401).json({
      authenticated: false,
      user: null,
      csrfToken: req.csrfToken(),
    });
  });

  /**
   * POST /api/auth/login
   * JSON login endpoint for the mobile SPA.
   */
  app.post(
    '/api/auth/login',
    loginRateLimit,
    csrfProtection,
    asyncHandler(async (req, res, next) => {
      const { email, password, remember } = req.body;

      if (!email || !password) {
        return res
          .status(400)
          .json({ error: 'Email and password are required' });
      }

      try {
        const { user, info } = await new Promise((resolve, reject) => {
          passport.authenticate('local', (err, user, info) => {
            if (err) return reject(err);
            resolve({ user, info });
          })(req, res, next);
        });

        if (!user) {
          recordAuthAttempt('login', 'failure');
          return res
            .status(401)
            .json({ error: info?.message || 'Invalid credentials' });
        }

        await new Promise((resolve, reject) => {
          req.logIn(user, (err) => {
            if (err) return reject(err);
            resolve();
          });
        });

        logger.info('User logged in via mobile API', { email: user.email });
        recordAuthAttempt('login', 'success');

        // "Remember me" — extend or use default session lifetime
        req.session.cookie.maxAge = authService.getSessionMaxAge(remember);

        // Record last activity
        const timestamp = new Date();
        req.user.lastActivity = timestamp;
        req.session.lastActivityUpdatedAt = Date.now();
        await usersAsync.update(
          { _id: req.user._id },
          { $set: { lastActivity: timestamp } }
        );

        // req.logIn() regenerates the session (Passport session fixation
        // protection), which destroys the old csrfSecret. Re-initialize it
        // on the new session so req.csrfToken() works below.
        if (!req.session.csrfSecret) {
          req.session.csrfSecret = csrfTokens.secretSync();
        }

        await saveSessionAsync(req);

        return res.json({
          success: true,
          user: {
            _id: user._id,
            email: user.email,
            username: user.username,
            role: user.role,
            spotifyConnected: !!user.spotifyAuth,
            tidalConnected: !!user.tidalAuth,
            lastfmConnected: !!user.lastfmAuth?.session_key,
            accentColor: user.accentColor || null,
            timeFormat: user.timeFormat || '24h',
            dateFormat: user.dateFormat || 'MM/DD/YYYY',
            musicService: user.musicService || null,
            lastfmUsername: user.lastfmUsername || null,
            preferredUi: user.preferredUi || null,
            createdAt: user.createdAt || null,
          },
          csrfToken: req.csrfToken(),
        });
      } catch (err) {
        logger.error('Mobile login error', { error: err.message });
        return res
          .status(500)
          .json({ error: 'An error occurred during login' });
      }
    })
  );

  /**
   * POST /api/auth/register
   * JSON registration endpoint for the mobile SPA.
   */
  app.post(
    '/api/auth/register',
    registerRateLimit,
    csrfProtection,
    asyncHandler(async (req, res) => {
      const { email, username, password, confirmPassword } = req.body;

      try {
        const { user, validation } = await authService.registerUser(
          { email, username, password, confirmPassword },
          { isValidEmail, isValidUsername, isValidPassword }
        );

        if (!validation.valid) {
          recordAuthAttempt('register', 'failure');
          return res.status(400).json({ error: validation.error });
        }

        // Fire-and-forget admin approval event
        await authService.createApprovalEvent(
          app.locals.adminEventService,
          user
        );

        recordAuthAttempt('register', 'success');
        return res.json({
          success: true,
          message:
            'Registration successful! Your account is pending admin approval.',
        });
      } catch (error) {
        logger.error('Mobile registration error', { error: error.message });
        recordAuthAttempt('register', 'failure');
        return res
          .status(500)
          .json({ error: 'Registration error. Please try again.' });
      }
    })
  );

  /**
   * POST /api/auth/logout
   * JSON logout endpoint.
   */
  app.post('/api/auth/logout', (req, res) => {
    recordAuthAttempt('logout', 'success');
    req.logout(() => {
      res.json({ success: true });
    });
  });
};
