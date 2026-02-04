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

module.exports = (app, deps) => {
  const { ensureAuth, usersAsync } = deps;

  // Initiate Last.fm auth flow
  app.get('/auth/lastfm', ensureAuth, (req, res) => {
    const apiKey = process.env.LASTFM_API_KEY;

    if (!apiKey) {
      logger.warn('Last.fm API key not configured');
      req.flash('error', 'Last.fm is not configured on this server');
      return res.redirect('/');
    }

    const callbackUrl = `${process.env.BASE_URL}/auth/lastfm/callback`;
    const authUrl = `https://www.last.fm/api/auth/?api_key=${apiKey}&cb=${encodeURIComponent(callbackUrl)}`;

    logger.info('Starting Last.fm auth flow', {
      email: req.user.email,
      userId: req.user._id,
    });
    res.redirect(authUrl);
  });

  // Handle Last.fm auth callback
  app.get('/auth/lastfm/callback', ensureAuth, async (req, res) => {
    const { token } = req.query;

    if (!token) {
      logger.warn('Last.fm callback received without token');
      req.flash('error', 'Last.fm authorization failed - no token received');
      return res.redirect('/');
    }

    try {
      const { getSession } = require('../../utils/lastfm-auth');
      const sessionData = await getSession(
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
      await usersAsync.update(
        { _id: req.user._id },
        {
          $set: {
            lastfmAuth: lastfmAuth,
            lastfmUsername: sessionData.username,
            updatedAt: new Date(),
          },
        }
      );

      logger.info('Last.fm connected', {
        email: req.user.email,
        lastfmUsername: sessionData.username,
        userId: req.user._id,
      });
      req.flash('success', `Connected to Last.fm as ${sessionData.username}`);
    } catch (error) {
      logger.error('Last.fm auth error', {
        error: error.message,
        userId: req.user._id,
      });
      req.flash('error', `Last.fm connection failed: ${error.message}`);
    }

    res.redirect('/');
  });

  // Disconnect Last.fm account
  app.get('/auth/lastfm/disconnect', ensureAuth, async (req, res) => {
    logger.info('Disconnecting Last.fm', {
      email: req.user.email,
      userId: req.user._id,
    });

    try {
      // Await the database update to ensure it completes before redirect
      await usersAsync.update(
        { _id: req.user._id },
        {
          $unset: { lastfmAuth: true, lastfmUsername: true },
          $set: { updatedAt: new Date() },
        }
      );

      req.flash('success', 'Disconnected from Last.fm');
    } catch (err) {
      logger.error('Last.fm disconnect error', {
        error: err.message,
        userId: req.user._id,
      });
      req.flash('error', 'Failed to disconnect from Last.fm');
    }

    res.redirect('/');
  });
};
