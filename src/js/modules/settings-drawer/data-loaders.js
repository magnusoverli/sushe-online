/**
 * Settings drawer data loaders.
 *
 * Keeps API and normalization logic separate from rendering/DOM concerns.
 */

export function createSettingsDataLoaders(deps = {}) {
  const apiCall =
    deps.apiCall || (() => Promise.reject(new Error('apiCall not provided')));

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
      const response = await apiCall('/api/admin/bootstrap');
      return response || { hasData: false };
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
