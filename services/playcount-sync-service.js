/**
 * Playcount Sync Service (Tier 1)
 *
 * Background scheduler that periodically re-syncs Last.fm playcounts for all
 * users with stale data. The actual Last.fm fetch + cache write lives in
 * playcount-engine.js; this module owns the cron-style cycle, user selection,
 * and per-user orchestration.
 *
 * Three-tier refresh strategy:
 *   - Tier 1: this background job (every 24h, for users with stale data)
 *   - Tier 2: list view refreshes stale albums (see playcount-service.js)
 *   - Tier 3: interaction-triggered refreshes (scrobble, add album)
 */

const logger = require('../utils/logger');
const { ensureDb } = require('../db/postgres');
const { runInBatches } = require('../utils/batch');
const { recordPlaycountSync } = require('../utils/metrics');
const {
  SYNC_INTERVAL_MS,
  BACKGROUND_SYNC_STALE_MS,
  RATE_LIMIT_DELAY_MS,
  STARTUP_DELAY_MS,
  BATCH_SIZE,
  BATCH_DELAY_MS,
} = require('./playcount-constants');
const {
  refreshAlbumPlaycount,
  invalidateUserPlaycounts,
} = require('./playcount-engine');

// ============================================
// DATABASE HELPERS
// ============================================

/**
 * Get users who need playcount sync (Last.fm connected and either stale or
 * missing coverage for some album in their lists).
 */
async function getUsersNeedingSync(db, staleThresholdMs, limit = 50) {
  const staleIntervalSeconds = Math.floor(staleThresholdMs / 1000);

  const query = `
    WITH fresh_users AS (
      SELECT DISTINCT uas.user_id
      FROM user_album_stats uas
      WHERE uas.lastfm_updated_at > NOW() - make_interval(secs => $2)
    ),
    users_with_missing_coverage AS (
      SELECT DISTINCT l.user_id
      FROM lists l
      JOIN list_items li ON li.list_id = l._id
      JOIN albums a ON li.album_id = a.album_id
      LEFT JOIN user_album_stats uas
        ON uas.user_id = l.user_id
       AND uas.album_id = a.album_id
      WHERE a.album_id IS NOT NULL
        AND a.artist IS NOT NULL
        AND a.album IS NOT NULL
        AND uas.id IS NULL
    )
    SELECT
      u._id,
      u.username,
      u.lastfm_username
    FROM users u
    LEFT JOIN fresh_users f ON f.user_id = u._id
    LEFT JOIN users_with_missing_coverage m ON m.user_id = u._id
    WHERE u.lastfm_auth IS NOT NULL
      AND u.lastfm_username IS NOT NULL
      AND u.lastfm_username != ''
      AND (f.user_id IS NULL OR m.user_id IS NOT NULL)
    ORDER BY u._id
    LIMIT $1
  `;

  const result = await db.raw(query, [limit, staleIntervalSeconds]);
  return result.rows;
}

/**
 * Get all distinct albums for a user across all their lists.
 */
async function getUserAlbums(db, userId) {
  const query = `
    SELECT DISTINCT
      a.album_id,
      a.artist,
      a.album
    FROM list_items li
    JOIN lists l ON li.list_id = l._id
    JOIN albums a ON li.album_id = a.album_id
    WHERE l.user_id = $1
      AND a.artist IS NOT NULL
      AND a.album IS NOT NULL
  `;

  const result = await db.raw(query, [userId]);
  return result.rows;
}

/**
 * Sync all playcounts for a single user.
 * @returns {Promise<Object>} Sync result { userId, success, synced, failed, duration }
 */
async function syncUserPlaycounts(db, log, user) {
  const userId = user._id;
  const lastfmUsername = user.lastfm_username;
  const startTime = Date.now();

  log.info('Starting playcount sync for user', {
    userId,
    username: user.username,
    lastfmUsername,
  });

  const albums = await getUserAlbums(db, userId);

  if (albums.length === 0) {
    log.info('No albums to sync for user', { userId });
    return { userId, success: true, synced: 0, failed: 0, duration: 0 };
  }

  const outcomes = await runInBatches(
    albums,
    { batchSize: BATCH_SIZE, delayMs: BATCH_DELAY_MS },
    async (album) => {
      const result = await refreshAlbumPlaycount(
        db,
        log,
        userId,
        lastfmUsername,
        album
      );
      return result !== null;
    }
  );

  const synced = outcomes.filter(Boolean).length;
  const failed = outcomes.length - synced;
  const duration = Date.now() - startTime;

  log.info('Playcount sync complete for user', {
    userId,
    username: user.username,
    totalAlbums: albums.length,
    synced,
    failed,
    duration: `${duration}ms`,
  });

  return { userId, success: failed === 0, synced, failed, duration };
}

// ============================================
// MAIN FACTORY
// ============================================

/**
 * Create the Tier-1 playcount sync scheduler.
 * @param {Object} deps
 * @param {import("../db/types").DbFacade} deps.db - Canonical datastore
 * @param {Object} [deps.logger]
 * @param {number} [deps.syncIntervalMs]
 * @param {number} [deps.staleThresholdMs]
 */
function createPlaycountSyncService(deps = {}) {
  const log = deps.logger || logger;
  const db = ensureDb(deps.db, 'playcount-sync-service');

  const syncIntervalMs = deps.syncIntervalMs || SYNC_INTERVAL_MS;
  const staleThresholdMs = deps.staleThresholdMs || BACKGROUND_SYNC_STALE_MS;
  let syncInterval = null;
  let isRunning = false;

  /**
   * Refresh a single album (for interaction-triggered refreshes).
   */
  async function refreshSingleAlbum(
    userId,
    lastfmUsername,
    album,
    delayMs = 0
  ) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    log.debug('Refreshing single album playcount', {
      userId,
      artist: album.artist,
      album: album.album,
    });

    return refreshAlbumPlaycount(db, log, userId, lastfmUsername, album);
  }

  /**
   * Run a complete sync cycle for all users needing updates.
   */
  async function runSyncCycle() {
    if (isRunning) {
      log.warn('Playcount sync cycle already running, skipping');
      return { skipped: true };
    }

    isRunning = true;
    const cycleStart = Date.now();

    log.info('Starting playcount sync cycle');
    const results = {
      total: 0,
      success: 0,
      failed: 0,
      totalAlbums: 0,
      errors: [],
    };

    try {
      const users = await getUsersNeedingSync(db, staleThresholdMs);
      results.total = users.length;

      log.info(`Found ${users.length} users needing playcount sync`);

      for (const user of users) {
        try {
          const result = await syncUserPlaycounts(db, log, user);
          results.totalAlbums += result.synced + result.failed;

          if (result.success) {
            results.success++;
          } else {
            results.failed++;
            results.errors.push({
              userId: user._id,
              synced: result.synced,
              failed: result.failed,
            });
          }

          // Rate limit delay between users
          if (users.indexOf(user) < users.length - 1) {
            await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS));
          }
        } catch (err) {
          results.failed++;
          results.errors.push({
            userId: user._id,
            error: err.message,
          });
          log.error('Error syncing user playcounts', {
            userId: user._id,
            error: err.message,
          });
        }
      }

      const cycleDuration = Date.now() - cycleStart;
      log.info('Playcount sync cycle complete', {
        totalUsers: results.total,
        successUsers: results.success,
        failedUsers: results.failed,
        totalAlbums: results.totalAlbums,
        duration: `${cycleDuration}ms`,
      });
      recordPlaycountSync('success', results.totalAlbums);
    } catch (err) {
      log.error('Playcount sync cycle failed', { error: err.message });
      results.errors.push({ source: 'cycle', error: err.message });
      recordPlaycountSync('error', 0);
    } finally {
      isRunning = false;
    }

    return results;
  }

  function start(options = {}) {
    if (syncInterval) {
      log.warn('Playcount sync service already running');
      return;
    }

    log.info('Starting playcount sync service', {
      syncInterval: `${syncIntervalMs / 1000 / 60 / 60} hours`,
      staleThreshold: `${staleThresholdMs / 1000 / 60 / 60} hours`,
    });

    const initialDelay = options.immediate ? 0 : STARTUP_DELAY_MS;
    setTimeout(() => {
      runSyncCycle().catch((err) => {
        log.error('Initial playcount sync cycle failed', {
          error: err.message,
        });
      });
    }, initialDelay);

    syncInterval = setInterval(() => {
      runSyncCycle().catch((err) => {
        log.error('Scheduled playcount sync cycle failed', {
          error: err.message,
        });
      });
    }, syncIntervalMs);
  }

  function stop() {
    if (syncInterval) {
      clearInterval(syncInterval);
      syncInterval = null;
      log.info('Playcount sync service stopped');
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
    syncUserPlaycounts: (user) => syncUserPlaycounts(db, log, user),
    getUsersNeedingSync: (limit) =>
      getUsersNeedingSync(db, staleThresholdMs, limit),
    getUserAlbums: (userId) => getUserAlbums(db, userId),
    refreshSingleAlbum,
  };
}

module.exports = {
  createPlaycountSyncService,
  syncUserPlaycounts,
  // Re-exported from the engine so existing importers keep working.
  refreshAlbumPlaycount,
  invalidateUserPlaycounts,
};
