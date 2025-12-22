// Ensure fetch is available
const fetch = globalThis.fetch || require('node-fetch');
const sharp = require('sharp');

// Import queue utilities
const {
  MusicBrainzQueue,
  RequestQueue,
  createMbFetch,
} = require('../utils/request-queue');

// Create queue instances
const mbQueue = new MusicBrainzQueue({ fetch });
const mbFetch = createMbFetch(mbQueue);
const imageProxyQueue = new RequestQueue(10); // Max 10 concurrent image fetches

// Import deduplication helpers
const {
  clearAlbumCache,
  getStorableValue,
  getStorableTracksValue,
} = require('../utils/deduplication');

module.exports = (app, deps) => {
  const logger = require('../utils/logger');
  const {
    cacheConfigs,
    responseCache,
  } = require('../middleware/response-cache');
  const {
    forgotPasswordRateLimit,
    resetPasswordRateLimit,
  } = require('../middleware/rate-limit');
  const { ensureValidSpotifyToken } = require('../utils/spotify-auth');
  const { ensureValidTidalToken } = require('../utils/tidal-auth');
  const { URLSearchParams } = require('url');
  const {
    htmlTemplate,
    forgotPasswordTemplate,
    invalidTokenTemplate,
    resetPasswordTemplate,
  } = require('../templates');
  const { validateYear } = require('../validators');
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
  // Get album cover image
  app.get('/api/albums/:album_id/cover', ensureAuthAPI, async (req, res) => {
    try {
      const { album_id } = req.params;

      // Query albums table for cover image
      const result = await pool.query(
        'SELECT cover_image, cover_image_format FROM albums WHERE album_id = $1',
        [album_id]
      );

      if (!result.rows.length || !result.rows[0].cover_image) {
        return res.status(404).json({ error: 'Image not found' });
      }

      const { cover_image, cover_image_format } = result.rows[0];

      // Convert base64 to buffer
      const imageBuffer = Buffer.from(cover_image, 'base64');

      // Determine content type
      const contentType = cover_image_format
        ? `image/${cover_image_format.toLowerCase()}`
        : 'image/jpeg';

      // Set aggressive caching headers (images rarely change)
      res.set({
        'Content-Type': contentType,
        'Content-Length': imageBuffer.length,
        'Cache-Control': 'public, max-age=31536000, immutable', // 1 year
        ETag: `"${album_id}-${cover_image.length}"`,
      });

      res.send(imageBuffer);
    } catch (err) {
      logger.error('Error fetching album cover:', {
        error: err.message,
        albumId: req.params.album_id,
      });
      res.status(500).json({ error: 'Error fetching image' });
    }
  });

  // Batch fetch multiple album covers - reduces N requests to 1
  app.get('/api/albums/covers', ensureAuthAPI, async (req, res) => {
    try {
      const { ids } = req.query;

      if (!ids) {
        return res.status(400).json({ error: 'Missing ids parameter' });
      }

      // Parse comma-separated IDs and validate
      const albumIds = ids
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0);

      if (albumIds.length === 0) {
        return res.json({ covers: {} });
      }

      // Limit to prevent abuse (100 covers per request should be plenty)
      if (albumIds.length > 100) {
        return res
          .status(400)
          .json({ error: 'Too many IDs requested (max 100)' });
      }

      // Single query for all covers
      const result = await pool.query(
        'SELECT album_id, cover_image, cover_image_format FROM albums WHERE album_id = ANY($1)',
        [albumIds]
      );

      // Build response object with data URIs
      const covers = {};
      for (const row of result.rows) {
        if (row.cover_image) {
          const format = (row.cover_image_format || 'jpeg').toLowerCase();
          covers[row.album_id] =
            `data:image/${format};base64,${row.cover_image}`;
        }
      }

      // Cache for 1 hour (covers don't change often)
      res.set({
        'Cache-Control': 'private, max-age=3600',
      });

      res.json({ covers });
    } catch (err) {
      logger.error('Error fetching album covers batch:', {
        error: err.message,
        idsCount: req.query.ids?.split(',').length,
      });
      res.status(500).json({ error: 'Error fetching covers' });
    }
  });

  app.get(
    '/api/lists',
    ensureAuthAPI,
    cacheConfigs.userSpecific,
    async (req, res) => {
      try {
        const userLists = await listsAsync.find({ userId: req.user._id });
        const { full } = req.query;

        const listsObj = {};

        if (full === 'true') {
          // FULL MODE: Return all album data (backward compatibility)
          for (const list of userLists) {
            const items = await listItemsAsync.find({ listId: list._id });
            items.sort((a, b) => a.position - b.position);

            // Batch load album data to avoid N+1 queries
            const albumIds = items.map((item) => item.albumId).filter(Boolean);
            const albumsData =
              albumIds.length > 0
                ? await albumsAsync.findByAlbumIds(albumIds)
                : [];
            const albumsMap = new Map(
              albumsData.map((album) => [album.albumId, album])
            );

            const mapped = [];
            for (const item of items) {
              const albumData = item.albumId
                ? albumsMap.get(item.albumId)
                : null;
              mapped.push({
                artist: item.artist || albumData?.artist,
                album: item.album || albumData?.album,
                album_id: item.albumId,
                release_date: item.releaseDate || albumData?.releaseDate,
                country: item.country || albumData?.country,
                genre_1: item.genre1 || albumData?.genre1,
                genre_2: item.genre2 || albumData?.genre2,
                track_pick: item.trackPick,
                comments: item.comments,
                tracks: item.tracks || albumData?.tracks,
                cover_image: item.coverImage || albumData?.coverImage,
                cover_image_format:
                  item.coverImageFormat || albumData?.coverImageFormat,
              });
            }
            listsObj[list.name] = mapped;
          }
        } else {
          // METADATA MODE (default): Return only list metadata for fast loading
          // This dramatically improves page refresh performance by avoiding
          // loading all album data when we only need list names for the sidebar
          for (const list of userLists) {
            const count = await listItemsAsync.count({ listId: list._id });
            listsObj[list.name] = {
              _id: list._id, // List ID - needed for playcount API
              name: list.name,
              year: list.year || null,
              isOfficial: list.isOfficial || false,
              count: count,
              updatedAt: list.updatedAt,
              createdAt: list.createdAt,
            };
          }
        }

        res.json(listsObj);
      } catch (err) {
        logger.error('Error fetching lists:', err);
        return res.status(500).json({ error: 'Error fetching lists' });
      }
    }
  );

  // Points calculation for export (matches client-side logic in import-export.js)
  const POSITION_POINTS = {
    1: 60,
    2: 54,
    3: 50,
    4: 46,
    5: 43,
    6: 40,
    7: 38,
    8: 36,
    9: 34,
    10: 32,
    11: 30,
    12: 29,
    13: 28,
    14: 27,
    15: 26,
    16: 25,
    17: 24,
    18: 23,
    19: 22,
    20: 21,
    21: 20,
    22: 19,
    23: 18,
    24: 17,
    25: 16,
    26: 15,
    27: 14,
    28: 13,
    29: 12,
    30: 11,
    31: 10,
    32: 9,
    33: 8,
    34: 7,
    35: 6,
    36: 5,
    37: 4,
    38: 3,
    39: 2,
    40: 1,
  };
  const getPointsForPosition = (position) => POSITION_POINTS[position] || 1;

  // Get a single list
  // Use ?export=true to get full data with embedded base64 images for JSON export
  app.get(
    '/api/lists/:name',
    ensureAuthAPI,
    cacheConfigs.userSpecific,
    async (req, res) => {
      try {
        const { name } = req.params;
        const isExport = req.query.export === 'true';
        logger.debug('Fetching list:', {
          name,
          userId: req.user._id,
          isExport,
        });
        const list = await listsAsync.findOne({ userId: req.user._id, name });

        if (!list) {
          logger.warn('List not found:', { name, userId: req.user._id });
          return res.status(404).json({ error: 'List not found' });
        }
        logger.debug('List found:', { listId: list._id, name });

        // OPTIMIZED: Use single JOIN query instead of 3 separate queries
        // Old approach: findOne + find + findByAlbumIds + Map construction
        // New approach: findOne + findWithAlbumData (with JOIN)
        // Performance improvement: ~30-40% faster, reduces DB round-trips
        const items = await listItemsAsync.findWithAlbumData(list._id);

        // Transform to API response format (already sorted by position in query)
        // When export=true: include base64 images, rank, and points for JSON export
        // Otherwise: return image URLs for faster page loading
        const data = items.map((item, index) => ({
          _id: item._id, // List item ID - used for playcount tracking
          artist: item.artist,
          album: item.album,
          album_id: item.albumId,
          release_date: item.releaseDate,
          country: item.country,
          genre_1: item.genre1,
          genre_2: item.genre2,
          track_pick: item.trackPick,
          comments: item.comments,
          tracks: item.tracks,
          cover_image_format: item.coverImageFormat,
          // Export mode: embed base64 images + rank/points for shareable JSON
          // Normal mode: return URLs for fast parallel loading & caching
          ...(isExport
            ? {
                cover_image: item.coverImage || '',
                rank: index + 1,
                points: getPointsForPosition(index + 1),
              }
            : {
                cover_image_url: item.albumId
                  ? `/api/albums/${item.albumId}/cover`
                  : null,
                // Keep base64 as fallback for custom images (not in albums table)
                ...(item.coverImage && !item.albumId
                  ? { cover_image: item.coverImage }
                  : {}),
              }),
        }));

        res.json(data);
      } catch (err) {
        logger.error('Error fetching list:', {
          error: err.message,
          stack: err.stack,
          listName: req.params.name,
          userId: req.user?._id,
        });
        return res.status(500).json({ error: 'Error fetching list' });
      }
    }
  );

  // Create or update a list
  app.post('/api/lists/:name', ensureAuthAPI, async (req, res) => {
    const { name } = req.params;
    const { data, year } = req.body;

    if (!data || !Array.isArray(data)) {
      return res.status(400).json({ error: 'Invalid list data' });
    }

    // Validate year if provided
    const yearValidation = validateYear(year);
    if (!yearValidation.valid) {
      return res.status(400).json({ error: yearValidation.error });
    }

    let client;
    try {
      // Check if list exists
      const existingList = await lists.findOne({ userId: req.user._id, name });

      // For new lists, year is required
      if (!existingList && yearValidation.value === null) {
        return res
          .status(400)
          .json({ error: 'Year is required for new lists' });
      }

      const timestamp = new Date();
      client = await pool.connect();

      try {
        await client.query('BEGIN');
        let listId = existingList ? existingList._id : null;
        if (existingList) {
          // Update existing list - only update year if provided
          if (yearValidation.value !== null) {
            await client.query(
              'UPDATE lists SET updated_at=$1, year=$2 WHERE _id=$3',
              [timestamp, yearValidation.value, listId]
            );
          } else {
            await client.query('UPDATE lists SET updated_at=$1 WHERE _id=$2', [
              timestamp,
              listId,
            ]);
          }
          await client.query('DELETE FROM list_items WHERE list_id=$1', [
            listId,
          ]);
        } else {
          // Create new list with year (required)
          const resList = await client.query(
            'INSERT INTO lists (_id, user_id, name, year, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING _id',
            [
              crypto.randomBytes(12).toString('hex'),
              req.user._id,
              name,
              yearValidation.value,
              timestamp,
              timestamp,
            ]
          );
          listId = resList.rows[0]._id;
        }

        const placeholders = [];
        const values = [];
        let idx = 1;

        // Clear album cache for this batch operation
        clearAlbumCache();

        for (let i = 0; i < data.length; i++) {
          const album = data[i];
          if (album.album_id) {
            await upsertAlbumRecord(album, timestamp);
          }

          // Deduplicate: Only store values that differ from albums table
          // NULL = "use albums table value", non-NULL = "custom override"
          const albumId = album.album_id || '';

          placeholders.push(
            `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`
          );
          values.push(
            crypto.randomBytes(12).toString('hex'),
            listId,
            i + 1,
            await getStorableValue(
              album.artist || null,
              albumId,
              'artist',
              client
            ),
            await getStorableValue(
              album.album || null,
              albumId,
              'album',
              client
            ),
            albumId,
            await getStorableValue(
              album.release_date || null,
              albumId,
              'release_date',
              client
            ),
            await getStorableValue(
              album.country || null,
              albumId,
              'country',
              client
            ),
            await getStorableValue(
              album.genre_1 || album.genre || null,
              albumId,
              'genre_1',
              client
            ),
            await getStorableValue(
              album.genre_2 || null,
              albumId,
              'genre_2',
              client
            ),
            album.comments || album.comment || null, // Always store (list-specific)
            await getStorableTracksValue(
              Array.isArray(album.tracks) ? album.tracks : null,
              albumId,
              client
            ),
            album.track_pick || null, // Always store (list-specific)
            await getStorableValue(
              album.cover_image || null,
              albumId,
              'cover_image',
              client
            ),
            await getStorableValue(
              album.cover_image_format || null,
              albumId,
              'cover_image_format',
              client
            ),
            timestamp,
            timestamp
          );
        }

        // Clear cache after batch
        clearAlbumCache();

        if (placeholders.length) {
          await client.query(
            `INSERT INTO list_items (_id, list_id, position, artist, album, album_id, release_date, country, genre_1, genre_2, comments, tracks, track_pick, cover_image, cover_image_format, created_at, updated_at) VALUES ${placeholders.join(',')}`,
            values
          );
        }

        await client.query('COMMIT');

        // Invalidate cache BEFORE sending response to prevent race condition
        // Use req.originalUrl to match the exact cache key format (includes URL encoding)
        responseCache.invalidate(`GET:${req.originalUrl}:${req.user._id}`);
        responseCache.invalidate(`GET:/api/lists:${req.user._id}`);

        res.json({
          success: true,
          message: existingList ? 'List updated' : 'List created',
        });
      } catch (dbErr) {
        await client.query('ROLLBACK');
        logger.error('Error updating list:', dbErr);
        res.status(500).json({ error: 'Database error' });
      } finally {
        client.release();
      }
    } catch (err) {
      logger.error('Error in list update:', err);
      // Only release client if it was acquired
      if (client) {
        client.release();
      }
      return res.status(500).json({ error: 'Database error' });
    }
  });

  // Update list metadata (name and/or year)
  app.patch('/api/lists/:name', ensureAuthAPI, async (req, res) => {
    const { name } = req.params;
    const { newName, year } = req.body;

    // At least one field must be provided
    if (newName === undefined && year === undefined) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Validate year if provided
    if (year !== undefined) {
      const yearValidation = validateYear(year);
      if (!yearValidation.valid) {
        return res.status(400).json({ error: yearValidation.error });
      }
    }

    try {
      // Check if list exists
      const existingList = await listsAsync.findOne({
        userId: req.user._id,
        name,
      });
      if (!existingList) {
        return res.status(404).json({ error: 'List not found' });
      }

      // If renaming, check for conflicts
      if (newName && newName !== name) {
        const conflictingList = await listsAsync.findOne({
          userId: req.user._id,
          name: newName,
        });
        if (conflictingList) {
          return res
            .status(409)
            .json({ error: 'A list with that name already exists' });
        }
      }

      // Build dynamic update
      const updates = [];
      const values = [];
      let paramIndex = 1;

      if (newName && newName !== name) {
        updates.push(`name = $${paramIndex++}`);
        values.push(newName);
      }

      if (year !== undefined) {
        const yearValidation = validateYear(year);
        updates.push(`year = $${paramIndex++}`);
        values.push(yearValidation.value);
      }

      updates.push(`updated_at = $${paramIndex++}`);
      values.push(new Date());

      values.push(existingList._id);

      await pool.query(
        `UPDATE lists SET ${updates.join(', ')} WHERE _id = $${paramIndex}`,
        values
      );

      // Update lastSelectedList if this list was renamed
      if (newName && newName !== name && req.user.lastSelectedList === name) {
        users.update(
          { _id: req.user._id },
          { $set: { lastSelectedList: newName } },
          {},
          (updateErr) => {
            if (updateErr) {
              logger.error('Error updating last selected list:', updateErr);
            }
          }
        );
      }

      // Invalidate caches
      responseCache.invalidate(
        `GET:/api/lists/${encodeURIComponent(name)}:${req.user._id}`
      );
      if (newName && newName !== name) {
        responseCache.invalidate(
          `GET:/api/lists/${encodeURIComponent(newName)}:${req.user._id}`
        );
      }
      responseCache.invalidate(`GET:/api/lists:${req.user._id}`);

      // Return updated metadata
      const yearValidation =
        year !== undefined ? validateYear(year) : { value: existingList.year };
      res.json({
        success: true,
        name: newName || name,
        year: yearValidation.value,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      logger.error('Error updating list metadata:', err);
      return res.status(500).json({ error: 'Database error' });
    }
  });

  // Toggle official status for a list
  app.post('/api/lists/:name/official', ensureAuthAPI, async (req, res) => {
    const { name } = req.params;
    const { isOfficial } = req.body;

    // isOfficial must be a boolean
    if (typeof isOfficial !== 'boolean') {
      return res.status(400).json({ error: 'isOfficial must be a boolean' });
    }

    try {
      // Check if list exists
      const existingList = await listsAsync.findOne({
        userId: req.user._id,
        name,
      });

      if (!existingList) {
        return res.status(404).json({ error: 'List not found' });
      }

      // A list must have a year to be marked as official
      if (isOfficial && !existingList.year) {
        return res.status(400).json({
          error: 'Cannot mark as official: list must have a year assigned',
        });
      }

      let previousOfficialList = null;

      // If setting as official, first remove official status from any other list for this year
      if (isOfficial) {
        const currentOfficial = await listsAsync.findOne({
          userId: req.user._id,
          year: existingList.year,
          isOfficial: true,
        });

        if (currentOfficial && currentOfficial._id !== existingList._id) {
          previousOfficialList = currentOfficial.name;
          await pool.query(
            'UPDATE lists SET is_official = FALSE, updated_at = $1 WHERE _id = $2',
            [new Date(), currentOfficial._id]
          );
        }
      }

      // Update the list's official status
      await pool.query(
        'UPDATE lists SET is_official = $1, updated_at = $2 WHERE _id = $3',
        [isOfficial, new Date(), existingList._id]
      );

      // Invalidate caches
      responseCache.invalidate(
        `GET:/api/lists/${encodeURIComponent(name)}:${req.user._id}`
      );
      responseCache.invalidate(`GET:/api/lists:${req.user._id}`);

      res.json({
        success: true,
        name: name,
        year: existingList.year,
        isOfficial: isOfficial,
        previousOfficialList: previousOfficialList,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      logger.error('Error updating official status:', err);
      return res.status(500).json({ error: 'Database error' });
    }
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

      // Invalidate cache for deleted list and list index
      responseCache.invalidate(
        `GET:/api/lists/${encodeURIComponent(name)}:${req.user._id}`
      );
      responseCache.invalidate(`GET:/api/lists:${req.user._id}`);

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
  app.post('/forgot', forgotPasswordRateLimit, csrfProtection, (req, res) => {
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

          // Support both Resend and SendGrid for email delivery
          // Prefer Resend if RESEND_API_KEY is set, otherwise fall back to SendGrid
          if (process.env.RESEND_API_KEY || process.env.SENDGRID_API_KEY) {
            const useResend = !!process.env.RESEND_API_KEY;
            const serviceName = useResend ? 'Resend' : 'SendGrid';

            const transporter = nodemailer.createTransport({
              host: useResend ? 'smtp.resend.com' : 'smtp.sendgrid.net',
              port: 587,
              auth: {
                user: useResend ? 'resend' : 'apikey',
                pass:
                  process.env.RESEND_API_KEY || process.env.SENDGRID_API_KEY,
              },
            });

            logger.info(`Email service configured: ${serviceName}`);

            const resetUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/reset/${token}`;
            const emailOptions = composeForgotPasswordEmail(
              user.email,
              resetUrl
            );

            transporter.sendMail(emailOptions, (error, _info) => {
              if (error) {
                logger.error(
                  `Failed to send password reset email via ${serviceName}:`,
                  error.message
                );
              } else {
                logger.info(
                  `Password reset email sent successfully via ${serviceName}`,
                  {
                    email: user.email,
                  }
                );
              }
            });
          } else {
            logger.warn(
              'No email service configured (RESEND_API_KEY or SENDGRID_API_KEY required) - password reset email not sent'
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
            resetPasswordTemplate(req.params.token, req.csrfToken()),
            'Reset Password - Black Metal Auth'
          )
        );
      }
    );
  });

  // Handle password reset
  app.post(
    '/reset/:token',
    resetPasswordRateLimit,
    csrfProtection,
    async (req, res) => {
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
    }
  );

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

  // Deezer artist search proxy for direct artist image fetching
  app.get(
    '/api/proxy/deezer/artist',
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

        const url = `https://api.deezer.com/search/artist?q=${encodeURIComponent(q)}&limit=30`;
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(
            `Deezer API responded with status ${response.status}`
          );
        }

        const data = await response.json();
        res.json(data);
      } catch (error) {
        logger.error('Deezer artist proxy error:', error);
        res.status(500).json({ error: 'Failed to fetch artist from Deezer' });
      }
    }
  );

  // Deezer artist albums proxy - get all albums for an artist
  app.get(
    '/api/proxy/deezer/artist/:artistId/albums',
    ensureAuthAPI,
    cacheConfigs.public,
    async (req, res) => {
      try {
        const { artistId } = req.params;
        if (!artistId) {
          return res.status(400).json({ error: 'Artist ID is required' });
        }

        const url = `https://api.deezer.com/artist/${artistId}/albums?limit=100`;
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(
            `Deezer API responded with status ${response.status}`
          );
        }

        const data = await response.json();
        res.json(data);
      } catch (error) {
        logger.error('Deezer artist albums proxy error:', error);
        res
          .status(500)
          .json({ error: 'Failed to fetch artist albums from Deezer' });
      }
    }
  );

  // Proxy for MusicBrainz API to avoid CORS issues and handle rate limiting
  app.get(
    '/api/proxy/musicbrainz',
    ensureAuthAPI,
    cacheConfigs.public,
    async (req, res) => {
      try {
        const { endpoint, priority } = req.query;
        if (!endpoint) {
          return res
            .status(400)
            .json({ error: 'Query parameter endpoint is required' });
        }

        // Determine request priority
        // high: user-initiated searches, album lists
        // normal: artist metadata for display
        // low: background image fetching
        const requestPriority = priority || 'normal';

        // Use the MusicBrainz rate-limited fetch function with priority
        const url = `https://musicbrainz.org/ws/2/${endpoint}`;
        const response = await mbFetch(
          url,
          {
            headers: {
              'User-Agent': `SuSheOnline/1.0 ( ${process.env.BASE_URL || 'https://github.com/yourusername/sushe-online'} )`,
              Accept: 'application/json',
            },
          },
          requestPriority
        );

        if (!response.ok) {
          throw new Error(
            `MusicBrainz API responded with status ${response.status}`
          );
        }

        const data = await response.json();
        res.json(data);
      } catch (error) {
        logger.error('MusicBrainz proxy error:', {
          message: error.message,
          stack: error.stack,
          endpoint: req.query.endpoint,
          url: req.query.endpoint
            ? `https://musicbrainz.org/ws/2/${req.query.endpoint}`
            : 'unknown',
        });
        res.status(500).json({ error: 'Failed to fetch from MusicBrainz API' });
      }
    }
  );

  // Proxy for Wikidata API to avoid CORS issues
  app.get(
    '/api/proxy/wikidata',
    ensureAuthAPI,
    cacheConfigs.public,
    async (req, res) => {
      try {
        const { entity, property } = req.query;
        if (!entity || !property) {
          return res.status(400).json({
            error: 'Query parameters entity and property are required',
          });
        }

        const url = `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${encodeURIComponent(entity)}&property=${encodeURIComponent(property)}&format=json`;
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'SuSheBot/1.0 (kvlt.example.com)',
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(
            `Wikidata API responded with status ${response.status}`
          );
        }

        const data = await response.json();
        res.json(data);
      } catch (error) {
        logger.error('Wikidata proxy error:', error);
        res.status(500).json({ error: 'Failed to fetch from Wikidata API' });
      }
    }
  );

  // Proxy for iTunes Search API (album artwork)
  // Public API, no key required, ~20 req/min rate limit
  app.get(
    '/api/proxy/itunes',
    ensureAuthAPI,
    cacheConfigs.public,
    async (req, res) => {
      try {
        const { term, limit = 10 } = req.query;
        if (!term) {
          return res.status(400).json({
            error: 'Query parameter term is required',
          });
        }

        const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=album&country=us&limit=${limit}`;
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'SuSheOnline/1.0',
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(
            `iTunes API responded with status ${response.status}`
          );
        }

        const data = await response.json();
        res.json(data);
      } catch (error) {
        logger.error('iTunes proxy error:', error);
        res.status(500).json({ error: 'Failed to fetch from iTunes API' });
      }
    }
  );

  // Image proxy endpoint for fetching external cover art
  app.get(
    '/api/proxy/image',
    ensureAuthAPI,
    cacheConfigs.images,
    async (req, res) => {
      try {
        const { url } = req.query;
        if (!url) {
          return res.status(400).json({ error: 'URL parameter is required' });
        }

        // Validate URL to prevent SSRF attacks
        const allowedHosts = [
          'is1-ssl.mzstatic.com',
          'is2-ssl.mzstatic.com',
          'is3-ssl.mzstatic.com',
          'is4-ssl.mzstatic.com',
          'is5-ssl.mzstatic.com',
          'e-cdns-images.dzcdn.net',
          'cdn-images.dzcdn.net',
          'coverartarchive.org',
          'archive.org',
          'commons.wikimedia.org',
          'upload.wikimedia.org',
        ];

        const urlObj = new URL(url);
        const isAllowed = allowedHosts.some(
          (host) =>
            urlObj.hostname === host || urlObj.hostname.endsWith('.' + host)
        );

        if (!isAllowed) {
          return res.status(403).json({ error: 'URL host not allowed' });
        }

        // Use request queue to limit concurrent image fetches
        const result = await imageProxyQueue.add(async () => {
          const response = await fetch(url, {
            headers: {
              'User-Agent': 'SuSheBot/1.0 (kvlt.example.com)',
            },
          });

          if (!response.ok) {
            throw new Error(
              `Image fetch responded with status ${response.status}`
            );
          }

          const contentType = response.headers.get('content-type');
          if (!contentType || !contentType.startsWith('image/')) {
            throw new Error('Response is not an image');
          }

          const buffer = await response.arrayBuffer();

          // Resize image to 256x256 pixels using sharp
          // Use 'inside' fit to maintain aspect ratio without cropping
          // Convert to JPEG for consistent format and smaller file size
          const resizedBuffer = await sharp(Buffer.from(buffer))
            .resize(256, 256, {
              fit: 'inside', // Maintain aspect ratio
              withoutEnlargement: true, // Don't upscale small images
            })
            .jpeg({ quality: 85 }) // Convert to JPEG with good quality
            .toBuffer();

          const base64 = resizedBuffer.toString('base64');

          return {
            data: base64,
            contentType: 'image/jpeg', // Always JPEG after processing
          };
        });

        res.json(result);
      } catch (error) {
        logger.error('Image proxy error:', error);
        res.status(500).json({ error: 'Failed to fetch image' });
      }
    }
  );

  // Search Spotify for an album and return the ID
  app.get('/api/spotify/album', ensureAuthAPI, async (req, res) => {
    // Ensure valid Spotify token (auto-refresh if needed)
    const tokenResult = await ensureValidSpotifyToken(req.user, users);
    if (!tokenResult.success) {
      logger.warn('Spotify auth check failed:', tokenResult.error);
      return res.status(401).json({
        error: tokenResult.message,
        code: tokenResult.error,
        service: 'spotify',
      });
    }

    const spotifyAuth = tokenResult.spotifyAuth;

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
          Authorization: `Bearer ${spotifyAuth.access_token}`,
        },
      });
      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({}));
        const errorMsg =
          errorData?.error?.message || `Spotify API error ${resp.status}`;
        logger.error('Spotify search API error:', resp.status, errorMsg);

        // Pass through the actual status code
        if (resp.status === 401) {
          return res.status(401).json({
            error: 'Spotify authentication expired',
            code: 'TOKEN_EXPIRED',
            service: 'spotify',
          });
        }
        return res
          .status(resp.status >= 400 && resp.status < 500 ? resp.status : 502)
          .json({
            error: errorMsg,
            code: 'SPOTIFY_ERROR',
            service: 'spotify',
          });
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

  // Get Spotify access token for Web Playback SDK
  app.get('/api/spotify/token', ensureAuthAPI, async (req, res) => {
    // Ensure valid Spotify token (auto-refresh if needed)
    const tokenResult = await ensureValidSpotifyToken(req.user, users);
    if (!tokenResult.success) {
      logger.warn('Spotify token request failed:', tokenResult.error);
      return res.status(401).json({
        error: tokenResult.message,
        code: tokenResult.error,
        service: 'spotify',
      });
    }

    res.json({ access_token: tokenResult.spotifyAuth.access_token });
  });

  // Get available Spotify Connect devices
  app.get('/api/spotify/devices', ensureAuthAPI, async (req, res) => {
    // Ensure valid Spotify token (auto-refresh if needed)
    const tokenResult = await ensureValidSpotifyToken(req.user, users);
    if (!tokenResult.success) {
      logger.warn('Spotify auth check failed:', tokenResult.error);
      return res.status(401).json({
        error: tokenResult.message,
        code: tokenResult.error,
        service: 'spotify',
      });
    }

    const spotifyAuth = tokenResult.spotifyAuth;

    try {
      const resp = await fetch('https://api.spotify.com/v1/me/player/devices', {
        headers: {
          Authorization: `Bearer ${spotifyAuth.access_token}`,
        },
      });

      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({}));
        return handleSpotifyPlayerError(
          resp,
          errorData,
          res,
          logger,
          'devices'
        );
      }

      const data = await resp.json();
      // Filter out restricted devices (can't accept commands)
      const usableDevices = (data.devices || []).filter(
        (d) => !d.is_restricted && d.id
      );

      logger.info(
        'Spotify devices found:',
        usableDevices.map((d) => d.name)
      );
      res.json({ devices: usableDevices });
    } catch (err) {
      logger.error('Spotify devices error:', err);
      res.status(500).json({ error: 'Failed to get Spotify devices' });
    }
  });

  // Play an album on a specific Spotify Connect device
  app.put('/api/spotify/play', ensureAuthAPI, async (req, res) => {
    // Ensure valid Spotify token (auto-refresh if needed)
    const tokenResult = await ensureValidSpotifyToken(req.user, users);
    if (!tokenResult.success) {
      logger.warn('Spotify auth check failed:', tokenResult.error);
      return res.status(401).json({
        error: tokenResult.message,
        code: tokenResult.error,
        service: 'spotify',
      });
    }

    const spotifyAuth = tokenResult.spotifyAuth;
    const { albumId, deviceId } = req.body;

    if (!albumId) {
      return res.status(400).json({ error: 'albumId is required' });
    }

    try {
      const url = deviceId
        ? `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`
        : 'https://api.spotify.com/v1/me/player/play';

      const resp = await fetch(url, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${spotifyAuth.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          context_uri: `spotify:album:${albumId}`,
        }),
      });

      // 204 = success, 202 = accepted (device may need to wake up)
      if (resp.status === 204 || resp.status === 202) {
        logger.info(
          'Spotify playback started on device:',
          deviceId || 'active'
        );
        return res.json({ success: true });
      }

      // Handle specific errors
      if (resp.status === 404) {
        return res.status(404).json({
          error:
            'No active device found. Please open Spotify on a device first.',
          code: 'NO_DEVICE',
          service: 'spotify',
        });
      }

      if (resp.status === 403) {
        return res.status(403).json({
          error: 'Spotify Premium is required for playback control.',
          code: 'PREMIUM_REQUIRED',
          service: 'spotify',
        });
      }

      const errorData = await resp.json().catch(() => ({}));
      return handleSpotifyPlayerError(resp, errorData, res, logger, 'play');
    } catch (err) {
      logger.error('Spotify play error:', err);
      res.status(500).json({ error: 'Failed to start playback' });
    }
  });

  // ============ SPOTIFY PLAYBACK CONTROL ENDPOINTS ============

  // Helper to handle Spotify player API errors (Premium-required endpoints)
  function handleSpotifyPlayerError(resp, errorData, res, logger, action) {
    // 403 = Premium required for playback control
    if (resp.status === 403) {
      // Only log once per session type of thing, not every poll
      logger.debug('Spotify Premium required for:', action);
      return res.status(403).json({
        error: 'Spotify Premium required for playback control',
        code: 'PREMIUM_REQUIRED',
        service: 'spotify',
      });
    }

    // 401 = Token invalid/expired (should have been caught by ensureValidSpotifyToken)
    if (resp.status === 401) {
      return res.status(401).json({
        error: 'Spotify authentication expired',
        code: 'TOKEN_EXPIRED',
        service: 'spotify',
      });
    }

    // 404 = No active device
    if (resp.status === 404) {
      return res.status(404).json({
        error: 'No active Spotify device found',
        code: 'NO_DEVICE',
        service: 'spotify',
      });
    }

    // Other errors
    const message =
      errorData?.error?.message || `Spotify API error ${resp.status}`;
    logger.error(`Spotify ${action} error:`, resp.status, message);
    return res
      .status(resp.status >= 400 && resp.status < 500 ? resp.status : 502)
      .json({
        error: message,
        code: 'SPOTIFY_ERROR',
        service: 'spotify',
      });
  }

  // Get current playback state
  app.get('/api/spotify/playback', ensureAuthAPI, async (req, res) => {
    const tokenResult = await ensureValidSpotifyToken(req.user, users);
    if (!tokenResult.success) {
      return res.status(401).json({
        error: tokenResult.message,
        code: tokenResult.error,
        service: 'spotify',
      });
    }

    try {
      const resp = await fetch('https://api.spotify.com/v1/me/player', {
        headers: {
          Authorization: `Bearer ${tokenResult.spotifyAuth.access_token}`,
        },
      });

      if (resp.status === 204) {
        // No active playback
        return res.json({ is_playing: false, device: null, item: null });
      }

      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({}));
        return handleSpotifyPlayerError(
          resp,
          errorData,
          res,
          logger,
          'playback state'
        );
      }

      const data = await resp.json();
      res.json(data);
    } catch (err) {
      logger.error('Spotify playback state error:', err);
      res.status(500).json({ error: 'Failed to get playback state' });
    }
  });

  // Pause playback
  app.put('/api/spotify/pause', ensureAuthAPI, async (req, res) => {
    const tokenResult = await ensureValidSpotifyToken(req.user, users);
    if (!tokenResult.success) {
      return res.status(401).json({
        error: tokenResult.message,
        code: tokenResult.error,
        service: 'spotify',
      });
    }

    try {
      const resp = await fetch('https://api.spotify.com/v1/me/player/pause', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${tokenResult.spotifyAuth.access_token}`,
        },
      });

      if (resp.ok || resp.status === 204) {
        return res.json({ success: true });
      }

      const errorData = await resp.json().catch(() => ({}));
      return handleSpotifyPlayerError(resp, errorData, res, logger, 'pause');
    } catch (err) {
      logger.error('Spotify pause error:', err);
      res.status(500).json({ error: 'Failed to pause playback' });
    }
  });

  // Resume playback
  app.put('/api/spotify/resume', ensureAuthAPI, async (req, res) => {
    const tokenResult = await ensureValidSpotifyToken(req.user, users);
    if (!tokenResult.success) {
      return res.status(401).json({
        error: tokenResult.message,
        code: tokenResult.error,
        service: 'spotify',
      });
    }

    try {
      const resp = await fetch('https://api.spotify.com/v1/me/player/play', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${tokenResult.spotifyAuth.access_token}`,
        },
      });

      if (resp.ok || resp.status === 204) {
        return res.json({ success: true });
      }

      const errorData = await resp.json().catch(() => ({}));
      return handleSpotifyPlayerError(resp, errorData, res, logger, 'resume');
    } catch (err) {
      logger.error('Spotify resume error:', err);
      res.status(500).json({ error: 'Failed to resume playback' });
    }
  });

  // Skip to previous track
  app.post('/api/spotify/previous', ensureAuthAPI, async (req, res) => {
    const tokenResult = await ensureValidSpotifyToken(req.user, users);
    if (!tokenResult.success) {
      return res.status(401).json({
        error: tokenResult.message,
        code: tokenResult.error,
        service: 'spotify',
      });
    }

    try {
      const resp = await fetch(
        'https://api.spotify.com/v1/me/player/previous',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokenResult.spotifyAuth.access_token}`,
          },
        }
      );

      if (resp.ok || resp.status === 204) {
        return res.json({ success: true });
      }

      const errorData = await resp.json().catch(() => ({}));
      return handleSpotifyPlayerError(resp, errorData, res, logger, 'previous');
    } catch (err) {
      logger.error('Spotify previous track error:', err);
      res.status(500).json({ error: 'Failed to skip to previous' });
    }
  });

  // Skip to next track
  app.post('/api/spotify/next', ensureAuthAPI, async (req, res) => {
    const tokenResult = await ensureValidSpotifyToken(req.user, users);
    if (!tokenResult.success) {
      return res.status(401).json({
        error: tokenResult.message,
        code: tokenResult.error,
        service: 'spotify',
      });
    }

    try {
      const resp = await fetch('https://api.spotify.com/v1/me/player/next', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenResult.spotifyAuth.access_token}`,
        },
      });

      if (resp.ok || resp.status === 204) {
        return res.json({ success: true });
      }

      const errorData = await resp.json().catch(() => ({}));
      return handleSpotifyPlayerError(resp, errorData, res, logger, 'next');
    } catch (err) {
      logger.error('Spotify next track error:', err);
      res.status(500).json({ error: 'Failed to skip to next' });
    }
  });

  // Seek to position
  app.put('/api/spotify/seek', ensureAuthAPI, async (req, res) => {
    const tokenResult = await ensureValidSpotifyToken(req.user, users);
    if (!tokenResult.success) {
      return res.status(401).json({
        error: tokenResult.message,
        code: tokenResult.error,
        service: 'spotify',
      });
    }

    const { position_ms } = req.body;
    if (position_ms === undefined || isNaN(parseInt(position_ms))) {
      return res.status(400).json({ error: 'position_ms is required' });
    }

    try {
      const resp = await fetch(
        `https://api.spotify.com/v1/me/player/seek?position_ms=${parseInt(position_ms)}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${tokenResult.spotifyAuth.access_token}`,
          },
        }
      );

      if (resp.ok || resp.status === 204) {
        return res.json({ success: true });
      }

      const errorData = await resp.json().catch(() => ({}));
      return handleSpotifyPlayerError(resp, errorData, res, logger, 'seek');
    } catch (err) {
      logger.error('Spotify seek error:', err);
      res.status(500).json({ error: 'Failed to seek' });
    }
  });

  // Set volume
  app.put('/api/spotify/volume', ensureAuthAPI, async (req, res) => {
    const tokenResult = await ensureValidSpotifyToken(req.user, users);
    if (!tokenResult.success) {
      return res.status(401).json({
        error: tokenResult.message,
        code: tokenResult.error,
        service: 'spotify',
      });
    }

    const { volume_percent } = req.body;
    if (volume_percent === undefined || isNaN(parseInt(volume_percent))) {
      return res.status(400).json({ error: 'volume_percent is required' });
    }

    const vol = Math.max(0, Math.min(100, parseInt(volume_percent)));

    try {
      const resp = await fetch(
        `https://api.spotify.com/v1/me/player/volume?volume_percent=${vol}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${tokenResult.spotifyAuth.access_token}`,
          },
        }
      );

      if (resp.ok || resp.status === 204) {
        return res.json({ success: true });
      }

      const errorData = await resp.json().catch(() => ({}));
      return handleSpotifyPlayerError(resp, errorData, res, logger, 'volume');
    } catch (err) {
      logger.error('Spotify volume error:', err);
      res.status(500).json({ error: 'Failed to set volume' });
    }
  });

  // Transfer playback to a device
  app.put('/api/spotify/transfer', ensureAuthAPI, async (req, res) => {
    const tokenResult = await ensureValidSpotifyToken(req.user, users);
    if (!tokenResult.success) {
      return res.status(401).json({
        error: tokenResult.message,
        code: tokenResult.error,
        service: 'spotify',
      });
    }

    const { device_id, play } = req.body;
    if (!device_id) {
      return res.status(400).json({ error: 'device_id is required' });
    }

    try {
      const resp = await fetch('https://api.spotify.com/v1/me/player', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${tokenResult.spotifyAuth.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          device_ids: [device_id],
          play: play === true,
        }),
      });

      if (resp.ok || resp.status === 204) {
        logger.info('Spotify playback transferred to device:', device_id);
        return res.json({ success: true });
      }

      const errorData = await resp.json().catch(() => ({}));
      return handleSpotifyPlayerError(resp, errorData, res, logger, 'transfer');
    } catch (err) {
      logger.error('Spotify transfer error:', err);
      res.status(500).json({ error: 'Failed to transfer playback' });
    }
  });

  // Search Tidal for an album and return the ID
  app.get('/api/tidal/album', ensureAuthAPI, async (req, res) => {
    // Ensure valid Tidal token (auto-refresh if needed)
    const tokenResult = await ensureValidTidalToken(req.user, users);
    if (!tokenResult.success) {
      logger.warn('Tidal auth check failed:', tokenResult.error);
      return res.status(401).json({
        error: tokenResult.message,
        code: tokenResult.error,
        service: 'tidal',
      });
    }

    const tidalAuth = tokenResult.tidalAuth;

    logger.debug('Tidal token expires at:', tidalAuth.expires_at);
    logger.debug(
      'Using Tidal access token:',
      (tidalAuth.access_token || '').slice(0, 6) +
        '...' +
        (tidalAuth.access_token || '').slice(-4)
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
                Authorization: `Bearer ${tidalAuth.access_token}`,
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
          Authorization: `Bearer ${tidalAuth.access_token}`,
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

  // Search Spotify for a track and return the ID
  app.get('/api/spotify/track', ensureAuthAPI, async (req, res) => {
    // Ensure valid Spotify token (auto-refresh if needed)
    const tokenResult = await ensureValidSpotifyToken(req.user, users);
    if (!tokenResult.success) {
      logger.warn('Spotify auth check failed:', tokenResult.error);
      return res.status(401).json({
        error: tokenResult.message,
        code: tokenResult.error,
        service: 'spotify',
      });
    }

    const spotifyAuth = tokenResult.spotifyAuth;

    const { artist, album, track } = req.query;
    if (!artist || !album || !track) {
      return res
        .status(400)
        .json({ error: 'artist, album, and track are required' });
    }
    logger.info('Spotify track search:', artist, '-', album, '-', track);

    const headers = {
      Authorization: `Bearer ${spotifyAuth.access_token}`,
    };

    try {
      // First, find the album
      const albumQuery = `album:${album} artist:${artist}`;
      const albumResp = await fetch(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(albumQuery)}&type=album&limit=1`,
        { headers }
      );
      if (!albumResp.ok) {
        throw new Error(`Spotify API error ${albumResp.status}`);
      }
      const albumData = await albumResp.json();
      if (!albumData.albums || !albumData.albums.items.length) {
        return res.status(404).json({ error: 'Album not found' });
      }
      const spotifyAlbumId = albumData.albums.items[0].id;

      // Get album tracks
      const tracksResp = await fetch(
        `https://api.spotify.com/v1/albums/${spotifyAlbumId}/tracks?limit=50`,
        { headers }
      );
      if (!tracksResp.ok) {
        throw new Error(`Spotify API error ${tracksResp.status}`);
      }
      const tracksData = await tracksResp.json();
      const tracks = tracksData.items;

      // Try to match by track number first
      const trackNum = parseInt(track);
      if (!isNaN(trackNum) && trackNum > 0 && trackNum <= tracks.length) {
        const matchedTrack = tracks[trackNum - 1];
        logger.info('Spotify track matched by number:', matchedTrack.id);
        return res.json({ id: matchedTrack.id });
      }

      // Extract track name from format like "3. Track Name"
      const trackNameMatch = track.match(/^\d+[.\s-]*\s*(.+)$/);
      const searchName = trackNameMatch ? trackNameMatch[1] : track;

      // Try to match by track name
      const matchingTrack = tracks.find(
        (t) =>
          t.name.toLowerCase() === searchName.toLowerCase() ||
          t.name.toLowerCase().includes(searchName.toLowerCase()) ||
          searchName.toLowerCase().includes(t.name.toLowerCase())
      );
      if (matchingTrack) {
        logger.info('Spotify track matched by name:', matchingTrack.id);
        return res.json({ id: matchingTrack.id });
      }

      // Fallback: general track search
      const fallbackQuery = `track:${searchName} album:${album} artist:${artist}`;
      const fallbackResp = await fetch(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(fallbackQuery)}&type=track&limit=1`,
        { headers }
      );
      if (fallbackResp.ok) {
        const fallbackData = await fallbackResp.json();
        if (fallbackData.tracks.items.length > 0) {
          logger.info(
            'Spotify track matched by fallback search:',
            fallbackData.tracks.items[0].id
          );
          return res.json({ id: fallbackData.tracks.items[0].id });
        }
      }

      return res.status(404).json({ error: 'Track not found' });
    } catch (err) {
      logger.error('Spotify track search error:', err);
      res.status(500).json({ error: 'Failed to search Spotify' });
    }
  });

  // Search Tidal for a track and return the ID
  app.get('/api/tidal/track', ensureAuthAPI, async (req, res) => {
    // Ensure valid Tidal token (auto-refresh if needed)
    const tokenResult = await ensureValidTidalToken(req.user, users);
    if (!tokenResult.success) {
      logger.warn('Tidal auth check failed:', tokenResult.error);
      return res.status(401).json({
        error: tokenResult.message,
        code: tokenResult.error,
        service: 'tidal',
      });
    }

    const tidalAuth = tokenResult.tidalAuth;

    const { artist, album, track } = req.query;
    if (!artist || !album || !track) {
      return res
        .status(400)
        .json({ error: 'artist, album, and track are required' });
    }
    logger.info('Tidal track search:', artist, '-', album, '-', track);

    const headers = {
      Authorization: `Bearer ${tidalAuth.access_token}`,
      Accept: 'application/vnd.api+json',
      'X-Tidal-Token': process.env.TIDAL_CLIENT_ID || '',
    };

    try {
      const countryCode = req.user.tidalCountry || 'US';

      // First, find the album
      const albumQuery = `${album} ${artist}`;
      const searchPath = encodeURIComponent(albumQuery).replace(/'/g, '%27');
      const albumResp = await fetch(
        `https://openapi.tidal.com/v2/searchResults/${searchPath}/relationships/albums?countryCode=${countryCode}`,
        { headers }
      );
      if (!albumResp.ok) {
        throw new Error(`Tidal API error ${albumResp.status}`);
      }
      const albumData = await albumResp.json();
      const tidalAlbumId = albumData?.data?.[0]?.id;
      if (!tidalAlbumId) {
        return res.status(404).json({ error: 'Album not found' });
      }

      // Get album tracks
      const tracksResp = await fetch(
        `https://openapi.tidal.com/v2/albums/${tidalAlbumId}/relationships/items?countryCode=${countryCode}`,
        { headers }
      );
      if (!tracksResp.ok) {
        throw new Error(`Tidal API error ${tracksResp.status}`);
      }
      const tracksData = await tracksResp.json();
      const tracks = tracksData.data || [];

      // Try to match by track number first
      const trackNum = parseInt(track);
      if (!isNaN(trackNum) && trackNum > 0 && trackNum <= tracks.length) {
        const matchedTrack = tracks[trackNum - 1];
        logger.info('Tidal track matched by number:', matchedTrack.id);
        return res.json({ id: matchedTrack.id });
      }

      // Extract track name from format like "3. Track Name"
      const trackNameMatch = track.match(/^\d+[.\s-]*\s*(.+)$/);
      const searchName = trackNameMatch ? trackNameMatch[1] : track;

      // For name matching, we need track details - fetch them
      // Tidal's items endpoint returns track IDs, need to get names
      const trackDetailsPromises = tracks.slice(0, 20).map(async (t) => {
        try {
          const detailResp = await fetch(
            `https://openapi.tidal.com/v2/tracks/${t.id}?countryCode=${countryCode}`,
            { headers }
          );
          if (detailResp.ok) {
            const detail = await detailResp.json();
            return { id: t.id, name: detail.data?.attributes?.title || '' };
          }
        } catch {
          // Ignore individual track fetch errors
        }
        return { id: t.id, name: '' };
      });

      const trackDetails = await Promise.all(trackDetailsPromises);
      const matchingTrack = trackDetails.find(
        (t) =>
          t.name &&
          (t.name.toLowerCase() === searchName.toLowerCase() ||
            t.name.toLowerCase().includes(searchName.toLowerCase()) ||
            searchName.toLowerCase().includes(t.name.toLowerCase()))
      );
      if (matchingTrack) {
        logger.info('Tidal track matched by name:', matchingTrack.id);
        return res.json({ id: matchingTrack.id });
      }

      // Fallback: direct track search
      const trackSearchPath = encodeURIComponent(
        `${searchName} ${artist}`
      ).replace(/'/g, '%27');
      const fallbackResp = await fetch(
        `https://openapi.tidal.com/v2/searchResults/${trackSearchPath}/relationships/tracks?countryCode=${countryCode}&limit=1`,
        { headers }
      );
      if (fallbackResp.ok) {
        const fallbackData = await fallbackResp.json();
        if (fallbackData.data && fallbackData.data.length > 0) {
          logger.info(
            'Tidal track matched by fallback search:',
            fallbackData.data[0].id
          );
          return res.json({ id: fallbackData.data[0].id });
        }
      }

      return res.status(404).json({ error: 'Track not found' });
    } catch (err) {
      logger.error('Tidal track search error:', err);
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
          // Race both services and return first successful result
          try {
            return await Promise.any([
              fetchItunesTracks(),
              fetchDeezerTracks(),
            ]);
          } catch (_err) {
            // All fallbacks failed
            return null;
          }
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

    // Determine target service: explicit service > user preference > auto-detect from auth
    let targetService = service || req.user.musicService;

    // If no explicit service is set, auto-detect from authenticated services
    if (!targetService || !['spotify', 'tidal'].includes(targetService)) {
      const hasSpotify = req.user.spotifyAuth?.access_token;
      const hasTidal = req.user.tidalAuth?.access_token;

      // If only one service is authenticated, use it automatically
      if (hasSpotify && !hasTidal) {
        targetService = 'spotify';
        logger.info('Auto-detected music service:', { targetService: 'spotify' });
      } else if (hasTidal && !hasSpotify) {
        targetService = 'tidal';
        logger.info('Auto-detected music service:', { targetService: 'tidal' });
      } else if (!hasSpotify && !hasTidal) {
        // No services authenticated
        return res.status(400).json({
          error:
            'No music service connected. Please connect Spotify or Tidal in settings.',
          code: 'NOT_AUTHENTICATED',
        });
      } else {
        // Multiple services authenticated but no preference set
        return res.status(400).json({
          error:
            'Multiple music services connected. Please set a preferred service in settings.',
          code: 'NO_SERVICE',
        });
      }
    }

    try {

      let auth;

      // Handle authentication differently for each service
      if (targetService === 'spotify') {
        // For Spotify, use automatic token refresh
        const tokenResult = await ensureValidSpotifyToken(req.user, users);
        if (!tokenResult.success) {
          logger.warn('Spotify auth check failed:', tokenResult.error);
          return res.status(401).json({
            error: tokenResult.message,
            code: tokenResult.error,
            service: 'spotify',
          });
        }
        auth = tokenResult.spotifyAuth;
      } else {
        // For Tidal, use automatic token refresh
        const tokenResult = await ensureValidTidalToken(req.user, users);
        if (!tokenResult.success) {
          logger.warn('Tidal auth check failed:', tokenResult.error);
          return res.status(401).json({
            error: tokenResult.message,
            code: tokenResult.error,
            service: 'tidal',
          });
        }
        auth = tokenResult.tidalAuth;
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

      const items = await listItemsAsync.findWithAlbumData(list._id);

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
      // Log full error details server-side for debugging
      logger.error('Playlist operation error:', {
        error: err.message,
        stack: err.stack,
        userId: req.user?._id,
        listName,
        targetService,
      });

      // Return safe error response to client
      // Never expose error.message or stack traces - may contain sensitive info
      res.status(500).json({
        success: false,
        error: {
          type: 'PLAYLIST_ERROR',
          message:
            'Failed to update playlist. Please check your music service connection and try again.',
          timestamp: new Date().toISOString(),
        },
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
        } catch (_err) {
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

    // Collect track URIs with parallel processing
    const trackUris = [];
    const albumCache = new Map();

    // Process tracks in parallel batches to respect rate limits
    const batchSize = 10;
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);

      const batchResults = await Promise.allSettled(
        batch.map(async (item) => {
          result.processed++;

          const trackPick = item.trackPick || item.track_pick;
          if (!trackPick || !trackPick.trim()) {
            return {
              success: false,
              item,
              error: `Skipped "${item.artist} - ${item.album}": no track selected`,
            };
          }

          try {
            const trackUri = await findSpotifyTrack(item, auth, albumCache);
            if (trackUri) {
              return {
                success: true,
                item,
                trackUri,
                trackPick,
              };
            } else {
              return {
                success: false,
                item,
                error: `Track not found: "${item.artist} - ${item.album}" - Track ${item.trackPick}`,
              };
            }
          } catch (err) {
            return {
              success: false,
              item,
              error: `Error searching for "${item.artist} - ${item.album}": ${err.message}`,
            };
          }
        })
      );

      // Process batch results
      for (const promiseResult of batchResults) {
        if (promiseResult.status === 'fulfilled') {
          const trackResult = promiseResult.value;
          if (trackResult.success) {
            trackUris.push(trackResult.trackUri);
            result.successful++;
            result.tracks.push({
              artist: trackResult.item.artist,
              album: trackResult.item.album,
              track: trackResult.trackPick,
              found: true,
            });
          } else {
            result.failed++;
            result.errors.push(trackResult.error);
            if (trackResult.trackPick) {
              result.tracks.push({
                artist: trackResult.item.artist,
                album: trackResult.item.album,
                track: trackResult.trackPick,
                found: false,
              });
            }
          }
        } else {
          result.failed++;
          result.errors.push(`Unexpected error: ${promiseResult.reason}`);
        }
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

  // Find Spotify track URI with caching
  async function findSpotifyTrack(item, auth, albumCache = new Map()) {
    const trackPick = item.trackPick || item.track_pick;
    const headers = {
      Authorization: `Bearer ${auth.access_token}`,
    };

    // First try to get album tracks if we have album_id
    if (item.albumId) {
      try {
        const cacheKey = `${item.artist}::${item.album}`;
        let albumData = albumCache.get(cacheKey);

        if (!albumData) {
          const albumResp = await fetch(
            `https://api.spotify.com/v1/search?q=album:${encodeURIComponent(item.album)} artist:${encodeURIComponent(item.artist)}&type=album&limit=1`,
            { headers }
          );
          if (albumResp.ok) {
            const data = await albumResp.json();
            if (data.albums.items.length > 0) {
              const spotifyAlbumId = data.albums.items[0].id;
              const tracksResp = await fetch(
                `https://api.spotify.com/v1/albums/${spotifyAlbumId}/tracks`,
                { headers }
              );
              if (tracksResp.ok) {
                const tracksData = await tracksResp.json();
                albumData = {
                  id: spotifyAlbumId,
                  tracks: tracksData.tracks.items,
                };
                albumCache.set(cacheKey, albumData);
              }
            }
          }
        }

        if (albumData && albumData.tracks) {
          // Try to match by track number
          const trackNum = parseInt(trackPick);
          if (
            !isNaN(trackNum) &&
            trackNum > 0 &&
            trackNum <= albumData.tracks.length
          ) {
            return albumData.tracks[trackNum - 1].uri;
          }

          // Try to match by track name
          const matchingTrack = albumData.tracks.find(
            (t) =>
              t.name.toLowerCase().includes(trackPick.toLowerCase()) ||
              trackPick.toLowerCase().includes(t.name.toLowerCase())
          );
          if (matchingTrack) {
            return matchingTrack.uri;
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

    // Collect track IDs with parallel processing
    const trackIds = [];
    const albumCache = new Map();

    // Process tracks in parallel batches to respect rate limits
    const batchSize = 10;
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);

      const batchResults = await Promise.allSettled(
        batch.map(async (item) => {
          result.processed++;

          const trackPick = item.trackPick || item.track_pick;
          if (!trackPick || !trackPick.trim()) {
            return {
              success: false,
              item,
              error: `Skipped "${item.artist} - ${item.album}": no track selected`,
            };
          }

          try {
            const trackId = await findTidalTrack(
              item,
              auth,
              user.tidalCountry,
              albumCache
            );
            if (trackId) {
              return {
                success: true,
                item,
                trackId,
                trackPick,
              };
            } else {
              return {
                success: false,
                item,
                error: `Track not found: "${item.artist} - ${item.album}" - Track ${item.trackPick}`,
              };
            }
          } catch (err) {
            return {
              success: false,
              item,
              error: `Error searching for "${item.artist} - ${item.album}": ${err.message}`,
            };
          }
        })
      );

      // Process batch results
      for (const promiseResult of batchResults) {
        if (promiseResult.status === 'fulfilled') {
          const trackResult = promiseResult.value;
          if (trackResult.success) {
            trackIds.push(trackResult.trackId);
            result.successful++;
            result.tracks.push({
              artist: trackResult.item.artist,
              album: trackResult.item.album,
              track: trackResult.trackPick,
              found: true,
            });
          } else {
            result.failed++;
            result.errors.push(trackResult.error);
            if (trackResult.trackPick) {
              result.tracks.push({
                artist: trackResult.item.artist,
                album: trackResult.item.album,
                track: trackResult.trackPick,
                found: false,
              });
            }
          }
        } else {
          result.failed++;
          result.errors.push(`Unexpected error: ${promiseResult.reason}`);
        }
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

  // Find Tidal track ID with caching
  async function findTidalTrack(
    item,
    auth,
    countryCode = 'US',
    albumCache = new Map()
  ) {
    const trackPick = item.trackPick || item.track_pick;
    const headers = {
      Authorization: `Bearer ${auth.access_token}`,
      Accept: 'application/vnd.api+json',
    };

    // First try to search for the album and get tracks
    try {
      const cacheKey = `${item.artist}::${item.album}`;
      let albumData = albumCache.get(cacheKey);

      if (!albumData) {
        const albumQuery = `${item.artist} ${item.album}`;
        const albumSearchResp = await fetch(
          `https://openapi.tidal.com/v2/searchresults/albums?query=${encodeURIComponent(albumQuery)}&countryCode=${countryCode}&limit=1`,
          { headers }
        );

        if (albumSearchResp.ok) {
          const searchData = await albumSearchResp.json();
          if (searchData.data && searchData.data.length > 0) {
            const tidalAlbumId = searchData.data[0].id;

            // Get album tracks
            const tracksResp = await fetch(
              `https://openapi.tidal.com/v2/albums/${tidalAlbumId}/items?countryCode=${countryCode}`,
              { headers }
            );

            if (tracksResp.ok) {
              const tracksData = await tracksResp.json();
              albumData = {
                id: tidalAlbumId,
                tracks: tracksData.data || [],
              };
              albumCache.set(cacheKey, albumData);
            }
          }
        }
      }

      if (albumData && albumData.tracks) {
        // Try to match by track number
        const trackNum = parseInt(trackPick);
        if (
          !isNaN(trackNum) &&
          trackNum > 0 &&
          trackNum <= albumData.tracks.length
        ) {
          return albumData.tracks[trackNum - 1].id;
        }

        // Try to match by track name
        const matchingTrack = albumData.tracks.find(
          (t) =>
            t.attributes.title
              .toLowerCase()
              .includes(trackPick.toLowerCase()) ||
            trackPick.toLowerCase().includes(t.attributes.title.toLowerCase())
        );
        if (matchingTrack) {
          return matchingTrack.id;
        }
      }
    } catch (err) {
      logger.debug('Tidal album-based track search failed:', err);
    }

    // Fallback to general track search
    try {
      const query = `${trackPick} ${item.album} ${item.artist}`;
      const searchResp = await fetch(
        `https://openapi.tidal.com/v2/searchresults/tracks?query=${encodeURIComponent(query)}&countryCode=${countryCode}&limit=1`,
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

  // ============================================
  // LAST.FM API ENDPOINTS
  // ============================================

  // GET /api/lastfm/top-albums - Get user's top albums from Last.fm
  app.get('/api/lastfm/top-albums', ensureAuthAPI, async (req, res) => {
    const { period = 'overall', limit = 50 } = req.query;

    if (!req.user.lastfmUsername) {
      return res.status(401).json({
        error: 'Last.fm not connected',
        code: 'NOT_AUTHENTICATED',
        service: 'lastfm',
      });
    }

    const validPeriods = [
      '7day',
      '1month',
      '3month',
      '6month',
      '12month',
      'overall',
    ];
    if (!validPeriods.includes(period)) {
      return res.status(400).json({
        error: 'Invalid period. Valid values: ' + validPeriods.join(', '),
      });
    }

    try {
      const { getTopAlbums } = require('../utils/lastfm-auth');
      const albums = await getTopAlbums(
        req.user.lastfmUsername,
        period,
        Math.min(parseInt(limit) || 50, 200),
        process.env.LASTFM_API_KEY
      );

      // Transform to match app's album format
      const formatted = albums.map((album) => ({
        artist: album.artist?.name,
        title: album.name,
        playcount: parseInt(album.playcount) || 0,
        mbid: album.mbid || null,
        image:
          album.image?.find((i) => i.size === 'extralarge')?.['#text'] || null,
      }));

      res.json({ albums: formatted });
    } catch (error) {
      logger.error('Last.fm top albums error:', error);
      res.status(500).json({ error: 'Failed to fetch top albums' });
    }
  });

  // GET /api/lastfm/album-playcount - Get playcount for a specific album
  app.get('/api/lastfm/album-playcount', ensureAuthAPI, async (req, res) => {
    const { artist, album } = req.query;

    if (!req.user.lastfmUsername) {
      return res.status(401).json({
        error: 'Last.fm not connected',
        code: 'NOT_AUTHENTICATED',
        service: 'lastfm',
      });
    }

    if (!artist || !album) {
      return res.status(400).json({ error: 'artist and album are required' });
    }

    try {
      const { getAlbumInfo } = require('../utils/lastfm-auth');
      const info = await getAlbumInfo(
        artist,
        album,
        req.user.lastfmUsername,
        process.env.LASTFM_API_KEY
      );

      res.json({
        playcount: parseInt(info.userplaycount || 0),
        globalPlaycount: parseInt(info.playcount || 0),
        listeners: parseInt(info.listeners || 0),
      });
    } catch (error) {
      logger.error('Last.fm album info error:', error);
      res.status(500).json({ error: 'Failed to fetch album info' });
    }
  });

  // POST /api/lastfm/batch-playcounts - Get playcounts for multiple albums
  app.post('/api/lastfm/batch-playcounts', ensureAuthAPI, async (req, res) => {
    const { albums } = req.body;

    if (!req.user.lastfmUsername) {
      return res.status(401).json({
        error: 'Last.fm not connected',
        code: 'NOT_AUTHENTICATED',
        service: 'lastfm',
      });
    }

    if (!albums || !Array.isArray(albums)) {
      return res.status(400).json({ error: 'albums array is required' });
    }

    try {
      const { getAlbumInfo } = require('../utils/lastfm-auth');

      // Limit to 50 per request to avoid rate limits
      const albumsToFetch = albums.slice(0, 50);

      // Fetch in parallel with rate limiting via Promise.allSettled
      const results = await Promise.allSettled(
        albumsToFetch.map(async (album) => {
          const info = await getAlbumInfo(
            album.artist,
            album.title,
            req.user.lastfmUsername,
            process.env.LASTFM_API_KEY
          );
          return {
            artist: album.artist,
            title: album.title,
            playcount: parseInt(info.userplaycount || 0),
          };
        })
      );

      const playcounts = results
        .filter((r) => r.status === 'fulfilled')
        .map((r) => r.value);

      res.json({ playcounts });
    } catch (error) {
      logger.error('Last.fm batch playcounts error:', error);
      res.status(500).json({ error: 'Failed to fetch playcounts' });
    }
  });

  // POST /api/lastfm/scrobble - Submit a scrobble to Last.fm
  app.post('/api/lastfm/scrobble', ensureAuthAPI, async (req, res) => {
    const { artist, track, album, duration, timestamp } = req.body;

    if (!req.user.lastfmAuth?.session_key) {
      return res.status(401).json({
        error: 'Last.fm not connected',
        code: 'NOT_AUTHENTICATED',
        service: 'lastfm',
      });
    }

    if (!artist || !track) {
      return res.status(400).json({ error: 'artist and track are required' });
    }

    try {
      const { scrobble } = require('../utils/lastfm-auth');
      const result = await scrobble(
        { artist, track, album, duration, timestamp },
        req.user.lastfmAuth.session_key,
        process.env.LASTFM_API_KEY,
        process.env.LASTFM_SECRET
      );

      if (result.error) {
        return res.status(400).json({ error: result.message });
      }

      res.json({ success: true, scrobbles: result.scrobbles });
    } catch (error) {
      logger.error('Scrobble error:', error);
      res.status(500).json({ error: 'Failed to scrobble' });
    }
  });

  // POST /api/lastfm/now-playing - Update now playing status on Last.fm
  app.post('/api/lastfm/now-playing', ensureAuthAPI, async (req, res) => {
    const { artist, track, album, duration } = req.body;

    if (!req.user.lastfmAuth?.session_key) {
      return res.status(401).json({
        error: 'Last.fm not connected',
        code: 'NOT_AUTHENTICATED',
        service: 'lastfm',
      });
    }

    if (!artist || !track) {
      return res.status(400).json({ error: 'artist and track are required' });
    }

    try {
      const { updateNowPlaying } = require('../utils/lastfm-auth');
      const result = await updateNowPlaying(
        { artist, track, album, duration },
        req.user.lastfmAuth.session_key,
        process.env.LASTFM_API_KEY,
        process.env.LASTFM_SECRET
      );

      res.json({ success: true, nowplaying: result.nowplaying });
    } catch (error) {
      logger.error('Now playing error:', error);
      res.status(500).json({ error: 'Failed to update now playing' });
    }
  });

  // GET /api/lastfm/similar-artists - Get similar artists (for discovery)
  app.get('/api/lastfm/similar-artists', ensureAuthAPI, async (req, res) => {
    const { artist, limit = 20 } = req.query;

    if (!artist) {
      return res.status(400).json({ error: 'artist is required' });
    }

    if (!req.user.lastfmUsername) {
      return res.status(401).json({
        error: 'Last.fm not connected',
        code: 'NOT_AUTHENTICATED',
        service: 'lastfm',
      });
    }

    try {
      const { getSimilarArtists } = require('../utils/lastfm-auth');
      const similarArtists = await getSimilarArtists(
        artist,
        Math.min(parseInt(limit) || 20, 50),
        process.env.LASTFM_API_KEY
      );

      if (!similarArtists || similarArtists.length === 0) {
        return res.json({ artists: [], message: 'No similar artists found' });
      }

      res.json({
        artists: similarArtists.map((a) => ({
          name: a.name,
          match: parseFloat(a.match) || 0,
          url: a.url,
          image:
            a.image?.find((i) => i.size === 'large')?.['#text'] ||
            a.image?.find((i) => i.size === 'medium')?.['#text'] ||
            null,
        })),
      });
    } catch (error) {
      logger.error('Last.fm similar artists error:', error);
      res.status(500).json({ error: 'Failed to fetch similar artists' });
    }
  });

  // GET /api/lastfm/recent-tracks - Get user's recent listening history
  app.get('/api/lastfm/recent-tracks', ensureAuthAPI, async (req, res) => {
    const { limit = 50 } = req.query;

    if (!req.user.lastfmUsername) {
      return res.status(401).json({
        error: 'Last.fm not connected',
        code: 'NOT_AUTHENTICATED',
        service: 'lastfm',
      });
    }

    try {
      const { getRecentTracks } = require('../utils/lastfm-auth');
      const tracks = await getRecentTracks(
        req.user.lastfmUsername,
        Math.min(parseInt(limit) || 50, 200),
        process.env.LASTFM_API_KEY
      );

      res.json({
        tracks: tracks.map((t) => ({
          artist: t.artist?.['#text'] || t.artist?.name,
          track: t.name,
          album: t.album?.['#text'],
          nowPlaying: t['@attr']?.nowplaying === 'true',
          timestamp: t.date?.uts ? parseInt(t.date.uts) : null,
          image: t.image?.find((i) => i.size === 'medium')?.['#text'] || null,
        })),
      });
    } catch (error) {
      logger.error('Last.fm recent tracks error:', error);
      res.status(500).json({ error: 'Failed to fetch recent tracks' });
    }
  });

  // GET /api/lastfm/list-playcounts/:listId - Get cached playcounts for albums in a list
  // Returns cached data immediately, triggers background refresh for stale entries
  app.get(
    '/api/lastfm/list-playcounts/:listId',
    ensureAuthAPI,
    async (req, res) => {
      const { listId } = req.params;
      const { refresh = 'false' } = req.query;

      if (!req.user.lastfmUsername) {
        return res.status(401).json({
          error: 'Last.fm not connected',
          code: 'NOT_AUTHENTICATED',
          service: 'lastfm',
        });
      }

      try {
        // Verify user owns this list
        const list = await listsAsync.findOne({ _id: listId });
        if (!list || list.userId !== req.user._id) {
          return res.status(404).json({ error: 'List not found' });
        }

        // Get all albums in the list with a JOIN to albums table
        // Prefer albums table (MusicBrainz) data for Last.fm lookups since it's more
        // likely to match Last.fm's database (proper diacritics, canonical spelling)
        // Fall back to list_items data if albums table has NULL
        const listItemsResult = await pool.query(
          `SELECT li._id, li.album_id,
                  COALESCE(a.artist, li.artist) as artist,
                  COALESCE(a.album, li.album) as album
           FROM list_items li
           LEFT JOIN albums a ON li.album_id = a.album_id
           WHERE li.list_id = $1`,
          [listId]
        );
        const listItems = listItemsResult.rows;

        if (listItems.length === 0) {
          return res.json({ playcounts: {}, staleCount: 0 });
        }

        // Get cached playcounts from user_album_stats
        const userId = req.user._id;
        const playcounts = {};
        const staleAlbums = [];
        const missingAlbums = [];

        // Stale threshold: 24 hours
        const staleThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000);

        // Query all stats for this user at once
        const statsResult = await pool.query(
          `SELECT artist, album_name, album_id, lastfm_playcount, lastfm_updated_at
         FROM user_album_stats
         WHERE user_id = $1`,
          [userId]
        );

        // Build a lookup map (lowercase artist+album for matching)
        const statsMap = new Map();
        for (const row of statsResult.rows) {
          const key = `${row.artist.toLowerCase()}|||${row.album_name.toLowerCase()}`;
          statsMap.set(key, row);
        }

        // Match list items to cached stats
        for (const item of listItems) {
          if (!item.artist || !item.album) continue;

          const key = `${item.artist.toLowerCase()}|||${item.album.toLowerCase()}`;
          const cached = statsMap.get(key);

          if (cached) {
            playcounts[item._id] = cached.lastfm_playcount || 0;

            // Check if stale
            if (
              !cached.lastfm_updated_at ||
              new Date(cached.lastfm_updated_at) < staleThreshold
            ) {
              staleAlbums.push({
                itemId: item._id,
                artist: item.artist,
                album: item.album,
                albumId: item.album_id,
              });
            }
          } else {
            // No cached data
            playcounts[item._id] = null;
            missingAlbums.push({
              itemId: item._id,
              artist: item.artist,
              album: item.album,
              albumId: item.album_id,
            });
          }
        }

        // Trigger background refresh for stale/missing albums
        const albumsToRefresh =
          refresh === 'true'
            ? [...missingAlbums, ...staleAlbums]
            : missingAlbums;

        if (albumsToRefresh.length > 0) {
          logger.info('Triggering background playcount refresh', {
            albumCount: albumsToRefresh.length,
            missingCount: missingAlbums.length,
            staleCount: staleAlbums.length,
            lastfmUsername: req.user.lastfmUsername,
          });
          // Don't await - let it run in background
          refreshPlaycountsInBackground(
            userId,
            req.user.lastfmUsername,
            albumsToRefresh,
            pool,
            logger
          ).catch((err) => {
            logger.error('Background playcount refresh failed:', err);
          });
        }

        res.json({
          playcounts,
          staleCount: staleAlbums.length,
          missingCount: missingAlbums.length,
          refreshing: albumsToRefresh.length,
        });
      } catch (error) {
        logger.error('Last.fm list playcounts error:', error);
        res.status(500).json({ error: 'Failed to fetch playcounts' });
      }
    }
  );

  // POST /api/lastfm/refresh-playcounts - Force refresh playcounts for specific albums
  app.post(
    '/api/lastfm/refresh-playcounts',
    ensureAuthAPI,
    async (req, res) => {
      const { albums } = req.body;

      if (!req.user.lastfmUsername) {
        return res.status(401).json({
          error: 'Last.fm not connected',
          code: 'NOT_AUTHENTICATED',
          service: 'lastfm',
        });
      }

      if (!albums || !Array.isArray(albums) || albums.length === 0) {
        return res.status(400).json({ error: 'albums array is required' });
      }

      // Limit to 50 albums per request
      const toRefresh = albums.slice(0, 50).map((a) => ({
        itemId: a.itemId,
        artist: a.artist,
        album: a.album,
        albumId: a.albumId,
      }));

      try {
        const results = await refreshPlaycountsInBackground(
          req.user._id,
          req.user.lastfmUsername,
          toRefresh,
          pool,
          logger
        );

        res.json({ updated: results });
      } catch (error) {
        logger.error('Last.fm refresh playcounts error:', error);
        res.status(500).json({ error: 'Failed to refresh playcounts' });
      }
    }
  );

  // GET /api/user/lists-summary - Get list names for the current user (for "Add to..." dropdown)
  app.get('/api/user/lists-summary', ensureAuthAPI, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT _id, name, year FROM lists WHERE user_id = $1 ORDER BY name`,
        [req.user._id]
      );

      res.json({
        lists: result.rows.map((row) => ({
          id: row._id,
          name: row.name,
          year: row.year,
        })),
      });
    } catch (error) {
      logger.error('Lists summary error:', error);
      res.status(500).json({ error: 'Failed to fetch lists' });
    }
  });
};

// Background function to refresh playcounts from Last.fm API
async function refreshPlaycountsInBackground(
  userId,
  lastfmUsername,
  albums,
  pool,
  logger
) {
  const { getAlbumInfo } = require('../utils/lastfm-auth');
  const results = {};

  // Process in batches with rate limiting (~5 req/sec for Last.fm)
  const BATCH_SIZE = 5;
  const DELAY_MS = 1100; // Just over 1 second between batches

  for (let i = 0; i < albums.length; i += BATCH_SIZE) {
    const batch = albums.slice(i, i + BATCH_SIZE);

    const batchPromises = batch.map(async (album) => {
      try {
        const info = await getAlbumInfo(
          album.artist,
          album.album,
          lastfmUsername,
          process.env.LASTFM_API_KEY
        );

        const playcount = parseInt(info.userplaycount || 0);

        // Upsert into user_album_stats
        // Use LOWER() for artist/album_name to ensure case-insensitive matching
        // ON CONFLICT uses the unique index on (user_id, LOWER(artist), LOWER(album_name))
        await pool.query(
          `INSERT INTO user_album_stats (user_id, album_id, artist, album_name, lastfm_playcount, lastfm_updated_at, updated_at)
           VALUES ($1, $2, LOWER($3), LOWER($4), $5, NOW(), NOW())
           ON CONFLICT (user_id, LOWER(artist), LOWER(album_name))
           DO UPDATE SET
             album_id = COALESCE(EXCLUDED.album_id, user_album_stats.album_id),
             lastfm_playcount = EXCLUDED.lastfm_playcount,
             lastfm_updated_at = NOW(),
             updated_at = NOW()`,
          [userId, album.albumId || null, album.artist, album.album, playcount]
        );

        results[album.itemId] = playcount;
        logger.debug('Fetched playcount', {
          artist: album.artist,
          album: album.album,
          playcount,
        });
      } catch (err) {
        logger.warn(
          `Failed to fetch playcount for ${album.artist} - ${album.album}:`,
          err.message
        );
        results[album.itemId] = null;
      }
    });

    await Promise.all(batchPromises);

    // Rate limit delay between batches (except for last batch)
    if (i + BATCH_SIZE < albums.length) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
  }

  const successCount = Object.values(results).filter((v) => v !== null).length;
  logger.info('Background playcount refresh completed', {
    total: albums.length,
    successful: successCount,
    failed: albums.length - successCount,
  });

  return results;
}
