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
  const { initializeCoverFetchQueue } = require('../utils/cover-fetch-queue');
  initializeCoverFetchQueue(pool);

  const { initializeTrackFetchQueue } = require('../utils/track-fetch-queue');
  initializeTrackFetchQueue(pool);
}

/**
 * Start background sync services (preference sync, playcount sync).
 * Only starts in production or when explicitly enabled via env vars.
 * @param {Object} pool - PostgreSQL connection pool
 */
function startSyncServices(pool) {
  // Start preference sync service (only in production or if explicitly enabled)
  if (
    process.env.NODE_ENV === 'production' ||
    process.env.ENABLE_PREFERENCE_SYNC === 'true'
  ) {
    try {
      const syncService = createPreferenceSyncService({ pool, logger });
      syncService.start();

      // Clean shutdown
      const shutdown = () => {
        logger.info('Shutting down preference sync service...');
        syncService.stop();
      };
      process.on('SIGTERM', shutdown);
      process.on('SIGINT', shutdown);

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
        pool,
        logger,
      });
      playcountSyncService.start();

      // Clean shutdown
      const playcountShutdown = () => {
        logger.info('Shutting down playcount sync service...');
        playcountSyncService.stop();
      };
      process.on('SIGTERM', playcountShutdown);
      process.on('SIGINT', playcountShutdown);

      logger.info('Playcount sync service initialized (24h interval)');
    } catch (syncErr) {
      logger.error('Failed to start playcount sync service', {
        error: syncErr.message,
      });
      // Don't exit - sync service is not critical for app operation
    }
  }
}

module.exports = { initializeQueues, startSyncServices };
