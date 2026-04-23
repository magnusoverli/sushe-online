/**
 * Post-Startup Background Service Initialization
 *
 * Initializes background services that run after the HTTP server starts:
 * - Cover fetch queue for async album cover fetching
 * - Track fetch queue for async album track fetching
 * - Preference sync service (production only)
 * - Playcount sync service (production only)
 */

const logger = require('../utils/logger');
const { createPreferenceSyncService } = require('../services/preference-sync');
const {
  createPlaycountSyncService,
} = require('../services/playcount-sync-service');

/**
 * Initialize background queues (cover fetch, track fetch).
 * Should be called after database migrations complete.
 * @param {Object} pool - PostgreSQL connection pool
 */
function initializeQueues(pool) {
  const {
    initializeCoverFetchQueue,
  } = require('../services/cover-fetch-queue');
  initializeCoverFetchQueue(pool);

  const { initializeTrackFetchQueue } = require('../utils/track-fetch-queue');
  initializeTrackFetchQueue(pool);
}

/**
 * Start background sync services (preference sync, playcount sync).
 * Only starts in production or when explicitly enabled via env vars.
 * Returns a cleanup function used during graceful shutdown.
 * @param {Object} pool - PostgreSQL connection pool
 * @returns {Function} stopSyncServices cleanup function
 */
function startSyncServices(pool) {
  // Canonical datastore for services that use .raw() instead of pool.query.
  const { db } = require('../db');
  const cleanupTasks = [];

  // Start preference sync service (only in production or if explicitly enabled)
  if (
    process.env.NODE_ENV === 'production' ||
    process.env.ENABLE_PREFERENCE_SYNC === 'true'
  ) {
    try {
      const syncService = createPreferenceSyncService({ db, pool, logger });
      syncService.start();

      cleanupTasks.push(async () => {
        logger.info('Shutting down preference sync service...');
        syncService.stop();
      });

      logger.info('Preference sync service initialized');
    } catch (syncErr) {
      logger.error('Failed to start preference sync service', {
        error: syncErr.message,
      });
      // Don't exit - sync service is not critical for app operation
    }
  }

  // Start playcount sync service (only in production or if explicitly enabled)
  // This runs every 24 hours to refresh Last.fm playcounts for all user albums
  if (
    process.env.NODE_ENV === 'production' ||
    process.env.ENABLE_PLAYCOUNT_SYNC === 'true'
  ) {
    try {
      const playcountSyncService = createPlaycountSyncService({
        db,
        pool,
        logger,
      });
      playcountSyncService.start();

      cleanupTasks.push(async () => {
        logger.info('Shutting down playcount sync service...');
        playcountSyncService.stop();
      });

      logger.info('Playcount sync service initialized (24h interval)');
    } catch (syncErr) {
      logger.error('Failed to start playcount sync service', {
        error: syncErr.message,
      });
      // Don't exit - sync service is not critical for app operation
    }
  }

  return async function stopSyncServices() {
    for (const stopTask of cleanupTasks) {
      try {
        await stopTask();
      } catch (error) {
        logger.error('Error while stopping sync service', {
          error: error.message,
        });
      }
    }
  };
}

module.exports = { initializeQueues, startSyncServices };
