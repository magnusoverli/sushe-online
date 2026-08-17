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
const {
  AVAILABILITY_SERVICES,
  ODESLI_RATE_LIMIT_MS,
} = require('./availability/platforms');
const {
  AVAILABILITY_RESOLUTION_VERSION,
} = require('./availability-resolution-service');
const {
  buildAvailabilityResolution,
} = require('./availability/build-resolution');
const {
  invalidateResponseCacheForAlbumUsers,
} = require('./album-cache-invalidation');

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

  async function broadcastAvailabilityUpdate(albumId) {
    if (!db || typeof broadcast?.albumAvailabilityUpdated !== 'function') {
      return;
    }

    try {
      const result = await db.raw(
        `SELECT DISTINCT l.user_id,
                COALESCE((
                  SELECT json_agg(m.service ORDER BY m.service)
                  FROM album_service_mappings m
                  WHERE m.album_id = $1
                    AND (m.strategy LIKE 'availability:%' OR m.external_url IS NOT NULL)
                    AND m.service = ANY($2)
                ), '[]'::json) AS availability,
                COALESCE((
                  SELECT json_agg(
                    json_build_object('service', m.service, 'url', m.external_url)
                    ORDER BY m.service
                  )
                  FROM album_service_mappings m
                  WHERE m.album_id = $1
                    AND m.service = ANY($2)
                    AND m.external_url IS NOT NULL
                ), '[]'::json) AS availability_links
         FROM lists l
         JOIN list_items li ON li.list_id = l._id
         WHERE li.album_id = $1`,
        [albumId, AVAILABILITY_SERVICES],
        {
          name: 'availability-fetch-queue-broadcast-album-update',
          retryable: true,
        }
      );

      for (const row of result.rows) {
        broadcast.albumAvailabilityUpdated(
          row.user_id,
          albumId,
          row.availability || [],
          row.availability_links || []
        );
      }
    } catch (error) {
      log.warn('Failed to broadcast album availability update', {
        albumId,
        error: error.message,
      });
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
          await broadcastAvailabilityUpdate(albumId);
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
