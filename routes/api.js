// Ensure fetch is available
const fetch = globalThis.fetch || require('node-fetch');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let mbQueue = Promise.resolve();
function mbFetch(url, options) {
  const result = mbQueue.then(() => fetch(url, options));
  mbQueue = result.then(
    () => wait(3000),
    () => wait(3000)
  );
  return result;
}

module.exports = (app, deps) => {
  const logger = require('../utils/logger');
  const {
    cacheConfigs,
    responseCache,
  } = require('../middleware/response-cache');
  const { URLSearchParams } = require('url');
  const {
    htmlTemplate,
    forgotPasswordTemplate,
    invalidTokenTemplate,
    resetPasswordTemplate,
  } = require('../templates');
  const {
    ensureAuthAPI,
    users,
    lists,
    listsAsync,
    listItemsAsync,
    albumsAsync,
    bcrypt,
    crypto,
    nodemailer,
    composeForgotPasswordEmail,
    csrfProtection,
    broadcastListUpdate,
    listSubscribers,
    pool,
  } = deps;

  async function upsertAlbumRecord(album, timestamp) {
    const values = [
      album.album_id,
      album.artist || '',
      album.album || '',
      album.release_date || '',
      album.country || '',
      album.genre_1 || album.genre || '',
      album.genre_2 || '',
      Array.isArray(album.tracks) ? JSON.stringify(album.tracks) : null,
      album.cover_image || '',
      album.cover_image_format || '',
      timestamp,
      timestamp,
    ];

    await pool.query(
      `INSERT INTO albums (
        album_id,
        artist,
        album,
        release_date,
        country,
        genre_1,
        genre_2,
        tracks,
        cover_image,
        cover_image_format,
        created_at,
        updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
      ) ON CONFLICT (album_id) DO UPDATE SET
        artist = COALESCE(albums.artist, EXCLUDED.artist),
        album = COALESCE(albums.album, EXCLUDED.album),
        release_date = COALESCE(albums.release_date, EXCLUDED.release_date),
        country = COALESCE(albums.country, EXCLUDED.country),
        genre_1 = COALESCE(albums.genre_1, EXCLUDED.genre_1),
        genre_2 = COALESCE(albums.genre_2, EXCLUDED.genre_2),
        tracks = COALESCE(albums.tracks, EXCLUDED.tracks),
        cover_image = COALESCE(albums.cover_image, EXCLUDED.cover_image),
        cover_image_format = COALESCE(albums.cover_image_format, EXCLUDED.cover_image_format),
        updated_at = EXCLUDED.updated_at`,
      values
    );
  }

  // ============ API ENDPOINTS FOR LISTS ============

  // Get all lists for current user
  app.get(
    '/api/lists',
    ensureAuthAPI,
    cacheConfigs.userSpecific,
    async (req, res) => {
      try {
        const userLists = await listsAsync.find({ userId: req.user._id });

        const listsObj = {};
        for (const list of userLists) {
          const items = await listItemsAsync.find({ listId: list._id });
          items.sort((a, b) => a.position - b.position);

          // Batch load album data to avoid N+1 queries
          const albumIds = items.map((item) => item.albumId).filter(Boolean);
          const albumsData =
            albumIds.length > 0 ? await albumsAsync.findByIds(albumIds) : [];
          const albumsMap = new Map(
            albumsData.map((album) => [album._id, album])
          );

          const mapped = [];
          for (const item of items) {
            const albumData = item.albumId ? albumsMap.get(item.albumId) : null;
            mapped.push({
              artist: albumData?.artist || item.artist,
              album: albumData?.album || item.album,
              album_id: item.albumId,
              release_date: albumData?.releaseDate || item.releaseDate,
              country: albumData?.country || item.country,
              genre_1: albumData?.genre1 || item.genre1,
              genre_2: albumData?.genre2 || item.genre2,
              track_pick: item.trackPick,
              comments: item.comments,
              tracks: albumData?.tracks || item.tracks,
              cover_image: albumData?.coverImage || item.coverImage,
              cover_image_format:
                albumData?.coverImageFormat || item.coverImageFormat,
            });
          }
          listsObj[list.name] = mapped;
        }

        res.json(listsObj);
      } catch (err) {
        logger.error('Error fetching lists:', err);
        return res.status(500).json({ error: 'Error fetching lists' });
      }
    }
  );

  // Server-sent events subscription for a specific list
  app.get('/api/lists/subscribe/:name', ensureAuthAPI, (req, res) => {
    const { name } = req.params;
    const key = `${req.user._id}:${name}`;

    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
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
  app.get(
    '/api/lists/:name',
    ensureAuthAPI,
    cacheConfigs.userSpecific,
    async (req, res) => {
      try {
        const { name } = req.params;
        const list = await listsAsync.findOne({ userId: req.user._id, name });

        if (!list) {
          return res.status(404).json({ error: 'List not found' });
        }
        const items = await listItemsAsync.find({ listId: list._id });
        items.sort((a, b) => a.position - b.position);

        // Batch load album data to avoid N+1 queries
        const albumIds = items.map((item) => item.albumId).filter(Boolean);
        const albumsData =
          albumIds.length > 0 ? await albumsAsync.findByIds(albumIds) : [];
        const albumsMap = new Map(
          albumsData.map((album) => [album._id, album])
        );

        const data = [];
        for (const item of items) {
          const albumData = item.albumId ? albumsMap.get(item.albumId) : null;
          data.push({
            artist: albumData?.artist || item.artist,
            album: albumData?.album || item.album,
            album_id: item.albumId,
            release_date: albumData?.releaseDate || item.releaseDate,
            country: albumData?.country || item.country,
            genre_1: albumData?.genre1 || item.genre1,
            genre_2: albumData?.genre2 || item.genre2,
            track_pick: item.trackPick,
            comments: item.comments,
            tracks: albumData?.tracks || item.tracks,
            cover_image: albumData?.coverImage || item.coverImage,
            cover_image_format:
              albumData?.coverImageFormat || item.coverImageFormat,
          });
        }
        res.json(data);
      } catch (err) {
        logger.error('Error fetching list:', err);
        return res.status(500).json({ error: 'Error fetching list' });
      }
    }
  );

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
        logger.error('Error checking list:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      const timestamp = new Date();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        let listId = existingList ? existingList._id : null;
        if (existingList) {
          await client.query('UPDATE lists SET updated_at=$1 WHERE _id=$2', [
            timestamp,
            listId,
          ]);
          await client.query('DELETE FROM list_items WHERE list_id=$1', [
            listId,
          ]);
        } else {
          // Create new list
          const resList = await client.query(
            'INSERT INTO lists (_id, user_id, name, created_at, updated_at) VALUES ($1, $2, $3, $4, $5) RETURNING _id',
            [
              crypto.randomBytes(12).toString('hex'),
              req.user._id,
              name,
              timestamp,
              timestamp,
            ]
          );
          listId = resList.rows[0]._id;
        }

        const placeholders = [];
        const values = [];
        let idx = 1;
        for (let i = 0; i < data.length; i++) {
          const album = data[i];
          if (album.album_id) {
            await upsertAlbumRecord(album, timestamp);
          }
          placeholders.push(
            `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`
          );
          values.push(
            crypto.randomBytes(12).toString('hex'),
            listId,
            i + 1,
            album.artist || '',
            album.album || '',
            album.album_id || '',
            album.release_date || '',
            album.country || '',
            album.genre_1 || album.genre || '',
            album.genre_2 || '',
            album.comments || album.comment || '',
            Array.isArray(album.tracks) ? JSON.stringify(album.tracks) : null,
            album.track_pick || null,
            album.cover_image || '',
            album.cover_image_format || '',
            timestamp,
            timestamp
          );
        }

        if (placeholders.length) {
          await client.query(
            `INSERT INTO list_items (_id, list_id, position, artist, album, album_id, release_date, country, genre_1, genre_2, comments, tracks, track_pick, cover_image, cover_image_format, created_at, updated_at) VALUES ${placeholders.join(',')}`,
            values
          );
        }

        await client.query('COMMIT');
        res.json({
          success: true,
          message: existingList ? 'List updated' : 'List created',
        });

        // Invalidate cache for this user's lists
        responseCache.invalidate(`GET:/api/lists:${req.user._id}`);
        responseCache.invalidate(`GET:/api/lists/${name}:${req.user._id}`);

        broadcastListUpdate(req.user._id, name, data);
      } catch (dbErr) {
        await client.query('ROLLBACK');
        logger.error('Error updating list:', dbErr);
        res.status(500).json({ error: 'Database error' });
      } finally {
        client.release();
      }
    });
  });

  // Delete a specific list
  app.delete('/api/lists/:name', ensureAuthAPI, (req, res) => {
    const { name } = req.params;

    lists.remove({ userId: req.user._id, name }, {}, (err, numRemoved) => {
      if (err) {
        logger.error('Error deleting list:', err);
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
              logger.error('Error clearing last selected list:', updateErr);
            }
            req.user.lastSelectedList = null;
            req.session.save();
          }
        );
      }

      res.json({ success: true, message: 'List deleted' });

      // Invalidate cache for this user's lists
      responseCache.invalidate(`GET:/api/lists:${req.user._id}`);
      responseCache.invalidate(`GET:/api/lists/${name}:${req.user._id}`);
    });
  });

  // ============ PASSWORD RESET ROUTES ============

  // Forgot password page
  app.get('/forgot', csrfProtection, (req, res) => {
    res.send(
      htmlTemplate(
        forgotPasswordTemplate(req, res.locals.flash || {}),
        'Password Recovery - Black Metal Auth'
      )
    );
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
        logger.error('Database error during forgot password:', err);
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
            logger.error('Failed to set reset token:', err);
            // Don't show error to user for security reasons
            return res.redirect('/forgot');
          }

          if (numReplaced === 0) {
            logger.error('No user updated when setting reset token');
            // Don't show error to user for security reasons
            return res.redirect('/forgot');
          }

          logger.info('Reset token set for user:', user.email);

          if (process.env.SENDGRID_API_KEY) {
            const transporter = nodemailer.createTransport({
              host: 'smtp.sendgrid.net',
              port: 587,
              auth: {
                user: 'apikey',
                pass: process.env.SENDGRID_API_KEY,
              },
            });

            const resetUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/reset/${token}`;
            const emailOptions = composeForgotPasswordEmail(
              user.email,
              resetUrl
            );

            transporter.sendMail(emailOptions, (error, _info) => {
              if (error) {
                logger.error(
                  'Failed to send password reset email:',
                  error.message
                );
              } else {
                logger.info('Password reset email sent successfully', {
                  email: user.email,
                });
              }
            });
          } else {
            logger.warn(
              'SENDGRID_API_KEY not configured - password reset email not sent'
            );
            logger.info('Reset token for testing:', token);
          }

          res.redirect('/forgot');
        }
      );
    });
  });

  // Reset password page
  app.get('/reset/:token', csrfProtection, (req, res) => {
    users.findOne(
      { resetToken: req.params.token, resetExpires: { $gt: Date.now() } },
      (err, user) => {
        if (!user) {
          return res.send(
            htmlTemplate(
              invalidTokenTemplate(),
              'Invalid Token - Black Metal Auth'
            )
          );
        }
        res.send(
          htmlTemplate(
            resetPasswordTemplate(req.params.token),
            'Reset Password - Black Metal Auth'
          )
        );
      }
    );
  });

  // Handle password reset
  app.post('/reset/:token', csrfProtection, async (req, res) => {
    users.findOne(
      { resetToken: req.params.token, resetExpires: { $gt: Date.now() } },
      async (err, user) => {
        if (err) {
          logger.error('Error finding user with reset token:', err);
          return res.send(
            htmlTemplate(
              invalidTokenTemplate(),
              'Invalid Token - Black Metal Auth'
            )
          );
        }

        if (!user) {
          return res.send(
            htmlTemplate(
              invalidTokenTemplate(),
              'Invalid Token - Black Metal Auth'
            )
          );
        }

        try {
          const hash = await bcrypt.hash(req.body.password, 12);

          users.update(
            { _id: user._id },
            {
              $set: { hash },
              $unset: { resetToken: true, resetExpires: true },
            },
            {},
            (err, numReplaced) => {
              if (err) {
                logger.error('Password reset update error:', err);
                req.flash(
                  'error',
                  'Error updating password. Please try again.'
                );
                return res.redirect('/reset/' + req.params.token);
              }

              if (numReplaced === 0) {
                logger.error('No user updated during password reset');
                req.flash(
                  'error',
                  'Error updating password. Please try again.'
                );
                return res.redirect('/reset/' + req.params.token);
              }

              logger.info(
                'Password successfully updated for user:',
                user.email
              );
              req.flash(
                'success',
                'Password updated successfully. Please login with your new password.'
              );
              res.redirect('/login');
            }
          );
        } catch (error) {
          logger.error('Password hashing error:', error);
          req.flash('error', 'Error processing password. Please try again.');
          res.redirect('/reset/' + req.params.token);
        }
      }
    );
  });

  // Proxy for Deezer API to avoid CORS issues
  app.get(
    '/api/proxy/deezer',
    ensureAuthAPI,
    cacheConfigs.public,
    async (req, res) => {
      try {
        const { q } = req.query;
        if (!q) {
          return res
            .status(400)
            .json({ error: 'Query parameter q is required' });
        }

        const url = `https://api.deezer.com/search/album?q=${encodeURIComponent(q)}&limit=5`;
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(
            `Deezer API responded with status ${response.status}`
          );
        }

        const data = await response.json();
        res.json(data);
      } catch (error) {
        logger.error('Deezer proxy error:', error);
        res.status(500).json({ error: 'Failed to fetch from Deezer' });
      }
    }
  );

  // Search Spotify for an album and return the ID
  app.get('/api/spotify/album', ensureAuthAPI, async (req, res) => {
    if (
      !req.user.spotifyAuth ||
      !req.user.spotifyAuth.access_token ||
      (req.user.spotifyAuth.expires_at &&
        req.user.spotifyAuth.expires_at <= Date.now())
    ) {
      logger.warn('Spotify API request without valid token');
      return res.status(400).json({ error: 'Not authenticated with Spotify' });
    }

    const { artist, album } = req.query;
    if (!artist || !album) {
      return res.status(400).json({ error: 'artist and album are required' });
    }
    logger.info('Spotify album search:', artist, '-', album);

    try {
      const query = `album:${album} artist:${artist}`;
      const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=album&limit=1`;
      const resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${req.user.spotifyAuth.access_token}`,
        },
      });
      if (!resp.ok) {
        throw new Error(`Spotify API error ${resp.status}`);
      }
      const data = await resp.json();
      if (!data.albums || !data.albums.items.length) {
        return res.status(404).json({ error: 'Album not found' });
      }
      const albumId = data.albums.items[0].id;
      logger.info('Spotify search result id:', albumId);
      res.json({ id: albumId });
    } catch (err) {
      logger.error('Spotify search error:', err);
      res.status(500).json({ error: 'Failed to search Spotify' });
    }
  });

  // Search Tidal for an album and return the ID
  app.get('/api/tidal/album', ensureAuthAPI, async (req, res) => {
    if (
      !req.user.tidalAuth ||
      !req.user.tidalAuth.access_token ||
      (req.user.tidalAuth.expires_at &&
        req.user.tidalAuth.expires_at <= Date.now())
    ) {
      logger.warn('Tidal API request without valid token');
      return res.status(400).json({ error: 'Not authenticated with Tidal' });
    }

    logger.debug('Tidal token expires at:', req.user.tidalAuth.expires_at);
    logger.debug(
      'Using Tidal access token:',
      (req.user.tidalAuth.access_token || '').slice(0, 6) +
        '...' +
        (req.user.tidalAuth.access_token || '').slice(-4)
    );

    const { artist, album } = req.query;
    if (!artist || !album) {
      return res.status(400).json({ error: 'artist and album are required' });
    }

    logger.info('Tidal album search:', artist, '-', album);

    try {
      let countryCode = req.user.tidalCountry;
      if (!countryCode) {
        try {
          const profileResp = await fetch(
            'https://openapi.tidal.com/users/v1/me',
            {
              headers: {
                Authorization: `Bearer ${req.user.tidalAuth.access_token}`,
                Accept: 'application/vnd.api+json',
                'X-Tidal-Token': process.env.TIDAL_CLIENT_ID || '',
              },
            }
          );
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
            logger.warn('Tidal profile request failed:', profileResp.status);
            countryCode = 'US';
          }
        } catch (profileErr) {
          logger.error('Tidal profile fetch error:', profileErr);
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
      logger.debug('Tidal search URL:', url);
      logger.debug(
        'Tidal client ID header:',
        (process.env.TIDAL_CLIENT_ID || '').slice(0, 6) + '...'
      );
      const resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${req.user.tidalAuth.access_token}`,
          Accept: 'application/vnd.api+json',
          'X-Tidal-Token': process.env.TIDAL_CLIENT_ID || '',
        },
      });
      logger.debug('Tidal response status:', resp.status);
      if (!resp.ok) {
        const body = await resp.text().catch(() => '<body read failed>');
        logger.warn('Tidal API request failed:', resp.status, body);
        throw new Error(`Tidal API error ${resp.status}`);
      }
      const data = await resp.json();
      logger.debug('Tidal API response body:', JSON.stringify(data, null, 2));
      const albumId = data?.data?.[0]?.id;
      if (!albumId) {
        return res.status(404).json({ error: 'Album not found' });
      }
      logger.info('Tidal search result id:', albumId);
      res.json({ id: albumId });
    } catch (err) {
      logger.error('Tidal search error:', err);
      res.status(500).json({ error: 'Failed to search Tidal' });
    }
  });

  // Fetch metadata for link previews
  app.get(
    '/api/unfurl',
    ensureAuthAPI,
    cacheConfigs.public,
    async (req, res) => {
      try {
        const { url } = req.query;
        if (!url) {
          return res.status(400).json({ error: 'url query is required' });
        }

        const response = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (SuSheBot)' },
        });
        const html = await response.text();

        const getMeta = (name) => {
          const metaTag =
            new RegExp(
              `<meta[^>]+property=["']og:${name}["'][^>]+content=["']([^"']+)["']`,
              'i'
            ).exec(html) ||
            new RegExp(
              `<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`,
              'i'
            ).exec(html);
          return metaTag ? metaTag[1] : '';
        };

        const titleTag = /<title[^>]*>([^<]*)<\/title>/i.exec(html);

        res.json({
          title: getMeta('title') || (titleTag ? titleTag[1] : ''),
          description: getMeta('description'),
          image: getMeta('image'),
        });
      } catch (err) {
        logger.error('Unfurl error:', err);
        res.status(500).json({ error: 'Failed to unfurl' });
      }
    }
  );

  // Fetch track list for a release group from MusicBrainz
  app.get(
    '/api/musicbrainz/tracks',
    ensureAuthAPI,
    cacheConfigs.static,
    async (req, res) => {
      const { id, artist, album } = req.query;
      if (!id && (!artist || !album)) {
        return res
          .status(400)
          .json({ error: 'id or artist/album query required' });
      }

      const headers = { 'User-Agent': 'SuSheBot/1.0 (kvlt.example.com)' };

      try {
        let releaseGroupId = id;
        let directReleaseId = null;

        const sanitize = (str = '') =>
          str
            .trim()
            .replace(/[\u2018\u2019'"`]/g, '')
            .replace(/[()[\]{}]/g, '')
            .replace(/[.,!?]/g, '')
            .replace(/\s{2,}/g, ' ');

        const artistClean = sanitize(artist);
        const albumClean = sanitize(album);

        const fetchItunesTracks = async () => {
          try {
            const term = `${artistClean} ${albumClean}`
              .replace(/[^\w\s]/g, ' ')
              .trim();
            const searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=album&limit=5`;
            const resp = await fetch(searchUrl);
            if (!resp.ok) return null;
            const data = await resp.json();
            if (!data.results || !data.results.length) return null;
            const best = data.results[0];
            if (!best.collectionId) return null;
            const lookup = await fetch(
              `https://itunes.apple.com/lookup?id=${best.collectionId}&entity=song`
            );
            if (!lookup.ok) return null;
            const lookupData = await lookup.json();
            const tracks = (lookupData.results || [])
              .filter((r) => r.wrapperType === 'track')
              .map((r) => r.trackName);
            return tracks.length
              ? { tracks, releaseId: `itunes:${best.collectionId}` }
              : null;
          } catch (err) {
            logger.error('iTunes fallback error:', err);
            return null;
          }
        };

        const fetchDeezerTracks = async () => {
          try {
            const q = `${artistClean} ${albumClean}`
              .replace(/[^\w\s]/g, ' ')
              .trim();
            const searchResp = await fetch(
              `https://api.deezer.com/search/album?q=${encodeURIComponent(q)}&limit=5`
            );
            if (!searchResp.ok) return null;
            const data = await searchResp.json();
            const albumId = data.data && data.data[0] && data.data[0].id;
            if (!albumId) return null;
            const albumResp = await fetch(
              `https://api.deezer.com/album/${albumId}`
            );
            if (!albumResp.ok) return null;
            const albumData = await albumResp.json();
            const tracks = (albumData.tracks?.data || []).map((t) => t.title);
            return tracks.length
              ? { tracks, releaseId: `deezer:${albumId}` }
              : null;
          } catch (err) {
            logger.error('Deezer fallback error:', err);
            return null;
          }
        };

        const runFallbacks = async () => {
          const itunes = await fetchItunesTracks();
          if (itunes) return itunes;
          return await fetchDeezerTracks();
        };

        const looksLikeMBID = (val) =>
          /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
            val || ''
          );

        if (!looksLikeMBID(releaseGroupId)) {
          if (!artist || !album) {
            return res
              .status(400)
              .json({ error: 'artist and album are required' });
          }

          const searchReleaseGroups = async (query) => {
            const url =
              `https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(query)}` +
              `&type=album|ep&fmt=json&limit=10`;
            const resp = await mbFetch(url, { headers });
            if (!resp.ok) {
              throw new Error(`MusicBrainz search responded ${resp.status}`);
            }
            const data = await resp.json();
            return data['release-groups'] || [];
          };

          let groups = await searchReleaseGroups(
            `release:${albumClean} AND artist:${artistClean}`
          );
          if (
            !groups.length &&
            (albumClean !== album || artistClean !== artist)
          ) {
            groups = await searchReleaseGroups(
              `release:${album} AND artist:${artist}`
            );
          }

          if (!groups.length) {
            // Fallback: try release search instead of release-group
            const relUrl =
              `https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(`${albumClean} ${artistClean}`)}` +
              `&fmt=json&limit=10`;
            const relResp = await mbFetch(relUrl, { headers });
            if (relResp.ok) {
              const relData = await relResp.json();
              const releases = relData.releases || [];
              if (releases.length) {
                releaseGroupId = releases[0]['release-group']?.id || null;
                directReleaseId = releases[0].id;
              }
            }
          } else {
            releaseGroupId = groups[0].id;
          }

          if (!releaseGroupId && !directReleaseId) {
            const fb = await runFallbacks();
            if (fb) return res.json(fb);
            return res.status(404).json({ error: 'Release group not found' });
          }
        }

        let releasesData;
        if (directReleaseId) {
          const mbUrl =
            `https://musicbrainz.org/ws/2/release/${directReleaseId}` +
            `?inc=recordings&fmt=json`;
          const resp = await mbFetch(mbUrl, { headers });
          if (!resp.ok) {
            throw new Error(`MusicBrainz responded ${resp.status}`);
          }
          const data = await resp.json();
          releasesData = [data];
        } else {
          const mbUrl =
            `https://musicbrainz.org/ws/2/release?release-group=${releaseGroupId}` +
            `&inc=recordings&fmt=json&limit=100`;
          const resp = await mbFetch(mbUrl, { headers });
          if (!resp.ok) {
            throw new Error(`MusicBrainz responded ${resp.status}`);
          }
          const data = await resp.json();
          if (!data.releases || !data.releases.length) {
            const fb = await runFallbacks();
            if (fb) return res.json(fb);
            return res.status(404).json({ error: 'No releases found' });
          }
          releasesData = data.releases;
        }

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
          if (!isNaN(date)) s += date.getTime() / 1e10; // minor weight
          return s;
        };

        const best = releasesData
          .map((r) => ({ ...r, _score: score(r) }))
          .filter((r) => r._score >= 0)
          .sort((a, b) => b._score - a._score)[0];

        if (!best || !best.media) {
          const fb = await runFallbacks();
          if (fb) return res.json(fb);
          return res.status(404).json({ error: 'No suitable release found' });
        }

        const tracks = [];
        for (const medium of best.media) {
          if (Array.isArray(medium.tracks)) {
            medium.tracks.forEach((t) => {
              const title = t.title || (t.recording && t.recording.title) || '';
              tracks.push(title);
            });
          }
        }

        if (!tracks.length) {
          const fb = await runFallbacks();
          if (fb) return res.json(fb);
          return res.status(404).json({ error: 'No tracks available' });
        }

        res.json({ tracks, releaseId: best.id });
      } catch (err) {
        logger.error('MusicBrainz tracks error:', err);
        res.status(500).json({ error: 'Failed to fetch tracks' });
      }
    }
  );

  // Playlist management endpoint
  app.post('/api/playlists/:listName', ensureAuthAPI, async (req, res) => {
    const { listName } = req.params;
    const { action = 'update', service } = req.body;

    logger.info('Playlist endpoint called:', {
      listName,
      action,
      service,
      body: req.body,
    });

    try {
      // Validate user has a preferred music service or service is specified
      const targetService = service || req.user.musicService;
      if (!targetService || !['spotify', 'tidal'].includes(targetService)) {
        return res.status(400).json({
          error:
            'No music service specified. Please set a preferred service in settings.',
          code: 'NO_SERVICE',
        });
      }

      // Check authentication for the target service
      const authField =
        targetService === 'spotify' ? 'spotifyAuth' : 'tidalAuth';
      const auth = req.user[authField];

      if (
        !auth ||
        !auth.access_token ||
        (auth.expires_at && auth.expires_at <= Date.now())
      ) {
        return res.status(400).json({
          error: `Not authenticated with ${targetService}. Please connect your ${targetService} account.`,
          code: 'NOT_AUTHENTICATED',
          service: targetService,
        });
      }

      // Check if playlist exists (for confirmation dialog)
      if (action === 'check') {
        logger.info('Playlist check action received:', {
          listName,
          targetService,
        });
        const exists = await checkPlaylistExists(listName, targetService, auth);
        logger.info('Playlist check result:', { listName, exists });
        return res.json({ exists, playlistName: listName });
      }

      // Get the list and its items
      const list = await listsAsync.findOne({
        userId: req.user._id,
        name: listName,
      });

      if (!list) {
        return res.status(404).json({ error: 'List not found' });
      }

      const items = await listItemsAsync.find({ listId: list._id });
      items.sort((a, b) => a.position - b.position);

      // Pre-flight validation
      const validation = await validatePlaylistData(items, targetService, auth);

      if (action === 'validate') {
        return res.json(validation);
      }

      // Create or update playlist
      const result = await createOrUpdatePlaylist(
        listName,
        items,
        targetService,
        auth,
        req.user,
        validation
      );

      res.json(result);
    } catch (err) {
      logger.error('Playlist operation error:', err);
      logger.error('Error stack:', err.stack);
      res.status(500).json({
        error: 'Failed to update playlist',
        details: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
      });
    }
  });

  // Check if playlist exists in the music service
  async function checkPlaylistExists(playlistName, targetService, auth) {
    logger.info('checkPlaylistExists called:', { playlistName, targetService });

    if (targetService === 'spotify') {
      const baseUrl = 'https://api.spotify.com/v1';
      const headers = {
        Authorization: `Bearer ${auth.access_token}`,
      };

      let offset = 0;
      let hasMore = true;
      let totalChecked = 0;
      let allPlaylistNames = [];

      while (hasMore) {
        try {
          const url = `${baseUrl}/me/playlists?limit=50&offset=${offset}`;
          logger.info('Fetching Spotify playlists:', { url, offset });

          const resp = await fetch(url, { headers });

          if (resp.ok) {
            const playlists = await resp.json();
            totalChecked += playlists.items.length;

            // Collect all playlist names for debugging
            allPlaylistNames = allPlaylistNames.concat(
              playlists.items.map((p) => p.name)
            );

            // Log details about this batch
            logger.info('Spotify playlists batch:', {
              count: playlists.items.length,
              total: playlists.total,
              offset,
              hasNext: playlists.next !== null,
              nextUrl: playlists.next,
              searchingFor: playlistName,
              batchNames: playlists.items.map((p) => ({
                name: p.name,
                owner: p.owner.display_name || p.owner.id,
                collaborative: p.collaborative,
                public: p.public,
              })),
            });

            const exists = playlists.items.some((p) => {
              // Log every comparison for debugging
              logger.debug('Comparing playlist names:', {
                searchName: playlistName,
                searchNameLength: playlistName.length,
                searchNameType: typeof playlistName,
                spotifyName: p.name,
                spotifyNameLength: p.name.length,
                spotifyNameType: typeof p.name,
                exactMatch: p.name === playlistName,
                caseInsensitiveMatch:
                  p.name.toLowerCase() === playlistName.toLowerCase(),
                trimmedMatch: p.name.trim() === playlistName.trim(),
              });

              const match = p.name === playlistName;
              if (match) {
                logger.info('Found matching Spotify playlist:', {
                  searchName: playlistName,
                  foundName: p.name,
                  playlistId: p.id,
                });
              }
              return match;
            });

            if (exists) return true;

            hasMore = playlists.next !== null;
            offset += 50;
          } else {
            logger.error('Failed to fetch Spotify playlists:', {
              status: resp.status,
              statusText: resp.statusText,
            });
            return false;
          }
        } catch (err) {
          logger.error('Error fetching Spotify playlists:', err);
          return false;
        }
      }

      logger.info('Playlist search complete', {
        totalChecked,
        searchName: playlistName,
        searchNameLength: playlistName.length,
        found: false,
        allPlaylistNames: allPlaylistNames.slice(0, 100), // Log first 100 names
        totalPlaylists: allPlaylistNames.length,
      });
      return false;
    } else if (targetService === 'tidal') {
      const baseUrl = 'https://openapi.tidal.com/v2';
      const headers = {
        Authorization: `Bearer ${auth.access_token}`,
        Accept: 'application/vnd.api+json',
      };

      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        try {
          const resp = await fetch(
            `${baseUrl}/me/playlists?limit=50&offset=${offset}`,
            { headers }
          );

          if (resp.ok) {
            const playlists = await resp.json();
            const exists = playlists.data.some(
              (p) => p.attributes.title === playlistName
            );
            if (exists) return true;

            hasMore = playlists.data.length === 50;
            offset += 50;
          } else {
            return false;
          }
        } catch (err) {
          return false;
        }
      }
      return false;
    }

    return false;
  }

  // Pre-flight validation for playlist creation
  async function validatePlaylistData(items, _service, _auth) {
    const validation = {
      totalAlbums: items.length,
      albumsWithTracks: 0,
      albumsWithoutTracks: 0,
      estimatedTracks: 0,
      warnings: [],
      canProceed: true,
    };

    for (const item of items) {
      const trackPick = item.trackPick || item.track_pick;
      if (trackPick && trackPick.trim()) {
        validation.albumsWithTracks++;
        validation.estimatedTracks++;
      } else {
        validation.albumsWithoutTracks++;
        validation.warnings.push(
          `"${item.artist} - ${item.album}" has no selected track`
        );
      }
    }

    if (validation.albumsWithoutTracks > 0) {
      validation.warnings.unshift(
        `${validation.albumsWithoutTracks} albums will be skipped (no selected tracks)`
      );
    }

    if (validation.estimatedTracks === 0) {
      validation.canProceed = false;
      validation.warnings.push(
        'No tracks selected. Please select tracks from your albums first.'
      );
    }

    return validation;
  }

  // Create or update playlist in the specified service
  async function createOrUpdatePlaylist(
    playlistName,
    items,
    service,
    auth,
    user,
    _validation
  ) {
    const result = {
      service,
      playlistName,
      processed: 0,
      successful: 0,
      failed: 0,
      tracks: [],
      errors: [],
      playlistUrl: null,
    };

    try {
      if (service === 'spotify') {
        return await handleSpotifyPlaylist(
          playlistName,
          items,
          auth,
          user,
          result
        );
      } else if (service === 'tidal') {
        return await handleTidalPlaylist(
          playlistName,
          items,
          auth,
          user,
          result
        );
      }
    } catch (err) {
      logger.error(`${service} playlist error:`, err);
      logger.error(`${service} error stack:`, err.stack);
      throw err;
    }
  }

  // Spotify playlist handling
  async function handleSpotifyPlaylist(
    playlistName,
    items,
    auth,
    user,
    result
  ) {
    logger.debug('Starting Spotify playlist creation', {
      playlistName,
      itemCount: items.length,
    });

    const baseUrl = 'https://api.spotify.com/v1';
    const headers = {
      Authorization: `Bearer ${auth.access_token}`,
      'Content-Type': 'application/json',
    };

    // Get user's Spotify profile
    logger.debug('Fetching Spotify profile');
    const profileResp = await fetch(`${baseUrl}/me`, { headers });
    if (!profileResp.ok) {
      const errorText = await profileResp.text();
      logger.error('Spotify profile fetch failed', {
        status: profileResp.status,
        error: errorText,
      });
      throw new Error(
        `Failed to get Spotify profile: ${profileResp.status} - ${errorText}`
      );
    }
    const profile = await profileResp.json();
    logger.debug('Spotify profile fetched', { userId: profile.id });

    // Check if playlist exists
    let playlistId = null;
    let existingPlaylist = null;

    logger.debug('Checking for existing playlists');
    const playlistsResp = await fetch(`${baseUrl}/me/playlists?limit=50`, {
      headers,
    });
    if (playlistsResp.ok) {
      const playlists = await playlistsResp.json();
      existingPlaylist = playlists.items.find((p) => p.name === playlistName);
      if (existingPlaylist) {
        playlistId = existingPlaylist.id;
        logger.debug('Found existing playlist', { playlistId });
      } else {
        logger.debug('No existing playlist found');
      }
    } else {
      const errorText = await playlistsResp.text();
      logger.error('Failed to fetch playlists', {
        status: playlistsResp.status,
        error: errorText,
      });
    }

    // Create playlist if it doesn't exist
    if (!playlistId) {
      logger.debug('Creating new playlist');
      const createResp = await fetch(
        `${baseUrl}/users/${profile.id}/playlists`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            name: playlistName,
            description: `Created from SuShe Online list "${playlistName}"`,
            public: false,
          }),
        }
      );

      if (!createResp.ok) {
        const errorText = await createResp.text();
        logger.error('Failed to create playlist', {
          status: createResp.status,
          error: errorText,
        });
        throw new Error(
          `Failed to create Spotify playlist: ${createResp.status} - ${errorText}`
        );
      }

      const newPlaylist = await createResp.json();
      playlistId = newPlaylist.id;
      result.playlistUrl = newPlaylist.external_urls.spotify;
    } else {
      result.playlistUrl = existingPlaylist.external_urls.spotify;
    }

    // Collect track URIs
    const trackUris = [];

    for (const item of items) {
      result.processed++;

      const trackPick = item.trackPick || item.track_pick;
      if (!trackPick || !trackPick.trim()) {
        result.errors.push(
          `Skipped "${item.artist} - ${item.album}": no track selected`
        );
        continue;
      }

      try {
        const trackUri = await findSpotifyTrack(item, auth);
        if (trackUri) {
          trackUris.push(trackUri);
          result.successful++;
          result.tracks.push({
            artist: item.artist,
            album: item.album,
            track: trackPick,
            found: true,
          });
        } else {
          result.failed++;
          result.errors.push(
            `Track not found: "${item.artist} - ${item.album}" - Track ${item.trackPick}`
          );
          result.tracks.push({
            artist: item.artist,
            album: item.album,
            track: trackPick,
            found: false,
          });
        }
      } catch (err) {
        result.failed++;
        result.errors.push(
          `Error searching for "${item.artist} - ${item.album}": ${err.message}`
        );
      }
    }

    // Update playlist with tracks
    if (trackUris.length > 0) {
      // Clear existing tracks
      await fetch(`${baseUrl}/playlists/${playlistId}/tracks`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ uris: [] }),
      });

      // Add new tracks in batches of 100 (Spotify limit)
      for (let i = 0; i < trackUris.length; i += 100) {
        const batch = trackUris.slice(i, i + 100);
        const addResp = await fetch(
          `${baseUrl}/playlists/${playlistId}/tracks`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ uris: batch }),
          }
        );

        if (!addResp.ok) {
          logger.warn(
            `Failed to add tracks batch ${i}-${i + batch.length}: ${addResp.status}`
          );
        }
      }
    }

    return result;
  }

  // Find Spotify track URI
  async function findSpotifyTrack(item, auth) {
    const trackPick = item.trackPick || item.track_pick;
    const headers = {
      Authorization: `Bearer ${auth.access_token}`,
    };

    // First try to get album tracks if we have album_id
    if (item.albumId) {
      try {
        const albumResp = await fetch(
          `https://api.spotify.com/v1/search?q=album:${encodeURIComponent(item.album)} artist:${encodeURIComponent(item.artist)}&type=album&limit=1`,
          { headers }
        );
        if (albumResp.ok) {
          const albumData = await albumResp.json();
          if (albumData.albums.items.length > 0) {
            const spotifyAlbumId = albumData.albums.items[0].id;
            const tracksResp = await fetch(
              `https://api.spotify.com/v1/albums/${spotifyAlbumId}/tracks`,
              { headers }
            );
            if (tracksResp.ok) {
              const tracksData = await tracksResp.json();

              // Try to match by track number
              const trackNum = parseInt(trackPick);
              if (
                !isNaN(trackNum) &&
                trackNum > 0 &&
                trackNum <= tracksData.tracks.items.length
              ) {
                return tracksData.tracks.items[trackNum - 1].uri;
              }

              // Try to match by track name
              const matchingTrack = tracksData.tracks.items.find(
                (t) =>
                  t.name.toLowerCase().includes(trackPick.toLowerCase()) ||
                  trackPick.toLowerCase().includes(t.name.toLowerCase())
              );
              if (matchingTrack) {
                return matchingTrack.uri;
              }
            }
          }
        }
      } catch (err) {
        logger.debug('Album-based track search failed:', err);
      }
    }

    // Fallback to general track search
    try {
      const query = `track:${trackPick} album:${item.album} artist:${item.artist}`;
      const searchResp = await fetch(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=1`,
        { headers }
      );
      if (searchResp.ok) {
        const searchData = await searchResp.json();
        if (searchData.tracks.items.length > 0) {
          return searchData.tracks.items[0].uri;
        }
      }
    } catch (err) {
      logger.debug('Track search failed:', err);
    }

    return null;
  }

  // Tidal playlist handling
  async function handleTidalPlaylist(playlistName, items, auth, user, result) {
    const baseUrl = 'https://openapi.tidal.com/v2';
    const headers = {
      Authorization: `Bearer ${auth.access_token}`,
      'Content-Type': 'application/vnd.api+json',
      Accept: 'application/vnd.api+json',
    };

    // Get user's Tidal profile
    const profileResp = await fetch(`${baseUrl}/me`, { headers });
    if (!profileResp.ok) {
      throw new Error(`Failed to get Tidal profile: ${profileResp.status}`);
    }
    const profile = await profileResp.json();
    const _userId = profile.data.id;

    // Check if playlist exists
    let playlistId = null;
    let existingPlaylist = null;

    try {
      const playlistsResp = await fetch(`${baseUrl}/me/playlists?limit=50`, {
        headers,
      });
      if (playlistsResp.ok) {
        const playlists = await playlistsResp.json();
        existingPlaylist = playlists.data.find(
          (p) => p.attributes.title === playlistName
        );
        if (existingPlaylist) {
          playlistId = existingPlaylist.id;
        }
      }
    } catch (err) {
      logger.debug('Error fetching Tidal playlists:', err);
    }

    // Create playlist if it doesn't exist
    if (!playlistId) {
      const createResp = await fetch(`${baseUrl}/playlists`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          data: {
            type: 'playlists',
            attributes: {
              title: playlistName,
              description: `Created from SuShe Online list "${playlistName}"`,
              public: false,
            },
          },
        }),
      });

      if (!createResp.ok) {
        const errorText = await createResp.text();
        logger.error(
          'Tidal playlist creation failed:',
          createResp.status,
          errorText
        );
        throw new Error(
          `Failed to create Tidal playlist: ${createResp.status}`
        );
      }

      const newPlaylist = await createResp.json();
      playlistId = newPlaylist.data.id;
      result.playlistUrl = `https://tidal.com/browse/playlist/${playlistId}`;
    } else {
      result.playlistUrl = `https://tidal.com/browse/playlist/${playlistId}`;
    }

    // Collect track IDs
    const trackIds = [];

    for (const item of items) {
      result.processed++;

      const trackPick = item.trackPick || item.track_pick;
      if (!trackPick || !trackPick.trim()) {
        result.errors.push(
          `Skipped "${item.artist} - ${item.album}": no track selected`
        );
        continue;
      }

      try {
        const trackId = await findTidalTrack(item, auth, user.tidalCountry);
        if (trackId) {
          trackIds.push(trackId);
          result.successful++;
          result.tracks.push({
            artist: item.artist,
            album: item.album,
            track: trackPick,
            found: true,
          });
        } else {
          result.failed++;
          result.errors.push(
            `Track not found: "${item.artist} - ${item.album}" - Track ${item.trackPick}`
          );
          result.tracks.push({
            artist: item.artist,
            album: item.album,
            track: trackPick,
            found: false,
          });
        }
      } catch (err) {
        result.failed++;
        result.errors.push(
          `Error searching for "${item.artist} - ${item.album}": ${err.message}`
        );
      }
    }

    // Update playlist with tracks
    if (trackIds.length > 0) {
      // Clear existing tracks first
      try {
        await fetch(`${baseUrl}/playlists/${playlistId}/items`, {
          method: 'DELETE',
          headers,
        });
      } catch (err) {
        logger.debug('Error clearing Tidal playlist:', err);
      }

      // Add new tracks in batches
      for (let i = 0; i < trackIds.length; i += 50) {
        const batch = trackIds.slice(i, i + 50);
        const trackData = batch.map((id) => ({
          type: 'tracks',
          id: id,
        }));

        try {
          const addResp = await fetch(
            `${baseUrl}/playlists/${playlistId}/items`,
            {
              method: 'POST',
              headers,
              body: JSON.stringify({
                data: trackData,
              }),
            }
          );

          if (!addResp.ok) {
            logger.warn(
              `Failed to add Tidal tracks batch ${i}-${i + batch.length}: ${addResp.status}`
            );
          }
        } catch (err) {
          logger.warn(`Error adding Tidal tracks batch:`, err);
        }
      }
    }

    return result;
  }

  // Find Tidal track ID
  async function findTidalTrack(item, auth, countryCode = 'US') {
    const trackPick = item.trackPick || item.track_pick;
    const headers = {
      Authorization: `Bearer ${auth.access_token}`,
      Accept: 'application/vnd.api+json',
    };

    // First try to search for the album and get tracks
    try {
      const albumQuery = `${item.artist} ${item.album}`;
      const albumSearchResp = await fetch(
        `https://openapi.tidal.com/v2/searchresults/albums?query=${encodeURIComponent(albumQuery)}&countryCode=${countryCode}&limit=1`,
        { headers }
      );

      if (albumSearchResp.ok) {
        const albumData = await albumSearchResp.json();
        if (albumData.data && albumData.data.length > 0) {
          const tidalAlbumId = albumData.data[0].id;

          // Get album tracks
          const tracksResp = await fetch(
            `https://openapi.tidal.com/v2/albums/${tidalAlbumId}/items?countryCode=${countryCode}`,
            { headers }
          );

          if (tracksResp.ok) {
            const tracksData = await tracksResp.json();

            // Try to match by track number
            const trackNum = parseInt(trackPick);
            if (
              !isNaN(trackNum) &&
              trackNum > 0 &&
              tracksData.data &&
              trackNum <= tracksData.data.length
            ) {
              return tracksData.data[trackNum - 1].id;
            }

            // Try to match by track name
            if (tracksData.data) {
              const matchingTrack = tracksData.data.find(
                (t) =>
                  t.attributes.title
                    .toLowerCase()
                    .includes(trackPick.toLowerCase()) ||
                  trackPick
                    .toLowerCase()
                    .includes(t.attributes.title.toLowerCase())
              );
              if (matchingTrack) {
                return matchingTrack.id;
              }
            }
          }
        }
      }
    } catch (err) {
      logger.debug('Tidal album-based track search failed:', err);
    }

    // Fallback to general track search
    try {
      const trackQuery = `${item.artist} ${item.album} ${trackPick}`;
      const searchResp = await fetch(
        `https://openapi.tidal.com/v2/searchresults/tracks?query=${encodeURIComponent(trackQuery)}&countryCode=${countryCode}&limit=1`,
        { headers }
      );

      if (searchResp.ok) {
        const searchData = await searchResp.json();
        if (searchData.data && searchData.data.length > 0) {
          return searchData.data[0].id;
        }
      }
    } catch (err) {
      logger.debug('Tidal track search failed:', err);
    }

    return null;
  }
};
