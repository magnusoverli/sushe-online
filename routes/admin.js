module.exports = (app, deps) => {
  const { csrfProtection, ensureAuth, ensureAuthAPI, ensureAdmin, rateLimitAdminRequest, users, lists, usersAsync, listsAsync, upload, adminCode, adminCodeExpiry, crypto } = deps;

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
      console.error('Error deleting user lists:', err);
      return res.status(500).json({ error: 'Error deleting user data' });
    }

    // Then delete the user
    users.remove({ _id: userId }, {}, (err, numRemoved) => {
      if (err) {
        console.error('Error deleting user:', err);
        return res.status(500).json({ error: 'Error deleting user' });
      }

      if (numRemoved === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      console.log(`Admin ${req.user.email} deleted user with ID: ${userId}`);
      res.json({ success: true });
    });
  });
});

// ===== Music Service Authentication =====
app.get('/auth/spotify', ensureAuth, (req, res) => {
  const state = crypto.randomBytes(8).toString('hex');
  console.log('Starting Spotify OAuth flow, state:', state);
  req.session.spotifyState = state;
  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID || '',
    response_type: 'code',
    redirect_uri: process.env.SPOTIFY_REDIRECT_URI || '',
    scope: 'user-read-email',
    state
  });
  res.redirect(`https://accounts.spotify.com/authorize?${params.toString()}`);
});

app.get('/auth/spotify/callback', ensureAuth, async (req, res) => {
  if (req.query.state !== req.session.spotifyState) {
    req.flash('error', 'Invalid Spotify state');
    return res.redirect('/settings');
  }
  delete req.session.spotifyState;
  console.log('Spotify callback received. code:', req.query.code, 'state:', req.query.state);
  try {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code: req.query.code || '',
      redirect_uri: process.env.SPOTIFY_REDIRECT_URI || '',
      client_id: process.env.SPOTIFY_CLIENT_ID || '',
      client_secret: process.env.SPOTIFY_CLIENT_SECRET || ''
    });
    const resp = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });
    if (!resp.ok) {
      console.error('Spotify token request failed:', resp.status, await resp.text());
      throw new Error('Token request failed');
    }
    const token = await resp.json();
    console.log('Spotify token response:', {
      access_token: token.access_token?.slice(0, 6) + '...',
      expires_in: token.expires_in,
      refresh: !!token.refresh_token
    });
    if (token && token.expires_in) {
      token.expires_at = Date.now() + token.expires_in * 1000;
    }
    users.update(
      { _id: req.user._id },
      { $set: { spotifyAuth: token, updatedAt: new Date() } },
      {},
      err => {
        if (err) console.error('Spotify auth update error:', err);
      }
    );
    req.user.spotifyAuth = token;
    req.flash('success', 'Spotify connected');
  } catch (e) {
    console.error('Spotify auth error:', e);
    req.flash('error', 'Failed to authenticate with Spotify');
  }
  res.redirect('/settings');
});

app.get('/auth/spotify/disconnect', ensureAuth, (req, res) => {
  console.log('Disconnecting Spotify for user:', req.user.email);
  users.update(
    { _id: req.user._id },
    { $unset: { spotifyAuth: true }, $set: { updatedAt: new Date() } },
    {},
    err => {
      if (err) console.error('Spotify disconnect error:', err);
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
    state
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
      code_verifier: verifier
    });
    const resp = await fetch('https://auth.tidal.com/v1/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });
    if (!resp.ok) {
      console.error('Tidal token request failed:', resp.status, await resp.text());
      throw new Error('Token request failed');
    }
    const token = await resp.json();
    if (token && token.expires_in) {
      token.expires_at = Date.now() + token.expires_in * 1000;
    }

    let countryCode = null;
    try {
      const profileResp = await fetch('https://openapi.tidal.com/users/v1/me', {
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          Accept: 'application/vnd.api+json',
          'X-Tidal-Token': process.env.TIDAL_CLIENT_ID || ''
        }
      });
      if (profileResp.ok) {
        const profile = await profileResp.json();
        countryCode = profile.countryCode || null;
      } else {
        console.warn('Tidal profile request failed:', profileResp.status);
      }
    } catch (profileErr) {
      console.error('Tidal profile fetch error:', profileErr);
    }

    users.update(
      { _id: req.user._id },
      { $set: { tidalAuth: token, tidalCountry: countryCode, updatedAt: new Date() } },
      {},
      err => { if (err) console.error('Tidal auth update error:', err); }
    );
    req.user.tidalAuth = token;
    req.user.tidalCountry = countryCode;
    req.flash('success', 'Tidal connected');
  } catch (e) {
    console.error('Tidal auth error:', e);
    req.flash('error', 'Failed to authenticate with Tidal');
  }
  res.redirect('/settings');
});

app.get('/auth/tidal/disconnect', ensureAuth, (req, res) => {
  users.update(
    { _id: req.user._id },
    { $unset: { tidalAuth: true }, $set: { updatedAt: new Date() } },
    {},
    err => { if (err) console.error('Tidal disconnect error:', err); }
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
        console.error('Error granting admin:', err);
        return res.status(500).json({ error: 'Error granting admin privileges' });
      }

      if (numUpdated === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      console.log(`Admin ${req.user.email} granted admin to user ID: ${userId}`);
      res.json({ success: true });
    }
  );
});

// Admin: Revoke admin
app.post('/admin/revoke-admin', ensureAuth, ensureAdmin, (req, res) => {
  const { userId } = req.body;

  // Prevent revoking your own admin rights
  if (userId === req.user._id) {
    return res.status(400).json({ error: 'Cannot revoke your own admin privileges' });
  }

  users.update(
    { _id: userId },
    { $unset: { role: true, adminGrantedAt: true } },
    {},
    (err, numUpdated) => {
      if (err) {
        console.error('Error revoking admin:', err);
        return res.status(500).json({ error: 'Error revoking admin privileges' });
      }

      if (numUpdated === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      console.log(`Admin ${req.user.email} revoked admin from user ID: ${userId}`);
      res.json({ success: true });
    }
  );
});

// Admin: Export users as CSV
app.get('/admin/export-users', ensureAuth, ensureAdmin, (req, res) => {
  users.find({}, (err, allUsers) => {
    if (err) {
      console.error('Error exporting users:', err);
      return res.status(500).send('Error exporting users');
    }

    // Create CSV content
    let csv = 'Email,Username,Role,Created At\n';
    allUsers.forEach(user => {
      csv += `"${user.email}","${user.username}","${user.role || 'user'}","${new Date(user.createdAt).toISOString()}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="users-export.csv"');
    res.send(csv);
  });
});

// Admin: Get user lists
app.get('/admin/user-lists/:userId', ensureAuth, ensureAdmin, (req, res) => {
  const { userId } = req.params;
  
  lists.find({ userId }, (err, userLists) => {
    if (err) {
      console.error('Error fetching user lists:', err);
      return res.status(500).json({ error: 'Error fetching user lists' });
    }
    
    const listsData = userLists.map(list => ({
      name: list.name,
      albumCount: Array.isArray(list.data) ? list.data.length : 0,
      createdAt: list.createdAt,
      updatedAt: list.updatedAt
    }));
    
    res.json({ lists: listsData });
  });
});

// Admin: Database backup
app.get('/admin/backup', ensureAuth, ensureAdmin, async (req, res) => {
  try {
    const backup = {
      exportDate: new Date().toISOString(),
      users: await usersAsync.find({}),
      lists: await listsAsync.find({})
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="sushe-backup.json"');
    res.send(JSON.stringify(backup, null, 2));
  } catch (error) {
    console.error('Backup error:', error);
    res.status(500).send('Error creating backup');
  }
});

// Admin: Restore database
app.post('/admin/restore', ensureAuth, ensureAdmin, upload.single('backup'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Parse the JSON backup
    let backup;
    try {
      backup = JSON.parse(req.file.buffer.toString());
    } catch (parseError) {
      console.error('Invalid backup file:', parseError);
      return res.status(400).json({ error: 'Invalid backup file format' });
    }

    // Validate backup structure
    if (!backup.users || !backup.lists || !Array.isArray(backup.users) || !Array.isArray(backup.lists)) {
      return res.status(400).json({ error: 'Invalid backup structure' });
    }

    console.log(`Restoring backup from ${backup.exportDate}`);
    console.log(`Contains ${backup.users.length} users and ${backup.lists.length} lists`);

    // Clear existing data
    await usersAsync.remove({}, { multi: true });
    await listsAsync.remove({}, { multi: true });

    // Restore users and lists
    await usersAsync.insert(backup.users);
    await listsAsync.insert(backup.lists);

    // Clear all sessions after restore
    req.sessionStore.clear((err) => {
      if (err) {
        console.error('Error clearing sessions after restore:', err);
      }
    });

    console.log(`Database restored successfully by ${req.user.email}`);
    res.json({ success: true, message: 'Database restored successfully' });

  } catch (error) {
    console.error('Restore error:', error);
    res.status(500).json({ error: 'Error restoring database' });
  }
});

// Admin: Clear all sessions
app.post('/admin/clear-sessions', ensureAuth, ensureAdmin, (req, res) => {
  const sessionStore = req.sessionStore;
  
  sessionStore.clear((err) => {
    if (err) {
      console.error('Error clearing sessions:', err);
      return res.status(500).json({ error: 'Error clearing sessions' });
    }

    console.log(`Admin ${req.user.email} cleared all sessions`);
    res.json({ success: true });
  });
});

// Admin status endpoint (for debugging)
app.get('/api/admin/status', ensureAuth, (req, res) => {
  res.json({
    isAdmin: req.user.role === 'admin',
    codeValid: new Date() < adminCodeExpiry,
    codeExpiresIn: Math.max(0, Math.floor((adminCodeExpiry - new Date()) / 1000)) + ' seconds'
  });
});

};
