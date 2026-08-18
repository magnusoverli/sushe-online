/**
 * Availability Fetch Queue
 *
 * Background queue that resolves which platforms provide a freshly-added album
 * (via the availability resolution service) and caches the result. Runs off the
 * request path like the cover/track/native-name queues, serialized and paced to
 * stay within Odesli's free-tier rate limit. Already-resolved albums short-
 * circuit without a network call (and without consuming the pacing delay).
 */

const { RequestQueue } = require('../utils/request-queue');
const logger = require('../utils/logger');
const { ensureDb } = require('../db/postgres');
const { ODESLI_RATE_LIMIT_MS } = require('./availability/platforms');
const {
  AVAILABILITY_RESOLUTION_VERSION,
} = require('./availability-resolution-service');
const {
  buildAvailabilityResolution,
} = require('./availability/build-resolution');
const {
  invalidateResponseCacheForAlbumUsers,
} = require('./album-cache-invalidation');
const {
  publishAlbumAvailabilityUpdate,
} = require('./album-availability-publisher');

function createAvailabilityFetchQueue(deps = {}) {
  const maxConcurrent = deps.maxConcurrent || 1; // serialize for the Odesli limit
  const queue = new RequestQueue(maxConcurrent);
  const fetchFn = deps.fetch || fetch;
  const log = deps.logger || logger;
  const rateLimitMs =
    deps.rateLimitMs === undefined ? ODESLI_RATE_LIMIT_MS : deps.rateLimitMs;
  // ensureDb() only guarantees the structural `.raw` check; deps.db is the
  // canonical datastore facade, which is what buildAvailabilityResolution wants.
  const db =
    deps.db !== undefined && deps.db !== null
      ? /** @type {import('../db/types').DbFacade} */ (
          ensureDb(deps.db, 'availability-fetch-queue')
        )
      : null;
  const responseCache = deps.responseCache;
  const broadcast = deps.broadcast || require('../utils/websocket').broadcast;

  // Tests may inject a ready-made repository + resolution service; otherwise the
  // dependency graph is assembled from db (production startup path).
  let externalIdentityService = deps.externalIdentityService || null;
  let resolutionService = deps.resolutionService || null;
  if ((!externalIdentityService || !resolutionService) && db) {
    const built = buildAvailabilityResolution({
      db,
      fetch: fetchFn,
      logger: log,
      mbFetch: deps.mbFetch,
      externalIdentityService,
    });
    externalIdentityService =
      externalIdentityService || built.externalIdentityService;
    resolutionService = resolutionService || built.resolution;
  }

  async function pace() {
    if (rateLimitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, rateLimitMs));
    }
  }

  /**
   * Enqueue availability resolution for an album. No-op when fields are missing
   * or the dependency graph is not configured.
   */
  function add(albumId, artist, album) {
    if (!albumId || !artist || !album) return;
    if (!externalIdentityService || !resolutionService) return;

    return queue.add(async () => {
      try {
        const state =
          await externalIdentityService.getAlbumAvailabilityResolutionState(
            albumId
          );
        if (state.version >= AVAILABILITY_RESOLUTION_VERSION) return;
      } catch (err) {
        log.warn('Availability pre-check failed', {
          albumId,
          error: err.message,
        });
        return;
      }

      try {
        const result = await resolutionService.resolveAvailability({
          albumId,
          artist,
          album,
        });
        if (result.action === 'resolved') {
          log.info('Resolved album availability', {
            albumId,
            services: result.services,
          });
          if (db && responseCache) {
            await invalidateResponseCacheForAlbumUsers({
              db,
              responseCache,
              logger: log,
              albumIds: albumId,
              operation: 'availability-fetch-queue',
            });
          }
          await publishAlbumAvailabilityUpdate({
            db,
            broadcast,
            logger: log,
            albumId,
            operation: 'availability-fetch-queue',
          });
        }
      } catch (err) {
        log.warn('Availability resolution failed', {
          albumId,
          error: err.message,
        });
      } finally {
        await pace(); // only reached when an actual resolution was attempted
      }
    });
  }

  return {
    add,
    get length() {
      return queue.length;
    },
  };
}

// Singleton (initialized with db at startup)
let availabilityFetchQueue = null;

function initializeAvailabilityFetchQueue(db, options = {}) {
  if (!availabilityFetchQueue) {
    availabilityFetchQueue = createAvailabilityFetchQueue({
      db,
      mbFetch: options.mbFetch,
      responseCache: options.responseCache,
      broadcast: options.broadcast,
    });
    logger.info('Availability fetch queue initialized');
  }
  return availabilityFetchQueue;
}

function getAvailabilityFetchQueue() {
  if (!availabilityFetchQueue) {
    throw new Error(
      'Availability fetch queue not initialized. Call initializeAvailabilityFetchQueue(db) first.'
    );
  }
  return availabilityFetchQueue;
}

module.exports = {
  createAvailabilityFetchQueue,
  initializeAvailabilityFetchQueue,
  getAvailabilityFetchQueue,
};
