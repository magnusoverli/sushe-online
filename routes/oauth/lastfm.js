/**
 * Last.fm OAuth Routes
 *
 * Handles Last.fm authentication flow (simpler than OAuth2):
 * 1. Redirect user to Last.fm auth page
 * 2. User authorizes, Last.fm redirects back with a token
 * 3. Exchange token for session key (which never expires)
 *
 * Routes:
 * - /auth/lastfm - Initiate auth flow
 * - /auth/lastfm/callback - Handle auth callback
 * - /auth/lastfm/disconnect - Disconnect Last.fm account
 */

const logger = require('../../utils/logger');
const crypto = require('crypto');
const {
  invalidateUserPlaycounts: defaultInvalidateUserPlaycounts,
  syncUserPlaycounts: defaultSyncUserPlaycounts,
} = require('../../services/playcount-sync-service');

module.exports = (app, deps) => {
  const { ensureAuth, userService, db } = deps;
  const csrfProtection = deps.csrfProtection || ((_req, _res, next) => next());
  const log = deps.logger || logger;
  const getLastfmSession =
    deps.getLastfmSession || require('../../utils/lastfm-auth').getSession;
  const invalidateUserPlaycounts =
    deps.invalidateUserPlaycounts || defaultInvalidateUserPlaycounts;
  const syncUserPlaycounts =
    deps.syncUserPlaycounts || defaultSyncUserPlaycounts;

  if (!userService) {
    throw new Error('lastfm oauth routes require userService');
  }

  async function clearCachedPlaycounts(userId) {
    if (!db) return;

    try {
      await invalidateUserPlaycounts(db, log, userId);
    } catch (err) {
      log.warn('Failed to invalidate Last.fm playcount cache', {
        userId,
        error: err.message,
      });
    }
  }

  function triggerFullPlaycountRefresh(userId, lastfmUsername) {
    if (!db || !lastfmUsername) return;

    syncUserPlaycounts(db, log, {
      _id: userId,
      username: lastfmUsername,
      lastfm_username: lastfmUsername,
    }).catch((err) => {
      log.warn('Full Last.fm playcount refresh failed after reconnect', {
        userId,
        lastfmUsername,
        error: err.message,
      });
    });
  }

  // Initiate Last.fm auth flow
  app.get('/auth/lastfm', ensureAuth, (req, res) => {
    const apiKey = process.env.LASTFM_API_KEY;

    if (!apiKey) {
      logger.warn('Last.fm API key not configured');
      req.flash('error', 'Last.fm is not configured on this server');
      return res.redirect('/');
    }

    const state = crypto.randomBytes(16).toString('hex');
    req.session.lastfmAuthState = state;

    const callbackUrl = `${process.env.BASE_URL}/auth/lastfm/callback/${state}`;
    const authUrl = `https://www.last.fm/api/auth/?api_key=${apiKey}&cb=${encodeURIComponent(callbackUrl)}`;

    logger.info('Starting Last.fm auth flow', {
      email: req.user.email,
      userId: req.user._id,
    });
    res.redirect(authUrl);
  });

  // Handle Last.fm auth callback
  app.get('/auth/lastfm/callback', ensureAuth, (req, res) => {
    req.flash('error', 'Last.fm authorization failed - missing state');
    res.redirect('/');
  });

  app.get('/auth/lastfm/callback/:state', ensureAuth, async (req, res) => {
    const expectedState = req.session.lastfmAuthState;
    delete req.session.lastfmAuthState;

    if (!expectedState || req.params.state !== expectedState) {
      logger.warn('Last.fm callback received invalid state', {
        userId: req.user._id,
      });
      req.flash('error', 'Last.fm authorization failed - invalid state');
      return res.redirect('/');
    }

    const { token } = req.query;

    if (!token) {
      logger.warn('Last.fm callback received without token');
      req.flash('error', 'Last.fm authorization failed - no token received');
      return res.redirect('/');
    }

    try {
      const sessionData = await getLastfmSession(
        token,
        process.env.LASTFM_API_KEY,
        process.env.LASTFM_SECRET
      );

      const lastfmAuth = {
        session_key: sessionData.session_key,
        username: sessionData.username,
        connected_at: Date.now(),
      };

      // Await the database update to ensure it completes before redirect
      // This prevents a race condition where the settings page loads before
      // the database has been updated
      await userService.setLastfmAuth(
        req.user._id,
        lastfmAuth,
        sessionData.username
      );
      // Re-sync fresh playcounts in the background WITHOUT wiping the cache
      // first — deleting up front made every list view blank until the
      // (slow, rate-limited) full refresh finished. Existing values keep
      // showing and are overwritten per-album as fresh data arrives.
      triggerFullPlaycountRefresh(req.user._id, sessionData.username);

      log.info('Last.fm connected', {
        email: req.user.email,
        lastfmUsername: sessionData.username,
        userId: req.user._id,
      });
      req.flash('success', `Connected to Last.fm as ${sessionData.username}`);
    } catch (error) {
      log.error('Last.fm auth error', {
        error: error.message,
        userId: req.user._id,
      });
      req.flash('error', `Last.fm connection failed: ${error.message}`);
    }

    res.redirect('/');
  });

  // Disconnect Last.fm account
  app.get('/auth/lastfm/disconnect', ensureAuth, (req, res) => {
    req.flash('error', 'Please disconnect Last.fm from settings');
    res.redirect('/');
  });

  app.post(
    '/auth/lastfm/disconnect',
    ensureAuth,
    csrfProtection,
    async (req, res) => {
      logger.info('Disconnecting Last.fm', {
        email: req.user.email,
        userId: req.user._id,
      });

      try {
        // Await the database update to ensure it completes before redirect
        await userService.clearLastfmAuth(req.user._id);
        await clearCachedPlaycounts(req.user._id);

        req.flash('success', 'Disconnected from Last.fm');
        return res.json({ success: true });
      } catch (err) {
        logger.error('Last.fm disconnect error', {
          error: err.message,
          userId: req.user._id,
        });
        req.flash('error', 'Failed to disconnect from Last.fm');
        return res
          .status(500)
          .json({ error: 'Failed to disconnect from Last.fm' });
      }
    }
  );
};
