// routes/preferences.js
// API endpoints for user music preferences

const logger = require('../utils/logger');
const { createUserPreferences } = require('../utils/user-preferences');
const { createPreferenceSyncService } = require('../utils/preference-sync');
const { createAsyncHandler } = require('../middleware/async-handler');

const asyncHandler = createAsyncHandler(logger);

// Valid Last.fm time periods (shared across lastfm/artists and lastfm/albums)
const LASTFM_VALID_PERIODS = [
  '7day',
  '1month',
  '3month',
  '6month',
  '12month',
  'overall',
];

// Valid Spotify time ranges
const SPOTIFY_VALID_RANGES = ['short_term', 'medium_term', 'long_term'];

/**
 * Factory to create a handler that fetches prefs and returns a specific field
 * filtered by a time range/period query parameter.
 *
 * Handles: getPreferences, null guard, range filter, full-data fallback.
 *
 * @param {Object} opts
 * @param {Function} opts.getPreferences - userPrefs.getPreferences
 * @param {string} opts.field - Prefs field name (e.g. 'spotify_top_artists')
 * @param {string} opts.queryParam - Query parameter name ('range' or 'period')
 * @param {string[]} opts.validValues - Allowed values for the query param
 * @param {string} opts.syncedAtField - Prefs field for syncedAt timestamp
 * @returns {Function} Async route handler
 */
function createTimeRangeHandler({
  getPreferences,
  field,
  queryParam,
  validValues,
  syncedAtField,
}) {
  return async (req, res) => {
    const userId = req.user._id;
    const filterValue = req.query[queryParam];
    const prefs = await getPreferences(userId);

    if (!prefs || !prefs[field]) {
      return res.json({
        success: true,
        data: filterValue ? [] : {},
      });
    }

    const data = prefs[field];

    if (filterValue && validValues.includes(filterValue)) {
      return res.json({
        success: true,
        data: data[filterValue] || [],
        [queryParam]: filterValue,
      });
    }

    res.json({
      success: true,
      data,
      syncedAt: prefs[syncedAtField],
    });
  };
}

/**
 * Factory to create a handler that fetches prefs and returns an affinity
 * field sliced by an optional limit query parameter.
 *
 * @param {Object} opts
 * @param {Function} opts.getPreferences - userPrefs.getPreferences
 * @param {string} opts.field - Prefs field name (e.g. 'genre_affinity')
 * @returns {Function} Async route handler
 */
function createAffinityHandler({ getPreferences, field }) {
  return async (req, res) => {
    const userId = req.user._id;
    const { limit = 50 } = req.query;
    const prefs = await getPreferences(userId);

    if (!prefs || !prefs[field]) {
      return res.json({
        success: true,
        data: [],
      });
    }

    const items = prefs[field] || [];
    const limitNum = Math.min(parseInt(limit, 10) || 50, 100);

    res.json({
      success: true,
      data: items.slice(0, limitNum),
      total: items.length,
      updatedAt: prefs.updated_at,
    });
  };
}

module.exports = (app, deps) => {
  const { ensureAuthAPI, pool } = deps;

  // Initialize utilities with pool
  const userPrefs = createUserPreferences({ pool, logger });

  // Lazy-initialize sync service (only when needed for manual sync)
  let syncService = null;
  const getSyncService = () => {
    if (!syncService) {
      syncService = createPreferenceSyncService({ pool, logger });
    }
    return syncService;
  };

  // Helper: fetch prefs for current user
  const getPreferences = (userId) => userPrefs.getPreferences(userId);

  // ==========================================================================
  // GET /api/preferences - Get all preference data for current user
  // ==========================================================================
  app.get(
    '/api/preferences',
    ensureAuthAPI,
    asyncHandler(async (req, res) => {
      const userId = req.user._id;
      const prefs = await getPreferences(userId);

      if (!prefs) {
        return res.json({
          success: true,
          data: null,
          message: 'No preferences found. Sync will run automatically.',
        });
      }

      res.json({
        success: true,
        data: {
          // Internal aggregation
          topGenres: prefs.top_genres || [],
          topArtists: prefs.top_artists || [],
          topCountries: prefs.top_countries || [],
          totalAlbums: prefs.total_albums || 0,

          // Spotify data
          spotify: {
            topArtists: prefs.spotify_top_artists || [],
            topTracks: prefs.spotify_top_tracks || [],
            savedAlbums: prefs.spotify_saved_albums || [],
            syncedAt: prefs.spotify_synced_at,
          },

          // Last.fm data
          lastfm: {
            topArtists: prefs.lastfm_top_artists || [],
            topAlbums: prefs.lastfm_top_albums || [],
            totalScrobbles: prefs.lastfm_total_scrobbles || 0,
            syncedAt: prefs.lastfm_synced_at,
          },

          // Computed affinity scores
          affinity: {
            genres: prefs.genre_affinity || [],
            artists: prefs.artist_affinity || [],
          },

          // Country affinity data
          countryAffinity: prefs.country_affinity || [],

          // Artist country cache (from MusicBrainz)
          artistCountries: prefs.artist_countries || {},

          // Metadata
          createdAt: prefs.created_at,
          updatedAt: prefs.updated_at,
        },
      });
    }, 'fetching preferences')
  );

  // ==========================================================================
  // GET /api/preferences/status - Get sync status and staleness info
  // ==========================================================================
  app.get(
    '/api/preferences/status',
    ensureAuthAPI,
    asyncHandler(async (req, res) => {
      const userId = req.user._id;
      const prefs = await getPreferences(userId);
      const refreshNeeded = await userPrefs.checkRefreshNeeded(userId);

      res.json({
        success: true,
        data: {
          exists: !!prefs,
          lastUpdated: prefs?.updated_at || null,
          spotifySyncedAt: prefs?.spotify_synced_at || null,
          lastfmSyncedAt: prefs?.lastfm_synced_at || null,
          needsRefresh: refreshNeeded,
          hasSpotifyAuth: !!req.user.spotifyAuth?.access_token,
          hasLastfmAuth: !!(
            req.user.lastfmAuth?.session_key && req.user.lastfmUsername
          ),
        },
      });
    }, 'fetching preference status')
  );

  // ==========================================================================
  // POST /api/preferences/sync - Manually trigger a sync for current user
  // ==========================================================================
  app.post(
    '/api/preferences/sync',
    ensureAuthAPI,
    asyncHandler(async (req, res) => {
      const userId = req.user._id;
      const user = req.user;

      // Build user object with database field names for sync service
      const userForSync = {
        _id: userId,
        email: user.email,
        spotify_auth: user.spotifyAuth || null,
        lastfm_auth: user.lastfmAuth || null,
        lastfm_username: user.lastfmUsername || null,
      };

      logger.info('Manual preference sync triggered', { userId });

      const service = getSyncService();
      const result = await service.syncUserPreferences(userForSync);

      res.json({
        success: result.success,
        data: {
          duration: result.duration,
          errors: result.errors,
        },
        message: result.success
          ? 'Preferences synced successfully'
          : 'Sync completed with some errors',
      });
    }, 'syncing preferences')
  );

  // ==========================================================================
  // GET /api/preferences/genres - Get genre data only
  // ==========================================================================
  app.get(
    '/api/preferences/genres',
    ensureAuthAPI,
    asyncHandler(async (req, res) => {
      const userId = req.user._id;
      const prefs = await getPreferences(userId);

      if (!prefs) {
        return res.json({
          success: true,
          data: { internal: [], affinity: [] },
        });
      }

      res.json({
        success: true,
        data: {
          // From internal lists (with count and points)
          internal: prefs.top_genres || [],
          // Computed affinity (weighted across all sources)
          affinity: prefs.genre_affinity || [],
          updatedAt: prefs.updated_at,
        },
      });
    }, 'fetching genre preferences')
  );

  // ==========================================================================
  // GET /api/preferences/artists - Get artist data only
  // ==========================================================================
  app.get(
    '/api/preferences/artists',
    ensureAuthAPI,
    asyncHandler(async (req, res) => {
      const userId = req.user._id;
      const prefs = await getPreferences(userId);

      if (!prefs) {
        return res.json({
          success: true,
          data: { internal: [], spotify: {}, lastfm: {}, affinity: [] },
        });
      }

      res.json({
        success: true,
        data: {
          // From internal lists
          internal: prefs.top_artists || [],
          // From Spotify (by time range)
          spotify: prefs.spotify_top_artists || {},
          // From Last.fm (by time period)
          lastfm: prefs.lastfm_top_artists || {},
          // Computed affinity
          affinity: prefs.artist_affinity || [],
          updatedAt: prefs.updated_at,
        },
      });
    }, 'fetching artist preferences')
  );

  // ==========================================================================
  // GET /api/preferences/countries - Get country data only
  // ==========================================================================
  app.get(
    '/api/preferences/countries',
    ensureAuthAPI,
    asyncHandler(async (req, res) => {
      const userId = req.user._id;
      const prefs = await getPreferences(userId);

      if (!prefs) {
        return res.json({
          success: true,
          data: { countries: [] },
        });
      }

      res.json({
        success: true,
        data: {
          countries: prefs.top_countries || [],
          totalAlbums: prefs.total_albums || 0,
          updatedAt: prefs.updated_at,
        },
      });
    }, 'fetching country preferences')
  );

  // ==========================================================================
  // GET /api/preferences/spotify - Get Spotify data only
  // ==========================================================================
  app.get(
    '/api/preferences/spotify',
    ensureAuthAPI,
    asyncHandler(async (req, res) => {
      const userId = req.user._id;
      const prefs = await getPreferences(userId);

      if (!prefs || !prefs.spotify_synced_at) {
        return res.json({
          success: true,
          data: null,
          message: req.user.spotifyAuth?.access_token
            ? 'Spotify data not yet synced'
            : 'Spotify not connected',
        });
      }

      res.json({
        success: true,
        data: {
          topArtists: prefs.spotify_top_artists || [],
          topTracks: prefs.spotify_top_tracks || [],
          savedAlbums: prefs.spotify_saved_albums || [],
          syncedAt: prefs.spotify_synced_at,
        },
      });
    }, 'fetching Spotify preferences')
  );

  // ==========================================================================
  // GET /api/preferences/spotify/artists - Get Spotify top artists by time range
  // ==========================================================================
  app.get(
    '/api/preferences/spotify/artists',
    ensureAuthAPI,
    asyncHandler(
      createTimeRangeHandler({
        getPreferences,
        field: 'spotify_top_artists',
        queryParam: 'range',
        validValues: SPOTIFY_VALID_RANGES,
        syncedAtField: 'spotify_synced_at',
      }),
      'fetching Spotify artists'
    )
  );

  // ==========================================================================
  // GET /api/preferences/spotify/tracks - Get Spotify top tracks by time range
  // ==========================================================================
  app.get(
    '/api/preferences/spotify/tracks',
    ensureAuthAPI,
    asyncHandler(
      createTimeRangeHandler({
        getPreferences,
        field: 'spotify_top_tracks',
        queryParam: 'range',
        validValues: SPOTIFY_VALID_RANGES,
        syncedAtField: 'spotify_synced_at',
      }),
      'fetching Spotify tracks'
    )
  );

  // ==========================================================================
  // GET /api/preferences/spotify/albums - Get Spotify saved albums
  // ==========================================================================
  app.get(
    '/api/preferences/spotify/albums',
    ensureAuthAPI,
    asyncHandler(async (req, res) => {
      const userId = req.user._id;
      const { limit = 50, offset = 0 } = req.query;
      const prefs = await getPreferences(userId);

      if (!prefs || !prefs.spotify_saved_albums) {
        return res.json({
          success: true,
          data: [],
          total: 0,
        });
      }

      const albums = prefs.spotify_saved_albums || [];
      const start = parseInt(offset, 10) || 0;
      const end = start + (parseInt(limit, 10) || 50);

      res.json({
        success: true,
        data: albums.slice(start, end),
        total: albums.length,
        offset: start,
        limit: end - start,
        syncedAt: prefs.spotify_synced_at,
      });
    }, 'fetching Spotify albums')
  );

  // ==========================================================================
  // GET /api/preferences/lastfm - Get Last.fm data only
  // ==========================================================================
  app.get(
    '/api/preferences/lastfm',
    ensureAuthAPI,
    asyncHandler(async (req, res) => {
      const userId = req.user._id;
      const prefs = await getPreferences(userId);

      if (!prefs || !prefs.lastfm_synced_at) {
        return res.json({
          success: true,
          data: null,
          message: req.user.lastfmAuth?.session_key
            ? 'Last.fm data not yet synced'
            : 'Last.fm not connected',
        });
      }

      res.json({
        success: true,
        data: {
          topArtists: prefs.lastfm_top_artists || [],
          topAlbums: prefs.lastfm_top_albums || [],
          totalScrobbles: prefs.lastfm_total_scrobbles || 0,
          syncedAt: prefs.lastfm_synced_at,
        },
      });
    }, 'fetching Last.fm preferences')
  );

  // ==========================================================================
  // GET /api/preferences/lastfm/artists - Get Last.fm top artists by period
  // ==========================================================================
  app.get(
    '/api/preferences/lastfm/artists',
    ensureAuthAPI,
    asyncHandler(
      createTimeRangeHandler({
        getPreferences,
        field: 'lastfm_top_artists',
        queryParam: 'period',
        validValues: LASTFM_VALID_PERIODS,
        syncedAtField: 'lastfm_synced_at',
      }),
      'fetching Last.fm artists'
    )
  );

  // ==========================================================================
  // GET /api/preferences/lastfm/albums - Get Last.fm top albums by period
  // ==========================================================================
  app.get(
    '/api/preferences/lastfm/albums',
    ensureAuthAPI,
    asyncHandler(
      createTimeRangeHandler({
        getPreferences,
        field: 'lastfm_top_albums',
        queryParam: 'period',
        validValues: LASTFM_VALID_PERIODS,
        syncedAtField: 'lastfm_synced_at',
      }),
      'fetching Last.fm albums'
    )
  );

  // ==========================================================================
  // GET /api/preferences/affinity - Get computed affinity scores
  // ==========================================================================
  app.get(
    '/api/preferences/affinity',
    ensureAuthAPI,
    asyncHandler(async (req, res) => {
      const userId = req.user._id;
      const prefs = await getPreferences(userId);

      if (!prefs) {
        return res.json({
          success: true,
          data: { genres: [], artists: [] },
        });
      }

      res.json({
        success: true,
        data: {
          genres: prefs.genre_affinity || [],
          artists: prefs.artist_affinity || [],
          updatedAt: prefs.updated_at,
        },
      });
    }, 'fetching affinity scores')
  );

  // ==========================================================================
  // GET /api/preferences/affinity/genres - Get genre affinity scores only
  // ==========================================================================
  app.get(
    '/api/preferences/affinity/genres',
    ensureAuthAPI,
    asyncHandler(
      createAffinityHandler({
        getPreferences,
        field: 'genre_affinity',
      }),
      'fetching genre affinity'
    )
  );

  // ==========================================================================
  // GET /api/preferences/affinity/artists - Get artist affinity scores only
  // ==========================================================================
  app.get(
    '/api/preferences/affinity/artists',
    ensureAuthAPI,
    asyncHandler(
      createAffinityHandler({
        getPreferences,
        field: 'artist_affinity',
      }),
      'fetching artist affinity'
    )
  );

  // ==========================================================================
  // POST /api/preferences/aggregate - Re-aggregate internal data only
  // ==========================================================================
  app.post(
    '/api/preferences/aggregate',
    ensureAuthAPI,
    asyncHandler(async (req, res) => {
      const userId = req.user._id;
      const { mainOnly = false } = req.body;

      logger.info('Re-aggregating internal preferences', {
        userId,
        mainOnly,
      });

      const aggregated = await userPrefs.aggregateFromLists(userId, {
        mainOnly,
      });

      // Save just the internal data
      await userPrefs.savePreferences(userId, {
        topGenres: aggregated.topGenres,
        topArtists: aggregated.topArtists,
        topCountries: aggregated.topCountries,
        totalAlbums: aggregated.totalAlbums,
      });

      res.json({
        success: true,
        data: aggregated,
        message: 'Internal preferences re-aggregated',
      });
    }, 'aggregating preferences')
  );

  // ==========================================================================
  // GET /api/preferences/summary - Get a lightweight summary
  // ==========================================================================
  app.get(
    '/api/preferences/summary',
    ensureAuthAPI,
    asyncHandler(async (req, res) => {
      const userId = req.user._id;
      const prefs = await getPreferences(userId);

      if (!prefs) {
        return res.json({
          success: true,
          data: null,
        });
      }

      // Return just top 5 of each category for a quick overview
      res.json({
        success: true,
        data: {
          topGenres: (prefs.genre_affinity || []).slice(0, 5),
          topArtists: (prefs.artist_affinity || []).slice(0, 5),
          topCountries: (prefs.top_countries || []).slice(0, 5),
          totalAlbums: prefs.total_albums || 0,
          totalScrobbles: prefs.lastfm_total_scrobbles || 0,
          hasSpotify: !!prefs.spotify_synced_at,
          hasLastfm: !!prefs.lastfm_synced_at,
          lastUpdated: prefs.updated_at,
        },
      });
    }, 'fetching preference summary')
  );
};
