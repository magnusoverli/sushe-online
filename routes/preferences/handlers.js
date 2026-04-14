function createPreferencesHandlers({ userPrefs, getSyncService, logger }) {
  const getPreferences = (userId) => userPrefs.getPreferences(userId);

  async function getAll(req, res) {
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
        topGenres: prefs.top_genres || [],
        topArtists: prefs.top_artists || [],
        topCountries: prefs.top_countries || [],
        totalAlbums: prefs.total_albums || 0,
        spotify: {
          topArtists: prefs.spotify_top_artists || [],
          topTracks: prefs.spotify_top_tracks || [],
          savedAlbums: prefs.spotify_saved_albums || [],
          syncedAt: prefs.spotify_synced_at,
        },
        lastfm: {
          topArtists: prefs.lastfm_top_artists || [],
          topAlbums: prefs.lastfm_top_albums || [],
          totalScrobbles: prefs.lastfm_total_scrobbles || 0,
          syncedAt: prefs.lastfm_synced_at,
        },
        affinity: {
          genres: prefs.genre_affinity || [],
          artists: prefs.artist_affinity || [],
        },
        countryAffinity: prefs.country_affinity || [],
        artistCountries: prefs.artist_countries || {},
        createdAt: prefs.created_at,
        updatedAt: prefs.updated_at,
      },
    });
  }

  async function getStatus(req, res) {
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
  }

  async function postSync(req, res) {
    const userId = req.user._id;
    const user = req.user;

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
  }

  async function getGenres(req, res) {
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
        internal: prefs.top_genres || [],
        affinity: prefs.genre_affinity || [],
        updatedAt: prefs.updated_at,
      },
    });
  }

  async function getArtists(req, res) {
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
        internal: prefs.top_artists || [],
        spotify: prefs.spotify_top_artists || {},
        lastfm: prefs.lastfm_top_artists || {},
        affinity: prefs.artist_affinity || [],
        updatedAt: prefs.updated_at,
      },
    });
  }

  async function getCountries(req, res) {
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
  }

  async function getSpotify(req, res) {
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
  }

  async function getSpotifyAlbums(req, res) {
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
  }

  async function getLastfm(req, res) {
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
  }

  async function getAffinity(req, res) {
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
  }

  async function postAggregate(req, res) {
    const userId = req.user._id;
    const { mainOnly = false } = req.body;

    logger.info('Re-aggregating internal preferences', {
      userId,
      mainOnly,
    });

    const aggregated = await userPrefs.aggregateFromLists(userId, { mainOnly });

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
  }

  async function getSummary(req, res) {
    const userId = req.user._id;
    const prefs = await getPreferences(userId);

    if (!prefs) {
      return res.json({
        success: true,
        data: null,
      });
    }

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
  }

  return {
    getAffinity,
    getAll,
    getArtists,
    getCountries,
    getGenres,
    getLastfm,
    getPreferences,
    getSpotify,
    getSpotifyAlbums,
    getStatus,
    getSummary,
    postAggregate,
    postSync,
  };
}

module.exports = {
  createPreferencesHandlers,
};
