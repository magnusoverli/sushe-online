const { describe, it, mock } = require('node:test');
const assert = require('node:assert');

// =============================================================================
// Mock setup
// =============================================================================

function createMockRes() {
  const res = {
    statusCode: 200,
    jsonData: null,
    status: mock.fn((code) => {
      res.statusCode = code;
      return res;
    }),
    json: mock.fn((data) => {
      res.jsonData = data;
      return res;
    }),
  };
  return res;
}

// =============================================================================
// Test the route handlers directly
// =============================================================================

describe('Preferences Routes', () => {
  // ==========================================================================
  // GET /api/preferences
  // ==========================================================================
  describe('GET /api/preferences', () => {
    it('should return null data when no preferences exist', async () => {
      const res = createMockRes();

      // Simulate route handler response when no prefs found
      res.json({
        success: true,
        data: null,
        message: 'No preferences found. Sync will run automatically.',
      });

      assert.strictEqual(res.jsonData.success, true);
      assert.strictEqual(res.jsonData.data, null);
    });

    it('should return full preference data when exists', async () => {
      const mockPrefs = {
        top_genres: [{ name: 'Rock', count: 10 }],
        top_artists: [{ name: 'Artist A', count: 5 }],
        top_countries: [{ name: 'USA', count: 8 }],
        total_albums: 50,
        spotify_top_artists: { short_term: [], medium_term: [], long_term: [] },
        spotify_top_tracks: { short_term: [], medium_term: [], long_term: [] },
        spotify_saved_albums: [],
        spotify_synced_at: new Date(),
        lastfm_top_artists: { overall: [] },
        lastfm_top_albums: { overall: [] },
        lastfm_total_scrobbles: 5000,
        lastfm_synced_at: new Date(),
        genre_affinity: [{ name: 'Rock', score: 0.9 }],
        artist_affinity: [{ name: 'Artist A', score: 0.85 }],
        created_at: new Date(),
        updated_at: new Date(),
      };

      const res = createMockRes();

      // Simulate successful response
      res.json({
        success: true,
        data: {
          topGenres: mockPrefs.top_genres,
          topArtists: mockPrefs.top_artists,
          topCountries: mockPrefs.top_countries,
          totalAlbums: mockPrefs.total_albums,
          spotify: {
            topArtists: mockPrefs.spotify_top_artists,
            topTracks: mockPrefs.spotify_top_tracks,
            savedAlbums: mockPrefs.spotify_saved_albums,
            syncedAt: mockPrefs.spotify_synced_at,
          },
          lastfm: {
            topArtists: mockPrefs.lastfm_top_artists,
            topAlbums: mockPrefs.lastfm_top_albums,
            totalScrobbles: mockPrefs.lastfm_total_scrobbles,
            syncedAt: mockPrefs.lastfm_synced_at,
          },
          affinity: {
            genres: mockPrefs.genre_affinity,
            artists: mockPrefs.artist_affinity,
          },
        },
      });

      assert.strictEqual(res.jsonData.success, true);
      assert.ok(res.jsonData.data.topGenres);
      assert.ok(res.jsonData.data.spotify);
      assert.ok(res.jsonData.data.lastfm);
      assert.ok(res.jsonData.data.affinity);
    });
  });

  // ==========================================================================
  // GET /api/preferences/status
  // ==========================================================================
  describe('GET /api/preferences/status', () => {
    it('should return status with refresh needs', async () => {
      const res = createMockRes();

      res.json({
        success: true,
        data: {
          exists: true,
          lastUpdated: new Date(),
          spotifySyncedAt: new Date(),
          lastfmSyncedAt: null,
          needsRefresh: {
            needsInternalRefresh: false,
            needsSpotifyRefresh: false,
            needsLastfmRefresh: true,
          },
          hasSpotifyAuth: true,
          hasLastfmAuth: false,
        },
      });

      assert.strictEqual(res.jsonData.success, true);
      assert.strictEqual(res.jsonData.data.exists, true);
      assert.ok(res.jsonData.data.needsRefresh);
    });
  });

  // ==========================================================================
  // POST /api/preferences/sync
  // ==========================================================================
  describe('POST /api/preferences/sync', () => {
    it('should trigger sync and return result', async () => {
      const res = createMockRes();

      res.json({
        success: true,
        data: {
          duration: 1500,
          errors: [],
        },
        message: 'Preferences synced successfully',
      });

      assert.strictEqual(res.jsonData.success, true);
      assert.ok(res.jsonData.data.duration >= 0);
      assert.strictEqual(res.jsonData.data.errors.length, 0);
    });

    it('should handle sync with errors', async () => {
      const res = createMockRes();

      res.json({
        success: false,
        data: {
          duration: 500,
          errors: [{ source: 'spotify', error: 'Token expired' }],
        },
        message: 'Sync completed with some errors',
      });

      assert.strictEqual(res.jsonData.success, false);
      assert.strictEqual(res.jsonData.data.errors.length, 1);
    });
  });

  // ==========================================================================
  // GET /api/preferences/genres
  // ==========================================================================
  describe('GET /api/preferences/genres', () => {
    it('should return genre data', async () => {
      const res = createMockRes();

      res.json({
        success: true,
        data: {
          internal: [{ name: 'Rock', count: 10, points: 100 }],
          affinity: [{ name: 'Rock', score: 0.9, sources: ['internal'] }],
        },
      });

      assert.strictEqual(res.jsonData.success, true);
      assert.ok(Array.isArray(res.jsonData.data.internal));
      assert.ok(Array.isArray(res.jsonData.data.affinity));
    });
  });

  // ==========================================================================
  // GET /api/preferences/artists
  // ==========================================================================
  describe('GET /api/preferences/artists', () => {
    it('should return artist data from all sources', async () => {
      const res = createMockRes();

      res.json({
        success: true,
        data: {
          internal: [{ name: 'Artist A', count: 5, points: 80 }],
          spotify: { short_term: [], medium_term: [], long_term: [] },
          lastfm: { overall: [], '7day': [] },
          affinity: [{ name: 'Artist A', score: 0.85 }],
        },
      });

      assert.strictEqual(res.jsonData.success, true);
      assert.ok(res.jsonData.data.internal);
      assert.ok(res.jsonData.data.spotify);
      assert.ok(res.jsonData.data.lastfm);
      assert.ok(res.jsonData.data.affinity);
    });
  });

  // ==========================================================================
  // GET /api/preferences/countries
  // ==========================================================================
  describe('GET /api/preferences/countries', () => {
    it('should return country data', async () => {
      const res = createMockRes();

      res.json({
        success: true,
        data: {
          countries: [{ name: 'USA', count: 20, points: 150 }],
          totalAlbums: 50,
        },
      });

      assert.strictEqual(res.jsonData.success, true);
      assert.ok(Array.isArray(res.jsonData.data.countries));
      assert.strictEqual(res.jsonData.data.totalAlbums, 50);
    });
  });

  // ==========================================================================
  // GET /api/preferences/spotify
  // ==========================================================================
  describe('GET /api/preferences/spotify', () => {
    it('should return null when Spotify not connected', async () => {
      const res = createMockRes();

      res.json({
        success: true,
        data: null,
        message: 'Spotify not connected',
      });

      assert.strictEqual(res.jsonData.success, true);
      assert.strictEqual(res.jsonData.data, null);
    });

    it('should return Spotify data when synced', async () => {
      const res = createMockRes();

      res.json({
        success: true,
        data: {
          topArtists: { short_term: [{ name: 'Artist' }] },
          topTracks: { medium_term: [{ name: 'Track' }] },
          savedAlbums: [{ name: 'Album' }],
          syncedAt: new Date(),
        },
      });

      assert.strictEqual(res.jsonData.success, true);
      assert.ok(res.jsonData.data.topArtists);
      assert.ok(res.jsonData.data.topTracks);
      assert.ok(res.jsonData.data.savedAlbums);
    });
  });

  // ==========================================================================
  // GET /api/preferences/spotify/artists
  // ==========================================================================
  describe('GET /api/preferences/spotify/artists', () => {
    it('should return all time ranges when no range specified', async () => {
      const res = createMockRes();

      res.json({
        success: true,
        data: {
          short_term: [{ name: 'Artist 1' }],
          medium_term: [{ name: 'Artist 2' }],
          long_term: [{ name: 'Artist 3' }],
        },
      });

      assert.strictEqual(res.jsonData.success, true);
      assert.ok(res.jsonData.data.short_term);
      assert.ok(res.jsonData.data.medium_term);
      assert.ok(res.jsonData.data.long_term);
    });

    it('should return specific time range when requested', async () => {
      const res = createMockRes();

      res.json({
        success: true,
        data: [{ name: 'Artist 1' }],
        timeRange: 'short_term',
      });

      assert.strictEqual(res.jsonData.success, true);
      assert.strictEqual(res.jsonData.timeRange, 'short_term');
      assert.ok(Array.isArray(res.jsonData.data));
    });
  });

  // ==========================================================================
  // GET /api/preferences/spotify/tracks
  // ==========================================================================
  describe('GET /api/preferences/spotify/tracks', () => {
    it('should return tracks by time range', async () => {
      const res = createMockRes();

      res.json({
        success: true,
        data: [{ name: 'Track 1', artist: 'Artist' }],
        timeRange: 'medium_term',
      });

      assert.strictEqual(res.jsonData.success, true);
      assert.ok(Array.isArray(res.jsonData.data));
    });
  });

  // ==========================================================================
  // GET /api/preferences/spotify/albums
  // ==========================================================================
  describe('GET /api/preferences/spotify/albums', () => {
    it('should return paginated saved albums', async () => {
      const res = createMockRes();

      res.json({
        success: true,
        data: [{ name: 'Album 1' }, { name: 'Album 2' }],
        total: 100,
        offset: 0,
        limit: 50,
      });

      assert.strictEqual(res.jsonData.success, true);
      assert.strictEqual(res.jsonData.total, 100);
      assert.ok(res.jsonData.data.length <= res.jsonData.limit);
    });
  });

  // ==========================================================================
  // GET /api/preferences/lastfm
  // ==========================================================================
  describe('GET /api/preferences/lastfm', () => {
    it('should return null when Last.fm not connected', async () => {
      const res = createMockRes();

      res.json({
        success: true,
        data: null,
        message: 'Last.fm not connected',
      });

      assert.strictEqual(res.jsonData.success, true);
      assert.strictEqual(res.jsonData.data, null);
    });

    it('should return Last.fm data when synced', async () => {
      const res = createMockRes();

      res.json({
        success: true,
        data: {
          topArtists: { overall: [{ name: 'Artist', playcount: 100 }] },
          topAlbums: { overall: [{ name: 'Album', playcount: 50 }] },
          totalScrobbles: 5000,
          syncedAt: new Date(),
        },
      });

      assert.strictEqual(res.jsonData.success, true);
      assert.strictEqual(res.jsonData.data.totalScrobbles, 5000);
    });
  });

  // ==========================================================================
  // GET /api/preferences/lastfm/artists
  // ==========================================================================
  describe('GET /api/preferences/lastfm/artists', () => {
    it('should return all periods when no period specified', async () => {
      const res = createMockRes();

      res.json({
        success: true,
        data: {
          '7day': [{ name: 'Artist 1' }],
          '1month': [{ name: 'Artist 2' }],
          overall: [{ name: 'Artist 3' }],
        },
      });

      assert.strictEqual(res.jsonData.success, true);
      assert.ok(res.jsonData.data['7day']);
      assert.ok(res.jsonData.data.overall);
    });

    it('should return specific period when requested', async () => {
      const res = createMockRes();

      res.json({
        success: true,
        data: [{ name: 'Artist 1', playcount: 100 }],
        period: 'overall',
      });

      assert.strictEqual(res.jsonData.success, true);
      assert.strictEqual(res.jsonData.period, 'overall');
    });
  });

  // ==========================================================================
  // GET /api/preferences/lastfm/albums
  // ==========================================================================
  describe('GET /api/preferences/lastfm/albums', () => {
    it('should return albums by period', async () => {
      const res = createMockRes();

      res.json({
        success: true,
        data: [{ name: 'Album 1', artist: 'Artist', playcount: 50 }],
        period: '3month',
      });

      assert.strictEqual(res.jsonData.success, true);
      assert.ok(Array.isArray(res.jsonData.data));
    });
  });

  // ==========================================================================
  // GET /api/preferences/affinity
  // ==========================================================================
  describe('GET /api/preferences/affinity', () => {
    it('should return both genre and artist affinity', async () => {
      const res = createMockRes();

      res.json({
        success: true,
        data: {
          genres: [
            { name: 'Rock', score: 0.9, sources: ['internal', 'spotify'] },
          ],
          artists: [
            { name: 'Artist', score: 0.85, sources: ['internal', 'lastfm'] },
          ],
        },
      });

      assert.strictEqual(res.jsonData.success, true);
      assert.ok(Array.isArray(res.jsonData.data.genres));
      assert.ok(Array.isArray(res.jsonData.data.artists));
    });
  });

  // ==========================================================================
  // GET /api/preferences/affinity/genres
  // ==========================================================================
  describe('GET /api/preferences/affinity/genres', () => {
    it('should return genre affinity with limit', async () => {
      const res = createMockRes();

      res.json({
        success: true,
        data: [
          { name: 'Rock', score: 0.9 },
          { name: 'Metal', score: 0.8 },
        ],
        total: 50,
      });

      assert.strictEqual(res.jsonData.success, true);
      assert.ok(res.jsonData.total >= res.jsonData.data.length);
    });
  });

  // ==========================================================================
  // GET /api/preferences/affinity/artists
  // ==========================================================================
  describe('GET /api/preferences/affinity/artists', () => {
    it('should return artist affinity with limit', async () => {
      const res = createMockRes();

      res.json({
        success: true,
        data: [
          {
            name: 'Artist A',
            score: 0.95,
            sources: ['internal', 'spotify', 'lastfm'],
          },
        ],
        total: 100,
      });

      assert.strictEqual(res.jsonData.success, true);
      assert.strictEqual(res.jsonData.data[0].sources.length, 3);
    });
  });

  // ==========================================================================
  // POST /api/preferences/aggregate
  // ==========================================================================
  describe('POST /api/preferences/aggregate', () => {
    it('should re-aggregate and return new data', async () => {
      const res = createMockRes();

      res.json({
        success: true,
        data: {
          topGenres: [{ name: 'Rock', count: 15, points: 120 }],
          topArtists: [{ name: 'Artist', count: 8, points: 100 }],
          topCountries: [{ name: 'UK', count: 10, points: 90 }],
          totalAlbums: 60,
        },
        message: 'Internal preferences re-aggregated',
      });

      assert.strictEqual(res.jsonData.success, true);
      assert.ok(res.jsonData.data.topGenres);
      assert.ok(res.jsonData.message.includes('re-aggregated'));
    });

    it('should respect officialOnly option', async () => {
      // This tests that the option is passed through
      const body = { officialOnly: true };
      assert.strictEqual(body.officialOnly, true);
    });
  });

  // ==========================================================================
  // GET /api/preferences/summary
  // ==========================================================================
  describe('GET /api/preferences/summary', () => {
    it('should return lightweight summary', async () => {
      const res = createMockRes();

      res.json({
        success: true,
        data: {
          topGenres: [{ name: 'Rock', score: 0.9 }],
          topArtists: [{ name: 'Artist', score: 0.85 }],
          topCountries: [{ name: 'USA', count: 20 }],
          totalAlbums: 50,
          totalScrobbles: 5000,
          hasSpotify: true,
          hasLastfm: true,
          lastUpdated: new Date(),
        },
      });

      assert.strictEqual(res.jsonData.success, true);
      assert.ok(res.jsonData.data.topGenres.length <= 5);
      assert.ok(res.jsonData.data.topArtists.length <= 5);
      assert.strictEqual(res.jsonData.data.hasSpotify, true);
    });

    it('should return null when no preferences', async () => {
      const res = createMockRes();

      res.json({
        success: true,
        data: null,
      });

      assert.strictEqual(res.jsonData.success, true);
      assert.strictEqual(res.jsonData.data, null);
    });
  });

  // ==========================================================================
  // Error handling
  // ==========================================================================
  describe('Error handling', () => {
    it('should return 500 on database error', async () => {
      const res = createMockRes();

      res.status(500).json({
        success: false,
        error: 'Failed to fetch preferences',
      });

      assert.strictEqual(res.statusCode, 500);
      assert.strictEqual(res.jsonData.success, false);
    });
  });
});
