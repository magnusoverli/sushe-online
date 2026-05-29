/**
 * Availability Fetch Queue
 *
 * Background queue that resolves which platforms provide a freshly-added album
 * (via the availability resolution service) and caches the result. Runs off the
 * request path like the cover/track/native-name queues, serialized and paced to
 * stay within Odesli's free-tier rate limit. Already-resolved albums short-
 * circuit without a network call (and without consuming the pacing delay).
 */

const {
  RequestQueue,
  MusicBrainzQueue,
  createMbFetch,
} = require('../utils/request-queue');
const logger = require('../utils/logger');
const { ensureDb } = require('../db/postgres');
const { ODESLI_RATE_LIMIT_MS } = require('./availability/platforms');
const {
  createExternalIdentityService,
} = require('./external-identity-service');
const { createOdesliClient } = require('./availability/odesli-client');
const { createMbUrlRelsSource } = require('./availability/mb-url-rels-source');
const { createSeedProviders } = require('./availability/seed-providers');
const {
  createAvailabilityResolutionService,
} = require('./availability-resolution-service');

function createAvailabilityFetchQueue(deps = {}) {
  const maxConcurrent = deps.maxConcurrent || 1; // serialize for the Odesli limit
  const queue = new RequestQueue(maxConcurrent);
  const fetchFn = deps.fetch || fetch;
  const log = deps.logger || logger;
  const rateLimitMs =
    deps.rateLimitMs === undefined ? ODESLI_RATE_LIMIT_MS : deps.rateLimitMs;
  const db =
    deps.db !== undefined && deps.db !== null
      ? ensureDb(deps.db, 'availability-fetch-queue')
      : null;
  const mbFetch =
    deps.mbFetch || createMbFetch(new MusicBrainzQueue({ fetch: fetchFn }));

  // Tests may inject a ready-made repository + resolution service; otherwise the
  // dependency graph is assembled from db (production startup path).
  const externalIdentityService =
    deps.externalIdentityService ||
    (db ? createExternalIdentityService({ db, logger: log }) : null);
  const resolutionService =
    deps.resolutionService ||
    (externalIdentityService
      ? createAvailabilityResolutionService({
          logger: log,
          externalIdentityService,
          odesliClient: createOdesliClient({ fetch: fetchFn, logger: log }),
          mbUrlRelsSource: createMbUrlRelsSource({ mbFetch, logger: log }),
          seedProviders: createSeedProviders({
            fetch: fetchFn,
            logger: log,
            externalIdentityService,
          }),
        })
      : null);

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
        const existing =
          await externalIdentityService.getAlbumAvailability(albumId);
        // Skip only when availability was already resolved here. A prior
        // Spotify/Tidal identity mapping (from playback/export) does not count.
        const alreadyResolved = existing.some((row) =>
          String(row.strategy || '').startsWith('availability:')
        );
        if (alreadyResolved) return;
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

function initializeAvailabilityFetchQueue(db) {
  if (!availabilityFetchQueue) {
    availabilityFetchQueue = createAvailabilityFetchQueue({ db });
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
