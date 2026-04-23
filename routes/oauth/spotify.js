/**
 * Spotify OAuth Routes
 *
 * Handles Spotify authentication flow:
 * - /auth/spotify - Initiate OAuth flow
 * - /auth/spotify/callback - Handle OAuth callback
 * - /auth/spotify/disconnect - Disconnect Spotify account
 */

const { URLSearchParams } = require('url');
const logger = require('../../utils/logger');
const { sanitizeReturnPath } = require('../../utils/redirect-path');

module.exports = (app, deps) => {
  const { ensureAuth, userService, usersAsync, crypto } = deps;
  const setSpotifyAuth =
    typeof userService?.setSpotifyAuth === 'function'
      ? (userId, token) => userService.setSpotifyAuth(userId, token)
      : (userId, token) =>
          usersAsync.update(
            { _id: userId },
            { $set: { spotifyAuth: token, updatedAt: new Date() } }
          );
  const clearSpotifyAuth =
    typeof userService?.clearSpotifyAuth === 'function'
      ? (userId) => userService.clearSpotifyAuth(userId)
      : (userId) =>
          usersAsync.update(
            { _id: userId },
            { $unset: { spotifyAuth: true }, $set: { updatedAt: new Date() } }
          );

  // Initiate Spotify OAuth flow
  app.get('/auth/spotify', ensureAuth, (req, res) => {
    const state = crypto.randomBytes(8).toString('hex');
    logger.info('Starting Spotify OAuth flow', { state, userId: req.user._id });
    req.session.spotifyState = state;

    // Store returnTo path for after OAuth completes
    if (req.query.returnTo) {
      req.session.spotifyReturnTo = sanitizeReturnPath(req.query.returnTo);
    }

    const params = new URLSearchParams({
      client_id: process.env.SPOTIFY_CLIENT_ID || '',
      response_type: 'code',
      redirect_uri: process.env.SPOTIFY_REDIRECT_URI || '',
      scope:
        'user-read-email user-read-private playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public user-read-playback-state user-modify-playback-state user-read-currently-playing streaming user-top-read user-library-read user-read-recently-played',
      state,
    });

    // Force re-consent if requested (needed when scopes change)
    if (req.query.force === 'true') {
      params.set('show_dialog', 'true');
    }

    res.redirect(`https://accounts.spotify.com/authorize?${params.toString()}`);
  });

  // Handle Spotify OAuth callback
  app.get('/auth/spotify/callback', ensureAuth, async (req, res) => {
    if (req.query.state !== req.session.spotifyState) {
      req.flash('error', 'Invalid Spotify state');
      return res.redirect('/');
    }
    delete req.session.spotifyState;
    logger.info('Spotify callback received', {
      hasCode: !!req.query.code,
      state: req.query.state,
      userId: req.user._id,
    });
    try {
      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code: req.query.code || '',
        redirect_uri: process.env.SPOTIFY_REDIRECT_URI || '',
        client_id: process.env.SPOTIFY_CLIENT_ID || '',
        client_secret: process.env.SPOTIFY_CLIENT_SECRET || '',
      });
      const resp = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      if (!resp.ok) {
        const respText = await resp.text();
        logger.error('Spotify token request failed', {
          status: resp.status,
          response: respText.substring(0, 200),
          userId: req.user._id,
        });
        throw new Error('Token request failed');
      }
      const token = await resp.json();
      logger.info('Spotify token received', {
        access_token: token.access_token?.slice(0, 6) + '...',
        expires_in: token.expires_in,
        refresh: !!token.refresh_token,
      });
      if (token && token.expires_in) {
        token.expires_at = Date.now() + token.expires_in * 1000;
      }
      const numUpdated = await setSpotifyAuth(req.user._id, token);

      if (!numUpdated) {
        throw new Error('Failed to persist Spotify credentials');
      }

      req.user.spotifyAuth = token;
      req.flash('success', 'Spotify connected');
    } catch (e) {
      logger.error('Spotify auth error', {
        error: e.message,
        userId: req.user._id,
      });
      req.flash('error', 'Failed to authenticate with Spotify');
    }

    // Redirect back to where the user was (for automatic reconnects) or home
    const returnTo = sanitizeReturnPath(req.session.spotifyReturnTo);
    delete req.session.spotifyReturnTo; // Clean up
    res.redirect(returnTo);
  });

  // Disconnect Spotify account
  app.get('/auth/spotify/disconnect', ensureAuth, async (req, res) => {
    try {
      logger.info('Disconnecting Spotify', {
        email: req.user.email,
        userId: req.user._id,
      });

      const numUpdated = await clearSpotifyAuth(req.user._id);

      if (!numUpdated) {
        throw new Error('User not found during Spotify disconnect');
      }

      delete req.user.spotifyAuth;
      req.flash('success', 'Spotify disconnected');
      res.redirect('/');
    } catch (err) {
      logger.error('Spotify disconnect error', {
        error: err.message,
        userId: req.user._id,
      });
      req.flash('error', 'Failed to disconnect Spotify');
      res.redirect('/');
    }
  });
};
