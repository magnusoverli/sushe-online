/**
 * Authentication & User Settings Routes
 *
 * Thin route layer — delegates business logic to authService and userService.
 */
module.exports = (app, deps) => {
  const logger = require('../utils/logger');
  const { recordAuthAttempt } = require('../utils/metrics');
  const {
    saveSessionAsync,
    saveSessionSafe,
  } = require('../utils/session-helpers');
  const {
    loginRateLimit,
    registerRateLimit,
    sensitiveSettingsRateLimit,
  } = require('../middleware/rate-limit');
  const { createAsyncHandler } = require('../middleware/async-handler');
  const {
    generateExtensionToken,
    validateExtensionToken,
    cleanupExpiredTokens,
  } = require('../services/auth-utils-service');
  const { createResponseHelpers } = require('./auth/response-helpers');
  const { createSettingsHandlers } = require('./auth/settings-handlers');
  const { createSecurityHandlers } = require('./auth/security-handlers');
  const {
    createExtensionTokenHandlers,
  } = require('./auth/extension-token-handlers');

  const {
    htmlTemplate,
    registerTemplate,
    loginTemplate,
    extensionAuthTemplate,
    spotifyTemplate,
    csrfProtection,
    ensureAuth,
    ensureAuthAPI,
    rateLimitAdminRequest,
    isValidEmail,
    isValidUsername,
    isValidPassword,
    sanitizeUser,
    adminCodeState,
    db,
    passport,
    authService,
    userService,
    invalidateUserCache,
  } = deps;

  const asyncHandler = createAsyncHandler(logger);
  const { respondWithError, respondWithSuccess } = createResponseHelpers();
  const settingsHandlers = createSettingsHandlers({
    asyncHandler,
    userService,
    saveSessionSafe,
  });
  const securityHandlers = createSecurityHandlers({
    authService,
    userService,
    invalidateUserCache,
    saveSessionSafe,
    adminCodeState,
    logger,
    respondWithError,
    respondWithSuccess,
    isValidPassword,
  });
  const extensionTokenHandlers = createExtensionTokenHandlers({
    asyncHandler,
    authService,
    db,
    generateExtensionToken,
    validateExtensionToken,
    cleanupExpiredTokens,
    sanitizeUser,
    saveSessionAsync,
    extensionAuthTemplate,
    logger,
  });

  app.get('/register', csrfProtection, (req, res) => {
    res.send(
      htmlTemplate(
        registerTemplate(req, res.locals.flash),
        'Join the KVLT - Black Metal Auth'
      )
    );
  });

  app.post('/register', registerRateLimit, csrfProtection, async (req, res) => {
    try {
      const { email, username, password, confirmPassword } = req.body;

      const { user, validation } = await authService.registerUser(
        { email, username, password, confirmPassword },
        { isValidEmail, isValidUsername, isValidPassword }
      );

      if (!validation.valid) {
        req.flash('error', validation.error);
        recordAuthAttempt('register', 'failure');
        return res.redirect('/register');
      }

      await authService.createApprovalEvent(app.locals.adminEventService, user);

      recordAuthAttempt('register', 'success');
      req.flash(
        'success',
        'Registration successful! Your account is pending admin approval.'
      );
      res.redirect('/login');
    } catch (error) {
      logger.error('Registration error', { error: error.message });
      recordAuthAttempt('register', 'failure');
      req.flash('error', 'Registration error. Please try again.');
      res.redirect('/register');
    }
  });

  app.get('/login', csrfProtection, (req, res) => {
    if (req.isAuthenticated()) {
      return res.redirect('/');
    }

    logger.debug('Login GET - CSRF token generation', {
      hasSession: !!req.session,
      hasSecret: !!req.session?.csrfSecret,
      sessionId: req.sessionID,
      userAgent: req.get('User-Agent'),
    });

    res.send(
      htmlTemplate(loginTemplate(req, res.locals.flash), 'SuShe Online')
    );
  });

  app.post('/login', loginRateLimit, csrfProtection, async (req, res, next) => {
    logger.debug('Login POST request received', {
      email: req.body.email,
      hasSession: !!req.session,
      hasSecret: !!req.session?.csrfSecret,
      sessionId: req.sessionID,
      csrfToken: req.body._csrf?.substring(0, 8) + '...',
      userAgent: req.get('User-Agent'),
    });

    try {
      const { user, info } = await new Promise((resolve, reject) => {
        passport.authenticate('local', (err, authUser, authInfo) => {
          if (err) return reject(err);
          resolve({ user: authUser, info: authInfo });
        })(req, res, next);
      });

      if (!user) {
        logger.warn('Authentication failed', {
          reason: info?.message,
          email: req.body.email,
          requestId: req.id,
        });
        recordAuthAttempt('login', 'failure');
        req.flash('error', info.message || 'Invalid credentials');

        try {
          await saveSessionAsync(req);
        } catch (err) {
          logger.error('Session save error', {
            error: err.message,
            requestId: req.id,
          });
        }

        return res.redirect('/login');
      }

      await new Promise((resolve, reject) => {
        req.logIn(user, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });

      logger.info('User logged in successfully', { email: user.email });
      recordAuthAttempt('login', 'success');

      req.session.cookie.maxAge = authService.getSessionMaxAge(
        req.body.remember
      );

      const timestamp = new Date();
      req.user.lastActivity = timestamp;
      req.session.lastActivityUpdatedAt = Date.now();
      await userService.updateLastActivity(req.user._id, timestamp);

      try {
        await saveSessionAsync(req);
      } catch (err) {
        logger.error('Session save error', { error: err.message });
      }

      if (req.session.extensionAuth) {
        delete req.session.extensionAuth;
        return res.redirect('/extension/auth');
      }

      return res.redirect('/');
    } catch (err) {
      logger.error('Authentication error', { error: err.message });
      req.flash('error', 'An error occurred during login');
      return res.redirect('/login');
    }
  });

  app.get('/logout', (req, res) => {
    recordAuthAttempt('logout', 'success');
    req.logout(() => res.redirect('/login'));
  });

  app.get('/', ensureAuth, csrfProtection, (req, res) => {
    res.send(spotifyTemplate(sanitizeUser(req.user), req.csrfToken()));
  });

  app.post(
    '/settings/update-accent-color',
    ensureAuth,
    settingsHandlers.settingsHandler('accentColor')
  );
  app.post(
    '/settings/update-time-format',
    ensureAuth,
    settingsHandlers.settingsHandler('timeFormat')
  );
  app.post(
    '/settings/update-date-format',
    ensureAuth,
    settingsHandlers.settingsHandler('dateFormat')
  );
  app.post(
    '/settings/update-music-service',
    ensureAuth,
    settingsHandlers.settingsHandler('musicService')
  );
  app.post(
    '/settings/update-column-visibility',
    ensureAuth,
    settingsHandlers.settingsHandler('columnVisibility')
  );

  app.post(
    '/settings/update-email',
    ensureAuth,
    settingsHandlers.uniqueFieldHandler(
      'email',
      isValidEmail,
      'Invalid email format'
    )
  );
  app.post(
    '/settings/update-username',
    ensureAuth,
    settingsHandlers.uniqueFieldHandler(
      'username',
      isValidUsername,
      'Username can only contain letters, numbers, and underscores and must be 3-30 characters'
    )
  );

  app.post(
    '/api/user/last-list',
    ensureAuthAPI,
    settingsHandlers.updateLastSelectedList
  );

  app.post(
    '/settings/change-password',
    ensureAuth,
    sensitiveSettingsRateLimit,
    csrfProtection,
    securityHandlers.changePassword
  );

  app.post(
    '/settings/request-admin',
    ensureAuth,
    csrfProtection,
    rateLimitAdminRequest,
    securityHandlers.requestAdmin
  );

  app.get('/extension/auth', extensionTokenHandlers.showExtensionAuthPage);

  app.post(
    '/api/auth/extension-token',
    ensureAuth,
    extensionTokenHandlers.createExtensionToken
  );

  app.get('/api/auth/validate-token', extensionTokenHandlers.validateToken);

  app.delete(
    '/api/auth/extension-token',
    ensureAuth,
    extensionTokenHandlers.revokeExtensionToken
  );

  app.get(
    '/api/auth/extension-tokens',
    ensureAuth,
    extensionTokenHandlers.listExtensionTokens
  );

  app.post(
    '/api/auth/cleanup-tokens',
    ensureAuth,
    extensionTokenHandlers.cleanupTokens
  );
};
