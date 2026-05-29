/**
 * Last.fm API Routes
 *
 * Handles Last.fm integration:
 * - Top albums
 * - Scrobbling
 * - Now playing
 * - Similar artists
 * - Recent tracks
 * - List playcounts (cached, with background refresh)
 */

const { createAsyncHandler } = require('../../middleware/async-handler');
const { createPlaycountService } = require('../../services/playcount-service');
const {
  canonicalAlbumKey: buildCanonicalAlbumKey,
} = require('../../utils/playcount-key');
const { claimAlbumsForRefresh } = require('../../services/playcount-engine');

/**
 * Register Last.fm routes
 * @param {Object} app - Express app instance
 * @param {Object} deps - Dependencies
 */
module.exports = (app, deps) => {
  const {
    ensureAuthAPI,
    db,
    logger,
    normalizeAlbumKey,
    refreshPlaycountsInBackground,
    requireLastfmAuth,
    requireLastfmSessionKey,
    getLastfmTopAlbums,
    lastfmScrobble,
    lastfmUpdateNowPlaying,
    getLastfmSimilarArtists,
    getLastfmRecentTracks,
    externalIdentityService,
  } = deps;

  const asyncHandler = createAsyncHandler(logger);
  const playcountService = createPlaycountService();

  // Canonical album key consistent with the playcount cache write path, so
  // accented/special-char names (e.g. "Sigur Rós") match reliably.
  const canonicalAlbumKey = (artist, album) =>
    buildCanonicalAlbumKey(normalizeAlbumKey, artist, album);

  function getLastfmWriteConfigError() {
    if (!process.env.LASTFM_API_KEY || !process.env.LASTFM_SECRET) {
      return {
        status: 503,
        code: 'SERVICE_NOT_CONFIGURED',
        error: 'Last.fm is not configured on this server',
        retryable: false,
      };
    }
    return null;
  }

  function mapLastfmWriteError(err) {
    if (err.lastfmCode === 9) {
      return {
        status: 401,
        code: 'LASTFM_SESSION_INVALID',
        error: 'Last.fm session is invalid. Reconnect Last.fm.',
        retryable: false,
      };
    }

    if (err.lastfmCode === 4 || err.lastfmCode === 10) {
      return {
        status: 503,
        code: 'LASTFM_INVALID_API_KEY',
        error: 'Last.fm server credentials are invalid',
        retryable: false,
      };
    }

    if (err.lastfmCode === 29) {
      return {
        status: 429,
        code: 'LASTFM_RATE_LIMITED',
        error: 'Last.fm rate limit exceeded',
        retryable: true,
      };
    }

    return {
      status: 502,
      code: 'LASTFM_UPSTREAM_ERROR',
      error: 'Last.fm request failed',
      retryable: true,
    };
  }

  function sendLastfmWriteError(res, err, context) {
    const response = mapLastfmWriteError(err);
    const logLevel = response.retryable ? 'warn' : 'info';
    logger[logLevel]('Last.fm write operation failed', {
      action: context.action,
      userId: context.userId,
      status: response.status,
      code: response.code,
      lastfmCode: err.lastfmCode,
      error: err.message,
    });
    return res.status(response.status).json({
      error: response.error,
      code: response.code,
      service: 'lastfm',
      retryable: response.retryable,
    });
  }

  async function refreshScrobbledAlbumPlaycounts(user, artist, album) {
    if (!user?.lastfmUsername || !artist || !album) {
      return {};
    }

    try {
      const targetKey = canonicalAlbumKey(artist, album);
      const result = await db.raw(
        `SELECT li._id AS "itemId", a.album_id, a.artist, a.album
         FROM list_items li
         JOIN lists l ON l._id = li.list_id
         JOIN albums a ON a.album_id = li.album_id
         WHERE l.user_id = $1
           AND a.artist IS NOT NULL
           AND a.album IS NOT NULL`,
        [user._id]
      );

      const matchingAlbums = result.rows
        .filter((row) => canonicalAlbumKey(row.artist, row.album) === targetKey)
        .map((row) => ({
          itemId: row.itemId,
          artist: row.artist,
          album: row.album,
          album_id: row.album_id,
        }));

      if (matchingAlbums.length === 0) {
        return {};
      }

      // Skip albums already being refreshed by another tier (e.g. a concurrent
      // list view) so a scrobble doesn't spawn a duplicate Last.fm fetch.
      const { toLaunch, release } = claimAlbumsForRefresh(
        user._id,
        matchingAlbums
      );
      if (toLaunch.length === 0) {
        return {};
      }

      try {
        return await refreshPlaycountsInBackground(
          user._id,
          user.lastfmUsername,
          toLaunch,
          db,
          logger
        );
      } finally {
        release();
      }
    } catch (err) {
      logger.warn('Failed to refresh playcount after Last.fm scrobble', {
        userId: user._id,
        artist,
        album,
        error: err.message,
      });
      return {};
    }
  }

  async function getLastfmArtistCandidates(artist, albumId = null) {
    if (!artist) return [];

    const candidates = [artist];

    if (!externalIdentityService) {
      return candidates;
    }

    try {
      if (albumId) {
        const albumMapping =
          await externalIdentityService.getAlbumServiceMapping(
            'lastfm',
            albumId
          );
        if (albumMapping?.external_artist) {
          candidates.unshift(albumMapping.external_artist);
        }
      }

      const aliases = await externalIdentityService.getArtistAliasCandidates(
        'lastfm',
        artist,
        { includeCrossService: true }
      );
      candidates.push(...aliases);
    } catch (err) {
      logger.warn('Failed to resolve Last.fm artist aliases', {
        artist,
        albumId,
        error: err.message,
      });
    }

    return [...new Set(candidates.filter(Boolean))];
  }

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

      const configError = getLastfmWriteConfigError();
      if (configError) {
        return res.status(configError.status).json({
          error: configError.error,
          code: configError.code,
          service: 'lastfm',
          retryable: configError.retryable,
        });
      }

      let result;
      try {
        result = await lastfmScrobble(
          { artist, track, album, duration, timestamp },
          req.user.lastfmAuth.session_key,
          process.env.LASTFM_API_KEY,
          process.env.LASTFM_SECRET
        );
      } catch (err) {
        return sendLastfmWriteError(res, err, {
          action: 'scrobble',
          userId: req.user._id,
        });
      }

      if (result.error) {
        return res.status(400).json({ error: result.message });
      }

      const accepted = parseInt(result.scrobbles?.['@attr']?.accepted || 0, 10);
      const playcounts =
        accepted > 0
          ? await refreshScrobbledAlbumPlaycounts(req.user, artist, album)
          : {};

      res.json({ success: true, scrobbles: result.scrobbles, playcounts });
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

      const configError = getLastfmWriteConfigError();
      if (configError) {
        return res.status(configError.status).json({
          error: configError.error,
          code: configError.code,
          service: 'lastfm',
          retryable: configError.retryable,
        });
      }

      let result;
      try {
        result = await lastfmUpdateNowPlaying(
          { artist, track, album, duration },
          req.user.lastfmAuth.session_key,
          process.env.LASTFM_API_KEY,
          process.env.LASTFM_SECRET
        );
      } catch (err) {
        return sendLastfmWriteError(res, err, {
          action: 'now-playing',
          userId: req.user._id,
        });
      }

      res.json({ success: true, nowplaying: result.nowplaying });
    }, 'updating Last.fm now playing')
  );

  // GET /api/lastfm/similar-artists - Get similar artists (for discovery)
  app.get(
    '/api/lastfm/similar-artists',
    ensureAuthAPI,
    requireLastfmAuth,
    asyncHandler(async (req, res) => {
      const { artist, limit = 20, albumId } = req.query;

      if (!artist) {
        return res.status(400).json({ error: 'artist is required' });
      }

      const artistCandidates = await getLastfmArtistCandidates(artist, albumId);
      const safeLimit = Math.min(parseInt(limit) || 20, 50);

      let similarArtists = [];
      let matchedArtist = null;

      for (const artistCandidate of artistCandidates) {
        const result = await getLastfmSimilarArtists(
          artistCandidate,
          safeLimit,
          process.env.LASTFM_API_KEY
        );
        if (result && result.length > 0) {
          similarArtists = result;
          matchedArtist = artistCandidate;
          break;
        }
      }

      if (
        externalIdentityService &&
        matchedArtist &&
        matchedArtist !== artist
      ) {
        await externalIdentityService
          .upsertArtistAlias({
            service: 'lastfm',
            canonicalArtist: artist,
            serviceArtist: matchedArtist,
            sourceAlbumId: albumId || null,
          })
          .catch((err) => {
            logger.warn('Failed to persist Last.fm similar-artist alias', {
              artist,
              matchedArtist,
              albumId,
              error: err.message,
            });
          });
      }

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
    asyncHandler(async (req, res) => {
      if (!req.user.lastfmUsername) {
        return res.json({
          error: 'Last.fm not connected',
          code: 'NOT_AUTHENTICATED',
          service: 'lastfm',
          playcounts: {},
          refreshing: 0,
        });
      }

      const result = await playcountService.getListPlaycounts({
        listId: req.params.listId,
        userId: req.user._id,
        lastfmUsername: req.user.lastfmUsername,
        forceRefresh: req.query.refresh === 'true',
        db,
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
};
