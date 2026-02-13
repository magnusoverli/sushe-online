/**
 * Authentication & User Settings Routes
 *
 * Thin route layer — delegates business logic to authService and userService.
 * Handles only HTTP concerns: request parsing, response formatting,
 * session management, flash messages, and redirects.
 *
 * @module routes/auth
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
  } = require('../utils/auth-utils');

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
    usersAsync,
    isValidEmail,
    isValidUsername,
    isValidPassword,
    sanitizeUser,
    adminCodeState,
    pool,
    passport,
    authService,
    userService,
  } = deps;

  const asyncHandler = createAsyncHandler(logger);

  // ── Helper: respond with JSON or flash+redirect ────────────────────────

  function respondWithError(req, res, statusCode, message, redirectPath) {
    if (req.accepts('json')) {
      return res.status(statusCode).json({ error: message });
    }
    req.flash('error', message);
    return res.redirect(redirectPath);
  }

  function respondWithSuccess(req, res, message, redirectPath) {
    if (req.accepts('json')) {
      return res.json({ success: true, message });
    }
    req.flash('success', message);
    return res.redirect(redirectPath);
  }

  // ── Settings update helper (DRY: eliminates 4 identical handlers) ──────

  /**
   * Create a route handler for a simple user setting update.
   * Validates via userService.validateSetting, updates via userService.updateSetting,
   * then syncs the session.
   */
  function settingsHandler(field) {
    return asyncHandler(async (req, res) => {
      const value = req.body[field];
      const validation = userService.validateSetting(field, value);

      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      await userService.updateSetting(req.user._id, field, validation.value);

      // Sync session
      req.user[field] = validation.value;
      saveSessionSafe(req, `${field} update`);
      res.json({ success: true });
    }, `updating ${field}`);
  }

  // ── Unique field update helper (DRY: eliminates 2 identical handlers) ──

  /**
   * Create a route handler for a unique-constrained field update (email/username).
   * Validates format, checks uniqueness via userService, updates, syncs session.
   */
  function uniqueFieldHandler(field, validator, validationError) {
    return asyncHandler(async (req, res) => {
      const value = req.body[field];

      if (!value || !value.trim()) {
        return res
          .status(400)
          .json({ error: `${capitalize(field)} is required` });
      }

      if (!validator(value)) {
        return res.status(400).json({ error: validationError });
      }

      const result = await userService.updateUniqueField(
        req.user._id,
        field,
        value
      );

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      // Sync session
      req.user[field] = value.trim();
      saveSessionSafe(req, `${field} update`);
      req.flash('success', `${capitalize(field)} updated successfully`);
      res.json({ success: true });
    }, `updating ${field}`);
  }

  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  // ============ PAGE ROUTES ============

  // Registration page
  app.get('/register', csrfProtection, (req, res) => {
    res.send(
      htmlTemplate(
        registerTemplate(req, res.locals.flash),
        'Join the KVLT - Black Metal Auth'
      )
    );
  });

  // Registration handler
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

      // Fire-and-forget admin approval event
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

  // Login page
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

  // Login handler
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
        passport.authenticate('local', (err, user, info) => {
          if (err) return reject(err);
          resolve({ user, info });
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

      // "Remember me" — extend or use default session lifetime
      req.session.cookie.maxAge = authService.getSessionMaxAge(
        req.body.remember
      );

      // Record last activity
      const timestamp = new Date();
      req.user.lastActivity = timestamp;
      req.session.lastActivityUpdatedAt = Date.now();
      await usersAsync.update(
        { _id: req.user._id },
        { $set: { lastActivity: timestamp } }
      );

      try {
        await saveSessionAsync(req);
      } catch (err) {
        logger.error('Session save error', { error: err.message });
      }

      // Check if this login was for extension authorization
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

  // Logout
  app.get('/logout', (req, res) => {
    recordAuthAttempt('logout', 'success');
    req.logout(() => res.redirect('/login'));
  });

  // Home (protected)
  app.get('/', ensureAuth, csrfProtection, (req, res) => {
    res.send(spotifyTemplate(sanitizeUser(req.user), req.csrfToken()));
  });

  // ============ USER SETTINGS ============

  // Simple settings — all use the same DRY handler
  app.post(
    '/settings/update-accent-color',
    ensureAuth,
    settingsHandler('accentColor')
  );
  app.post(
    '/settings/update-time-format',
    ensureAuth,
    settingsHandler('timeFormat')
  );
  app.post(
    '/settings/update-date-format',
    ensureAuth,
    settingsHandler('dateFormat')
  );
  app.post(
    '/settings/update-music-service',
    ensureAuth,
    settingsHandler('musicService')
  );

  // Unique-field settings
  app.post(
    '/settings/update-email',
    ensureAuth,
    uniqueFieldHandler('email', isValidEmail, 'Invalid email format')
  );
  app.post(
    '/settings/update-username',
    ensureAuth,
    uniqueFieldHandler(
      'username',
      isValidUsername,
      'Username can only contain letters, numbers, and underscores and must be 3-30 characters'
    )
  );

  // Update last selected list
  app.post(
    '/api/user/last-list',
    ensureAuthAPI,
    asyncHandler(async (req, res) => {
      const listId = req.body.listId || req.body.listName;

      if (!listId) {
        return res.status(400).json({ error: 'listId is required' });
      }

      await userService.updateLastSelectedList(req.user._id, listId);

      req.user.lastSelectedList = listId;
      saveSessionSafe(req, 'lastSelectedList update');
      res.json({ success: true });
    }, 'updating last selected list')
  );

  // Change password
  app.post(
    '/settings/change-password',
    ensureAuth,
    sensitiveSettingsRateLimit,
    csrfProtection,
    async (req, res) => {
      try {
        const result = await authService.changePassword(
          req.user._id,
          req.user.hash,
          req.body,
          isValidPassword
        );

        if (!result.success) {
          return respondWithError(req, res, 400, result.error, '/');
        }

        await usersAsync.update(
          { _id: req.user._id },
          { $set: { hash: result.newHash, updatedAt: new Date() } }
        );

        return respondWithSuccess(
          req,
          res,
          'Password updated successfully',
          '/'
        );
      } catch (error) {
        logger.error('Password change error', {
          error: error.message,
          userId: req.user._id,
        });
        return respondWithError(req, res, 500, 'Error changing password', '/');
      }
    }
  );

  // Request admin access
  app.post(
    '/settings/request-admin',
    ensureAuth,
    csrfProtection,
    rateLimitAdminRequest,
    async (req, res) => {
      logger.info('Admin request received', {
        email: req.user.email,
        userId: req.user._id,
        requestId: req.id,
      });

      try {
        const { code } = req.body;
        const codeResult = authService.validateAdminCode(
          code,
          req.user._id,
          adminCodeState
        );

        if (!codeResult.valid) {
          logger.info('Invalid code attempt');

          // Increment failed attempts
          const attempts = req.adminAttempts;
          attempts.count++;
          adminCodeState.adminCodeAttempts.set(req.user._id, attempts);

          return respondWithError(req, res, 400, codeResult.error, '/');
        }

        // Clear failed attempts on success
        adminCodeState.adminCodeAttempts.delete(req.user._id);

        // Grant admin role in DB
        await usersAsync.update(
          { _id: req.user._id },
          { $set: { role: 'admin', adminGrantedAt: new Date() } }
        );

        logger.info(`Admin access granted to: ${req.user.email}`);
        authService.finalizeAdminCodeUsage(adminCodeState, req.user.email);

        // Update session
        req.user.role = 'admin';
        saveSessionSafe(req, 'admin role update');

        return respondWithSuccess(req, res, 'Admin access granted!', '/');
      } catch (error) {
        logger.error('Admin request error', {
          error: error.message,
          userId: req.user._id,
        });
        return respondWithError(
          req,
          res,
          500,
          'Error processing admin request',
          '/'
        );
      }
    }
  );

  // ============ EXTENSION AUTHENTICATION ============

  // Extension login page — redirects to login, then generates token
  app.get('/extension/auth', async (req, res) => {
    if (!req.isAuthenticated()) {
      req.session.extensionAuth = true;
      try {
        await saveSessionAsync(req);
      } catch (err) {
        logger.error('Session save error:', err);
      }
      return res.redirect('/login');
    }

    res.send(extensionAuthTemplate());
  });

  // ============ EXTENSION TOKEN ENDPOINTS ============

  // Generate extension token
  app.post(
    '/api/auth/extension-token',
    ensureAuth,
    asyncHandler(async (req, res) => {
      const userAgent = req.get('User-Agent') || 'Unknown';
      const result = await authService.createExtensionToken(
        pool,
        req.user._id,
        userAgent,
        generateExtensionToken
      );

      logger.info('Extension token generated', {
        userId: req.user._id,
        email: req.user.email,
      });

      res.json(result);
    }, 'generating extension token')
  );

  // Validate extension token
  app.get(
    '/api/auth/validate-token',
    asyncHandler(async (req, res) => {
      const authHeader = req.get('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
      }

      const token = authHeader.substring(7);
      const userId = await validateExtensionToken(token, pool);

      if (!userId) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }

      const user = await usersAsync.findOne({ _id: userId });
      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }

      res.json({ valid: true, user: sanitizeUser(user) });
    }, 'validating extension token')
  );

  // Revoke extension token
  app.delete(
    '/api/auth/extension-token',
    ensureAuth,
    asyncHandler(async (req, res) => {
      const { token } = req.body;

      if (!token) {
        return res.status(400).json({ error: 'Token required' });
      }

      const { revoked } = await authService.revokeExtensionToken(
        pool,
        token,
        req.user._id
      );

      if (!revoked) {
        return res.status(404).json({ error: 'Token not found' });
      }

      logger.info('Extension token revoked', {
        userId: req.user._id,
        email: req.user.email,
      });

      res.json({ success: true });
    }, 'revoking extension token')
  );

  // List extension tokens
  app.get(
    '/api/auth/extension-tokens',
    ensureAuth,
    asyncHandler(async (req, res) => {
      const tokens = await authService.listExtensionTokens(pool, req.user._id);
      res.json({ tokens });
    }, 'listing extension tokens')
  );

  // Cleanup expired tokens (admin only)
  app.post(
    '/api/auth/cleanup-tokens',
    ensureAuth,
    asyncHandler(async (req, res) => {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const deletedCount = await cleanupExpiredTokens(pool);
      logger.info('Cleaned up expired tokens', { count: deletedCount });
      res.json({ deletedCount });
    }, 'cleaning up expired tokens')
  );
};
