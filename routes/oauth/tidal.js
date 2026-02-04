/**
 * Tidal OAuth Routes
 *
 * Handles Tidal authentication flow with PKCE:
 * - /auth/tidal - Initiate OAuth flow
 * - /auth/tidal/callback - Handle OAuth callback
 * - /auth/tidal/disconnect - Disconnect Tidal account
 */

const { URLSearchParams } = require('url');
const logger = require('../../utils/logger');

module.exports = (app, deps) => {
  const { ensureAuth, usersAsync, crypto } = deps;

  // Initiate Tidal OAuth flow
  app.get('/auth/tidal', ensureAuth, (req, res) => {
    const state = crypto.randomBytes(8).toString('hex');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto
      .createHash('sha256')
      .update(verifier)
      .digest('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    logger.info('Starting Tidal OAuth flow', { state, userId: req.user._id });
    req.session.tidalState = state;
    req.session.tidalVerifier = verifier;

    // Store returnTo path for after OAuth completes
    if (req.query.returnTo) {
      req.session.tidalReturnTo = req.query.returnTo;
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: process.env.TIDAL_CLIENT_ID || '',
      redirect_uri: process.env.TIDAL_REDIRECT_URI || '',
      scope:
        'user.read collection.read search.read playlists.write playlists.read ' +
        'entitlements.read collection.write recommendations.read playback ' +
        'search.write',
      code_challenge_method: 'S256',
      code_challenge: challenge,
      state,
    });
    res.redirect(`https://login.tidal.com/authorize?${params.toString()}`);
  });

  // Handle Tidal OAuth callback
  app.get('/auth/tidal/callback', ensureAuth, async (req, res) => {
    if (req.query.state !== req.session.tidalState) {
      req.flash('error', 'Invalid Tidal state');
      return res.redirect('/');
    }
    const verifier = req.session.tidalVerifier;
    delete req.session.tidalState;
    delete req.session.tidalVerifier;
    logger.info('Tidal callback received', {
      hasCode: !!req.query.code,
      state: req.query.state,
      userId: req.user._id,
    });
    try {
      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.TIDAL_CLIENT_ID || '',
        code: req.query.code || '',
        redirect_uri: process.env.TIDAL_REDIRECT_URI || '',
        code_verifier: verifier,
      });
      const resp = await fetch('https://auth.tidal.com/v1/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      if (!resp.ok) {
        const respText = await resp.text();
        logger.error('Tidal token request failed', {
          status: resp.status,
          response: respText.substring(0, 200),
          userId: req.user._id,
        });
        throw new Error('Token request failed');
      }
      const token = await resp.json();
      logger.info('Tidal token received', {
        access_token: token.access_token?.slice(0, 6) + '...',
        expires_in: token.expires_in,
        refresh: !!token.refresh_token,
      });
      if (token && token.expires_in) {
        token.expires_at = Date.now() + token.expires_in * 1000;
      }

      let countryCode = null;
      try {
        const profileResp = await fetch(
          'https://openapi.tidal.com/users/v1/me',
          {
            headers: {
              Authorization: `Bearer ${token.access_token}`,
              Accept: 'application/vnd.api+json',
              'X-Tidal-Token': process.env.TIDAL_CLIENT_ID || '',
            },
          }
        );
        if (profileResp.ok) {
          const profile = await profileResp.json();
          countryCode = profile.countryCode || null;
        } else {
          logger.warn('Tidal profile request failed', {
            status: profileResp.status,
            userId: req.user._id,
          });
        }
      } catch (profileErr) {
        logger.error('Tidal profile fetch error', {
          error: profileErr.message,
          userId: req.user._id,
        });
      }

      await usersAsync.update(
        { _id: req.user._id },
        {
          $set: {
            tidalAuth: token,
            tidalCountry: countryCode,
            updatedAt: new Date(),
          },
        }
      );
      req.user.tidalAuth = token;
      req.user.tidalCountry = countryCode;
      req.flash('success', 'Tidal connected');
    } catch (e) {
      logger.error('Tidal auth error', {
        error: e.message,
        userId: req.user._id,
      });
      req.flash('error', 'Failed to authenticate with Tidal');
    }

    // Redirect back to where the user was (for automatic reconnects) or home
    const returnTo = req.session.tidalReturnTo || '/';
    delete req.session.tidalReturnTo; // Clean up
    res.redirect(returnTo);
  });

  // Disconnect Tidal account
  app.get('/auth/tidal/disconnect', ensureAuth, async (req, res) => {
    try {
      await usersAsync.update(
        { _id: req.user._id },
        { $unset: { tidalAuth: true }, $set: { updatedAt: new Date() } }
      );
      delete req.user.tidalAuth;
      req.flash('success', 'Tidal disconnected');
    } catch (e) {
      logger.error('Tidal disconnect error', {
        error: e.message,
        userId: req.user._id,
      });
      req.flash('error', 'Failed to disconnect Tidal');
    }
    res.redirect('/');
  });
};
