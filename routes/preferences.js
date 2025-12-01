// routes/preferences.js
// API endpoints for user music preferences

const logger = require('../utils/logger');
const { createUserPreferences } = require('../utils/user-preferences');
const { createPreferenceSyncService } = require('../utils/preference-sync');

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

  // ==========================================================================
  // GET /api/preferences - Get all preference data for current user
  // ==========================================================================
  app.get('/api/preferences', ensureAuthAPI, async (req, res) => {
    try {
      const userId = req.user._id;
      const prefs = await userPrefs.getPreferences(userId);

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
    } catch (error) {
      logger.error('Error fetching preferences:', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch preferences',
      });
    }
  });

  // ==========================================================================
  // GET /api/preferences/status - Get sync status and staleness info
  // ==========================================================================
  app.get('/api/preferences/status', ensureAuthAPI, async (req, res) => {
    try {
      const userId = req.user._id;
      const prefs = await userPrefs.getPreferences(userId);
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
    } catch (error) {
      logger.error('Error fetching preference status:', {
        error: error.message,
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch preference status',
      });
    }
  });

  // ==========================================================================
  // POST /api/preferences/sync - Manually trigger a sync for current user
  // ==========================================================================
  app.post('/api/preferences/sync', ensureAuthAPI, async (req, res) => {
    try {
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
    } catch (error) {
      logger.error('Error syncing preferences:', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to sync preferences',
      });
    }
  });

  // ==========================================================================
  // GET /api/preferences/genres - Get genre data only
  // ==========================================================================
  app.get('/api/preferences/genres', ensureAuthAPI, async (req, res) => {
    try {
      const userId = req.user._id;
      const prefs = await userPrefs.getPreferences(userId);

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
    } catch (error) {
      logger.error('Error fetching genre preferences:', {
        error: error.message,
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch genre preferences',
      });
    }
  });

  // ==========================================================================
  // GET /api/preferences/artists - Get artist data only
  // ==========================================================================
  app.get('/api/preferences/artists', ensureAuthAPI, async (req, res) => {
    try {
      const userId = req.user._id;
      const prefs = await userPrefs.getPreferences(userId);

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
    } catch (error) {
      logger.error('Error fetching artist preferences:', {
        error: error.message,
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch artist preferences',
      });
    }
  });

  // ==========================================================================
  // GET /api/preferences/countries - Get country data only
  // ==========================================================================
  app.get('/api/preferences/countries', ensureAuthAPI, async (req, res) => {
    try {
      const userId = req.user._id;
      const prefs = await userPrefs.getPreferences(userId);

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
    } catch (error) {
      logger.error('Error fetching country preferences:', {
        error: error.message,
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch country preferences',
      });
    }
  });

  // ==========================================================================
  // GET /api/preferences/spotify - Get Spotify data only
  // ==========================================================================
  app.get('/api/preferences/spotify', ensureAuthAPI, async (req, res) => {
    try {
      const userId = req.user._id;
      const prefs = await userPrefs.getPreferences(userId);

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
    } catch (error) {
      logger.error('Error fetching Spotify preferences:', {
        error: error.message,
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch Spotify preferences',
      });
    }
  });

  // ==========================================================================
  // GET /api/preferences/spotify/artists - Get Spotify top artists by time range
  // ==========================================================================
  app.get(
    '/api/preferences/spotify/artists',
    ensureAuthAPI,
    async (req, res) => {
      try {
        const userId = req.user._id;
        const { range } = req.query; // short_term, medium_term, long_term
        const prefs = await userPrefs.getPreferences(userId);

        if (!prefs || !prefs.spotify_top_artists) {
          return res.json({
            success: true,
            data: range ? [] : {},
          });
        }

        const artists = prefs.spotify_top_artists;

        if (
          range &&
          ['short_term', 'medium_term', 'long_term'].includes(range)
        ) {
          return res.json({
            success: true,
            data: artists[range] || [],
            timeRange: range,
          });
        }

        res.json({
          success: true,
          data: artists,
          syncedAt: prefs.spotify_synced_at,
        });
      } catch (error) {
        logger.error('Error fetching Spotify artists:', {
          error: error.message,
        });
        res.status(500).json({
          success: false,
          error: 'Failed to fetch Spotify artists',
        });
      }
    }
  );

  // ==========================================================================
  // GET /api/preferences/spotify/tracks - Get Spotify top tracks by time range
  // ==========================================================================
  app.get(
    '/api/preferences/spotify/tracks',
    ensureAuthAPI,
    async (req, res) => {
      try {
        const userId = req.user._id;
        const { range } = req.query;
        const prefs = await userPrefs.getPreferences(userId);

        if (!prefs || !prefs.spotify_top_tracks) {
          return res.json({
            success: true,
            data: range ? [] : {},
          });
        }

        const tracks = prefs.spotify_top_tracks;

        if (
          range &&
          ['short_term', 'medium_term', 'long_term'].includes(range)
        ) {
          return res.json({
            success: true,
            data: tracks[range] || [],
            timeRange: range,
          });
        }

        res.json({
          success: true,
          data: tracks,
          syncedAt: prefs.spotify_synced_at,
        });
      } catch (error) {
        logger.error('Error fetching Spotify tracks:', {
          error: error.message,
        });
        res.status(500).json({
          success: false,
          error: 'Failed to fetch Spotify tracks',
        });
      }
    }
  );

  // ==========================================================================
  // GET /api/preferences/spotify/albums - Get Spotify saved albums
  // ==========================================================================
  app.get(
    '/api/preferences/spotify/albums',
    ensureAuthAPI,
    async (req, res) => {
      try {
        const userId = req.user._id;
        const { limit = 50, offset = 0 } = req.query;
        const prefs = await userPrefs.getPreferences(userId);

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
      } catch (error) {
        logger.error('Error fetching Spotify albums:', {
          error: error.message,
        });
        res.status(500).json({
          success: false,
          error: 'Failed to fetch Spotify albums',
        });
      }
    }
  );

  // ==========================================================================
  // GET /api/preferences/lastfm - Get Last.fm data only
  // ==========================================================================
  app.get('/api/preferences/lastfm', ensureAuthAPI, async (req, res) => {
    try {
      const userId = req.user._id;
      const prefs = await userPrefs.getPreferences(userId);

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
    } catch (error) {
      logger.error('Error fetching Last.fm preferences:', {
        error: error.message,
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch Last.fm preferences',
      });
    }
  });

  // ==========================================================================
  // GET /api/preferences/lastfm/artists - Get Last.fm top artists by period
  // ==========================================================================
  app.get(
    '/api/preferences/lastfm/artists',
    ensureAuthAPI,
    async (req, res) => {
      try {
        const userId = req.user._id;
        const { period } = req.query; // 7day, 1month, 3month, 6month, 12month, overall
        const prefs = await userPrefs.getPreferences(userId);

        if (!prefs || !prefs.lastfm_top_artists) {
          return res.json({
            success: true,
            data: period ? [] : {},
          });
        }

        const artists = prefs.lastfm_top_artists;
        const validPeriods = [
          '7day',
          '1month',
          '3month',
          '6month',
          '12month',
          'overall',
        ];

        if (period && validPeriods.includes(period)) {
          return res.json({
            success: true,
            data: artists[period] || [],
            period,
          });
        }

        res.json({
          success: true,
          data: artists,
          syncedAt: prefs.lastfm_synced_at,
        });
      } catch (error) {
        logger.error('Error fetching Last.fm artists:', {
          error: error.message,
        });
        res.status(500).json({
          success: false,
          error: 'Failed to fetch Last.fm artists',
        });
      }
    }
  );

  // ==========================================================================
  // GET /api/preferences/lastfm/albums - Get Last.fm top albums by period
  // ==========================================================================
  app.get('/api/preferences/lastfm/albums', ensureAuthAPI, async (req, res) => {
    try {
      const userId = req.user._id;
      const { period } = req.query;
      const prefs = await userPrefs.getPreferences(userId);

      if (!prefs || !prefs.lastfm_top_albums) {
        return res.json({
          success: true,
          data: period ? [] : {},
        });
      }

      const albums = prefs.lastfm_top_albums;
      const validPeriods = [
        '7day',
        '1month',
        '3month',
        '6month',
        '12month',
        'overall',
      ];

      if (period && validPeriods.includes(period)) {
        return res.json({
          success: true,
          data: albums[period] || [],
          period,
        });
      }

      res.json({
        success: true,
        data: albums,
        syncedAt: prefs.lastfm_synced_at,
      });
    } catch (error) {
      logger.error('Error fetching Last.fm albums:', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch Last.fm albums',
      });
    }
  });

  // ==========================================================================
  // GET /api/preferences/affinity - Get computed affinity scores
  // ==========================================================================
  app.get('/api/preferences/affinity', ensureAuthAPI, async (req, res) => {
    try {
      const userId = req.user._id;
      const prefs = await userPrefs.getPreferences(userId);

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
    } catch (error) {
      logger.error('Error fetching affinity scores:', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch affinity scores',
      });
    }
  });

  // ==========================================================================
  // GET /api/preferences/affinity/genres - Get genre affinity scores only
  // ==========================================================================
  app.get(
    '/api/preferences/affinity/genres',
    ensureAuthAPI,
    async (req, res) => {
      try {
        const userId = req.user._id;
        const { limit = 50 } = req.query;
        const prefs = await userPrefs.getPreferences(userId);

        if (!prefs || !prefs.genre_affinity) {
          return res.json({
            success: true,
            data: [],
          });
        }

        const genres = prefs.genre_affinity || [];
        const limitNum = Math.min(parseInt(limit, 10) || 50, 100);

        res.json({
          success: true,
          data: genres.slice(0, limitNum),
          total: genres.length,
          updatedAt: prefs.updated_at,
        });
      } catch (error) {
        logger.error('Error fetching genre affinity:', {
          error: error.message,
        });
        res.status(500).json({
          success: false,
          error: 'Failed to fetch genre affinity',
        });
      }
    }
  );

  // ==========================================================================
  // GET /api/preferences/affinity/artists - Get artist affinity scores only
  // ==========================================================================
  app.get(
    '/api/preferences/affinity/artists',
    ensureAuthAPI,
    async (req, res) => {
      try {
        const userId = req.user._id;
        const { limit = 50 } = req.query;
        const prefs = await userPrefs.getPreferences(userId);

        if (!prefs || !prefs.artist_affinity) {
          return res.json({
            success: true,
            data: [],
          });
        }

        const artists = prefs.artist_affinity || [];
        const limitNum = Math.min(parseInt(limit, 10) || 50, 100);

        res.json({
          success: true,
          data: artists.slice(0, limitNum),
          total: artists.length,
          updatedAt: prefs.updated_at,
        });
      } catch (error) {
        logger.error('Error fetching artist affinity:', {
          error: error.message,
        });
        res.status(500).json({
          success: false,
          error: 'Failed to fetch artist affinity',
        });
      }
    }
  );

  // ==========================================================================
  // POST /api/preferences/aggregate - Re-aggregate internal data only
  // ==========================================================================
  app.post('/api/preferences/aggregate', ensureAuthAPI, async (req, res) => {
    try {
      const userId = req.user._id;
      const { officialOnly = false } = req.body;

      logger.info('Re-aggregating internal preferences', {
        userId,
        officialOnly,
      });

      const aggregated = await userPrefs.aggregateFromLists(userId, {
        officialOnly,
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
    } catch (error) {
      logger.error('Error aggregating preferences:', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to aggregate preferences',
      });
    }
  });

  // ==========================================================================
  // GET /api/preferences/summary - Get a lightweight summary
  // ==========================================================================
  app.get('/api/preferences/summary', ensureAuthAPI, async (req, res) => {
    try {
      const userId = req.user._id;
      const prefs = await userPrefs.getPreferences(userId);

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
    } catch (error) {
      logger.error('Error fetching preference summary:', {
        error: error.message,
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch preference summary',
      });
    }
  });
};
