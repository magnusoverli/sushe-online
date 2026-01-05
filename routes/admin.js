module.exports = (app, deps) => {
  const {
    ensureAuth,
    ensureAdmin,
    users,
    usersAsync,
    lists,
    listsAsync,
    listItemsAsync,
    upload,
    adminCodeExpiry,
    crypto,
  } = deps;

  const logger = require('../utils/logger');
  const { spawn } = require('child_process');
  const fs = require('fs');
  const path = require('path');
  const { URLSearchParams } = require('url');

  // PostgreSQL client configuration
  const pgMajor = process.env.PG_MAJOR || '18';
  const binDir = process.env.PG_BIN || `/usr/lib/postgresql/${pgMajor}/bin`;
  const pgDumpCmd = fs.existsSync(path.join(binDir, 'pg_dump'))
    ? path.join(binDir, 'pg_dump')
    : process.env.PG_DUMP || 'pg_dump';
  const pgRestoreCmd = fs.existsSync(path.join(binDir, 'pg_restore'))
    ? path.join(binDir, 'pg_restore')
    : process.env.PG_RESTORE || 'pg_restore';

  // Check if running in Docker (Unix socket connection)
  const isDocker =
    process.env.DATABASE_URL &&
    process.env.DATABASE_URL.includes('host=/var/run/postgresql');

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
        logger.error('Error deleting user lists', {
          error: err.message,
          userId,
        });
        return res.status(500).json({ error: 'Error deleting user data' });
      }

      // Then delete the user
      users.remove({ _id: userId }, {}, (err, numRemoved) => {
        if (err) {
          logger.error('Error deleting user', { error: err.message, userId });
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
    logger.info('Starting Spotify OAuth flow', { state, userId: req.user._id });
    req.session.spotifyState = state;

    // Store returnTo path for after OAuth completes
    if (req.query.returnTo) {
      req.session.spotifyReturnTo = req.query.returnTo;
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
      users.update(
        { _id: req.user._id },
        { $set: { spotifyAuth: token, updatedAt: new Date() } },
        {},
        (err) => {
          if (err)
            logger.error('Spotify auth update error', {
              error: err.message,
              userId: req.user._id,
            });
        }
      );
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
    const returnTo = req.session.spotifyReturnTo || '/';
    delete req.session.spotifyReturnTo; // Clean up
    res.redirect(returnTo);
  });

  app.get('/auth/spotify/disconnect', ensureAuth, (req, res) => {
    logger.info('Disconnecting Spotify', {
      email: req.user.email,
      userId: req.user._id,
    });
    users.update(
      { _id: req.user._id },
      { $unset: { spotifyAuth: true }, $set: { updatedAt: new Date() } },
      {},
      (err) => {
        if (err)
          logger.error('Spotify disconnect error', {
            error: err.message,
            userId: req.user._id,
          });
      }
    );
    delete req.user.spotifyAuth;
    req.flash('success', 'Spotify disconnected');
    res.redirect('/');
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

      await new Promise((resolve, reject) => {
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
            if (err) {
              logger.error('Tidal auth update error', {
                error: err.message,
                userId: req.user._id,
              });
              reject(err);
            } else {
              resolve();
            }
          }
        );
      });
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

  app.get('/auth/tidal/disconnect', ensureAuth, async (req, res) => {
    try {
      await new Promise((resolve, reject) => {
        users.update(
          { _id: req.user._id },
          { $unset: { tidalAuth: true }, $set: { updatedAt: new Date() } },
          {},
          (err) => {
            if (err) {
              logger.error('Tidal disconnect error', {
                error: err.message,
                userId: req.user._id,
              });
              reject(err);
            } else {
              resolve();
            }
          }
        );
      });
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

  // ===== Last.fm Authentication =====
  // Last.fm uses a simpler auth flow than OAuth2:
  // 1. Redirect user to Last.fm auth page
  // 2. User authorizes, Last.fm redirects back with a token
  // 3. Exchange token for session key (which never expires)

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

  app.get('/auth/lastfm/callback', ensureAuth, async (req, res) => {
    const { token } = req.query;

    if (!token) {
      logger.warn('Last.fm callback received without token');
      req.flash('error', 'Last.fm authorization failed - no token received');
      return res.redirect('/');
    }

    try {
      const { getSession } = require('../utils/lastfm-auth');
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

  // Admin: Make user admin
  app.post('/admin/make-admin', ensureAuth, ensureAdmin, (req, res) => {
    const { userId } = req.body;

    users.update(
      { _id: userId },
      { $set: { role: 'admin', adminGrantedAt: new Date() } },
      {},
      (err, numUpdated) => {
        if (err) {
          logger.error('Error granting admin', {
            error: err.message,
            targetUserId: userId,
            adminId: req.user._id,
          });
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
          logger.error('Error revoking admin', {
            error: err.message,
            targetUserId: userId,
            adminId: req.user._id,
          });
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
        logger.error('Error fetching user lists', {
          error: err.message,
          targetUserId: userId,
        });
        res.status(500).json({ error: 'Error fetching user lists' });
      }
    }
  );

  // Admin: Backup entire database using pg_dump
  app.get('/admin/backup', ensureAuth, ensureAdmin, (req, res) => {
    // For Docker setup, connect via TCP to the 'db' service
    const dbUrl = process.env.DATABASE_URL || '';

    let dump;
    if (isDocker) {
      // Running in Docker - connect via TCP to the 'db' service
      const env = {
        ...process.env,
        PGHOST: 'db',
        PGPORT: '5432',
        PGDATABASE: 'sushe',
        PGUSER: 'postgres',
        PGPASSWORD: 'example',
      };

      dump = spawn(pgDumpCmd, ['-Fc'], { env });
      logger.info('Using pg_dump with TCP connection to database service');
    } else {
      // Local development - use DATABASE_URL
      dump = spawn(pgDumpCmd, ['-Fc', '-d', dbUrl]);
      logger.info('Using pg_dump with DATABASE_URL connection');
    }

    // Collect backup data in memory to verify before sending
    const chunks = [];
    const stderrChunks = [];

    dump.stdout.on('data', (chunk) => {
      chunks.push(chunk);
    });

    dump.stderr.on('data', (d) => {
      // Collect stderr output but don't treat warnings as errors
      // pg_dump writes warnings to stderr even on successful dumps
      stderrChunks.push(d.toString());
    });

    dump.on('error', (err) => {
      logger.error('Backup error:', err);
      if (!res.headersSent) {
        res.status(500).send('Error creating backup');
      }
    });

    dump.on('close', (code) => {
      // Log any stderr output (warnings, notices, etc.)
      if (stderrChunks.length > 0) {
        const stderrOutput = stderrChunks.join('');
        if (code !== 0) {
          logger.error('pg_dump error output:', stderrOutput);
        } else {
          // Log warnings but don't fail the backup
          logger.warn('pg_dump warnings:', stderrOutput);
        }
      }

      // Only fail if exit code is non-zero
      if (code !== 0) {
        logger.error('pg_dump exited with code', code);
        if (!res.headersSent) {
          res.status(500).send('Error creating backup');
        }
        return;
      }

      const backup = Buffer.concat(chunks);

      // Verify backup integrity by checking magic bytes
      if (backup.length < 5 || backup.slice(0, 5).toString() !== 'PGDMP') {
        logger.error('Backup verification failed: invalid format');
        if (!res.headersSent) {
          res.status(500).send('Backup verification failed');
        }
        return;
      }

      // Backup is valid, send to user
      logger.info(
        `Backup created successfully (${(backup.length / 1024 / 1024).toFixed(2)} MB)`
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="sushe-db.dump"'
      );
      res.setHeader('Content-Type', 'application/octet-stream');
      res.send(backup);
    });
  });

  // Admin: Restore database from pg_dump file

  app.post(
    '/admin/restore',
    ensureAuth,
    ensureAdmin,
    upload.single('backup'),
    (req, res) => {
      const restoreStartTime = Date.now();
      const restoreId = `restore_${restoreStartTime}`;

      logger.info(`[${restoreId}] === DATABASE RESTORE STARTED ===`, {
        user: req.user.username,
        fileSize: req.file?.size,
        clientIp: req.ip,
        timestamp: new Date().toISOString(),
      });

      if (!req.file) {
        logger.error(`[${restoreId}] No file uploaded`);
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const tmpFile = req.file.path;
      const fileSize = req.file.size;
      const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);

      logger.info(`[${restoreId}] File upload complete`, {
        tmpFile,
        fileSize,
        fileSizeMB: `${fileSizeMB} MB`,
        uploadDuration: `${Date.now() - restoreStartTime}ms`,
      });

      // Validate that the file is a valid PostgreSQL dump file
      try {
        const validationStart = Date.now();
        const header = Buffer.alloc(5);
        const fd = fs.openSync(tmpFile, 'r');
        fs.readSync(fd, header, 0, 5, 0);
        fs.closeSync(fd);

        if (header.toString() !== 'PGDMP') {
          logger.error(`[${restoreId}] Invalid backup file header`, {
            header: header.toString(),
          });
          fs.unlinkSync(tmpFile);
          return res.status(400).json({
            error: 'Invalid backup file. Must be a PostgreSQL dump file.',
          });
        }

        logger.info(`[${restoreId}] File validation passed`, {
          validationDuration: `${Date.now() - validationStart}ms`,
        });
      } catch (err) {
        logger.error(`[${restoreId}] Error validating backup file:`, err);
        fs.unlinkSync(tmpFile);
        return res.status(400).json({
          error: 'Unable to validate backup file',
        });
      }

      const pgRestoreStart = Date.now();

      // For Docker setup, connect via TCP instead of Unix socket
      const dbUrl = process.env.DATABASE_URL || '';

      let restore;
      if (isDocker) {
        // Running in Docker - connect via TCP to the 'db' service
        const env = {
          ...process.env,
          PGHOST: 'db',
          PGPORT: '5432',
          PGDATABASE: 'sushe',
          PGUSER: 'postgres',
          PGPASSWORD: 'example',
        };

        logger.info(`[${restoreId}] Starting pg_restore process via TCP`, {
          command: pgRestoreCmd,
          args: [
            '--clean',
            '--if-exists',
            '--single-transaction',
            '-d',
            'sushe',
          ],
        });

        restore = spawn(
          pgRestoreCmd,
          ['--clean', '--if-exists', '--single-transaction', '-d', 'sushe'],
          { env }
        );

        // Pipe the backup file content to pg_restore via stdin
        const fileStream = fs.createReadStream(tmpFile);
        fileStream.pipe(restore.stdin);
        fileStream.on('error', (err) => {
          logger.error(`[${restoreId}] Error reading backup file:`, err);
        });
      } else {
        // Local development fallback
        logger.info(`[${restoreId}] Starting pg_restore process`, {
          command: pgRestoreCmd,
          args: ['--clean', '--if-exists', '--single-transaction', '-d', '***'],
        });

        restore = spawn(pgRestoreCmd, [
          '--clean',
          '--if-exists',
          '--single-transaction',
          '-d',
          dbUrl,
          tmpFile,
        ]);
      }

      let stderrData = '';
      restore.stderr.on('data', (data) => {
        const output = data.toString();
        stderrData += output;
        logger.error(`[${restoreId}] pg_restore stderr:`, output);
      });

      restore.on('error', (err) => {
        const elapsed = Date.now() - pgRestoreStart;
        logger.error(`[${restoreId}] Restore process error`, {
          error: err.message,
          elapsed: `${elapsed}ms`,
        });

        if (!res.headersSent) {
          res.status(500).json({ error: 'Error restoring database' });
        } else {
          logger.error(
            `[${restoreId}] Cannot send error response - headers already sent`
          );
        }
      });

      restore.on('exit', async (code) => {
        const pgRestoreDuration = Date.now() - pgRestoreStart;
        logger.info(`[${restoreId}] pg_restore process exited`, {
          exitCode: code,
          duration: `${pgRestoreDuration}ms`,
          durationSeconds: (pgRestoreDuration / 1000).toFixed(2),
        });

        fs.unlink(tmpFile, () => {});

        if (code === 0) {
          // Clear all sessions after restore using direct SQL
          try {
            const sessionClearStart = Date.now();
            const { pool } = deps;
            await pool.query('DELETE FROM session');
            logger.info(`[${restoreId}] All sessions cleared`, {
              duration: `${Date.now() - sessionClearStart}ms`,
            });
          } catch (err) {
            logger.error(
              `[${restoreId}] Error clearing sessions after restore:`,
              err
            );
          }

          const totalDuration = Date.now() - restoreStartTime;
          logger.info(`[${restoreId}] Sending success response to client`, {
            totalDuration: `${totalDuration}ms`,
            totalSeconds: (totalDuration / 1000).toFixed(2),
            responseHeadersSent: res.headersSent,
          });

          if (!res.headersSent) {
            res.json({
              success: true,
              message:
                'Database restored successfully. Server will restart in 3 seconds...',
            });
            logger.info(
              `[${restoreId}] Success response sent, headers now sent: ${res.headersSent}`
            );
          } else {
            logger.error(
              `[${restoreId}] CRITICAL: Cannot send response - headers already sent!`
            );
          }

          // Schedule server restart to clear prepared statement cache
          logger.info(
            `[${restoreId}] Scheduling server restart in 3 seconds...`
          );
          setTimeout(() => {
            logger.info(`[${restoreId}] Restarting server now...`);
            process.exit(0); // Exit cleanly, Docker/nodemon will restart
          }, 3000);
        } else {
          const totalDuration = Date.now() - restoreStartTime;
          logger.error(`[${restoreId}] pg_restore failed`, {
            exitCode: code,
            totalDuration: `${totalDuration}ms`,
            stderrSample: stderrData.slice(-500), // Last 500 chars of stderr
          });

          if (!res.headersSent) {
            res.status(500).json({ error: 'Error restoring database' });
          } else {
            logger.error(
              `[${restoreId}] Cannot send error response - headers already sent`
            );
          }
        }

        logger.info(
          `[${restoreId}] === DATABASE RESTORE COMPLETED (exit code: ${code}) ===`
        );
      });

      // Log if the connection closes unexpectedly
      req.on('close', () => {
        const elapsed = Date.now() - restoreStartTime;
        logger.warn(`[${restoreId}] Client connection closed`, {
          elapsed: `${elapsed}ms`,
          finished: req.complete,
        });
      });

      res.on('finish', () => {
        const elapsed = Date.now() - restoreStartTime;
        logger.info(`[${restoreId}] Response finished event fired`, {
          elapsed: `${elapsed}ms`,
          statusCode: res.statusCode,
        });
      });

      res.on('close', () => {
        const elapsed = Date.now() - restoreStartTime;
        logger.warn(`[${restoreId}] Response connection closed`, {
          elapsed: `${elapsed}ms`,
          finished: res.writableEnded,
        });
      });
    }
  );

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

  // Admin stats endpoint
  app.get('/api/admin/stats', ensureAuth, ensureAdmin, async (req, res) => {
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      // Parallel fetch of all independent data
      const [allUsers, allLists, userListCountsResult, adminStatsResult] =
        await Promise.all([
          usersAsync.find({}),
          listsAsync.find({}),
          pool.query(
            'SELECT user_id, COUNT(*) as list_count FROM lists GROUP BY user_id'
          ),
          pool.query(
            `
            WITH album_genres AS (
              SELECT DISTINCT li.album_id, li.genre_1, li.genre_2 
              FROM list_items li
            ),
            unique_albums AS (
              SELECT COUNT(DISTINCT album_id) as total 
              FROM album_genres 
              WHERE album_id IS NOT NULL AND album_id != ''
            ),
            active_users AS (
              SELECT COUNT(DISTINCT user_id) as count FROM lists WHERE updated_at >= $1
            )
            SELECT 
              (SELECT total FROM unique_albums) as total_albums,
              (SELECT count FROM active_users) as active_users
          `,
            [sevenDaysAgo]
          ),
        ]);

      // Build Map for O(1) list count lookup
      const listCountMap = new Map(
        userListCountsResult.rows.map((r) => [
          r.user_id,
          parseInt(r.list_count, 10),
        ])
      );

      const usersWithCounts = allUsers.map((user) => ({
        _id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        listCount: listCountMap.get(user._id) || 0,
        lastActivity: user.lastActivity,
        createdAt: user.createdAt,
      }));

      // Extract stats from aggregate query
      const aggregateStats = adminStatsResult.rows[0] || {};
      const totalAlbums = parseInt(aggregateStats.total_albums, 10) || 0;
      const activeUsers = parseInt(aggregateStats.active_users, 10) || 0;

      res.json({
        totalUsers: allUsers.length,
        totalLists: allLists.length,
        totalAlbums,
        adminUsers: allUsers.filter((u) => u.role === 'admin').length,
        activeUsers,
        users: usersWithCounts,
      });
    } catch (error) {
      logger.error('Error fetching admin stats', { error: error.message });
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });

  // ============ ADMIN EVENTS API ============
  // Core event system for admin actions (works with or without Telegram)

  const { createAdminEventService } = require('../utils/admin-events');
  const { pool } = deps;

  // Create admin event service instance
  const adminEventService = createAdminEventService({ pool, logger });

  // ============ ACCOUNT APPROVAL ACTION HANDLERS ============
  // Register handlers for account_approval events (approve/reject new registrations)

  adminEventService.registerActionHandler(
    'account_approval',
    'approve',
    async (eventData, adminUser) => {
      const { userId, username } = eventData;

      if (!userId) {
        return { success: false, message: 'Missing user ID in event data' };
      }

      try {
        // Update user's approval status to 'approved'
        const result = await usersAsync.update(
          { _id: userId },
          { $set: { approvalStatus: 'approved', updatedAt: new Date() } }
        );

        if (result === 0) {
          return { success: false, message: 'User not found' };
        }

        logger.info(`User registration approved: ${username}`, {
          userId,
          approvedBy: adminUser.username,
        });

        return {
          success: true,
          message: `Approved registration for ${username}`,
        };
      } catch (err) {
        logger.error('Error approving user registration:', err);
        return { success: false, message: 'Database error' };
      }
    }
  );

  adminEventService.registerActionHandler(
    'account_approval',
    'reject',
    async (eventData, adminUser) => {
      const { userId, username } = eventData;

      if (!userId) {
        return { success: false, message: 'Missing user ID in event data' };
      }

      try {
        // Update user's approval status to 'rejected' (keep for audit trail)
        const result = await usersAsync.update(
          { _id: userId },
          { $set: { approvalStatus: 'rejected', updatedAt: new Date() } }
        );

        if (result === 0) {
          return { success: false, message: 'User not found' };
        }

        logger.info(`User registration rejected: ${username}`, {
          userId,
          rejectedBy: adminUser.username,
        });

        return {
          success: true,
          message: `Rejected registration for ${username}`,
        };
      } catch (err) {
        logger.error('Error rejecting user registration:', err);
        return { success: false, message: 'Database error' };
      }
    }
  );

  // Get pending events
  app.get('/api/admin/events', ensureAuth, ensureAdmin, async (req, res) => {
    try {
      const { type, priority, limit, offset } = req.query;
      const result = await adminEventService.getPendingEvents({
        type,
        priority,
        limit: limit ? parseInt(limit, 10) : 50,
        offset: offset ? parseInt(offset, 10) : 0,
      });
      res.json(result);
    } catch (error) {
      logger.error('Error fetching admin events', { error: error.message });
      res.status(500).json({ error: 'Failed to fetch events' });
    }
  });

  // Get event history
  app.get(
    '/api/admin/events/history',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const { type, limit, offset } = req.query;
        const result = await adminEventService.getEventHistory({
          type,
          limit: limit ? parseInt(limit, 10) : 50,
          offset: offset ? parseInt(offset, 10) : 0,
        });
        res.json(result);
      } catch (error) {
        logger.error('Error fetching event history', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch event history' });
      }
    }
  );

  // Get pending event counts (for dashboard badge)
  app.get(
    '/api/admin/events/counts',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const counts = await adminEventService.getPendingCountsByPriority();
        res.json(counts);
      } catch (error) {
        logger.error('Error fetching event counts', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch counts' });
      }
    }
  );

  // Get single event by ID
  app.get(
    '/api/admin/events/:eventId',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const event = await adminEventService.getEventById(req.params.eventId);
        if (!event) {
          return res.status(404).json({ error: 'Event not found' });
        }
        res.json(event);
      } catch (error) {
        logger.error('Error fetching event', {
          error: error.message,
          eventId: req.params.eventId,
        });
        res.status(500).json({ error: 'Failed to fetch event' });
      }
    }
  );

  // Execute action on event
  app.post(
    '/api/admin/events/:eventId/action/:action',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const { eventId, action } = req.params;
        const result = await adminEventService.executeAction(
          eventId,
          action,
          req.user,
          'web'
        );

        if (!result.success) {
          return res.status(400).json({ error: result.message });
        }

        res.json({
          success: true,
          message: result.message,
          event: result.event,
        });
      } catch (error) {
        logger.error('Error executing event action', {
          error: error.message,
          eventId: req.params.eventId,
          action: req.params.action,
        });
        res.status(500).json({ error: 'Failed to execute action' });
      }
    }
  );

  // Get available actions for an event type
  app.get(
    '/api/admin/events/actions/:eventType',
    ensureAuth,
    ensureAdmin,
    (req, res) => {
      const actions = adminEventService.getAvailableActions(
        req.params.eventType
      );
      res.json({ actions });
    }
  );

  // Expose admin event service for use by other modules
  app.locals.adminEventService = adminEventService;

  // ============ TELEGRAM SETUP API ============
  // Configuration endpoints for Telegram notifications

  const { createTelegramNotifier } = require('../utils/telegram');

  // Create telegram notifier instance
  const telegramNotifier = createTelegramNotifier({ pool, logger });

  // Wire up telegram to admin events service
  adminEventService.setTelegramNotifier(telegramNotifier);

  // Expose telegram notifier for use by other modules
  app.locals.telegramNotifier = telegramNotifier;

  // Get current Telegram configuration status
  app.get(
    '/api/admin/telegram/status',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const config = await telegramNotifier.getConfig();
        if (!config) {
          return res.json({ configured: false });
        }

        res.json({
          configured: true,
          enabled: config.enabled,
          chatId: config.chatId,
          chatTitle: config.chatTitle,
          threadId: config.threadId,
          topicName: config.topicName,
          configuredAt: config.configuredAt,
        });
      } catch (error) {
        logger.error('Error getting Telegram status', { error: error.message });
        res.status(500).json({ error: 'Failed to get status' });
      }
    }
  );

  // Validate bot token
  app.post(
    '/api/admin/telegram/validate-token',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const { token } = req.body;
        if (!token) {
          return res.status(400).json({ error: 'Token is required' });
        }

        const result = await telegramNotifier.validateToken(token);
        res.json(result);
      } catch (error) {
        logger.error('Error validating Telegram token', {
          error: error.message,
        });
        res.status(500).json({ error: 'Failed to validate token' });
      }
    }
  );

  // Detect groups the bot has been added to
  app.post(
    '/api/admin/telegram/detect-groups',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const { token } = req.body;
        if (!token) {
          return res.status(400).json({ error: 'Token is required' });
        }

        const groups = await telegramNotifier.detectGroups(token);
        res.json({ groups });
      } catch (error) {
        logger.error('Error detecting Telegram groups', {
          error: error.message,
        });
        res.status(500).json({ error: 'Failed to detect groups' });
      }
    }
  );

  // Get group info (check if forum, get topics)
  app.post(
    '/api/admin/telegram/group-info',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const { token, chatId } = req.body;
        if (!token || !chatId) {
          return res
            .status(400)
            .json({ error: 'Token and chatId are required' });
        }

        const info = await telegramNotifier.getChatInfo(token, chatId);
        res.json(info);
      } catch (error) {
        logger.error('Error getting Telegram group info', {
          error: error.message,
        });
        res.status(500).json({ error: 'Failed to get group info' });
      }
    }
  );

  // Save Telegram configuration
  app.post(
    '/api/admin/telegram/save-config',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const { botToken, chatId, threadId, chatTitle, topicName } = req.body;

        if (!botToken || !chatId) {
          return res
            .status(400)
            .json({ error: 'Bot token and chat ID are required' });
        }

        const config = await telegramNotifier.saveConfig({
          botToken,
          chatId,
          threadId: threadId || null,
          chatTitle: chatTitle || 'Admin Group',
          topicName: topicName || null,
          configuredBy: req.user._id,
        });

        logger.info('Telegram configured', {
          adminUsername: req.user.username,
          adminId: req.user._id,
        });

        res.json({
          success: true,
          config: {
            chatId: config.chat_id,
            chatTitle: config.chat_title,
            threadId: config.thread_id,
            topicName: config.topic_name,
            enabled: config.enabled,
          },
        });
      } catch (error) {
        logger.error('Error saving Telegram config', {
          error: error.message,
          adminId: req.user._id,
        });
        res.status(500).json({ error: 'Failed to save configuration' });
      }
    }
  );

  // Send test message (for saved config)
  app.post(
    '/api/admin/telegram/test',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const result = await telegramNotifier.sendTestMessage();

        if (!result.success) {
          return res.status(400).json({ error: result.error });
        }

        res.json({ success: true, messageId: result.messageId });
      } catch (error) {
        logger.error('Error sending test message', { error: error.message });
        res.status(500).json({ error: 'Failed to send test message' });
      }
    }
  );

  // Send test message preview (before config is saved, using provided credentials)
  app.post(
    '/api/admin/telegram/test-preview',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const { token, chatId, threadId } = req.body;

        if (!token || !chatId) {
          return res
            .status(400)
            .json({ error: 'Token and chatId are required' });
        }

        const result = await telegramNotifier.sendTestMessageWithCredentials(
          token,
          chatId,
          threadId
        );

        if (!result.success) {
          return res.status(400).json({ error: result.error });
        }

        res.json({ success: true, messageId: result.messageId });
      } catch (error) {
        logger.error('Error sending test preview message', {
          error: error.message,
        });
        res.status(500).json({ error: 'Failed to send test message' });
      }
    }
  );

  // Disconnect Telegram
  app.delete(
    '/api/admin/telegram/disconnect',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        await telegramNotifier.disconnect();
        logger.info('Telegram disconnected', {
          adminUsername: req.user.username,
          adminId: req.user._id,
        });
        res.json({ success: true });
      } catch (error) {
        logger.error('Error disconnecting Telegram', {
          error: error.message,
          adminId: req.user._id,
        });
        res.status(500).json({ error: 'Failed to disconnect' });
      }
    }
  );

  // Link current admin to their Telegram account
  app.post(
    '/api/admin/telegram/link-account',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const { telegramUserId, telegramUsername } = req.body;

        if (!telegramUserId) {
          return res
            .status(400)
            .json({ error: 'Telegram user ID is required' });
        }

        const success = await telegramNotifier.linkAdmin(
          telegramUserId,
          telegramUsername,
          req.user._id
        );

        if (!success) {
          return res.status(500).json({ error: 'Failed to link account' });
        }

        res.json({ success: true });
      } catch (error) {
        logger.error('Error linking Telegram account', {
          error: error.message,
          userId: req.user._id,
        });
        res.status(500).json({ error: 'Failed to link account' });
      }
    }
  );

  // ============ ALBUM SUMMARY FETCH API ============
  // Batch fetch album summaries from Claude API

  const { createAlbumSummaryService } = require('../utils/album-summary');
  const { responseCache } = require('../middleware/response-cache');

  // Create album summary service instance
  const albumSummaryService = createAlbumSummaryService({
    pool,
    logger,
    responseCache,
    broadcast: app.locals.broadcast,
  });

  // Expose service for use by other modules (e.g., api.js for new album triggers)
  app.locals.albumSummaryService = albumSummaryService;

  // Get album summary statistics
  app.get(
    '/api/admin/album-summaries/stats',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const stats = await albumSummaryService.getStats();
        const batchStatus = albumSummaryService.getBatchStatus();
        res.json({ stats, batchStatus });
      } catch (error) {
        logger.error('Error fetching album summary stats', {
          error: error.message,
        });
        res.status(500).json({ error: 'Failed to fetch stats' });
      }
    }
  );

  // Get batch job status
  app.get(
    '/api/admin/album-summaries/status',
    ensureAuth,
    ensureAdmin,
    (req, res) => {
      const status = albumSummaryService.getBatchStatus();
      res.json({ status });
    }
  );

  // Start batch fetch job
  app.post(
    '/api/admin/album-summaries/fetch',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const { includeRetries, regenerateAll } = req.body;

        // Check if already running
        const currentStatus = albumSummaryService.getBatchStatus();
        if (currentStatus?.running) {
          return res.status(409).json({
            error: 'Batch job already running',
            status: currentStatus,
          });
        }

        logger.info('Admin started album summary batch fetch', {
          adminUsername: req.user.username,
          adminId: req.user._id,
          includeRetries: !!includeRetries,
          regenerateAll: !!regenerateAll,
        });

        await albumSummaryService.startBatchFetch({
          includeRetries,
          regenerateAll,
        });

        res.json({
          success: true,
          message: 'Batch fetch started',
          status: albumSummaryService.getBatchStatus(),
        });
      } catch (error) {
        logger.error('Error starting album summary batch fetch', {
          error: error.message,
          adminId: req.user._id,
        });
        res.status(500).json({ error: error.message });
      }
    }
  );

  // Stop batch fetch job
  app.post(
    '/api/admin/album-summaries/stop',
    ensureAuth,
    ensureAdmin,
    (req, res) => {
      const stopped = albumSummaryService.stopBatchFetch();

      logger.info('Admin stopped album summary batch fetch', {
        adminUsername: req.user.username,
        adminId: req.user._id,
        wasStopped: stopped,
      });

      res.json({
        success: true,
        stopped,
        status: albumSummaryService.getBatchStatus(),
      });
    }
  );

  // Fetch summary for a single album (for testing/manual trigger)
  app.post(
    '/api/admin/album-summaries/fetch-single',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const { albumId } = req.body;

        if (!albumId) {
          return res.status(400).json({ error: 'albumId is required' });
        }

        const result = await albumSummaryService.fetchAndStoreSummary(albumId);

        res.json({
          success: result.success,
          hasSummary: result.hasSummary,
          error: result.error,
        });
      } catch (error) {
        logger.error('Error fetching single album summary', {
          error: error.message,
          albumId: req.body?.albumId,
        });
        res.status(500).json({ error: error.message });
      }
    }
  );
};
