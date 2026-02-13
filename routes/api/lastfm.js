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

const { createAsyncHandler } = require('../../middleware/async-handler');
const { createPlaycountService } = require('../../services/playcount-service');

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
    requireLastfmAuth,
    requireLastfmSessionKey,
    getLastfmTopAlbums,
    getLastfmAlbumInfo,
    lastfmScrobble,
    lastfmUpdateNowPlaying,
    getLastfmSimilarArtists,
    getLastfmRecentTracks,
  } = deps;

  const asyncHandler = createAsyncHandler(logger);
  const playcountService = createPlaycountService();

  // GET /api/lastfm/top-albums - Get user's top albums from Last.fm
  app.get(
    '/api/lastfm/top-albums',
    ensureAuthAPI,
    requireLastfmAuth,
    asyncHandler(async (req, res) => {
      const { period = 'overall', limit = 50 } = req.query;

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
    }, 'fetching Last.fm top albums')
  );

  // GET /api/lastfm/album-playcount - Get playcount for a specific album
  app.get(
    '/api/lastfm/album-playcount',
    ensureAuthAPI,
    requireLastfmAuth,
    asyncHandler(async (req, res) => {
      const { artist, album } = req.query;

      if (!artist || !album) {
        return res.status(400).json({ error: 'artist and album are required' });
      }

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
    }, 'fetching Last.fm album playcount')
  );

  // POST /api/lastfm/batch-playcounts - Get playcounts for multiple albums
  app.post(
    '/api/lastfm/batch-playcounts',
    ensureAuthAPI,
    requireLastfmAuth,
    asyncHandler(async (req, res) => {
      const { albums } = req.body;

      if (!albums || !Array.isArray(albums)) {
        return res.status(400).json({ error: 'albums array is required' });
      }

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
    }, 'fetching Last.fm batch playcounts')
  );

  // POST /api/lastfm/scrobble - Submit a scrobble to Last.fm
  app.post(
    '/api/lastfm/scrobble',
    ensureAuthAPI,
    requireLastfmSessionKey,
    asyncHandler(async (req, res) => {
      const { artist, track, album, duration, timestamp } = req.body;

      if (!artist || !track) {
        return res.status(400).json({ error: 'artist and track are required' });
      }

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
    }, 'scrobbling to Last.fm')
  );

  // POST /api/lastfm/now-playing - Update now playing status on Last.fm
  app.post(
    '/api/lastfm/now-playing',
    ensureAuthAPI,
    requireLastfmSessionKey,
    asyncHandler(async (req, res) => {
      const { artist, track, album, duration } = req.body;

      if (!artist || !track) {
        return res.status(400).json({ error: 'artist and track are required' });
      }

      const result = await lastfmUpdateNowPlaying(
        { artist, track, album, duration },
        req.user.lastfmAuth.session_key,
        process.env.LASTFM_API_KEY,
        process.env.LASTFM_SECRET
      );

      res.json({ success: true, nowplaying: result.nowplaying });
    }, 'updating Last.fm now playing')
  );

  // GET /api/lastfm/similar-artists - Get similar artists (for discovery)
  app.get(
    '/api/lastfm/similar-artists',
    ensureAuthAPI,
    requireLastfmAuth,
    asyncHandler(async (req, res) => {
      const { artist, limit = 20 } = req.query;

      if (!artist) {
        return res.status(400).json({ error: 'artist is required' });
      }

      const similarArtists = await getLastfmSimilarArtists(
        artist,
        Math.min(parseInt(limit) || 20, 50),
        process.env.LASTFM_API_KEY
      );

      if (!similarArtists || similarArtists.length === 0) {
        return res.json({
          artists: [],
          message: 'No similar artists found',
        });
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
    }, 'fetching Last.fm similar artists')
  );

  // GET /api/lastfm/recent-tracks - Get user's recent listening history
  app.get(
    '/api/lastfm/recent-tracks',
    ensureAuthAPI,
    requireLastfmAuth,
    asyncHandler(async (req, res) => {
      const { limit = 50 } = req.query;

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
    }, 'fetching Last.fm recent tracks')
  );

  // GET /api/lastfm/list-playcounts/:listId - Get playcounts for albums in a list
  app.get(
    '/api/lastfm/list-playcounts/:listId',
    ensureAuthAPI,
    requireLastfmAuth,
    asyncHandler(async (req, res) => {
      const result = await playcountService.getListPlaycounts({
        listId: req.params.listId,
        userId: req.user._id,
        lastfmUsername: req.user.lastfmUsername,
        pool,
        logger,
        normalizeAlbumKey,
      });

      if (result.error) {
        return res
          .status(result.error.status)
          .json({ error: result.error.message });
      }

      res.json({
        playcounts: result.playcounts,
        refreshing: result.refreshing,
      });
    }, 'fetching Last.fm list playcounts')
  );

  // POST /api/lastfm/refresh-playcounts - Force refresh playcounts for specific albums
  app.post(
    '/api/lastfm/refresh-playcounts',
    ensureAuthAPI,
    requireLastfmAuth,
    asyncHandler(async (req, res) => {
      const { albums } = req.body;

      if (!albums || !Array.isArray(albums) || albums.length === 0) {
        return res.status(400).json({ error: 'albums array is required' });
      }

      const toRefresh = albums.slice(0, 50).map((a) => ({
        itemId: a.itemId,
        artist: a.artist,
        album: a.album,
        albumId: a.albumId,
      }));

      const results = await refreshPlaycountsInBackground(
        req.user._id,
        req.user.lastfmUsername,
        toRefresh,
        pool,
        logger
      );

      res.json({ updated: results });
    }, 'refreshing Last.fm playcounts')
  );
};
