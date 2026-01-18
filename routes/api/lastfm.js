/**
 * Last.fm API Routes
 *
 * Handles Last.fm integration:
 * - Top albums
 * - Album playcounts
 * - Scrobbling
 * - Now playing
 * - Similar artists
 * - Recent tracks
 * - List playcounts
 */

/**
 * Register Last.fm routes
 * @param {Object} app - Express app instance
 * @param {Object} deps - Dependencies
 */
module.exports = (app, deps) => {
  const {
    ensureAuthAPI,
    pool,
    logger,
    normalizeAlbumKey,
    refreshPlaycountsInBackground,
    getLastfmTopAlbums,
    getLastfmAlbumInfo,
    lastfmScrobble,
    lastfmUpdateNowPlaying,
    getLastfmSimilarArtists,
    getLastfmRecentTracks,
  } = deps;

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
      const albums = await getLastfmTopAlbums(
        req.user.lastfmUsername,
        period,
        Math.min(parseInt(limit) || 50, 200),
        process.env.LASTFM_API_KEY
      );

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
      const info = await getLastfmAlbumInfo(
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
      const albumsToFetch = albums.slice(0, 50);
      const BATCH_SIZE = 5;
      const DELAY_MS = 1100;
      const results = [];

      for (let i = 0; i < albumsToFetch.length; i += BATCH_SIZE) {
        const batch = albumsToFetch.slice(i, i + BATCH_SIZE);

        const batchResults = await Promise.allSettled(
          batch.map(async (album) => {
            const info = await getLastfmAlbumInfo(
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

        results.push(...batchResults);

        if (i + BATCH_SIZE < albumsToFetch.length) {
          await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
        }
      }

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
      const result = await lastfmScrobble(
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
      const result = await lastfmUpdateNowPlaying(
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
      const similarArtists = await getLastfmSimilarArtists(
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
      const tracks = await getLastfmRecentTracks(
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

  // GET /api/lastfm/list-playcounts/:listId - Get playcounts for albums in a list
  app.get(
    '/api/lastfm/list-playcounts/:listId',
    ensureAuthAPI,
    async (req, res) => {
      const { listId } = req.params;

      if (!req.user.lastfmUsername) {
        return res.status(401).json({
          error: 'Last.fm not connected',
          code: 'NOT_AUTHENTICATED',
          service: 'lastfm',
        });
      }

      try {
        // Verify user owns this list
        const list = await pool.query(`SELECT _id FROM lists WHERE _id = $1`, [
          listId,
        ]);
        if (list.rows.length === 0) {
          return res.status(404).json({ error: 'List not found' });
        }

        // Get all albums in the list with a JOIN to albums table
        const listItemsResult = await pool.query(
          `SELECT li._id, li.album_id,
                  COALESCE(NULLIF(a.artist, ''), li.artist) as artist,
                  COALESCE(NULLIF(a.album, ''), li.album) as album
           FROM list_items li
           LEFT JOIN albums a ON li.album_id = a.album_id
           WHERE li.list_id = $1`,
          [listId]
        );
        const listItems = listItemsResult.rows;

        if (listItems.length === 0) {
          return res.json({ playcounts: {}, refreshing: 0 });
        }

        // Get cached playcounts from user_album_stats
        const userId = req.user._id;
        const playcounts = {};

        const statsResult = await pool.query(
          `SELECT artist, album_name, album_id, normalized_key, lastfm_playcount, lastfm_updated_at
         FROM user_album_stats
         WHERE user_id = $1`,
          [userId]
        );

        // Build a lookup map using normalized artist+album keys
        const statsMap = new Map();
        for (const row of statsResult.rows) {
          const key =
            row.normalized_key || normalizeAlbumKey(row.artist, row.album_name);
          const existing = statsMap.get(key);
          const rowCount = row.lastfm_playcount ?? 0;
          const existingCount = existing?.lastfm_playcount ?? 0;
          const rowNewer =
            existing &&
            row.lastfm_updated_at &&
            existing.lastfm_updated_at &&
            new Date(row.lastfm_updated_at) >
              new Date(existing.lastfm_updated_at);
          if (
            !existing ||
            rowCount > existingCount ||
            (rowCount === existingCount && rowNewer)
          ) {
            statsMap.set(key, row);
          }
        }

        // Match list items to cached stats using normalized keys
        for (const item of listItems) {
          if (!item.artist || !item.album) continue;

          const key = normalizeAlbumKey(item.artist, item.album);
          const cached = statsMap.get(key);

          playcounts[item._id] = cached ? cached.lastfm_playcount || 0 : null;
        }

        // Always refresh ALL albums in background on every list render
        const albumsToRefresh = listItems.map((item) => ({
          itemId: item._id,
          artist: item.artist,
          album: item.album,
          albumId: item.album_id,
        }));

        if (albumsToRefresh.length > 0) {
          logger.debug('Triggering background playcount refresh', {
            albumCount: albumsToRefresh.length,
            lastfmUsername: req.user.lastfmUsername,
          });
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
};
