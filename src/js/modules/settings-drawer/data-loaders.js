/**
 * Settings drawer data loaders.
 *
 * Keeps API and normalization logic separate from rendering/DOM concerns.
 */

export function createSettingsDataLoaders(deps = {}) {
  const apiCall =
    deps.apiCall || (() => Promise.reject(new Error('apiCall not provided')));
  const ADMIN_YEAR_LOAD_CONCURRENCY = 4;

  async function mapWithConcurrency(items, concurrency, mapper) {
    if (!Array.isArray(items) || items.length === 0) {
      return [];
    }

    const limit = Math.max(1, concurrency);
    const results = new Array(items.length);
    let cursor = 0;

    async function worker() {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await mapper(items[index], index);
      }
    }

    const workerCount = Math.min(limit, items.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    return results;
  }

  function createEmptyAdminData() {
    return {
      hasData: true,
      events: {
        pending: [],
        counts: {
          total: 0,
          byType: {},
          byPriority: {},
        },
      },
      telegram: { configured: false },
      telegramRecs: {
        configured: false,
        recommendationsEnabled: false,
      },
      stats: null,
      users: [],
      aggregateLists: [],
      loading: {
        events: true,
        telegram: true,
        users: true,
        aggregateLists: true,
      },
    };
  }

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

  async function loadAdminData(options = {}) {
    const onPartialUpdate =
      typeof options.onPartialUpdate === 'function'
        ? options.onPartialUpdate
        : null;

    const publishPartial = (partial) => {
      if (onPartialUpdate) {
        onPartialUpdate(partial);
      }
    };

    try {
      const emptyAdminData = createEmptyAdminData();

      const [
        eventsResponseResult,
        eventsCountsResponseResult,
        telegramStatusResult,
        telegramRecsStatusResult,
        statsResult,
        aggregateYearsResult,
      ] = await Promise.allSettled([
        apiCall('/api/admin/events?limit=50'),
        apiCall('/api/admin/events/counts'),
        apiCall('/api/admin/telegram/status'),
        apiCall('/api/admin/telegram/recommendations/status'),
        apiCall('/api/admin/stats'),
        apiCall('/api/aggregate-list-years/with-main-lists'),
      ]);

      if (eventsResponseResult.status === 'rejected') {
        console.warn(
          'Could not load admin events:',
          eventsResponseResult.reason
        );
      }

      if (eventsCountsResponseResult.status === 'rejected') {
        console.warn(
          'Could not load admin event counts:',
          eventsCountsResponseResult.reason
        );
      }

      if (telegramStatusResult.status === 'rejected') {
        console.warn(
          'Could not load Telegram status:',
          telegramStatusResult.reason
        );
      }

      if (telegramRecsStatusResult.status === 'rejected') {
        console.warn(
          'Could not load Telegram recommendations status:',
          telegramRecsStatusResult.reason
        );
      }

      if (statsResult.status === 'rejected') {
        console.warn('Could not load admin stats:', statsResult.reason);
      }

      if (aggregateYearsResult.status === 'rejected') {
        console.warn(
          'Could not load aggregate list years:',
          aggregateYearsResult.reason
        );
      }

      const topLevelData = {
        hasData: true,
        events: {
          pending:
            eventsResponseResult.status === 'fulfilled'
              ? eventsResponseResult.value?.events || []
              : [],
          counts:
            eventsCountsResponseResult.status === 'fulfilled'
              ? eventsCountsResponseResult.value || emptyAdminData.events.counts
              : emptyAdminData.events.counts,
        },
        telegram:
          telegramStatusResult.status === 'fulfilled'
            ? telegramStatusResult.value || emptyAdminData.telegram
            : emptyAdminData.telegram,
        telegramRecs:
          telegramRecsStatusResult.status === 'fulfilled'
            ? telegramRecsStatusResult.value || emptyAdminData.telegramRecs
            : emptyAdminData.telegramRecs,
        stats: statsResult.status === 'fulfilled' ? statsResult.value : null,
        users:
          statsResult.status === 'fulfilled' &&
          Array.isArray(statsResult.value?.users)
            ? statsResult.value.users
            : [],
        loading: {
          events: false,
          telegram: false,
          users: false,
          aggregateLists: true,
        },
      };

      publishPartial(topLevelData);

      const years =
        aggregateYearsResult.status === 'fulfilled' &&
        Array.isArray(aggregateYearsResult.value?.years)
          ? aggregateYearsResult.value.years
          : [];

      const aggregateLists = await mapWithConcurrency(
        years,
        ADMIN_YEAR_LOAD_CONCURRENCY,
        async (year) => {
          try {
            const [statusResult, recStatusResult] = await Promise.allSettled([
              apiCall(`/api/aggregate-list/${year}/status`),
              getRecommendationLockStatus(year),
            ]);

            if (statusResult.status === 'rejected') {
              console.warn(
                `Could not load aggregate status for year ${year}:`,
                statusResult.reason
              );
            }

            if (recStatusResult.status === 'rejected') {
              console.warn(
                `Could not load recommendation status for year ${year}:`,
                recStatusResult.reason
              );
            }

            return {
              year,
              status:
                statusResult.status === 'fulfilled'
                  ? statusResult.value || {
                      exists: false,
                      revealed: false,
                      confirmations: [],
                      confirmationCount: 0,
                      requiredConfirmations: 2,
                    }
                  : {
                      exists: false,
                      revealed: false,
                      confirmations: [],
                      confirmationCount: 0,
                      requiredConfirmations: 2,
                    },
              stats: null,
              statsState: 'idle',
              recStatus:
                recStatusResult.status === 'fulfilled'
                  ? recStatusResult.value || { locked: false }
                  : { locked: false },
            };
          } catch (error) {
            console.warn(
              `Error loading aggregate list for year ${year}:`,
              error
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
              statsState: 'error',
              recStatus: { locked: false },
            };
          }
        }
      );

      const finalData = {
        ...topLevelData,
        aggregateLists,
        loading: {
          ...topLevelData.loading,
          aggregateLists: false,
        },
      };

      publishPartial({
        aggregateLists: finalData.aggregateLists,
        loading: finalData.loading,
      });

      return finalData;
    } catch (error) {
      console.error('Error loading admin data:', error);
      return { hasData: false };
    }
  }

  async function loadAdminAggregateYearStats(year) {
    try {
      const response = await apiCall(`/api/aggregate-list/${year}/stats`);
      return response?.stats || null;
    } catch (error) {
      console.warn(`Could not load aggregate stats for year ${year}:`, error);
      return null;
    }
  }

  return {
    loadAccountData,
    loadIntegrationsData,
    loadVisualData,
    loadPreferencesData,
    loadStatsData,
    loadAdminData,
    loadAdminAggregateYearStats,
    createEmptyAdminData,
  };
}
