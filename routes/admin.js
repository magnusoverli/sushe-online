// Import fuzzy matching utilities for duplicate scanning
const { findPotentialDuplicates } = require('../utils/fuzzy-match');

// Import aggregate audit utilities for data integrity checks
const { createAggregateAudit } = require('../utils/aggregate-audit');

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
      // Fire-and-forget async update with error logging
      usersAsync
        .update(
          { _id: req.user._id },
          { $set: { spotifyAuth: token, updatedAt: new Date() } }
        )
        .catch((err) =>
          logger.error('Spotify auth update error', {
            error: err.message,
            userId: req.user._id,
          })
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
    // Fire-and-forget async update with error logging
    usersAsync
      .update(
        { _id: req.user._id },
        { $unset: { spotifyAuth: true }, $set: { updatedAt: new Date() } }
      )
      .catch((err) =>
        logger.error('Spotify disconnect error', {
          error: err.message,
          userId: req.user._id,
        })
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
  app.post('/admin/make-admin', ensureAuth, ensureAdmin, async (req, res) => {
    const { userId } = req.body;

    try {
      const numUpdated = await usersAsync.update(
        { _id: userId },
        { $set: { role: 'admin', adminGrantedAt: new Date() } }
      );

      if (numUpdated === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      logger.info(
        `Admin ${req.user.email} granted admin to user ID: ${userId}`
      );
      res.json({ success: true });
    } catch (err) {
      logger.error('Error granting admin', {
        error: err.message,
        targetUserId: userId,
        adminId: req.user._id,
      });
      return res.status(500).json({ error: 'Error granting admin privileges' });
    }
  });

  // Admin: Revoke admin
  app.post('/admin/revoke-admin', ensureAuth, ensureAdmin, async (req, res) => {
    const { userId } = req.body;

    // Prevent revoking your own admin rights
    if (userId === req.user._id) {
      return res
        .status(400)
        .json({ error: 'Cannot revoke your own admin privileges' });
    }

    try {
      const numUpdated = await usersAsync.update(
        { _id: userId },
        { $unset: { role: true, adminGrantedAt: true } }
      );

      if (numUpdated === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      logger.info(
        `Admin ${req.user.email} revoked admin from user ID: ${userId}`
      );
      res.json({ success: true });
    } catch (err) {
      logger.error('Error revoking admin', {
        error: err.message,
        targetUserId: userId,
        adminId: req.user._id,
      });
      return res.status(500).json({ error: 'Error revoking admin privileges' });
    }
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
    async (req, res) => {
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

      // Pre-restore: Drop all tables in public schema with CASCADE
      // This prevents foreign key constraint errors when restoring older backups
      // that don't have newer tables (e.g., album_distinct_pairs)
      try {
        logger.info(
          `[${restoreId}] Dropping all tables before restore to avoid FK conflicts`
        );
        const { pool } = deps;

        // Get all table names in public schema
        const tablesResult = await pool.query(`
          SELECT tablename FROM pg_tables 
          WHERE schemaname = 'public'
        `);

        if (tablesResult.rows.length > 0) {
          const tableNames = tablesResult.rows
            .map((r) => `"${r.tablename}"`)
            .join(', ');
          await pool.query(`DROP TABLE IF EXISTS ${tableNames} CASCADE`);
          logger.info(
            `[${restoreId}] Dropped ${tablesResult.rows.length} tables`
          );
        }

        // Also drop the migration tracking table so migrations re-run
        await pool.query('DROP TABLE IF EXISTS migrations CASCADE');
        logger.info(`[${restoreId}] Dropped migrations table`);
      } catch (dropErr) {
        logger.warn(
          `[${restoreId}] Pre-restore table drop failed (non-fatal)`,
          {
            error: dropErr.message,
          }
        );
        // Continue with restore anyway - pg_restore --clean may still work
      }

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

            // In development with nodemon, touch a file to trigger restart
            // In production, Docker's restart policy will handle the exit
            if (process.env.NODE_ENV === 'development') {
              const fs = require('fs');
              const path = require('path');
              const triggerFile = path.join(__dirname, '../.restart-trigger');
              try {
                // Touch the file to trigger nodemon's file watcher
                const now = new Date();
                fs.utimesSync(triggerFile, now, now);
                logger.info(
                  `[${restoreId}] Triggered nodemon restart via file touch`
                );
              } catch (_err) {
                // File doesn't exist, create it
                try {
                  fs.writeFileSync(triggerFile, String(Date.now()));
                  logger.info(
                    `[${restoreId}] Created restart trigger file for nodemon`
                  );
                } catch (createErr) {
                  logger.warn(
                    `[${restoreId}] Could not create restart trigger file`,
                    { error: createErr.message }
                  );
                }
              }
            }

            // Exit the process - Docker will restart the container
            // Use exit code 1 to force restart even in dev mode
            process.exit(1);
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

  // Public stats endpoint (accessible to all authenticated users)
  app.get('/api/stats', ensureAuth, async (req, res) => {
    try {
      const { pool } = deps;
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      // Parallel fetch of aggregate stats only (no user details)
      const [allUsers, allLists, adminStatsResult] = await Promise.all([
        usersAsync.find({}),
        listsAsync.find({}),
        pool.query(
          `
            WITH unique_albums AS (
              SELECT COUNT(DISTINCT album_id) as total 
              FROM list_items 
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
      });
    } catch (error) {
      logger.error('Error fetching public stats', { error: error.message });
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
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
              SELECT DISTINCT li.album_id, a.genre_1, a.genre_2 
              FROM list_items li
              LEFT JOIN albums a ON li.album_id = a.album_id
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

  // ============ TELEGRAM RECOMMENDATIONS CONFIG ============

  // Get recommendations Telegram status
  app.get(
    '/api/admin/telegram/recommendations/status',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const config = await telegramNotifier.getConfig();
        const threads = await telegramNotifier.getRecommendationThreads();

        res.json({
          configured: config?.enabled || false,
          recommendationsEnabled: config?.recommendationsEnabled || false,
          chatTitle: config?.chatTitle || null,
          threads,
        });
      } catch (error) {
        logger.error('Error getting recommendations Telegram status', {
          error: error.message,
        });
        res.status(500).json({ error: 'Failed to get status' });
      }
    }
  );

  // Enable/disable recommendations notifications
  app.post(
    '/api/admin/telegram/recommendations/toggle',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const { enabled } = req.body;

        // Check if base Telegram is configured
        const config = await telegramNotifier.getConfig();
        if (!config?.enabled) {
          return res.status(400).json({
            error: 'Telegram must be configured for admin events first',
          });
        }

        await telegramNotifier.setRecommendationsEnabled(enabled);

        logger.info('Admin action', {
          action: enabled
            ? 'enable_telegram_recommendations'
            : 'disable_telegram_recommendations',
          adminId: req.user._id,
          adminEmail: req.user.email,
          ip: req.ip,
        });

        res.json({ success: true, enabled });
      } catch (error) {
        logger.error('Error toggling recommendations Telegram', {
          error: error.message,
        });
        res.status(500).json({ error: 'Failed to toggle setting' });
      }
    }
  );

  // Send test recommendation notification
  app.post(
    '/api/admin/telegram/recommendations/test',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const config = await telegramNotifier.getConfig();
        if (!config?.enabled || !config?.recommendationsEnabled) {
          return res.status(400).json({
            error: 'Recommendations notifications are not enabled',
          });
        }

        const testYear = new Date().getFullYear();
        const result = await telegramNotifier.sendRecommendationNotification(
          {
            artist: 'Test Artist',
            album: 'Test Album',
            album_id: 'test-album-id',
            release_date: new Date().toISOString(),
            year: testYear,
            recommended_by: req.user.username,
            reasoning:
              'This is a test recommendation to verify the Telegram integration is working correctly.',
          },
          null // No cover for test
        );

        if (!result.success) {
          return res.status(500).json({ error: result.error });
        }

        res.json({ success: true, year: testYear });
      } catch (error) {
        logger.error('Error sending test recommendation notification', {
          error: error.message,
        });
        res.status(500).json({ error: 'Failed to send test notification' });
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

  // ============ DUPLICATE SCANNING ============

  // Admin: Scan for potential duplicate albums in the database
  app.get(
    '/admin/api/scan-duplicates',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      // Parse threshold from query param, default to 0.15 (high sensitivity)
      const threshold = Math.max(
        0.03,
        Math.min(0.5, parseFloat(req.query.threshold) || 0.15)
      );

      try {
        logger.info('Starting duplicate album scan', {
          adminId: req.user?._id,
          threshold,
        });

        // Get all albums from database with extended fields for diff comparison
        // Exclude albums without album_id (data integrity issue)
        const albumsResult = await pool.query(`
          SELECT 
            album_id, 
            artist, 
            album, 
            release_date,
            genre_1,
            genre_2,
            COALESCE(jsonb_array_length(tracks), 0) as track_count,
            cover_image IS NOT NULL as has_cover
          FROM albums
          WHERE artist IS NOT NULL AND artist != ''
            AND album IS NOT NULL AND album != ''
            AND album_id IS NOT NULL
          ORDER BY artist, album
        `);

        // Get excluded pairs from album_distinct_pairs table
        const excludedPairsResult = await pool.query(`
          SELECT album_id_1, album_id_2 FROM album_distinct_pairs
        `);

        const excludePairs = new Set();
        for (const row of excludedPairsResult.rows) {
          excludePairs.add(`${row.album_id_1}::${row.album_id_2}`);
          excludePairs.add(`${row.album_id_2}::${row.album_id_1}`);
        }

        const albums = albumsResult.rows.map((row) => ({
          album_id: row.album_id,
          artist: row.artist,
          album: row.album,
          release_date: row.release_date || null,
          genre_1: row.genre_1 || null,
          genre_2: row.genre_2 || null,
          trackCount: row.track_count > 0 ? row.track_count : null,
          hasCover: row.has_cover,
        }));

        // Find all potential duplicate pairs
        const duplicatePairs = [];
        const processedPairs = new Set();

        for (let i = 0; i < albums.length; i++) {
          const album = albums[i];
          const candidates = albums.slice(i + 1); // Only check forward to avoid duplicate pairs

          const matches = findPotentialDuplicates(album, candidates, {
            threshold, // Configurable threshold - human reviews all matches
            maxResults: 10,
            excludePairs,
          });

          for (const match of matches) {
            const pairKey = [album.album_id, match.candidate.album_id]
              .sort()
              .join('::');
            if (!processedPairs.has(pairKey)) {
              processedPairs.add(pairKey);
              duplicatePairs.push({
                album1: album,
                album2: match.candidate,
                confidence: Math.round(match.confidence * 100),
                artistScore: Math.round(match.artistScore.score * 100),
                albumScore: Math.round(match.albumScore.score * 100),
              });
            }
          }
        }

        // Sort by confidence (highest first)
        duplicatePairs.sort((a, b) => b.confidence - a.confidence);

        logger.info('Duplicate scan completed', {
          totalAlbums: albums.length,
          potentialDuplicates: duplicatePairs.length,
          excludedPairs: excludePairs.size / 2,
        });

        res.json({
          totalAlbums: albums.length,
          potentialDuplicates: duplicatePairs.length,
          excludedPairs: excludePairs.size / 2,
          pairs: duplicatePairs.slice(0, 100), // Limit to top 100 for performance
        });
      } catch (error) {
        logger.error('Error scanning for duplicates', {
          error: error.message,
        });
        res.status(500).json({ error: error.message });
      }
    }
  );

  // Admin: Merge two albums (keep one, update references, delete other)
  // Smart merges metadata from deleted album into kept album before deleting
  app.post(
    '/admin/api/merge-albums',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const { keepAlbumId, deleteAlbumId } = req.body;

        if (!keepAlbumId || !deleteAlbumId) {
          return res
            .status(400)
            .json({ error: 'keepAlbumId and deleteAlbumId are required' });
        }

        if (keepAlbumId === deleteAlbumId) {
          return res
            .status(400)
            .json({ error: 'Cannot merge album with itself' });
        }

        logger.info('Merging albums', {
          keepAlbumId,
          deleteAlbumId,
          adminId: req.user?._id,
        });

        // Fetch both albums to merge metadata
        const albumsResult = await pool.query(
          `SELECT album_id, artist, album, release_date, country, 
                  genre_1, genre_2, tracks, cover_image, cover_image_format,
                  summary, summary_source, summary_fetched_at
           FROM albums WHERE album_id = $1 OR album_id = $2`,
          [keepAlbumId, deleteAlbumId]
        );

        const keepAlbum = albumsResult.rows.find(
          (a) => a.album_id === keepAlbumId
        );
        const deleteAlbum = albumsResult.rows.find(
          (a) => a.album_id === deleteAlbumId
        );

        if (!keepAlbum) {
          return res.status(404).json({ error: 'Keep album not found' });
        }

        // Smart merge: fill in missing fields from the album being deleted
        const fieldsToMerge = [];
        const values = [keepAlbumId];
        let paramIndex = 2;

        // Helper to check if we should use the value from deleteAlbum
        const shouldMerge = (keepVal, deleteVal) => {
          if (!deleteAlbum) return false;
          // Use deleteVal if keepVal is empty/null and deleteVal has content
          const keepEmpty =
            keepVal === null || keepVal === undefined || keepVal === '';
          const deleteHasValue =
            deleteVal !== null && deleteVal !== undefined && deleteVal !== '';
          return keepEmpty && deleteHasValue;
        };

        // Text fields
        if (shouldMerge(keepAlbum.release_date, deleteAlbum?.release_date)) {
          fieldsToMerge.push(`release_date = $${paramIndex++}`);
          values.push(deleteAlbum.release_date);
        }
        if (shouldMerge(keepAlbum.country, deleteAlbum?.country)) {
          fieldsToMerge.push(`country = $${paramIndex++}`);
          values.push(deleteAlbum.country);
        }
        if (shouldMerge(keepAlbum.genre_1, deleteAlbum?.genre_1)) {
          fieldsToMerge.push(`genre_1 = $${paramIndex++}`);
          values.push(deleteAlbum.genre_1);
        }
        if (shouldMerge(keepAlbum.genre_2, deleteAlbum?.genre_2)) {
          fieldsToMerge.push(`genre_2 = $${paramIndex++}`);
          values.push(deleteAlbum.genre_2);
        }

        // Tracks (if keep has none and delete has some)
        if (
          deleteAlbum?.tracks &&
          Array.isArray(deleteAlbum.tracks) &&
          deleteAlbum.tracks.length > 0
        ) {
          const keepTracks = keepAlbum.tracks;
          const keepHasTracks =
            keepTracks && Array.isArray(keepTracks) && keepTracks.length > 0;
          if (!keepHasTracks) {
            fieldsToMerge.push(`tracks = $${paramIndex++}`);
            values.push(JSON.stringify(deleteAlbum.tracks));
          }
        }

        // Cover image: prefer larger (higher quality)
        if (deleteAlbum?.cover_image && !keepAlbum.cover_image) {
          fieldsToMerge.push(`cover_image = $${paramIndex++}`);
          values.push(deleteAlbum.cover_image);
          fieldsToMerge.push(`cover_image_format = $${paramIndex++}`);
          values.push(deleteAlbum.cover_image_format || 'jpeg');
        } else if (deleteAlbum?.cover_image && keepAlbum.cover_image) {
          // Both have covers - use larger one
          const deleteSize = deleteAlbum.cover_image.length;
          const keepSize = keepAlbum.cover_image.length;
          if (deleteSize > keepSize) {
            fieldsToMerge.push(`cover_image = $${paramIndex++}`);
            values.push(deleteAlbum.cover_image);
            fieldsToMerge.push(`cover_image_format = $${paramIndex++}`);
            values.push(deleteAlbum.cover_image_format || 'jpeg');
          }
        }

        // Summary: prefer existing, but fill if missing
        if (shouldMerge(keepAlbum.summary, deleteAlbum?.summary)) {
          fieldsToMerge.push(`summary = $${paramIndex++}`);
          values.push(deleteAlbum.summary);
          fieldsToMerge.push(`summary_source = $${paramIndex++}`);
          values.push(deleteAlbum.summary_source);
          fieldsToMerge.push(`summary_fetched_at = $${paramIndex++}`);
          values.push(deleteAlbum.summary_fetched_at);
        }

        // Update the kept album if we have fields to merge
        let metadataMerged = false;
        if (fieldsToMerge.length > 0) {
          fieldsToMerge.push(`updated_at = NOW()`);
          await pool.query(
            `UPDATE albums SET ${fieldsToMerge.join(', ')} WHERE album_id = $1`,
            values
          );
          metadataMerged = true;
          logger.info('Merged metadata into kept album', {
            keepAlbumId,
            fieldsMerged: fieldsToMerge.length - 1, // -1 for updated_at
          });
        }

        // Update all list_items to point to the kept album
        const updateResult = await pool.query(
          `UPDATE list_items SET album_id = $1 WHERE album_id = $2`,
          [keepAlbumId, deleteAlbumId]
        );

        // Delete the duplicate album
        const deleteResult = await pool.query(
          `DELETE FROM albums WHERE album_id = $1`,
          [deleteAlbumId]
        );

        // Also clean up any distinct pairs involving the deleted album
        await pool.query(
          `DELETE FROM album_distinct_pairs WHERE album_id_1 = $1 OR album_id_2 = $1`,
          [deleteAlbumId]
        );

        logger.info('Albums merged successfully', {
          keepAlbumId,
          deleteAlbumId,
          listItemsUpdated: updateResult.rowCount,
          albumsDeleted: deleteResult.rowCount,
          metadataMerged,
        });

        res.json({
          success: true,
          listItemsUpdated: updateResult.rowCount,
          albumsDeleted: deleteResult.rowCount,
          metadataMerged,
        });
      } catch (error) {
        logger.error('Error merging albums', {
          error: error.message,
          keepAlbumId: req.body?.keepAlbumId,
          deleteAlbumId: req.body?.deleteAlbumId,
        });
        res.status(500).json({ error: error.message });
      }
    }
  );

  // ============ AGGREGATE LIST AUDIT ENDPOINTS ============

  // Create aggregate audit instance
  const aggregateAudit = createAggregateAudit({ pool: deps.pool, logger });

  /**
   * GET /api/admin/aggregate-audit/:year
   * Get audit report for a year's aggregate list
   * Shows albums with different album_ids that normalize to the same name
   */
  app.get(
    '/api/admin/aggregate-audit/:year',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const year = parseInt(req.params.year, 10);
        if (isNaN(year) || year < 1000 || year > 9999) {
          return res.status(400).json({ error: 'Invalid year' });
        }

        const report = await aggregateAudit.getAuditReport(year);
        res.json(report);
      } catch (error) {
        logger.error('Error running aggregate audit', {
          error: error.message,
          year: req.params.year,
        });
        res.status(500).json({ error: error.message });
      }
    }
  );

  /**
   * GET /api/admin/aggregate-audit/:year/preview
   * Preview what changes would be made to fix duplicates
   */
  app.get(
    '/api/admin/aggregate-audit/:year/preview',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const year = parseInt(req.params.year, 10);
        if (isNaN(year) || year < 1000 || year > 9999) {
          return res.status(400).json({ error: 'Invalid year' });
        }

        const preview = await aggregateAudit.previewFix(year);
        res.json(preview);
      } catch (error) {
        logger.error('Error previewing aggregate fix', {
          error: error.message,
          year: req.params.year,
        });
        res.status(500).json({ error: error.message });
      }
    }
  );

  /**
   * POST /api/admin/aggregate-audit/:year/fix
   * Execute the fix to normalize album_ids
   * Requires explicit confirmation in request body
   */
  app.post(
    '/api/admin/aggregate-audit/:year/fix',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const year = parseInt(req.params.year, 10);
        if (isNaN(year) || year < 1000 || year > 9999) {
          return res.status(400).json({ error: 'Invalid year' });
        }

        const { confirm, dryRun } = req.body;

        // Require explicit confirmation unless dry run
        if (!dryRun && confirm !== true) {
          return res.status(400).json({
            error: 'Confirmation required',
            message:
              'Set confirm: true in request body to execute the fix, or use dryRun: true to preview',
          });
        }

        const result = await aggregateAudit.executeFix(year, dryRun === true);

        logger.info('Aggregate audit fix executed', {
          year,
          dryRun: dryRun === true,
          changesApplied: result.changesApplied,
          adminId: req.user._id,
        });

        res.json(result);
      } catch (error) {
        logger.error('Error executing aggregate fix', {
          error: error.message,
          year: req.params.year,
        });
        res.status(500).json({ error: error.message });
      }
    }
  );

  /**
   * GET /api/admin/aggregate-audit/:year/diagnose
   * Diagnose normalization effectiveness for a year
   * Compares basic (lowercase+trim) vs sophisticated normalization
   * Shows albums that would be missed by basic normalization
   * and provides detailed overlap statistics
   */
  app.get(
    '/api/admin/aggregate-audit/:year/diagnose',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const year = parseInt(req.params.year, 10);
        if (isNaN(year) || year < 1000 || year > 9999) {
          return res.status(400).json({ error: 'Invalid year' });
        }

        const diagnostic = await aggregateAudit.diagnoseNormalization(year);
        res.json(diagnostic);
      } catch (error) {
        logger.error('Error running normalization diagnostic', {
          error: error.message,
          year: req.params.year,
        });
        res.status(500).json({ error: error.message });
      }
    }
  );

  // ============ MANUAL ALBUM RECONCILIATION ENDPOINTS ============

  /**
   * GET /api/admin/audit/manual-albums
   * Find manual albums that may match canonical albums
   * Returns list of manual albums with potential matches for admin review
   */
  app.get(
    '/api/admin/audit/manual-albums',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        // Parse threshold from query param, default to 0.15 (high sensitivity)
        const threshold = Math.max(
          0.03,
          Math.min(0.5, parseFloat(req.query.threshold) || 0.15)
        );
        const maxMatches = parseInt(req.query.maxMatches, 10) || 5;

        const result = await aggregateAudit.findManualAlbumsForReconciliation({
          threshold,
          maxMatchesPerAlbum: maxMatches,
        });

        res.json(result);
      } catch (error) {
        logger.error('Error finding manual albums for reconciliation', {
          error: error.message,
        });
        res.status(500).json({ error: error.message });
      }
    }
  );

  /**
   * POST /api/admin/audit/merge-album
   * Merge a manual album into a canonical album
   * Updates all list_items and optionally syncs metadata
   */
  app.post(
    '/api/admin/audit/merge-album',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const {
          manualAlbumId,
          canonicalAlbumId,
          syncMetadata = true,
        } = req.body;

        if (!manualAlbumId || !canonicalAlbumId) {
          return res.status(400).json({
            error: 'manualAlbumId and canonicalAlbumId are required',
          });
        }

        if (!manualAlbumId.startsWith('manual-')) {
          return res.status(400).json({
            error: 'manualAlbumId must be a manual album (manual-* prefix)',
          });
        }

        const result = await aggregateAudit.mergeManualAlbum(
          manualAlbumId,
          canonicalAlbumId,
          {
            syncMetadata,
            adminUserId: req.user._id,
          }
        );

        // Recompute aggregate lists for affected years
        if (result.affectedYears && result.affectedYears.length > 0) {
          const { createAggregateList } = require('../utils/aggregate-list');
          const aggregateList = createAggregateList({
            pool: deps.pool,
            logger,
          });

          const recomputeResults = [];
          for (const year of result.affectedYears) {
            try {
              await aggregateList.recompute(year);
              recomputeResults.push({ year, success: true });
              logger.info(`Recomputed aggregate list for ${year} after merge`);
            } catch (recomputeErr) {
              recomputeResults.push({
                year,
                success: false,
                error: recomputeErr.message,
              });
              logger.error(`Failed to recompute aggregate list for ${year}`, {
                error: recomputeErr.message,
              });
            }
          }
          result.recomputeResults = recomputeResults;
        }

        logger.info('Manual album merged', {
          manualAlbumId,
          canonicalAlbumId,
          updatedListItems: result.updatedListItems,
          affectedYears: result.affectedYears,
          adminId: req.user._id,
        });

        res.json(result);
      } catch (error) {
        logger.error('Error merging manual album', {
          error: error.message,
          manualAlbumId: req.body?.manualAlbumId,
          canonicalAlbumId: req.body?.canonicalAlbumId,
        });
        res.status(500).json({ error: error.message });
      }
    }
  );

  /**
   * POST /api/admin/audit/delete-orphaned-references
   * Delete orphaned album references from list_items
   * (albums that don't exist in albums table)
   */
  app.post(
    '/api/admin/audit/delete-orphaned-references',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const { albumId } = req.body;

        if (!albumId || !albumId.startsWith('manual-')) {
          return res.status(400).json({
            error: 'albumId must be a manual album (manual-* prefix)',
          });
        }

        logger.info('Deleting orphaned album references', {
          albumId,
          adminId: req.user._id,
        });

        // Verify the album doesn't exist in albums table
        const albumCheck = await deps.pool.query(
          'SELECT album_id FROM albums WHERE album_id = $1',
          [albumId]
        );

        if (albumCheck.rows.length > 0) {
          return res.status(400).json({
            error: 'Album exists in albums table - not orphaned',
          });
        }

        // Get affected lists before deletion
        const affectedResult = await deps.pool.query(
          `
          SELECT DISTINCT 
            l._id as list_id,
            l.name as list_name,
            l.year,
            u.username
          FROM list_items li
          JOIN lists l ON li.list_id = l._id
          JOIN users u ON l.user_id = u._id
          WHERE li.album_id = $1
        `,
          [albumId]
        );

        const affectedLists = affectedResult.rows;
        const affectedYears = [...new Set(affectedLists.map((l) => l.year))];

        // Delete the orphaned references
        const deleteResult = await deps.pool.query(
          'DELETE FROM list_items WHERE album_id = $1',
          [albumId]
        );

        const deletedCount = deleteResult.rowCount;

        // Log admin event
        await deps.pool.query(
          `
          INSERT INTO admin_events (event_type, event_data, created_by)
          VALUES ($1, $2, $3)
        `,
          [
            'orphaned_album_deleted',
            JSON.stringify({
              albumId,
              deletedListItems: deletedCount,
              affectedLists: affectedLists.map((l) => l.list_name),
              affectedYears,
            }),
            req.user._id,
          ]
        );

        // Recompute affected aggregate lists
        if (affectedYears.length > 0) {
          const { createAggregateList } = require('../utils/aggregate-list');
          const aggregateList = createAggregateList({
            pool: deps.pool,
            logger,
          });

          const recomputeResults = [];
          for (const year of affectedYears) {
            try {
              await aggregateList.recompute(year);
              recomputeResults.push({ year, success: true });
              logger.info(
                `Recomputed aggregate list for ${year} after orphan deletion`
              );
            } catch (recomputeErr) {
              recomputeResults.push({
                year,
                success: false,
                error: recomputeErr.message,
              });
              logger.error(`Failed to recompute aggregate list for ${year}`, {
                error: recomputeErr.message,
              });
            }
          }

          res.json({
            success: true,
            albumId,
            deletedListItems: deletedCount,
            affectedLists: affectedLists.map((l) => ({
              listId: l.list_id,
              listName: l.list_name,
              year: l.year,
              username: l.username,
            })),
            affectedYears,
            recomputeResults,
          });
        } else {
          res.json({
            success: true,
            albumId,
            deletedListItems: deletedCount,
            affectedLists: [],
            affectedYears: [],
          });
        }

        logger.info('Orphaned album references deleted', {
          albumId,
          deletedCount,
          affectedYears,
          adminId: req.user._id,
        });
      } catch (error) {
        logger.error('Error deleting orphaned references', {
          error: error.message,
        });
        res.status(500).json({ error: error.message });
      }
    }
  );

  // ============ IMAGE REFETCH ============

  const { createImageRefetchService } = require('../utils/image-refetch');
  const imageRefetchService = createImageRefetchService({
    pool: deps.pool,
    logger,
  });

  // Get image statistics
  app.get(
    '/api/admin/images/stats',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const stats = await imageRefetchService.getStats();
        const isRunning = imageRefetchService.isJobRunning();
        res.json({ stats, isRunning });
      } catch (error) {
        logger.error('Error fetching image stats', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch image stats' });
      }
    }
  );

  // Get image refetch job progress
  app.get('/api/admin/images/progress', ensureAuth, ensureAdmin, (req, res) => {
    const isRunning = imageRefetchService.isJobRunning();
    const progress = imageRefetchService.getProgress();
    res.json({ isRunning, progress });
  });

  // Start image refetch job
  app.post(
    '/api/admin/images/refetch',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        // Check if already running
        if (imageRefetchService.isJobRunning()) {
          return res.status(409).json({
            error: 'Image refetch job is already running',
          });
        }

        logger.info('Admin started image refetch job', {
          adminUsername: req.user.username,
          adminId: req.user._id,
        });

        // Start the job and wait for completion
        const summary = await imageRefetchService.refetchAllImages();

        res.json({
          success: true,
          summary,
        });
      } catch (error) {
        logger.error('Error during image refetch', {
          error: error.message,
          adminId: req.user._id,
        });
        res.status(500).json({ error: error.message });
      }
    }
  );

  // Stop image refetch job
  app.post('/api/admin/images/stop', ensureAuth, ensureAdmin, (req, res) => {
    const stopped = imageRefetchService.stopJob();

    logger.info('Admin stopped image refetch job', {
      adminUsername: req.user.username,
      adminId: req.user._id,
      wasStopped: stopped,
    });

    res.json({
      success: true,
      stopped,
    });
  });

  // ============ ALBUM RE-IDENTIFICATION ============

  // Helper: Simple rate-limited fetch for MusicBrainz (1 req/sec)
  const mbFetchWithDelay = async (url, headers) => {
    const response = await fetch(url, { headers });
    // MusicBrainz rate limit: wait 1 second between requests
    await new Promise((resolve) => setTimeout(resolve, 1100));
    return response;
  };

  // Helper: Sanitize search terms for MusicBrainz
  const sanitizeSearchTerm = (str = '') =>
    str
      .trim()
      .replace(/[\u2018\u2019'"`]/g, '')
      .replace(/[()[\]{}]/g, '')
      .replace(/[.,!?]/g, '')
      .replace(/\s{2,}/g, ' ');

  /**
   * Search for release group candidates on MusicBrainz
   * Returns a list of options for the user to choose from
   */
  app.post(
    '/api/admin/album/reidentify/search',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      const { artist, album, currentAlbumId } = req.body;

      if (!artist || !album) {
        return res.status(400).json({ error: 'artist and album are required' });
      }

      const headers = { 'User-Agent': 'SuSheBot/1.0 (kvlt.example.com)' };

      try {
        logger.info('Admin searching for album candidates', {
          adminUsername: req.user.username,
          artist,
          album,
        });

        const artistClean = sanitizeSearchTerm(artist);
        const albumClean = sanitizeSearchTerm(album);

        // Search for release groups
        const searchUrl =
          `https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(`release:${albumClean} AND artist:${artistClean}`)}` +
          `&fmt=json&limit=15`;

        const searchResp = await mbFetchWithDelay(searchUrl, headers);
        if (!searchResp.ok) {
          throw new Error(`MusicBrainz search responded ${searchResp.status}`);
        }

        const searchData = await searchResp.json();
        const groups = searchData['release-groups'] || [];

        if (!groups.length) {
          return res.status(404).json({
            error: 'No release groups found on MusicBrainz',
            searchTerms: { artist: artistClean, album: albumClean },
          });
        }

        // Helper to extract track count from releases
        const getTrackCountFromReleases = (releases) => {
          let trackCount = null;
          for (const rel of releases) {
            if (!rel.media || rel.media.length === 0) continue;
            // Sum track counts from all media (for multi-disc releases)
            const totalTracks = rel.media.reduce(
              (sum, m) => sum + (m['track-count'] || 0),
              0
            );
            // Prefer releases with reasonable track counts (8-20 typical for albums)
            // Skip box sets with 30+ tracks across many discs
            const isStandard = totalTracks >= 8 && totalTracks <= 20;
            if (totalTracks > 0 && (trackCount === null || isStandard)) {
              trackCount = totalTracks;
              if (isStandard) break; // Found a good standard release
            }
          }
          return trackCount;
        };

        // For each release group, get track count from releases
        const candidates = [];
        for (const group of groups.slice(0, 10)) {
          // Limit to 10 candidates
          // Include media to get track counts (track-count at release level is often null)
          const releaseUrl =
            `https://musicbrainz.org/ws/2/release?release-group=${group.id}` +
            `&inc=media&fmt=json&limit=10`;

          const relResp = await mbFetchWithDelay(releaseUrl, headers);
          let trackCount = null;

          if (relResp.ok) {
            const relData = await relResp.json();
            trackCount = getTrackCountFromReleases(relData.releases || []);
          }

          // Get cover art from Cover Art Archive
          let coverUrl = null;
          try {
            const coverResp = await fetch(
              `https://coverartarchive.org/release-group/${group.id}`,
              { headers, redirect: 'follow' }
            );
            if (coverResp.ok) {
              const coverData = await coverResp.json();
              const front = coverData.images?.find((img) => img.front);
              coverUrl = front?.thumbnails?.small || front?.image || null;
            }
          } catch {
            // Cover art not available, continue without it
          }

          const artistName =
            group['artist-credit']?.[0]?.name ||
            group['artist-credit']?.[0]?.artist?.name ||
            artist;

          candidates.push({
            id: group.id,
            title: group.title,
            artist: artistName,
            type: group['primary-type'] || 'Unknown',
            secondaryTypes: group['secondary-types'] || [],
            releaseDate: group['first-release-date'] || null,
            trackCount,
            coverUrl,
            isCurrent: group.id === currentAlbumId,
          });
        }

        // Sort: current first, then Album > EP > Single, then by date
        const typeOrder = { Album: 0, EP: 1, Single: 2 };
        candidates.sort((a, b) => {
          if (a.isCurrent && !b.isCurrent) return -1;
          if (!a.isCurrent && b.isCurrent) return 1;
          const aOrder = typeOrder[a.type] ?? 3;
          const bOrder = typeOrder[b.type] ?? 3;
          if (aOrder !== bOrder) return aOrder - bOrder;
          // Sort by date descending (newer first)
          return (b.releaseDate || '').localeCompare(a.releaseDate || '');
        });

        res.json({
          success: true,
          candidates,
          currentAlbumId,
        });
      } catch (error) {
        logger.error('Admin album search failed', {
          adminUsername: req.user.username,
          artist,
          album,
          error: error.message,
        });
        res.status(500).json({ error: error.message });
      }
    }
  );

  /**
   * Apply a selected release group to an album
   * Updates the album_id and fetches fresh track data
   */
  app.post(
    '/api/admin/album/reidentify',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      const { currentAlbumId, newAlbumId, artist, album } = req.body;
      const { pool } = deps;

      if (!currentAlbumId || !newAlbumId) {
        return res
          .status(400)
          .json({ error: 'currentAlbumId and newAlbumId are required' });
      }

      const headers = { 'User-Agent': 'SuSheBot/1.0 (kvlt.example.com)' };

      try {
        logger.info('Admin applying album re-identification', {
          adminUsername: req.user.username,
          adminId: req.user._id,
          artist,
          album,
          currentAlbumId,
          newAlbumId,
        });

        // If same as current, no change needed
        if (newAlbumId === currentAlbumId) {
          return res.json({
            success: true,
            message: 'Album already has this release group',
            albumId: newAlbumId,
            changed: false,
          });
        }

        // Fetch releases for this release group to get tracks
        const releasesUrl =
          `https://musicbrainz.org/ws/2/release?release-group=${newAlbumId}` +
          `&inc=recordings&fmt=json&limit=100`;

        const relResp = await mbFetchWithDelay(releasesUrl, headers);
        if (!relResp.ok) {
          throw new Error(`MusicBrainz releases responded ${relResp.status}`);
        }

        const relData = await relResp.json();
        const releases = relData.releases || [];

        if (!releases.length) {
          return res.status(404).json({
            error: 'No releases found for release group',
            releaseGroupId: newAlbumId,
          });
        }

        // Score releases to find best one (prefer EU/XW, Digital, Official)
        const EU = new Set([
          'AT',
          'BE',
          'BG',
          'HR',
          'CY',
          'CZ',
          'DK',
          'EE',
          'FI',
          'FR',
          'DE',
          'GR',
          'HU',
          'IE',
          'IT',
          'LV',
          'LT',
          'LU',
          'MT',
          'NL',
          'PL',
          'PT',
          'RO',
          'SK',
          'SI',
          'ES',
          'SE',
          'GB',
          'XE',
        ]);

        const score = (rel) => {
          if (rel.status !== 'Official' || rel.status === 'Pseudo-Release')
            return -1;
          let s = 0;
          if (EU.has(rel.country)) s += 20;
          if (rel.country === 'XW') s += 10;
          if (
            (rel.media || []).some((m) => (m.format || '').includes('Digital'))
          )
            s += 15;
          const date = new Date(rel.date || '1900-01-01');
          if (!isNaN(date)) s += date.getTime() / 1e10;
          return s;
        };

        const best = releases
          .map((r) => ({ ...r, _score: score(r) }))
          .filter((r) => r._score >= 0)
          .sort((a, b) => b._score - a._score)[0];

        if (!best || !best.media) {
          return res.status(404).json({
            error: 'No suitable release found with tracks',
            releaseGroupId: newAlbumId,
          });
        }

        // Extract tracks
        const tracks = [];
        for (const medium of best.media) {
          if (Array.isArray(medium.tracks)) {
            medium.tracks.forEach((t) => {
              const title = t.title || (t.recording && t.recording.title) || '';
              const length =
                t.length || (t.recording && t.recording.length) || null;
              tracks.push({ name: title, length });
            });
          }
        }

        if (!tracks.length) {
          return res.status(404).json({
            error: 'No tracks found in release',
            releaseGroupId: newAlbumId,
          });
        }

        // Update the albums table - match by artist+album name for reliability
        // (album_id might have already been changed by a previous operation)
        const updateResult = await pool.query(
          `UPDATE albums 
           SET album_id = $1, tracks = $2, updated_at = NOW() 
           WHERE LOWER(artist) = LOWER($3) AND LOWER(album) = LOWER($4)
           RETURNING id, artist, album, album_id`,
          [newAlbumId, JSON.stringify(tracks), artist, album]
        );

        if (updateResult.rowCount === 0) {
          return res.status(404).json({
            error: 'Album not found in database',
            artist,
            album,
          });
        }

        // Also update list_items that reference the old album_id
        // This is crucial - otherwise the JOIN between list_items and albums breaks
        let listItemsUpdated = 0;
        if (currentAlbumId && currentAlbumId !== newAlbumId) {
          const listItemsResult = await pool.query(
            `UPDATE list_items 
             SET album_id = $1, updated_at = NOW() 
             WHERE album_id = $2`,
            [newAlbumId, currentAlbumId]
          );
          listItemsUpdated = listItemsResult.rowCount;
        }

        logger.info('Admin re-identified album successfully', {
          adminUsername: req.user.username,
          artist,
          album,
          oldAlbumId: currentAlbumId,
          newAlbumId,
          trackCount: tracks.length,
          listItemsUpdated,
        });

        res.json({
          success: true,
          message: `Album updated with ${tracks.length} tracks${listItemsUpdated > 0 ? ` (${listItemsUpdated} list references updated)` : ''}`,
          albumId: newAlbumId,
          trackCount: tracks.length,
          tracks: tracks.map((t) => t.name),
          listItemsUpdated,
          changed: true,
        });
      } catch (error) {
        logger.error('Admin album re-identification failed', {
          adminUsername: req.user.username,
          artist,
          album,
          error: error.message,
        });
        res.status(500).json({ error: error.message });
      }
    }
  );
};
