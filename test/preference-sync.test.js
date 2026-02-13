const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const {
  createPreferenceSyncService,
} = require('../services/preference-sync.js');
const { createMockLogger, createMockPool } = require('./helpers');

function createMockSpotifyAuth(overrides = {}) {
  return {
    ensureValidSpotifyToken: mock.fn(async () => ({
      success: true,
      spotifyAuth: { access_token: 'valid_token' },
    })),
    getAllTopArtists: mock.fn(async () => ({
      short_term: [{ name: 'Artist 1' }],
      medium_term: [{ name: 'Artist 2' }],
      long_term: [{ name: 'Artist 3' }],
    })),
    getAllTopTracks: mock.fn(async () => ({
      short_term: [{ name: 'Track 1' }],
      medium_term: [{ name: 'Track 2' }],
      long_term: [{ name: 'Track 3' }],
    })),
    fetchAllPages: mock.fn(async () => [
      {
        album: { id: 'a1', name: 'Album 1', artist: 'Artist 1' },
        added_at: '2024-01-01',
      },
    ]),
    getSavedAlbums: mock.fn(async () => ({ items: [] })),
    ...overrides,
  };
}

function createMockLastfmAuth(overrides = {}) {
  return {
    getAllTopArtists: mock.fn(async () => ({
      overall: [{ name: 'Artist 1', playcount: 100 }],
      '7day': [{ name: 'Artist 2', playcount: 50 }],
    })),
    getAllTopAlbums: mock.fn(async () => ({
      overall: [{ name: 'Album 1', artist: 'Artist 1', playcount: 50 }],
    })),
    getUserInfo: mock.fn(async () => ({
      playcount: 5000,
      username: 'testuser',
    })),
    ...overrides,
  };
}

function createMockUserPrefs(overrides = {}) {
  return {
    aggregateFromLists: mock.fn(async () => ({
      topGenres: [{ name: 'Rock', count: 10, points: 100 }],
      topArtists: [{ name: 'Artist 1', count: 5, points: 80 }],
      topCountries: [{ name: 'USA', count: 8, points: 90 }],
      totalAlbums: 50,
    })),
    calculateAffinity: mock.fn(() => ({
      genreAffinity: [{ name: 'Rock', score: 0.9, sources: ['internal'] }],
      artistAffinity: [
        { name: 'Artist 1', score: 0.85, sources: ['internal'] },
      ],
    })),
    savePreferences: mock.fn(async () => ({ id: 1, user_id: 'user123' })),
    ...overrides,
  };
}

// =============================================================================
// createPreferenceSyncService tests
// =============================================================================

describe('createPreferenceSyncService', () => {
  it('should throw if pool is not provided', () => {
    assert.throws(
      () => createPreferenceSyncService({}),
      /Database pool is required/
    );
  });

  it('should create service with default dependencies', () => {
    const pool = createMockPool();
    const service = createPreferenceSyncService({ pool });

    assert.ok(service.start);
    assert.ok(service.stop);
    assert.ok(service.runSyncCycle);
    assert.ok(service.syncUserPreferences);
  });

  it('should accept custom sync interval', () => {
    const pool = createMockPool();
    const logger = createMockLogger();
    const service = createPreferenceSyncService({
      pool,
      logger,
      syncIntervalMs: 1000,
    });

    service.start({ immediate: true });
    service.stop();

    // Check that logger was called with the custom interval
    const startCall = logger.info.mock.calls.find(
      (c) => c.arguments[0] === 'Starting preference sync service'
    );
    assert.ok(startCall);
  });
});

// =============================================================================
// getUsersNeedingSync tests
// =============================================================================

describe('getUsersNeedingSync', () => {
  it('should query users with external auth who need sync', async () => {
    const pool = createMockPool([
      {
        rows: [
          {
            _id: 'user1',
            email: 'user1@test.com',
            spotify_auth: { access_token: 'token' },
          },
          {
            _id: 'user2',
            email: 'user2@test.com',
            lastfm_auth: { session_key: 'key' },
          },
        ],
      },
    ]);
    const logger = createMockLogger();
    const userPrefs = createMockUserPrefs();

    const service = createPreferenceSyncService({ pool, logger, userPrefs });
    const users = await service.getUsersNeedingSync();

    assert.strictEqual(users.length, 2);
    assert.strictEqual(pool.query.mock.calls.length, 1);

    // Verify query includes proper filters
    const query = pool.query.mock.calls[0].arguments[0];
    assert.ok(
      query.includes('spotify_auth IS NOT NULL OR u.lastfm_auth IS NOT NULL')
    );
    assert.ok(query.includes('LIMIT'));
  });

  it('should respect limit parameter', async () => {
    const pool = createMockPool([{ rows: [] }]);
    const logger = createMockLogger();
    const userPrefs = createMockUserPrefs();

    const service = createPreferenceSyncService({ pool, logger, userPrefs });
    await service.getUsersNeedingSync(10);

    const params = pool.query.mock.calls[0].arguments[1];
    assert.strictEqual(params[0], 10);
  });
});

// =============================================================================
// syncInternalData tests
// =============================================================================

describe('syncInternalData', () => {
  it('should call aggregateFromLists with userId', async () => {
    const pool = createMockPool();
    const logger = createMockLogger();
    const userPrefs = createMockUserPrefs();

    const service = createPreferenceSyncService({ pool, logger, userPrefs });
    const result = await service.syncInternalData('user123');

    assert.strictEqual(userPrefs.aggregateFromLists.mock.calls.length, 1);
    assert.strictEqual(
      userPrefs.aggregateFromLists.mock.calls[0].arguments[0],
      'user123'
    );
    assert.ok(result.topGenres);
    assert.ok(result.topArtists);
  });
});

// =============================================================================
// syncSpotifyData tests
// =============================================================================

describe('syncSpotifyData', () => {
  it('should return null if user has no spotify auth', async () => {
    const pool = createMockPool();
    const logger = createMockLogger();
    const spotifyAuth = createMockSpotifyAuth();
    const userPrefs = createMockUserPrefs();

    const service = createPreferenceSyncService({
      pool,
      logger,
      spotifyAuth,
      userPrefs,
    });
    const result = await service.syncSpotifyData({ _id: 'user123' });

    assert.strictEqual(result, null);
    assert.strictEqual(
      spotifyAuth.ensureValidSpotifyToken.mock.calls.length,
      0
    );
  });

  it('should return null if token refresh fails', async () => {
    const pool = createMockPool();
    const logger = createMockLogger();
    const spotifyAuth = createMockSpotifyAuth({
      ensureValidSpotifyToken: mock.fn(async () => ({
        success: false,
        error: 'TOKEN_EXPIRED',
      })),
    });
    const userPrefs = createMockUserPrefs();

    const service = createPreferenceSyncService({
      pool,
      logger,
      spotifyAuth,
      userPrefs,
    });
    const result = await service.syncSpotifyData({
      _id: 'user123',
      spotify_auth: { access_token: 'old_token' },
    });

    assert.strictEqual(result, null);
  });

  it('should fetch and return Spotify data on success', async () => {
    const pool = createMockPool();
    const logger = createMockLogger();
    const spotifyAuth = createMockSpotifyAuth();
    const userPrefs = createMockUserPrefs();

    const service = createPreferenceSyncService({
      pool,
      logger,
      spotifyAuth,
      userPrefs,
    });
    const result = await service.syncSpotifyData({
      _id: 'user123',
      spotify_auth: { access_token: 'token', refresh_token: 'refresh' },
    });

    assert.ok(result);
    assert.ok(result.topArtists);
    assert.ok(result.topTracks);
    assert.ok(result.savedAlbums);
    assert.ok(result.syncedAt);
  });
});

// =============================================================================
// syncLastfmData tests
// =============================================================================

describe('syncLastfmData', () => {
  it('should return null if user has no lastfm auth', async () => {
    const pool = createMockPool();
    const logger = createMockLogger();
    const lastfmAuth = createMockLastfmAuth();
    const userPrefs = createMockUserPrefs();

    const service = createPreferenceSyncService({
      pool,
      logger,
      lastfmAuth,
      userPrefs,
    });
    const result = await service.syncLastfmData({ _id: 'user123' });

    assert.strictEqual(result, null);
  });

  it('should return null if user has no lastfm username', async () => {
    const pool = createMockPool();
    const logger = createMockLogger();
    const lastfmAuth = createMockLastfmAuth();
    const userPrefs = createMockUserPrefs();

    const service = createPreferenceSyncService({
      pool,
      logger,
      lastfmAuth,
      userPrefs,
    });
    const result = await service.syncLastfmData({
      _id: 'user123',
      lastfm_auth: { session_key: 'key' },
    });

    assert.strictEqual(result, null);
  });

  it('should fetch and return Last.fm data on success', async () => {
    const pool = createMockPool();
    const logger = createMockLogger();
    const lastfmAuth = createMockLastfmAuth();
    const userPrefs = createMockUserPrefs();

    const service = createPreferenceSyncService({
      pool,
      logger,
      lastfmAuth,
      userPrefs,
    });
    const result = await service.syncLastfmData({
      _id: 'user123',
      lastfm_auth: { session_key: 'key' },
      lastfm_username: 'testuser',
    });

    assert.ok(result);
    assert.ok(result.topArtists);
    assert.ok(result.topAlbums);
    assert.strictEqual(result.totalScrobbles, 5000);
    assert.ok(result.syncedAt);
  });
});

// =============================================================================
// syncUserPreferences tests
// =============================================================================

describe('syncUserPreferences', () => {
  it('should sync all data sources for user with both Spotify and Last.fm', async () => {
    const pool = createMockPool();
    const logger = createMockLogger();
    const spotifyAuth = createMockSpotifyAuth();
    const lastfmAuth = createMockLastfmAuth();
    const userPrefs = createMockUserPrefs();

    const service = createPreferenceSyncService({
      pool,
      logger,
      spotifyAuth,
      lastfmAuth,
      userPrefs,
    });

    const result = await service.syncUserPreferences({
      _id: 'user123',
      email: 'test@test.com',
      spotify_auth: { access_token: 'token' },
      lastfm_auth: { session_key: 'key' },
      lastfm_username: 'testuser',
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.userId, 'user123');
    assert.strictEqual(result.errors.length, 0);

    // Verify all functions were called
    assert.strictEqual(userPrefs.aggregateFromLists.mock.calls.length, 1);
    assert.strictEqual(
      spotifyAuth.ensureValidSpotifyToken.mock.calls.length,
      1
    );
    assert.strictEqual(lastfmAuth.getAllTopArtists.mock.calls.length, 1);
    assert.strictEqual(userPrefs.calculateAffinity.mock.calls.length, 1);
    assert.strictEqual(userPrefs.savePreferences.mock.calls.length, 1);
  });

  it('should handle internal data failure gracefully', async () => {
    const pool = createMockPool();
    const logger = createMockLogger();
    const userPrefs = createMockUserPrefs({
      aggregateFromLists: mock.fn(async () => {
        throw new Error('Database error');
      }),
    });

    const service = createPreferenceSyncService({ pool, logger, userPrefs });

    const result = await service.syncUserPreferences({
      _id: 'user123',
      email: 'test@test.com',
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.errors.length, 1);
    assert.strictEqual(result.errors[0].source, 'internal');
  });

  it('should handle Spotify failure gracefully and continue', async () => {
    const pool = createMockPool();
    const logger = createMockLogger();
    const spotifyAuth = createMockSpotifyAuth({
      ensureValidSpotifyToken: mock.fn(async () => {
        throw new Error('Spotify API error');
      }),
    });
    const userPrefs = createMockUserPrefs();

    const service = createPreferenceSyncService({
      pool,
      logger,
      spotifyAuth,
      userPrefs,
    });

    const result = await service.syncUserPreferences({
      _id: 'user123',
      email: 'test@test.com',
      spotify_auth: { access_token: 'token' },
    });

    // Should have one error but still save preferences
    assert.strictEqual(result.errors.length, 1);
    assert.strictEqual(result.errors[0].source, 'spotify');
    assert.strictEqual(userPrefs.savePreferences.mock.calls.length, 1);
  });

  it('should include duration in result', async () => {
    const pool = createMockPool();
    const logger = createMockLogger();
    const userPrefs = createMockUserPrefs();

    const service = createPreferenceSyncService({ pool, logger, userPrefs });

    const result = await service.syncUserPreferences({
      _id: 'user123',
      email: 'test@test.com',
    });

    assert.ok(typeof result.duration === 'number');
    assert.ok(result.duration >= 0);
  });
});

// =============================================================================
// runSyncCycle tests
// =============================================================================

describe('runSyncCycle', () => {
  it('should sync all users needing sync', async () => {
    const pool = createMockPool([
      {
        rows: [
          { _id: 'user1', email: 'u1@test.com' },
          { _id: 'user2', email: 'u2@test.com' },
        ],
      },
      { rows: [] }, // For savePreferences
      { rows: [] },
    ]);
    const logger = createMockLogger();
    const userPrefs = createMockUserPrefs();

    const service = createPreferenceSyncService({ pool, logger, userPrefs });
    const results = await service.runSyncCycle();

    assert.strictEqual(results.total, 2);
    assert.strictEqual(results.success, 2);
    assert.strictEqual(results.failed, 0);
  });

  it('should skip if already running', async () => {
    const pool = createMockPool([
      { rows: [{ _id: 'user1', email: 'u1@test.com' }] },
    ]);
    const logger = createMockLogger();
    const userPrefs = createMockUserPrefs({
      aggregateFromLists: mock.fn(async () => {
        // Simulate slow operation
        await new Promise((r) => setTimeout(r, 100));
        return {
          topGenres: [],
          topArtists: [],
          topCountries: [],
          totalAlbums: 0,
        };
      }),
    });

    const service = createPreferenceSyncService({ pool, logger, userPrefs });

    // Start first cycle
    const cycle1Promise = service.runSyncCycle();

    // Try to start second cycle immediately
    const cycle2Result = await service.runSyncCycle();

    // Second cycle should be skipped
    assert.strictEqual(cycle2Result.skipped, true);

    // Wait for first to complete
    await cycle1Promise;
  });

  it('should handle user sync errors and continue', async () => {
    let callCount = 0;
    const pool = createMockPool([
      {
        rows: [
          { _id: 'user1', email: 'u1@test.com' },
          { _id: 'user2', email: 'u2@test.com' },
        ],
      },
    ]);
    const logger = createMockLogger();
    const userPrefs = createMockUserPrefs({
      aggregateFromLists: mock.fn(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('First user fails');
        }
        return {
          topGenres: [],
          topArtists: [],
          topCountries: [],
          totalAlbums: 0,
        };
      }),
    });

    const service = createPreferenceSyncService({ pool, logger, userPrefs });
    const results = await service.runSyncCycle();

    assert.strictEqual(results.total, 2);
    assert.strictEqual(results.failed, 1);
    assert.strictEqual(results.success, 1);
  });
});

// =============================================================================
// start/stop tests
// =============================================================================

describe('start and stop', () => {
  it('should start and stop the service', () => {
    const pool = createMockPool();
    const logger = createMockLogger();
    const userPrefs = createMockUserPrefs();

    const service = createPreferenceSyncService({
      pool,
      logger,
      userPrefs,
      syncIntervalMs: 100000, // Long interval to prevent actual runs
    });

    assert.strictEqual(service.isStarted(), false);

    service.start();
    assert.strictEqual(service.isStarted(), true);

    service.stop();
    assert.strictEqual(service.isStarted(), false);
  });

  it('should warn if started twice', () => {
    const pool = createMockPool();
    const logger = createMockLogger();
    const userPrefs = createMockUserPrefs();

    const service = createPreferenceSyncService({
      pool,
      logger,
      userPrefs,
      syncIntervalMs: 100000,
    });

    service.start();
    service.start(); // Second call

    const warnCalls = logger.warn.mock.calls;
    const alreadyRunningWarn = warnCalls.find(
      (c) => c.arguments[0] === 'Sync service already running'
    );
    assert.ok(alreadyRunningWarn);

    service.stop();
  });

  it('should report isSyncing correctly', async () => {
    const pool = createMockPool([{ rows: [] }]);
    const logger = createMockLogger();
    const userPrefs = createMockUserPrefs();

    const service = createPreferenceSyncService({ pool, logger, userPrefs });

    assert.strictEqual(service.isSyncing(), false);

    // Note: Testing isSyncing during actual sync would require async coordination
    // This just verifies the initial state
  });
});
