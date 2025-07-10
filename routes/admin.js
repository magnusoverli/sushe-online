module.exports = (app, deps) => {
  const {
    ensureAuth,
    ensureAdmin,
    users,
    lists,
    usersAsync,
    listsAsync,
    listItemsAsync,
    albumsAsync,
    upload,
    adminCodeExpiry,
    crypto,
  } = deps;

  const logger = require('../utils/logger');
  const { spawn } = require('child_process');
  const fs = require('fs');
  const path = require('path');
  const { URLSearchParams } = require('url');

  const pgMajor = process.env.PG_MAJOR || '16';
  const binDir = process.env.PG_BIN || `/usr/lib/postgresql/${pgMajor}/bin`;
  const pgDumpCmd = fs.existsSync(path.join(binDir, 'pg_dump'))
    ? path.join(binDir, 'pg_dump')
    : process.env.PG_DUMP || 'pg_dump';
  const pgRestoreCmd = fs.existsSync(path.join(binDir, 'pg_restore'))
    ? path.join(binDir, 'pg_restore')
    : process.env.PG_RESTORE || 'pg_restore';

  // ============ ADMIN API ENDPOINTS ============

  // Admin: Delete user
  app.post('/admin/delete-user', ensureAuth, ensureAdmin, (req, res) => {
    const { userId } = req.body;

    if (userId === req.user._id) {
      return res.status(400).json({ error: 'Cannot delete yourself' });
    }

    // Delete user's lists first
    lists.remove({ userId }, { multi: true }, (err) => {
      if (err) {
        logger.error('Error deleting user lists:', err);
        return res.status(500).json({ error: 'Error deleting user data' });
      }

      // Then delete the user
      users.remove({ _id: userId }, {}, (err, numRemoved) => {
        if (err) {
          logger.error('Error deleting user:', err);
          return res.status(500).json({ error: 'Error deleting user' });
        }

        if (numRemoved === 0) {
          return res.status(404).json({ error: 'User not found' });
        }

        logger.info(`Admin ${req.user.email} deleted user with ID: ${userId}`);
        res.json({ success: true });
      });
    });
  });

  // ===== Music Service Authentication =====
  app.get('/auth/spotify', ensureAuth, (req, res) => {
    const state = crypto.randomBytes(8).toString('hex');
    logger.info('Starting Spotify OAuth flow, state:', state);
    req.session.spotifyState = state;
    const params = new URLSearchParams({
      client_id: process.env.SPOTIFY_CLIENT_ID || '',
      response_type: 'code',
      redirect_uri: process.env.SPOTIFY_REDIRECT_URI || '',
      scope: 'user-read-email playlist-modify-private playlist-modify-public',
      state,
    });
    res.redirect(`https://accounts.spotify.com/authorize?${params.toString()}`);
  });

  app.get('/auth/spotify/callback', ensureAuth, async (req, res) => {
    if (req.query.state !== req.session.spotifyState) {
      req.flash('error', 'Invalid Spotify state');
      return res.redirect('/settings');
    }
    delete req.session.spotifyState;
    logger.info(
      'Spotify callback received. code:',
      req.query.code,
      'state:',
      req.query.state
    );
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
        logger.error(
          'Spotify token request failed:',
          resp.status,
          await resp.text()
        );
        throw new Error('Token request failed');
      }
      const token = await resp.json();
      logger.info('Spotify token response:', {
        access_token: token.access_token?.slice(0, 6) + '...',
        expires_in: token.expires_in,
        refresh: !!token.refresh_token,
      });
      if (token && token.expires_in) {
        token.expires_at = Date.now() + token.expires_in * 1000;
      }
      users.update(
        { _id: req.user._id },
        { $set: { spotifyAuth: token, updatedAt: new Date() } },
        {},
        (err) => {
          if (err) logger.error('Spotify auth update error:', err);
        }
      );
      req.user.spotifyAuth = token;
      req.flash('success', 'Spotify connected');
    } catch (e) {
      logger.error('Spotify auth error:', e);
      req.flash('error', 'Failed to authenticate with Spotify');
    }
    res.redirect('/settings');
  });

  app.get('/auth/spotify/disconnect', ensureAuth, (req, res) => {
    logger.info('Disconnecting Spotify for user:', req.user.email);
    users.update(
      { _id: req.user._id },
      { $unset: { spotifyAuth: true }, $set: { updatedAt: new Date() } },
      {},
      (err) => {
        if (err) logger.error('Spotify disconnect error:', err);
      }
    );
    delete req.user.spotifyAuth;
    req.flash('success', 'Spotify disconnected');
    res.redirect('/settings');
  });

  // Tidal OAuth flow
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
    req.session.tidalState = state;
    req.session.tidalVerifier = verifier;
    // The TIDAL application grants these scopes:
    //   user.read, collection.read, search.read, playlists.write,
    //   playlists.read, entitlements.read, collection.write, playback,
    //   recommendations.read, search.write
    // The integration requests all available scopes. The `offline_access` scope
    // is not available to this app, so tokens cannot be refreshed and must be
    // re-authorized when they expire.
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

  app.get('/auth/tidal/callback', ensureAuth, async (req, res) => {
    if (req.query.state !== req.session.tidalState) {
      req.flash('error', 'Invalid Tidal state');
      return res.redirect('/settings');
    }
    const verifier = req.session.tidalVerifier;
    delete req.session.tidalState;
    delete req.session.tidalVerifier;
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
        logger.error(
          'Tidal token request failed:',
          resp.status,
          await resp.text()
        );
        throw new Error('Token request failed');
      }
      const token = await resp.json();
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
          logger.warn('Tidal profile request failed:', profileResp.status);
        }
      } catch (profileErr) {
        logger.error('Tidal profile fetch error:', profileErr);
      }

      users.update(
        { _id: req.user._id },
        {
          $set: {
            tidalAuth: token,
            tidalCountry: countryCode,
            updatedAt: new Date(),
          },
        },
        {},
        (err) => {
          if (err) logger.error('Tidal auth update error:', err);
        }
      );
      req.user.tidalAuth = token;
      req.user.tidalCountry = countryCode;
      req.flash('success', 'Tidal connected');
    } catch (e) {
      logger.error('Tidal auth error:', e);
      req.flash('error', 'Failed to authenticate with Tidal');
    }
    res.redirect('/settings');
  });

  app.get('/auth/tidal/disconnect', ensureAuth, (req, res) => {
    users.update(
      { _id: req.user._id },
      { $unset: { tidalAuth: true }, $set: { updatedAt: new Date() } },
      {},
      (err) => {
        if (err) logger.error('Tidal disconnect error:', err);
      }
    );
    delete req.user.tidalAuth;
    req.flash('success', 'Tidal disconnected');
    res.redirect('/settings');
  });

  // Admin: Make user admin
  app.post('/admin/make-admin', ensureAuth, ensureAdmin, (req, res) => {
    const { userId } = req.body;

    users.update(
      { _id: userId },
      { $set: { role: 'admin', adminGrantedAt: new Date() } },
      {},
      (err, numUpdated) => {
        if (err) {
          logger.error('Error granting admin:', err);
          return res
            .status(500)
            .json({ error: 'Error granting admin privileges' });
        }

        if (numUpdated === 0) {
          return res.status(404).json({ error: 'User not found' });
        }

        logger.info(
          `Admin ${req.user.email} granted admin to user ID: ${userId}`
        );
        res.json({ success: true });
      }
    );
  });

  // Admin: Revoke admin
  app.post('/admin/revoke-admin', ensureAuth, ensureAdmin, (req, res) => {
    const { userId } = req.body;

    // Prevent revoking your own admin rights
    if (userId === req.user._id) {
      return res
        .status(400)
        .json({ error: 'Cannot revoke your own admin privileges' });
    }

    users.update(
      { _id: userId },
      { $unset: { role: true, adminGrantedAt: true } },
      {},
      (err, numUpdated) => {
        if (err) {
          logger.error('Error revoking admin:', err);
          return res
            .status(500)
            .json({ error: 'Error revoking admin privileges' });
        }

        if (numUpdated === 0) {
          return res.status(404).json({ error: 'User not found' });
        }

        logger.info(
          `Admin ${req.user.email} revoked admin from user ID: ${userId}`
        );
        res.json({ success: true });
      }
    );
  });

  // Admin: Export users as CSV
  app.get('/admin/export-users', ensureAuth, ensureAdmin, (req, res) => {
    users.find({}, (err, allUsers) => {
      if (err) {
        logger.error('Error exporting users:', err);
        return res.status(500).send('Error exporting users');
      }

      // Create CSV content
      let csv = 'Email,Username,Role,Created At\n';
      allUsers.forEach((user) => {
        csv += `"${user.email}","${user.username}","${user.role || 'user'}","${new Date(user.createdAt).toISOString()}"\n`;
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="users-export.csv"'
      );
      res.send(csv);
    });
  });

  // Admin: Get user lists
  app.get(
    '/admin/user-lists/:userId',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      const { userId } = req.params;

      try {
        const userLists = await listsAsync.find({ userId });
        const listsData = [];
        for (const list of userLists) {
          const count = await listItemsAsync.count({ listId: list._id });
          listsData.push({
            name: list.name,
            albumCount: count,
            createdAt: list.createdAt,
            updatedAt: list.updatedAt,
          });
        }

        res.json({ lists: listsData });
      } catch (err) {
        logger.error('Error fetching user lists:', err);
        res.status(500).json({ error: 'Error fetching user lists' });
      }
    }
  );

  // Admin: Export database to JSON
  app.get('/admin/export', ensureAuth, ensureAdmin, async (req, res) => {
    try {
      const listsData = await listsAsync.find({});
      for (const l of listsData) {
        const items = await listItemsAsync.find({ listId: l._id });
        items.sort((a, b) => a.position - b.position);

        // Batch load album data to avoid N+1 queries
        const albumIds = items.map((item) => item.albumId).filter(Boolean);
        const albumsData =
          albumIds.length > 0 ? await albumsAsync.findByIds(albumIds) : [];
        const albumsMap = new Map(
          albumsData.map((album) => [album._id, album])
        );

        const mapped = [];
        for (const it of items) {
          const albumData = it.albumId ? albumsMap.get(it.albumId) : null;
          mapped.push({
            artist: albumData?.artist || it.artist,
            album: albumData?.album || it.album,
            album_id: it.albumId,
            release_date: albumData?.releaseDate || it.releaseDate,
            country: albumData?.country || it.country,
            genre_1: albumData?.genre1 || it.genre1,
            genre_2: albumData?.genre2 || it.genre2,
            comments: it.comments,
            cover_image: albumData?.coverImage || it.coverImage,
            cover_image_format:
              albumData?.coverImageFormat || it.coverImageFormat,
          });
        }
        l.data = mapped;
      }
      const backup = {
        exportDate: new Date().toISOString(),
        users: await usersAsync.find({}),
        lists: listsData,
      };

      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="sushe-export.json"'
      );
      res.send(JSON.stringify(backup, null, 2));
    } catch (error) {
      logger.error('Export error:', error);
      res.status(500).send('Error creating export');
    }
  });

  // Admin: Backup entire database using pg_dump
  app.get('/admin/backup', ensureAuth, ensureAdmin, (req, res) => {
    const dump = spawn(pgDumpCmd, ['-Fc', process.env.DATABASE_URL]);
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="sushe-db.dump"'
    );
    res.setHeader('Content-Type', 'application/octet-stream');
    dump.stdout.pipe(res);
    dump.stderr.on('data', (d) => logger.error('pg_dump:', d.toString()));
    dump.on('error', (err) => {
      logger.error('Backup error:', err);
      res.status(500).send('Error creating backup');
    });
  });

  // Admin: Restore database from pg_dump file

  app.post(
    '/admin/restore',
    ensureAuth,
    ensureAdmin,
    upload.single('backup'),
    (req, res) => {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const tmpFile = req.file.path;

      const restore = spawn(pgRestoreCmd, [
        '-c',
        '-d',
        process.env.DATABASE_URL,
        tmpFile,
      ]);

      restore.stderr.on('data', (data) =>
        logger.error('pg_restore:', data.toString())
      );

      restore.on('error', (err) => {
        logger.error('Restore error:', err);
        res.status(500).json({ error: 'Error restoring database' });
      });

      restore.on('exit', (code) => {
        fs.unlink(tmpFile, () => {});
        if (code === 0) {
          req.sessionStore.clear((err) => {
            if (err)
              logger.error('Error clearing sessions after restore:', err);
            res.json({
              success: true,
              message: 'Database restored successfully',
            });
          });
        } else {
          logger.error('pg_restore exited with code', code);
          res.status(500).json({ error: 'Error restoring database' });
        }
      });
    }
  );

  // Admin: Clear all sessions
  app.post('/admin/clear-sessions', ensureAuth, ensureAdmin, (req, res) => {
    const sessionStore = req.sessionStore;

    sessionStore.clear((err) => {
      if (err) {
        logger.error('Error clearing sessions:', err);
        return res.status(500).json({ error: 'Error clearing sessions' });
      }

      logger.info(`Admin ${req.user.email} cleared all sessions`);
      res.json({ success: true });
    });
  });

  // Admin status endpoint (for debugging)
  app.get('/api/admin/status', ensureAuth, (req, res) => {
    res.json({
      isAdmin: req.user.role === 'admin',
      codeValid: new Date() < adminCodeExpiry,
      codeExpiresIn:
        Math.max(0, Math.floor((adminCodeExpiry - new Date()) / 1000)) +
        ' seconds',
    });
  });
};
