// utils/preference-sync.js
// Background service for syncing user preferences from external APIs

const logger = require('./logger');
const { createSpotifyAuth } = require('./spotify-auth');
const { createLastfmAuth } = require('./lastfm-auth');
const { createUserPreferences } = require('./user-preferences');

// Default intervals
const DEFAULT_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const DEFAULT_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
const RATE_LIMIT_DELAY_MS = 2000; // 2 seconds between users
const STARTUP_DELAY_MS = 30000; // 30 seconds after startup

/**
 * Create preference sync service with injected dependencies
 * @param {Object} deps - Dependencies
 * @param {Object} deps.pool - PostgreSQL pool instance
 * @param {Object} deps.logger - Logger instance
 * @param {Object} deps.spotifyAuth - Spotify auth utilities (optional)
 * @param {Object} deps.lastfmAuth - Last.fm auth utilities (optional)
 * @param {Object} deps.userPrefs - User preferences utilities (optional)
 * @param {number} deps.syncIntervalMs - Sync interval in ms (optional)
 * @param {number} deps.staleThresholdMs - Stale data threshold in ms (optional)
 */
function createPreferenceSyncService(deps = {}) {
  const log = deps.logger || logger;
  const pool = deps.pool;

  if (!pool) {
    throw new Error('Database pool is required for preference sync service');
  }

  // Create or use injected utilities
  const spotifyAuth = deps.spotifyAuth || createSpotifyAuth({ logger: log });
  const lastfmAuth = deps.lastfmAuth || createLastfmAuth({ logger: log });
  const userPrefs =
    deps.userPrefs || createUserPreferences({ pool, logger: log });

  // Configuration
  const syncIntervalMs = deps.syncIntervalMs || DEFAULT_SYNC_INTERVAL_MS;
  const staleThresholdMs = deps.staleThresholdMs || DEFAULT_STALE_THRESHOLD_MS;

  // State
  let syncInterval = null;
  let isRunning = false;

  /**
   * Get users who need preference sync
   * Prioritizes users who have never been synced or are most stale
   * @param {number} limit - Max users to return
   * @returns {Array} - Users needing sync
   */
  async function getUsersNeedingSync(limit = 50) {
    const staleInterval = `${Math.floor(staleThresholdMs / 1000)} seconds`;

    const query = `
      SELECT 
        u._id,
        u.email,
        u.spotify_auth,
        u.lastfm_auth,
        u.lastfm_username,
        p.spotify_synced_at,
        p.lastfm_synced_at,
        p.updated_at
      FROM users u
      LEFT JOIN user_preferences p ON u._id = p.user_id
      WHERE (u.spotify_auth IS NOT NULL OR u.lastfm_auth IS NOT NULL)
        AND (
          p.user_id IS NULL
          OR p.updated_at < NOW() - INTERVAL '${staleInterval}'
          OR (u.spotify_auth IS NOT NULL AND (p.spotify_synced_at IS NULL OR p.spotify_synced_at < NOW() - INTERVAL '${staleInterval}'))
          OR (u.lastfm_auth IS NOT NULL AND (p.lastfm_synced_at IS NULL OR p.lastfm_synced_at < NOW() - INTERVAL '${staleInterval}'))
        )
      ORDER BY COALESCE(p.updated_at, '1970-01-01') ASC
      LIMIT $1
    `;

    const result = await pool.query(query, [limit]);
    return result.rows;
  }

  /**
   * Sync internal list data for a user
   * @param {string} userId - User ID
   * @returns {Object} - Aggregated data
   */
  async function syncInternalData(userId) {
    return userPrefs.aggregateFromLists(userId);
  }

  /**
   * Sync Spotify data for a user
   * @param {Object} user - User object with spotify_auth
   * @returns {Object|null} - Spotify data or null if failed
   */
  async function syncSpotifyData(user) {
    if (!user.spotify_auth?.access_token) {
      return null;
    }

    // Create a mock usersDb for ensureValidSpotifyToken
    // This allows token refresh to persist to database
    const usersDb = {
      update: (query, update, options, callback) => {
        const updateQuery = `
          UPDATE users 
          SET spotify_auth = $1, updated_at = NOW()
          WHERE _id = $2
        `;
        pool
          .query(updateQuery, [
            JSON.stringify(update.$set.spotifyAuth),
            query._id,
          ])
          .then(() => callback(null))
          .catch((err) => callback(err));
      },
    };

    // Ensure token is valid
    const tokenResult = await spotifyAuth.ensureValidSpotifyToken(
      { _id: user._id, spotifyAuth: user.spotify_auth },
      usersDb
    );

    if (!tokenResult.success) {
      log.warn('Spotify token invalid for user', {
        userId: user._id,
        error: tokenResult.error,
      });
      return null;
    }

    const accessToken = tokenResult.spotifyAuth.access_token;

    // Fetch all Spotify data in parallel
    const [topArtists, topTracks, savedAlbumsRaw] = await Promise.all([
      spotifyAuth.getAllTopArtists(accessToken, 50),
      spotifyAuth.getAllTopTracks(accessToken, 50),
      spotifyAuth.fetchAllPages(
        (offset) => spotifyAuth.getSavedAlbums(accessToken, 50, offset),
        200
      ),
    ]);

    // Transform saved albums to simpler format
    const savedAlbums = savedAlbumsRaw.map((item) => ({
      id: item.album.id,
      name: item.album.name,
      artist: item.album.artist,
      added_at: item.added_at,
    }));

    return {
      topArtists,
      topTracks,
      savedAlbums,
      syncedAt: new Date(),
    };
  }

  /**
   * Sync Last.fm data for a user
   * @param {Object} user - User object with lastfm_auth and lastfm_username
   * @returns {Object|null} - Last.fm data or null if failed
   */
  async function syncLastfmData(user) {
    if (!user.lastfm_auth?.session_key || !user.lastfm_username) {
      return null;
    }

    const username = user.lastfm_username;

    // Fetch all Last.fm data in parallel
    const [topArtists, topAlbums, userInfo] = await Promise.all([
      lastfmAuth.getAllTopArtists(username, 50),
      lastfmAuth.getAllTopAlbums(username, 50),
      lastfmAuth.getUserInfo(username),
    ]);

    return {
      topArtists,
      topAlbums,
      totalScrobbles: userInfo.playcount,
      syncedAt: new Date(),
    };
  }

  /**
   * Sync all preferences for a single user
   * @param {Object} user - User object from database
   * @returns {Object} - Sync result
   */
  async function syncUserPreferences(user) {
    const userId = user._id;
    const startTime = Date.now();

    log.info('Starting preference sync for user', {
      userId,
      email: user.email,
    });

    const updates = {};
    const errors = [];

    // 1. Aggregate from internal lists
    try {
      const internalData = await syncInternalData(userId);
      updates.topGenres = internalData.topGenres;
      updates.topArtists = internalData.topArtists;
      updates.topCountries = internalData.topCountries;
      updates.totalAlbums = internalData.totalAlbums;
    } catch (err) {
      log.error('Failed to aggregate internal data', {
        userId,
        error: err.message,
      });
      errors.push({ source: 'internal', error: err.message });
    }

    // 2. Sync Spotify data
    if (user.spotify_auth?.access_token) {
      try {
        const spotifyData = await syncSpotifyData(user);
        if (spotifyData) {
          updates.spotifyTopArtists = spotifyData.topArtists;
          updates.spotifyTopTracks = spotifyData.topTracks;
          updates.spotifySavedAlbums = spotifyData.savedAlbums;
          updates.spotifySyncedAt = spotifyData.syncedAt;
        }
      } catch (err) {
        log.error('Failed to sync Spotify data', {
          userId,
          error: err.message,
        });
        errors.push({ source: 'spotify', error: err.message });
      }
    }

    // 3. Sync Last.fm data
    if (user.lastfm_auth?.session_key && user.lastfm_username) {
      try {
        const lastfmData = await syncLastfmData(user);
        if (lastfmData) {
          updates.lastfmTopArtists = lastfmData.topArtists;
          updates.lastfmTopAlbums = lastfmData.topAlbums;
          updates.lastfmTotalScrobbles = lastfmData.totalScrobbles;
          updates.lastfmSyncedAt = lastfmData.syncedAt;
        }
      } catch (err) {
        log.error('Failed to sync Last.fm data', {
          userId,
          error: err.message,
        });
        errors.push({ source: 'lastfm', error: err.message });
      }
    }

    // 4. Calculate affinity scores
    try {
      const spotifyArtists = updates.spotifyTopArtists || null;
      const lastfmArtists = updates.lastfmTopArtists
        ? { overall: updates.lastfmTopArtists.overall || [] }
        : null;

      const { genreAffinity, artistAffinity } = userPrefs.calculateAffinity(
        {
          topGenres: updates.topGenres || [],
          topArtists: updates.topArtists || [],
        },
        spotifyArtists,
        lastfmArtists
      );

      updates.genreAffinity = genreAffinity;
      updates.artistAffinity = artistAffinity;
    } catch (err) {
      log.error('Failed to calculate affinity', { userId, error: err.message });
      errors.push({ source: 'affinity', error: err.message });
    }

    // 5. Save to database (only if we have some data)
    if (Object.keys(updates).length > 0) {
      try {
        await userPrefs.savePreferences(userId, updates);
      } catch (err) {
        log.error('Failed to save preferences', { userId, error: err.message });
        errors.push({ source: 'save', error: err.message });
      }
    }

    const duration = Date.now() - startTime;
    log.info('Preference sync complete for user', {
      userId,
      duration: `${duration}ms`,
      errors: errors.length,
    });

    return {
      userId,
      success: errors.length === 0,
      errors,
      duration,
    };
  }

  /**
   * Run a complete sync cycle for all users needing updates
   * @returns {Object} - Cycle results
   */
  async function runSyncCycle() {
    if (isRunning) {
      log.warn('Sync cycle already running, skipping');
      return { skipped: true };
    }

    isRunning = true;
    const cycleStart = Date.now();

    log.info('Starting preference sync cycle');

    const results = {
      total: 0,
      success: 0,
      failed: 0,
      errors: [],
    };

    try {
      const users = await getUsersNeedingSync();
      results.total = users.length;

      log.info(`Found ${users.length} users needing sync`);

      for (const user of users) {
        try {
          const result = await syncUserPreferences(user);
          if (result.success) {
            results.success++;
          } else {
            results.failed++;
            results.errors.push({
              userId: user._id,
              errors: result.errors,
            });
          }

          // Rate limiting between users
          if (users.indexOf(user) < users.length - 1) {
            await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS));
          }
        } catch (err) {
          results.failed++;
          results.errors.push({
            userId: user._id,
            errors: [{ source: 'sync', error: err.message }],
          });
          log.error('Error syncing user', {
            userId: user._id,
            error: err.message,
          });
        }
      }

      const cycleDuration = Date.now() - cycleStart;
      log.info('Preference sync cycle complete', {
        total: results.total,
        success: results.success,
        failed: results.failed,
        duration: `${cycleDuration}ms`,
      });
    } catch (err) {
      log.error('Sync cycle failed', { error: err.message });
      results.errors.push({ source: 'cycle', error: err.message });
    } finally {
      isRunning = false;
    }

    return results;
  }

  /**
   * Start the sync service
   * @param {Object} options - Start options
   * @param {boolean} options.immediate - Run immediately (default: false, waits 30s)
   */
  function start(options = {}) {
    if (syncInterval) {
      log.warn('Sync service already running');
      return;
    }

    log.info('Starting preference sync service', {
      syncInterval: `${syncIntervalMs / 1000 / 60} minutes`,
      staleThreshold: `${staleThresholdMs / 1000 / 60 / 60} hours`,
    });

    // Run first cycle after startup delay (or immediately if requested)
    const initialDelay = options.immediate ? 0 : STARTUP_DELAY_MS;
    setTimeout(() => {
      runSyncCycle().catch((err) => {
        log.error('Initial sync cycle failed', { error: err.message });
      });
    }, initialDelay);

    // Schedule periodic sync cycles
    syncInterval = setInterval(() => {
      runSyncCycle().catch((err) => {
        log.error('Scheduled sync cycle failed', { error: err.message });
      });
    }, syncIntervalMs);
  }

  /**
   * Stop the sync service
   */
  function stop() {
    if (syncInterval) {
      clearInterval(syncInterval);
      syncInterval = null;
      log.info('Preference sync service stopped');
    }
  }

  /**
   * Check if the sync service is currently running a cycle
   */
  function isSyncing() {
    return isRunning;
  }

  /**
   * Check if the sync service is started
   */
  function isStarted() {
    return syncInterval !== null;
  }

  return {
    // Lifecycle
    start,
    stop,
    isStarted,
    isSyncing,
    // Operations
    runSyncCycle,
    syncUserPreferences,
    getUsersNeedingSync,
    // Individual sync functions (for testing/manual use)
    syncInternalData,
    syncSpotifyData,
    syncLastfmData,
  };
}

module.exports = { createPreferenceSyncService };
