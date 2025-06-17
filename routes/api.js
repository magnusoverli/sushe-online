module.exports = (app, deps) => {
  const { ensureAuthAPI, ensureAuth, users, lists, listItems, usersAsync, listsAsync, listItemsAsync, upload, bcrypt, crypto, nodemailer, composeForgotPasswordEmail, isValidEmail, isValidUsername, isValidPassword, csrfProtection, broadcastListUpdate, listSubscribers } = deps;

// ============ API ENDPOINTS FOR LISTS ============

// Get all lists for current user
app.get('/api/lists', ensureAuthAPI, (req, res) => {
  lists.find({ userId: req.user._id }, async (err, userLists) => {
    if (err) {
      console.error('Error fetching lists:', err);
      return res.status(500).json({ error: 'Error fetching lists' });
    }

    const listsObj = {};
    for (const list of userLists) {
      const items = await listItemsAsync.find({ listId: list._id });
      items.sort((a, b) => a.position - b.position);
      listsObj[list.name] = items.map(item => ({
        artist: item.artist,
        album: item.album,
        album_id: item.albumId,
        release_date: item.releaseDate,
        country: item.country,
        genre_1: item.genre1,
        genre_2: item.genre2,
        comments: item.comments,
        tracks: item.tracks,
        cover_image: item.coverImage,
        cover_image_format: item.coverImageFormat
      }));
    }

    res.json(listsObj);
  });
});

// Server-sent events subscription for a specific list
app.get('/api/lists/subscribe/:name', ensureAuthAPI, (req, res) => {
  const { name } = req.params;
  const key = `${req.user._id}:${name}`;

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();
  res.write('retry: 10000\n\n');

  const heartbeat = setInterval(() => {
    res.write(':\n\n');
    if (typeof res.flush === 'function') {
      res.flush();
    }
  }, 25000);

  const subs = listSubscribers.get(key) || new Set();
  subs.add(res);
  listSubscribers.set(key, subs);

  req.on('close', () => {
    clearInterval(heartbeat);
    subs.delete(res);
  });
});

// Get a single list
app.get('/api/lists/:name', ensureAuthAPI, (req, res) => {
  const { name } = req.params;
  lists.findOne({ userId: req.user._id, name }, async (err, list) => {
    if (err) {
      console.error('Error fetching list:', err);
      return res.status(500).json({ error: 'Error fetching list' });
    }
    if (!list) {
      return res.status(404).json({ error: 'List not found' });
    }
    const items = await listItemsAsync.find({ listId: list._id });
    items.sort((a, b) => a.position - b.position);
    const data = items.map(item => ({
      artist: item.artist,
      album: item.album,
      album_id: item.albumId,
      release_date: item.releaseDate,
      country: item.country,
      genre_1: item.genre1,
      genre_2: item.genre2,
      comments: item.comments,
      tracks: item.tracks,
      cover_image: item.coverImage,
      cover_image_format: item.coverImageFormat
    }));
    res.json(data);
  });
});

// Create or update a list
app.post('/api/lists/:name', ensureAuthAPI, (req, res) => {
  const { name } = req.params;
  const { data } = req.body;
  
  if (!data || !Array.isArray(data)) {
    return res.status(400).json({ error: 'Invalid list data' });
  }
  
  // Check if list exists
  lists.findOne({ userId: req.user._id, name }, async (err, existingList) => {
    if (err) {
      console.error('Error checking list:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    const timestamp = new Date();
    if (existingList) {
      await lists.update(
        { _id: existingList._id },
        { $set: { updatedAt: timestamp } }
      );
      await listItemsAsync.remove({ listId: existingList._id }, { multi: true });
      for (let i = 0; i < data.length; i++) {
        const album = data[i];
        await listItemsAsync.insert({
          listId: existingList._id,
          position: i + 1,
          artist: album.artist || '',
          album: album.album || '',
          albumId: album.album_id || '',
          releaseDate: album.release_date || '',
          country: album.country || '',
          genre1: album.genre_1 || album.genre || '',
          genre2: album.genre_2 || '',
          comments: album.comments || album.comment || '',
          tracks: Array.isArray(album.tracks) ? album.tracks : null,
          coverImage: album.cover_image || '',
          coverImageFormat: album.cover_image_format || '',
          createdAt: timestamp,
          updatedAt: timestamp
        });
      }
      res.json({ success: true, message: 'List updated' });
      broadcastListUpdate(req.user._id, name, data);
    } else {
      const newList = await listsAsync.insert({
        userId: req.user._id,
        name,
        createdAt: timestamp,
        updatedAt: timestamp
      });
      for (let i = 0; i < data.length; i++) {
        const album = data[i];
        await listItemsAsync.insert({
          listId: newList._id,
          position: i + 1,
          artist: album.artist || '',
          album: album.album || '',
          albumId: album.album_id || '',
          releaseDate: album.release_date || '',
          country: album.country || '',
          genre1: album.genre_1 || album.genre || '',
          genre2: album.genre_2 || '',
          comments: album.comments || album.comment || '',
          tracks: Array.isArray(album.tracks) ? album.tracks : null,
          coverImage: album.cover_image || '',
          coverImageFormat: album.cover_image_format || '',
          createdAt: timestamp,
          updatedAt: timestamp
        });
      }
      res.json({ success: true, message: 'List created' });
      broadcastListUpdate(req.user._id, name, data);
    }
  });
});

// Delete a specific list
app.delete('/api/lists/:name', ensureAuthAPI, (req, res) => {
  const { name } = req.params;
  
  lists.remove({ userId: req.user._id, name }, {}, (err, numRemoved) => {
    if (err) {
      console.error('Error deleting list:', err);
      return res.status(500).json({ error: 'Error deleting list' });
    }
    
    if (numRemoved === 0) {
      return res.status(404).json({ error: 'List not found' });
    }
    
    // If this was the user's last selected list, clear it
    if (req.user.lastSelectedList === name) {
      users.update(
        { _id: req.user._id },
        { $unset: { lastSelectedList: true } },
        {},
        (updateErr) => {
          if (updateErr) {
            console.error('Error clearing last selected list:', updateErr);
          }
          req.user.lastSelectedList = null;
          req.session.save();
        }
      );
    }
    
    res.json({ success: true, message: 'List deleted' });
  });
});


// ============ PASSWORD RESET ROUTES ============

// Forgot password page
app.get('/forgot', csrfProtection, (req, res) => {
  res.send(htmlTemplate(forgotPasswordTemplate(req, res.locals.flash), 'Password Recovery - Black Metal Auth'));
});

// Handle forgot password submission
app.post('/forgot', csrfProtection, (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    req.flash('error', 'Please provide an email address');
    return res.redirect('/forgot');
  }
  
  users.findOne({ email }, (err, user) => {
    if (err) {
      console.error('Database error during forgot password:', err);
      req.flash('error', 'An error occurred. Please try again.');
      return res.redirect('/forgot');
    }
    
    // Always show the same message for security reasons
    req.flash('info', 'If that email exists, you will receive a reset link');
    
    if (!user) {
      // Don't reveal that the email doesn't exist
      return res.redirect('/forgot');
    }

    const token = crypto.randomBytes(20).toString('hex');
    const expires = Date.now() + 3600000; // 1 hour
    
    users.update(
      { _id: user._id }, 
      { $set: { resetToken: token, resetExpires: expires } }, 
      {}, 
      (err, numReplaced) => {
        if (err) {
          console.error('Failed to set reset token:', err);
          // Don't show error to user for security reasons
          return res.redirect('/forgot');
        }
        
        if (numReplaced === 0) {
          console.error('No user updated when setting reset token');
          // Don't show error to user for security reasons
          return res.redirect('/forgot');
        }
        
        console.log('Reset token set for user:', user.email);
        
        if (process.env.SENDGRID_API_KEY) {
          const transporter = nodemailer.createTransport({
            host: 'smtp.sendgrid.net',
            port: 587,
            auth: {
              user: 'apikey',
              pass: process.env.SENDGRID_API_KEY
            }
          });
          
          const resetUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/reset/${token}`;
          const emailOptions = composeForgotPasswordEmail(user.email, resetUrl);
          
          transporter.sendMail(emailOptions, (error, info) => {
            if (error) {
              console.error('Failed to send password reset email:', error.message);
            } else {
              console.log('Password reset email sent successfully to:', user.email);
            }
          });
        } else {
          console.warn('SENDGRID_API_KEY not configured - password reset email not sent');
          console.log('Reset token for testing:', token);
        }
        
        res.redirect('/forgot');
      }
    );
  });
});

// Reset password page
app.get('/reset/:token', csrfProtection, (req, res) => {
  users.findOne({ resetToken: req.params.token, resetExpires: { $gt: Date.now() } }, (err, user) => {
    if (!user) {
      return res.send(htmlTemplate(invalidTokenTemplate(), 'Invalid Token - Black Metal Auth'));
    }
    res.send(htmlTemplate(resetPasswordTemplate(req.params.token), 'Reset Password - Black Metal Auth'));
  });
});

// Handle password reset
app.post('/reset/:token', csrfProtection, async (req, res) => {
  users.findOne({ resetToken: req.params.token, resetExpires: { $gt: Date.now() } }, async (err, user) => {
    if (err) {
      console.error('Error finding user with reset token:', err);
      return res.send(htmlTemplate(invalidTokenTemplate(), 'Invalid Token - Black Metal Auth'));
    }
    
    if (!user) {
      return res.send(htmlTemplate(invalidTokenTemplate(), 'Invalid Token - Black Metal Auth'));
    }
    
    try {
      const hash = await bcrypt.hash(req.body.password, 12);
      
      users.update(
        { _id: user._id }, 
        { $set: { hash }, $unset: { resetToken: true, resetExpires: true } }, 
        {}, 
        (err, numReplaced) => {
          if (err) {
            console.error('Password reset update error:', err);
            req.flash('error', 'Error updating password. Please try again.');
            return res.redirect('/reset/' + req.params.token);
          }
          
          if (numReplaced === 0) {
            console.error('No user updated during password reset');
            req.flash('error', 'Error updating password. Please try again.');
            return res.redirect('/reset/' + req.params.token);
          }
          
          console.log('Password successfully updated for user:', user.email);
          req.flash('success', 'Password updated successfully. Please login with your new password.');
          res.redirect('/login');
        }
      );
    } catch (error) {
      console.error('Password hashing error:', error);
      req.flash('error', 'Error processing password. Please try again.');
      res.redirect('/reset/' + req.params.token);
    }
  });
});

// Proxy for Deezer API to avoid CORS issues
app.get('/api/proxy/deezer', ensureAuthAPI, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ error: 'Query parameter q is required' });
    }
    
    const url = `https://api.deezer.com/search/album?q=${encodeURIComponent(q)}&limit=5`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Deezer API responded with status ${response.status}`);
    }
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Deezer proxy error:', error);
    res.status(500).json({ error: 'Failed to fetch from Deezer' });
  }
});

// Search Spotify for an album and return the ID
app.get('/api/spotify/album', ensureAuthAPI, async (req, res) => {
  if (!req.user.spotifyAuth || !req.user.spotifyAuth.access_token ||
      (req.user.spotifyAuth.expires_at && req.user.spotifyAuth.expires_at <= Date.now())) {
    console.warn('Spotify API request without valid token');
    return res.status(400).json({ error: 'Not authenticated with Spotify' });
  }

  const { artist, album } = req.query;
  if (!artist || !album) {
    return res.status(400).json({ error: 'artist and album are required' });
  }
  console.log('Spotify album search:', artist, '-', album);

  try {
    const query = `album:${album} artist:${artist}`;
    const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=album&limit=1`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${req.user.spotifyAuth.access_token}` }
    });
    if (!resp.ok) {
      throw new Error(`Spotify API error ${resp.status}`);
    }
    const data = await resp.json();
    if (!data.albums || !data.albums.items.length) {
      return res.status(404).json({ error: 'Album not found' });
    }
    const albumId = data.albums.items[0].id;
    console.log('Spotify search result id:', albumId);
    res.json({ id: albumId });
  } catch (err) {
    console.error('Spotify search error:', err);
    res.status(500).json({ error: 'Failed to search Spotify' });
  }
});

// Search Tidal for an album and return the ID
app.get('/api/tidal/album', ensureAuthAPI, async (req, res) => {
  if (!req.user.tidalAuth || !req.user.tidalAuth.access_token ||
      (req.user.tidalAuth.expires_at && req.user.tidalAuth.expires_at <= Date.now())) {
    console.warn('Tidal API request without valid token');
    return res.status(400).json({ error: 'Not authenticated with Tidal' });
  }

  console.debug('Tidal token expires at:', req.user.tidalAuth.expires_at);
  console.debug('Using Tidal access token:',
    (req.user.tidalAuth.access_token || '').slice(0, 6) + '...' +
    (req.user.tidalAuth.access_token || '').slice(-4));

  const { artist, album } = req.query;
  if (!artist || !album) {
    return res.status(400).json({ error: 'artist and album are required' });
  }

  console.log('Tidal album search:', artist, '-', album);

  try {
    let countryCode = req.user.tidalCountry;
    if (!countryCode) {
      try {
        const profileResp = await fetch('https://openapi.tidal.com/users/v1/me', {
          headers: {
            Authorization: `Bearer ${req.user.tidalAuth.access_token}`,
            Accept: 'application/vnd.api+json',
            'X-Tidal-Token': process.env.TIDAL_CLIENT_ID || ''
          }
        });
        if (profileResp.ok) {
          const profile = await profileResp.json();
          countryCode = profile.countryCode || 'US';
          users.update(
            { _id: req.user._id },
            { $set: { tidalCountry: countryCode, updatedAt: new Date() } },
            {},
            () => {}
          );
          req.user.tidalCountry = countryCode;
        } else {
          console.warn('Tidal profile request failed:', profileResp.status);
          countryCode = 'US';
        }
      } catch (profileErr) {
        console.error('Tidal profile fetch error:', profileErr);
        countryCode = 'US';
      }
    }

    const query = `${album} ${artist}`;
    // encodeURIComponent does not escape apostrophes, which breaks the
    // Tidal searchResults path. Replace them manually after encoding.
    const searchPath = encodeURIComponent(query).replace(/'/g, '%27');
    const params = new URLSearchParams({ countryCode });
    const url =
      `https://openapi.tidal.com/v2/searchResults/${searchPath}/relationships/albums?` +
      params.toString();
    console.debug('Tidal search URL:', url);
    console.debug('Tidal client ID header:', (process.env.TIDAL_CLIENT_ID || '').slice(0, 6) + '...');
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${req.user.tidalAuth.access_token}`,
        Accept: 'application/vnd.api+json',
        'X-Tidal-Token': process.env.TIDAL_CLIENT_ID || ''
      }
    });
    console.debug('Tidal response status:', resp.status);
    if (!resp.ok) {
      const body = await resp.text().catch(() => '<body read failed>');
      console.warn('Tidal API request failed:', resp.status, body);
      throw new Error(`Tidal API error ${resp.status}`);
    }
    const data = await resp.json();
    console.debug('Tidal API response body:', JSON.stringify(data, null, 2));
    const albumId = data?.data?.[0]?.id;
    if (!albumId) {
      return res.status(404).json({ error: 'Album not found' });
    }
    console.log('Tidal search result id:', albumId);
    res.json({ id: albumId });
  } catch (err) {
    console.error('Tidal search error:', err);
    res.status(500).json({ error: 'Failed to search Tidal' });
  }
});


// Fetch metadata for link previews
app.get('/api/unfurl', ensureAuthAPI, async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: 'url query is required' });
    }

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (SuSheBot)' }
    });
    const html = await response.text();

    const getMeta = (name) => {
      const metaTag = new RegExp(`<meta[^>]+property=[\"']og:${name}[\"'][^>]+content=[\"']([^\"']+)[\"']`, 'i').exec(html) ||
        new RegExp(`<meta[^>]+name=[\"']${name}[\"'][^>]+content=[\"']([^\"']+)[\"']`, 'i').exec(html);
      return metaTag ? metaTag[1] : '';
    };

    const titleTag = /<title[^>]*>([^<]*)<\/title>/i.exec(html);

    res.json({
      title: getMeta('title') || (titleTag ? titleTag[1] : ''),
      description: getMeta('description'),
      image: getMeta('image')
    });
  } catch (err) {
    console.error('Unfurl error:', err);
    res.status(500).json({ error: 'Failed to unfurl' });
  }
});

};
