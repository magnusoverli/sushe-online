// services/preference-sync.js
// Background service for syncing user preferences from external APIs

const logger = require('../utils/logger');
const { ensureDb } = require('../db/postgres');
const { createSpotifyAuth } = require('../utils/spotify-auth');
const { createLastfmAuth } = require('../utils/lastfm-auth');
const { createUserPreferences } = require('./user-preferences-service');
const { createUserService } = require('./user-service');
const { createMusicBrainz } = require('../utils/musicbrainz');

// Default intervals
const DEFAULT_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const DEFAULT_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
const RATE_LIMIT_DELAY_MS = 2000; // 2 seconds between users
const STARTUP_DELAY_MS = 30000; // 30 seconds after startup

function isSpotifyUserRegistrationError(err) {
  return (err?.message || '').includes('not registered for this application');
}

function isLastfmConfigError(err) {
  return (err?.message || '').includes('Invalid API key');
}

function logExternalSyncError(log, service, user, err) {
  const isExpectedExternalError =
    (service === 'spotify' && isSpotifyUserRegistrationError(err)) ||
    (service === 'lastfm' && isLastfmConfigError(err));
  const message =
    service === 'spotify'
      ? 'Failed to sync Spotify data'
      : 'Failed to sync Last.fm data';
  const metadata = {
    userId: user._id,
    username: user.username,
    error: err.message,
  };

  if (isExpectedExternalError) {
    log.warn(message, metadata);
    return;
  }

  log.error(message, metadata);
}

// ============================================
// SPOTIFY SYNC HELPER
// ============================================

/**
 * Sync Spotify data for a user
 */
async function syncSpotifyDataForUser(user, tokenStore, spotifyAuth, log) {
  if (!user.spotify_auth?.access_token) {
    return null;
  }

  const tokenResult = await spotifyAuth.ensureValidSpotifyToken(
    { _id: user._id, spotifyAuth: user.spotify_auth },
    tokenStore
  );

  if (!tokenResult.success) {
    log.warn('Spotify token invalid for user', {
      userId: user._id,
      error: tokenResult.error,
    });
    return null;
  }

  const accessToken = tokenResult.spotifyAuth.access_token;
  const userContext = { userId: user._id, username: user.username };

  // Probe a single endpoint first so account/app access errors do not fan out
  // into several parallel Spotify requests and duplicate log lines.
  await spotifyAuth.getSavedAlbums(accessToken, 1, 0, userContext);

  const [topArtists, topTracks, savedAlbumsRaw] = await Promise.all([
    spotifyAuth.getAllTopArtists(accessToken, 50, userContext),
    spotifyAuth.getAllTopTracks(accessToken, 50, userContext),
    spotifyAuth.fetchAllPages(
      (offset) =>
        spotifyAuth.getSavedAlbums(accessToken, 50, offset, userContext),
      200
    ),
  ]);

  const savedAlbums = savedAlbumsRaw.map((item) => ({
    id: item.album.id,
    name: item.album.name,
    artist: item.album.artist,
    added_at: item.added_at,
  }));

  return { topArtists, topTracks, savedAlbums, syncedAt: new Date() };
}

// ============================================
// LASTFM SYNC HELPER
// ============================================

/**
 * Sync Last.fm data for a user (including artist tags)
 */
async function syncLastfmDataForUser(user, lastfmAuth, log) {
  if (!user.lastfm_auth?.session_key || !user.lastfm_username) {
    return null;
  }

  const username = user.lastfm_username;
  // Probe with a single request first so invalid app configuration fails once
  // instead of spawning many parallel Last.fm requests that all return the same error.
  const userInfo = await lastfmAuth.getUserInfo(username);
  const [topArtists, topAlbums] = await Promise.all([
    lastfmAuth.getAllTopArtists(username, 50),
    lastfmAuth.getAllTopAlbums(username, 50),
  ]);

  let artistTags = new Map();
  const overallArtists = topArtists?.overall || [];

  if (overallArtists.length > 0) {
    const topArtistNames = overallArtists.slice(0, 30).map((a) => a.name);

    log.info('Fetching tags for Last.fm top artists', {
      username,
      artistCount: topArtistNames.length,
    });

    try {
      artistTags = await lastfmAuth.getArtistTagsBatch(
        topArtistNames,
        5,
        null,
        200
      );
      log.info('Fetched artist tags', {
        username,
        artistsWithTags: artistTags.size,
      });
    } catch (err) {
      log.warn('Failed to fetch artist tags, continuing without them', {
        username,
        error: err.message,
      });
    }
  }

  const artistTagsObj = {};
  for (const [name, tags] of artistTags) {
    artistTagsObj[name] = tags;
  }

  return {
    topArtists,
    topAlbums,
    totalScrobbles: userInfo.playcount,
    artistTags: artistTagsObj,
    syncedAt: new Date(),
  };
}

// ============================================
// MUSICBRAINZ COUNTRY HELPER
// ============================================

/**
 * Fetch artist countries from MusicBrainz
 */
async function fetchArtistCountries(updates, musicBrainz, log, userId) {
  const artistCountries = {};
  const uniqueArtists = new Set();

  // From Spotify (all time ranges)
  if (updates.spotifyTopArtists) {
    for (const range of ['short_term', 'medium_term', 'long_term']) {
      const artists = updates.spotifyTopArtists[range] || [];
      artists.slice(0, 20).forEach((a) => uniqueArtists.add(a.name));
    }
  }

  // From Last.fm overall
  if (updates.lastfmTopArtists?.overall) {
    updates.lastfmTopArtists.overall
      .slice(0, 20)
      .forEach((a) => uniqueArtists.add(a.name));
  }

  // From internal lists
  if (updates.topArtists) {
    updates.topArtists.slice(0, 20).forEach((a) => uniqueArtists.add(a.name));
  }

  const artistList = Array.from(uniqueArtists).slice(0, 30);

  if (artistList.length > 0) {
    log.info('Fetching artist countries from MusicBrainz', {
      userId,
      artistCount: artistList.length,
    });

    const countriesMap = await musicBrainz.getArtistCountriesBatch(artistList);

    for (const [name, data] of countriesMap) {
      if (data?.country) {
        artistCountries[name] = data;
      }
    }

    log.info('Fetched artist countries', {
      userId,
      artistsWithCountry: Object.keys(artistCountries).length,
    });
  }

  return artistCountries;
}

// ============================================
// USER SYNC HELPERS
// ============================================

/**
 * Sync internal, Spotify, and Last.fm data sources for a user
 * @returns {Object} - { updates, errors }
 */
async function syncAllDataSources(user, syncHelpers, log) {
  const { syncInternalFn, syncSpotifyFn, syncLastfmFn } = syncHelpers;
  const userId = user._id;
  const updates = {};
  const errors = [];

  // 1. Internal list data
  try {
    const internalData = await syncInternalFn(userId);
    updates.topGenres = internalData.topGenres;
    updates.topArtists = internalData.topArtists;
    updates.topCountries = internalData.topCountries;
    updates.totalAlbums = internalData.totalAlbums;
  } catch (err) {
    log.error('Failed to aggregate internal data', {
      userId,
      username: user.username,
      error: err.message,
    });
    errors.push({ source: 'internal', error: err.message });
  }

  // 2. Spotify data
  if (user.spotify_auth?.access_token) {
    try {
      const spotifyData = await syncSpotifyFn(user);
      if (spotifyData) {
        updates.spotifyTopArtists = spotifyData.topArtists;
        updates.spotifyTopTracks = spotifyData.topTracks;
        updates.spotifySavedAlbums = spotifyData.savedAlbums;
        updates.spotifySyncedAt = spotifyData.syncedAt;
      }
    } catch (err) {
      logExternalSyncError(log, 'spotify', user, err);
      errors.push({ source: 'spotify', error: err.message });
    }
  }

  // 3. Last.fm data
  if (user.lastfm_auth?.session_key && user.lastfm_username) {
    try {
      const lastfmData = await syncLastfmFn(user);
      if (lastfmData) {
        updates.lastfmTopArtists = lastfmData.topArtists;
        updates.lastfmTopAlbums = lastfmData.topAlbums;
        updates.lastfmTotalScrobbles = lastfmData.totalScrobbles;
        updates.lastfmArtistTags = lastfmData.artistTags;
        updates.lastfmSyncedAt = lastfmData.syncedAt;
      }
    } catch (err) {
      logExternalSyncError(log, 'lastfm', user, err);
      errors.push({ source: 'lastfm', error: err.message });
    }
  }

  return { updates, errors };
}

/**
 * Calculate and save affinity scores for a user
 */
async function calculateAndSaveAffinity(
  userId,
  updates,
  artistCountries,
  userPrefs,
  log
) {
  const errors = [];

  try {
    const spotifyArtists = updates.spotifyTopArtists || null;
    const lastfmArtists = updates.lastfmTopArtists
      ? {
          overall: updates.lastfmTopArtists.overall || [],
          artistTags: updates.lastfmArtistTags || {},
        }
      : null;

    const { genreAffinity, artistAffinity, countryAffinity } =
      userPrefs.calculateAffinity(
        {
          topGenres: updates.topGenres || [],
          topArtists: updates.topArtists || [],
          topCountries: updates.topCountries || [],
        },
        spotifyArtists,
        lastfmArtists,
        { internal: 0.4, spotify: 0.35, lastfm: 0.25 },
        artistCountries
      );

    updates.genreAffinity = genreAffinity;
    updates.artistAffinity = artistAffinity;
    updates.countryAffinity = countryAffinity;
  } catch (err) {
    log.error('Failed to calculate affinity', { userId, error: err.message });
    errors.push({ source: 'affinity', error: err.message });
  }

  // Save to database
  if (Object.keys(updates).length > 0) {
    try {
      await userPrefs.savePreferences(userId, updates);
    } catch (err) {
      log.error('Failed to save preferences', { userId, error: err.message });
      errors.push({ source: 'save', error: err.message });
    }
  }

  return errors;
}

// ============================================
// MAIN FACTORY
// ============================================

/**
 * Create preference sync service with injected dependencies
 * @param {Object} deps - Dependencies
 * @param {import("../db/types").DbFacade} deps.db - Canonical datastore
 * @param {Object} deps.logger - Logger instance
 * @param {Object} deps.spotifyAuth - Spotify auth utilities (optional)
 * @param {Object} deps.lastfmAuth - Last.fm auth utilities (optional)
 * @param {Object} deps.userPrefs - User preferences utilities (optional)
 * @param {number} deps.syncIntervalMs - Sync interval in ms (optional)
 * @param {number} deps.staleThresholdMs - Stale data threshold in ms (optional)
 */
function createPreferenceSyncService(deps = {}) {
  const log = deps.logger || logger;
  const db = ensureDb(deps.db, 'preference-sync');

  const spotifyAuth = deps.spotifyAuth || createSpotifyAuth({ logger: log });
  const lastfmAuth = deps.lastfmAuth || createLastfmAuth({ logger: log });
  const userService =
    deps.userService || createUserService({ db, logger: log });
  const userPrefs =
    deps.userPrefs || createUserPreferences({ db, logger: log });
  const musicBrainz = deps.musicBrainz || createMusicBrainz({ logger: log });

  const syncIntervalMs = deps.syncIntervalMs || DEFAULT_SYNC_INTERVAL_MS;
  const staleThresholdMs = deps.staleThresholdMs || DEFAULT_STALE_THRESHOLD_MS;
  let syncInterval = null;
  let isRunning = false;
  /**
   * Get users who need preference sync
   */
  async function getUsersNeedingSync(limit = 50) {
    const staleIntervalSeconds = Math.floor(staleThresholdMs / 1000);

    const query = `
      SELECT 
        u._id,
        u.email,
        u.username,
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
          OR p.updated_at < NOW() - make_interval(secs => $2)
          OR (u.spotify_auth IS NOT NULL AND (p.spotify_synced_at IS NULL OR p.spotify_synced_at < NOW() - make_interval(secs => $2)))
          OR (u.lastfm_auth IS NOT NULL AND (p.lastfm_synced_at IS NULL OR p.lastfm_synced_at < NOW() - make_interval(secs => $2)))
        )
      ORDER BY COALESCE(p.updated_at, '1970-01-01') ASC
      LIMIT $1
    `;

    const result = await db.raw(query, [limit, staleIntervalSeconds], {
      name: 'preference-sync-users-needing-sync',
      retryable: true,
    });
    return result.rows;
  }

  /**
   * Sync internal list data for a user
   */
  async function syncInternalData(userId) {
    return userPrefs.aggregateFromLists(userId);
  }

  /**
   * Sync Spotify data for a user
   */
  async function syncSpotifyData(user) {
    return syncSpotifyDataForUser(user, userService, spotifyAuth, log);
  }

  /**
   * Sync Last.fm data for a user
   */
  async function syncLastfmData(user) {
    return syncLastfmDataForUser(user, lastfmAuth, log);
  }

  /**
   * Sync all preferences for a single user
   */
  async function syncUserPreferences(user) {
    const userId = user._id;
    const startTime = Date.now();

    log.info('Starting preference sync for user', {
      userId,
      email: user.email,
    });

    // Sync all data sources
    const syncHelpers = {
      syncInternalFn: syncInternalData,
      syncSpotifyFn: syncSpotifyData,
      syncLastfmFn: syncLastfmData,
    };
    const { updates, errors } = await syncAllDataSources(
      user,
      syncHelpers,
      log
    );

    // Fetch artist countries from MusicBrainz
    let artistCountries = {};
    try {
      artistCountries = await fetchArtistCountries(
        updates,
        musicBrainz,
        log,
        userId
      );
      if (Object.keys(artistCountries).length > 0) {
        updates.artistCountries = artistCountries;
      }
    } catch (err) {
      log.warn('Failed to fetch artist countries, continuing without them', {
        userId,
        error: err.message,
      });
    }

    // Calculate and save affinity
    const affinityErrors = await calculateAndSaveAffinity(
      userId,
      updates,
      artistCountries,
      userPrefs,
      log
    );
    errors.push(...affinityErrors);

    const duration = Date.now() - startTime;
    log.info('Preference sync complete for user', {
      userId,
      duration: `${duration}ms`,
      errors: errors.length,
    });

    return { userId, success: errors.length === 0, errors, duration };
  }

  /**
   * Run a complete sync cycle for all users needing updates
   */
  async function runSyncCycle() {
    if (isRunning) {
      log.warn('Sync cycle already running, skipping');
      return { skipped: true };
    }

    isRunning = true;
    const cycleStart = Date.now();

    log.info('Starting preference sync cycle');
    const results = { total: 0, success: 0, failed: 0, errors: [] };

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
            results.errors.push({ userId: user._id, errors: result.errors });
          }

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

    const initialDelay = options.immediate ? 0 : STARTUP_DELAY_MS;
    setTimeout(() => {
      runSyncCycle().catch((err) => {
        log.error('Initial sync cycle failed', { error: err.message });
      });
    }, initialDelay);

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

  function isSyncing() {
    return isRunning;
  }

  function isStarted() {
    return syncInterval !== null;
  }

  return {
    start,
    stop,
    isStarted,
    isSyncing,
    runSyncCycle,
    syncUserPreferences,
    getUsersNeedingSync,
    syncInternalData,
    syncSpotifyData,
    syncLastfmData,
  };
}

module.exports = { createPreferenceSyncService };
