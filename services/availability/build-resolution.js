/**
 * Availability resolution wiring (single assembly point).
 *
 * Composes the external-identity repository, the Odesli client, the MusicBrainz
 * url-rels source, the seed providers, and the direct sources (Spotify,
 * iTunes) into a ready-to-use resolution service. The live fetch queue,
 * the backfill CLI, and the admin resolution job all build through here so they
 * share one source set — adding a source updates every caller at once.
 */

const defaultLogger = require('../../utils/logger');
const { mbFetch: sharedMbFetch } = require('../../utils/mb-queue-singleton');
const {
  createExternalIdentityService,
} = require('../external-identity-service');
const { createOdesliClient } = require('./odesli-client');
const { createMbUrlRelsSource } = require('./mb-url-rels-source');
const { createSeedProviders } = require('./seed-providers');
const { createItunesSource } = require('./itunes-source');
const { createQobuzSource } = require('./qobuz-source');
const { createSpotifySource } = require('./spotify-source');
const {
  createAvailabilityResolutionService,
} = require('../availability-resolution-service');

/**
 * @param {Object} deps
 * @param {import('../../db/types').DbFacade} [deps.db] - datastore (used to build
 *   the repository when one is not injected)
 * @param {Function} [deps.fetch] - fetch implementation
 * @param {Object} [deps.logger]
 * @param {Function} [deps.mbFetch] - shared, rate-limited MusicBrainz fetch
 * @param {Object} [deps.externalIdentityService] - pre-built repository (tests)
 * @returns {{resolution: Object, externalIdentityService: Object, mbFetch: Function}}
 */
function buildAvailabilityResolution(deps = {}) {
  const logger = deps.logger || defaultLogger;
  const fetchFn = deps.fetch || fetch;
  const mbFetch = deps.mbFetch || sharedMbFetch;
  const externalIdentityService =
    deps.externalIdentityService ||
    createExternalIdentityService({ db: deps.db, logger });

  const itunesSource = createItunesSource({ fetch: fetchFn, logger });
  const qobuzSource = createQobuzSource({ fetch: fetchFn, logger });
  const spotifySource = createSpotifySource({ fetch: fetchFn, logger });

  const resolution = createAvailabilityResolutionService({
    logger,
    externalIdentityService,
    odesliClient: createOdesliClient({ fetch: fetchFn, logger }),
    mbUrlRelsSource: createMbUrlRelsSource({ mbFetch, logger }),
    seedProviders: createSeedProviders({
      fetch: fetchFn,
      logger,
      externalIdentityService,
    }),
    directSources: [
      { name: 'spotify', getLinks: spotifySource.getLinks },
      { name: 'itunes', getLinks: itunesSource.getLinks },
      { name: 'qobuz', getLinks: qobuzSource.getLinks },
    ],
  });

  return { resolution, externalIdentityService, mbFetch };
}

module.exports = { buildAvailabilityResolution };
