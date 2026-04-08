/**
 * Settings drawer data loaders.
 *
 * Keeps API and normalization logic separate from rendering/DOM concerns.
 */

export function createSettingsDataLoaders(deps = {}) {
  const apiCall =
    deps.apiCall || (() => Promise.reject(new Error('apiCall not provided')));

  async function getRecommendationLockStatus(year) {
    try {
      const response = await apiCall(`/api/recommendations/${year}/status`);
      return response;
    } catch (err) {
      console.warn('Error fetching recommendation lock status:', err);
      return { locked: false, hasAccess: true, count: 0 };
    }
  }

  async function loadAccountData() {
    try {
      const user = window.currentUser || {};
      return {
        email: user.email || '',
        username: user.username || '',
        role: user.role || 'user',
        createdAt: user.createdAt || user._createdAt || null,
      };
    } catch (error) {
      console.error('Error loading account data:', error);
      return { email: '', username: '', role: 'user', createdAt: null };
    }
  }

  async function loadIntegrationsData() {
    try {
      const user = window.currentUser || {};
      return {
        spotify: {
          connected: !!user.spotifyAuth,
        },
        tidal: {
          connected: !!user.tidalAuth,
        },
        lastfm: {
          connected: !!user.lastfmUsername,
        },
        musicService: user.musicService || '',
        spotifyAuth: !!user.spotifyAuth,
        tidalAuth: !!user.tidalAuth,
      };
    } catch (error) {
      console.error('Error loading integrations data:', error);
      return {
        spotify: { connected: false },
        tidal: { connected: false },
        lastfm: { connected: false },
        musicService: '',
        spotifyAuth: false,
        tidalAuth: false,
      };
    }
  }

  async function loadVisualData() {
    try {
      const user = window.currentUser || {};
      return {
        accentColor: user.accentColor || '#dc2626',
        timeFormat: user.timeFormat || '24h',
        dateFormat: user.dateFormat || 'MM/DD/YYYY',
        columnVisibility: user.columnVisibility || null,
      };
    } catch (error) {
      console.error('Error loading visual data:', error);
      return {
        accentColor: '#dc2626',
        timeFormat: '24h',
        dateFormat: 'MM/DD/YYYY',
        columnVisibility: null,
      };
    }
  }

  async function loadPreferencesData() {
    try {
      const prefs = await apiCall('/api/preferences');
      if (!prefs || !prefs.data) {
        return { hasData: false };
      }

      const data = prefs.data;
      let spotifyArtistsByRange = {};
      let spotifyTracksByRange = {};
      let lastfmArtistsByRange = {};

      if (data.spotify?.syncedAt) {
        try {
          const [spotifyArtistsRes, spotifyTracksRes] = await Promise.all([
            apiCall('/api/preferences/spotify/artists'),
            apiCall('/api/preferences/spotify/tracks'),
          ]);

          if (
            spotifyArtistsRes?.data &&
            typeof spotifyArtistsRes.data === 'object' &&
            !Array.isArray(spotifyArtistsRes.data)
          ) {
            spotifyArtistsByRange = spotifyArtistsRes.data;
          }

          if (
            spotifyTracksRes?.data &&
            typeof spotifyTracksRes.data === 'object' &&
            !Array.isArray(spotifyTracksRes.data)
          ) {
            spotifyTracksByRange = spotifyTracksRes.data;
          }
        } catch (error) {
          console.warn('Error loading Spotify time range data:', error);
        }
      }

      if (data.lastfm?.syncedAt) {
        try {
          const lastfmArtistsRes = await apiCall(
            '/api/preferences/lastfm/artists'
          );

          if (
            lastfmArtistsRes?.data &&
            typeof lastfmArtistsRes.data === 'object' &&
            !Array.isArray(lastfmArtistsRes.data)
          ) {
            lastfmArtistsByRange = lastfmArtistsRes.data;
          }
        } catch (error) {
          console.warn('Error loading Last.fm time range data:', error);
        }
      }

      return {
        hasData: true,
        totalAlbums: data.totalAlbums || 0,
        topGenres: data.topGenres || [],
        topArtists: data.topArtists || [],
        topCountries: data.topCountries || [],
        genreAffinity: data.affinity?.genres || [],
        artistAffinity: data.affinity?.artists || [],
        spotify: {
          ...data.spotify,
          topArtistsByRange: spotifyArtistsByRange,
          topTracksByRange: spotifyTracksByRange,
        },
        lastfm: {
          ...data.lastfm,
          topArtistsByRange: lastfmArtistsByRange,
        },
        updatedAt: data.updatedAt,
      };
    } catch (error) {
      console.error('Error loading preferences data:', error);
      return { hasData: false };
    }
  }

  async function loadStatsData() {
    try {
      const prefs = await apiCall('/api/preferences/summary');

      let listCount = 0;
      try {
        const listsSummary = await apiCall('/api/user/lists-summary');
        if (
          listsSummary &&
          listsSummary.lists &&
          Array.isArray(listsSummary.lists)
        ) {
          listCount = listsSummary.lists.length;
        }
      } catch (e) {
        console.warn('Could not fetch list count:', e);
      }

      let systemStats = null;
      try {
        systemStats = await apiCall('/api/stats');
      } catch (e) {
        console.warn('Could not load system stats:', e);
      }

      return {
        totalAlbums: prefs?.data?.totalAlbums || 0,
        totalScrobbles: prefs?.data?.totalScrobbles || 0,
        hasSpotify: prefs?.data?.hasSpotify || false,
        hasLastfm: prefs?.data?.hasLastfm || false,
        listCount,
        systemStats,
      };
    } catch (error) {
      console.error('Error loading stats data:', error);
      return {
        totalAlbums: 0,
        totalScrobbles: 0,
        hasSpotify: false,
        hasLastfm: false,
        listCount: 0,
        systemStats: null,
      };
    }
  }

  async function loadAdminData() {
    try {
      const eventsResponse = await apiCall('/api/admin/events?limit=50');
      const eventsCountsResponse = await apiCall('/api/admin/events/counts');

      let telegramStatus = null;
      try {
        telegramStatus = await apiCall('/api/admin/telegram/status');
      } catch (e) {
        console.warn('Could not load Telegram status:', e);
      }

      let telegramRecsStatus = null;
      try {
        telegramRecsStatus = await apiCall(
          '/api/admin/telegram/recommendations/status'
        );
      } catch (e) {
        console.warn('Could not load Telegram recommendations status:', e);
      }

      let stats = null;
      try {
        stats = await apiCall('/api/admin/stats');
      } catch (e) {
        console.warn('Could not load admin stats:', e);
      }

      let users = [];
      try {
        if (stats && stats.users) {
          users = stats.users;
        }
      } catch (e) {
        console.warn('Could not load users:', e);
      }

      let aggregateLists = [];
      try {
        const aggregateResponse = await apiCall(
          '/api/aggregate-list-years/with-main-lists'
        );
        if (
          aggregateResponse &&
          aggregateResponse.years &&
          aggregateResponse.years.length > 0
        ) {
          aggregateLists = await Promise.all(
            aggregateResponse.years.map(async (year) => {
              try {
                let status = {
                  exists: false,
                  revealed: false,
                  confirmations: [],
                  confirmationCount: 0,
                  requiredConfirmations: 2,
                };
                try {
                  const statusResponse = await apiCall(
                    `/api/aggregate-list/${year}/status`
                  );
                  status = statusResponse || status;
                } catch (e) {
                  console.warn(`Could not load status for year ${year}:`, e);
                }

                let yearStats = null;
                try {
                  const statsResponse = await apiCall(
                    `/api/aggregate-list/${year}/stats`
                  );
                  if (statsResponse && statsResponse.stats) {
                    yearStats = statsResponse.stats;
                  }
                } catch (e) {
                  console.warn(`Could not load stats for year ${year}:`, e);
                }

                let recStatus = { locked: false };
                try {
                  recStatus = await getRecommendationLockStatus(year);
                } catch (e) {
                  console.warn(
                    `Could not load recommendation status for year ${year}:`,
                    e
                  );
                }

                return {
                  year,
                  status,
                  stats: yearStats,
                  recStatus,
                };
              } catch (e) {
                console.warn(
                  `Error loading aggregate list for year ${year}:`,
                  e
                );
                return {
                  year,
                  status: {
                    exists: false,
                    revealed: false,
                    confirmations: [],
                    confirmationCount: 0,
                    requiredConfirmations: 2,
                  },
                  stats: null,
                };
              }
            })
          );
        }
      } catch (e) {
        console.warn('Could not load aggregate lists:', e);
      }

      return {
        hasData: true,
        events: {
          pending: eventsResponse.events || [],
          counts: eventsCountsResponse || {
            total: 0,
            byType: {},
            byPriority: {},
          },
        },
        telegram: telegramStatus || { configured: false },
        telegramRecs: telegramRecsStatus || {
          configured: false,
          recommendationsEnabled: false,
        },
        stats: stats || null,
        users,
        aggregateLists,
      };
    } catch (error) {
      console.error('Error loading admin data:', error);
      return { hasData: false };
    }
  }

  return {
    loadAccountData,
    loadIntegrationsData,
    loadVisualData,
    loadPreferencesData,
    loadStatsData,
    loadAdminData,
  };
}
