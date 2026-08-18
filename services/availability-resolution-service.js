/**
 * Availability resolution orchestration.
 *
 * Seeds an album (existing mapping / MusicBrainz / public search), expands the
 * seed via Odesli, unions the result with MusicBrainz direct links and any
 * direct sources, gates by confidence, and persists one album_service_mappings
 * row per target platform.
 *
 * Pure orchestration: no SQL and no HTTP of its own — it composes the injected
 * strategy modules and the external-identity repository.
 */

const defaultLogger = require('../utils/logger');
const {
  AVAILABILITY_CONFIDENCE_FLOOR,
  isAvailabilityService,
} = require('./availability/platforms');
const {
  MB_LINK_CONFIDENCE,
  buildCandidates,
} = require('./availability/candidates');
const {
  buildSeedCandidates,
  expandSeedCandidates,
  resolveSeedExpansionFallback,
} = require('./availability/seed-expansion');

const AVAILABILITY_RESOLUTION_VERSION = 2;

function isTransientStatus(status) {
  return !status || status === 429 || status >= 500;
}

/**
 * Collapse a flat candidate list into one row per canonical service, keeping the
 * higher-confidence candidate on a conflict and dropping anything below the
 * confidence floor.
 *
 * @param {Array<{service:string, url:string, confidence:number, strategy:string,
 *   externalAlbumId?:string, externalArtist?:string, externalAlbum?:string}>} candidates
 * @returns {Array<{service:string, url:string, confidence:number, strategy:string,
 *   externalAlbumId?:string, externalArtist?:string, externalAlbum?:string}>}
 */
function mergeCandidates(candidates) {
  const byService = new Map();

  for (const cand of candidates) {
    const {
      service,
      url,
      confidence,
      strategy,
      externalAlbumId,
      externalArtist,
      externalAlbum,
    } = cand;
    if (!service || !url || !isAvailabilityService(service)) continue;
    const existing = byService.get(service);
    if (!existing || confidence > existing.confidence) {
      byService.set(service, {
        service,
        url,
        confidence,
        strategy,
        externalAlbumId,
        externalArtist,
        externalAlbum,
      });
    }
  }

  return [...byService.values()].filter(
    (row) => row.confidence >= AVAILABILITY_CONFIDENCE_FLOOR
  );
}

function createAvailabilityResolutionService(deps = {}) {
  const logger = deps.logger || defaultLogger;
  const externalIdentityService = deps.externalIdentityService;
  const odesliClient = deps.odesliClient;
  const mbUrlRelsSource = deps.mbUrlRelsSource;
  const seedProviders = deps.seedProviders;
  // Each entry: { name: string, getLinks: ({upc, artist, album}) => {links:[...]} }.
  const directSources = deps.directSources || [];

  async function getMusicbrainz(albumId) {
    try {
      return await mbUrlRelsSource.getDirectLinks(albumId);
    } catch (err) {
      logger.debug?.('MusicBrainz url-rels lookup failed', {
        albumId,
        error: err.message,
      });
      return { seedUrl: null, upc: null, links: [], transient: true };
    }
  }

  /**
   * Run every direct source for this album, in parallel. Each source is
   * self-protecting (returns {links:[]} on a miss or transport error), so the
   * gathered contributions are always usable.
   */
  async function getDirectContributions(
    album,
    upc,
    requiresUpc,
    excludedNames = new Set()
  ) {
    const sources = directSources.filter(
      (entry) =>
        !excludedNames.has(entry.name) &&
        (requiresUpc
          ? entry.requiresUpc || entry.supportsUpc
          : !entry.requiresUpc)
    );
    if (!sources.length) return [];
    const results = await Promise.all(
      sources.map(async (entry) => {
        const { links } = await entry.getLinks({
          upc,
          upcOnly: requiresUpc && entry.supportsUpc,
          artist: album.artist,
          album: album.album,
        });
        return { name: entry.name, links: links || [] };
      })
    );
    return results.filter((c) => c.links.length > 0);
  }

  /**
   * @param {{albumId:string, artist:string, album:string}} album
   * @param {{persist?:boolean}} [options]
   * @returns {Promise<{action:string, reason?:string, transient?:boolean,
   *   services?:string[]}>}
   */
  async function resolveAvailability(album, options = {}) {
    const { persist = true } = options;
    const independentSeedPromise = seedProviders.acquireIndependentSeed
      ? seedProviders.acquireIndependentSeed(album)
      : seedProviders.acquireSeed(album, null);
    const independentExpansionPromise = independentSeedPromise.then((seed) =>
      expandSeedCandidates(odesliClient, seed ? [seed] : [])
    );
    const immediateDirectPromise = getDirectContributions(album, null, false);
    const [mb, independentSeed, immediateDirect, independentExpansion] =
      await Promise.all([
        getMusicbrainz(album.albumId),
        independentSeedPromise,
        immediateDirectPromise,
        independentExpansionPromise,
      ]);
    const seedCandidates = buildSeedCandidates(independentSeed, mb.seedUrl);
    const { upcDirect, expansion } = await resolveSeedExpansionFallback({
      odesliClient,
      mbSeedUrl: mb.seedUrl,
      initialExpansion: independentExpansion,
      upcDirectPromise: mb.upc
        ? getDirectContributions(
            album,
            mb.upc,
            true,
            new Set(immediateDirect.map((entry) => entry.name))
          )
        : Promise.resolve([]),
    });
    const directContributions = [...immediateDirect, ...upcDirect];
    if (independentSeed?.directLink) {
      directContributions.push({
        name: 'itunes-search',
        links: [independentSeed.directLink],
      });
    }
    const seedResult = expansion.seedResult;

    const hasNonOdesliLinks =
      mb.links.length > 0 || directContributions.length > 0;

    if (seedCandidates.length === 0 && !hasNonOdesliLinks) {
      if (mb.transient) {
        return { action: 'skip', reason: 'musicbrainz-error', transient: true };
      }
      if (persist) {
        await externalIdentityService.markAlbumAvailabilityResolved(
          album.albumId,
          AVAILABILITY_RESOLUTION_VERSION
        );
      }
      return { action: 'skip', reason: 'no-seed', transient: false };
    }

    const odesliLinks = expansion.links;
    if (expansion.errors.length > 0 && odesliLinks.length === 0) {
      if (!hasNonOdesliLinks) {
        const transient = expansion.errors.some((error) =>
          isTransientStatus(error.status)
        );
        if (persist && !transient) {
          await externalIdentityService.markAlbumAvailabilityResolved(
            album.albumId,
            AVAILABILITY_RESOLUTION_VERSION
          );
        }
        return {
          action: 'skip',
          reason: 'odesli-error',
          transient,
        };
      }
      logger.debug?.(
        'Odesli expansion failed; using MusicBrainz / direct links only',
        {
          albumId: album.albumId,
          errors: expansion.errors.map((error) => error.message),
        }
      );
    }

    const rows = mergeCandidates(
      buildCandidates({
        odesliLinks,
        seedKind: seedResult ? seedResult.kind : 'musicbrainz',
        seedConfidence: seedResult ? seedResult.confidence : MB_LINK_CONFIDENCE,
        mbLinks: mb.links,
        directContributions,
      })
    );

    if (rows.length === 0) {
      if (persist) {
        await externalIdentityService.markAlbumAvailabilityResolved(
          album.albumId,
          AVAILABILITY_RESOLUTION_VERSION
        );
      }
      return { action: 'skip', reason: 'no-links', transient: false };
    }

    if (persist) {
      for (const row of rows) {
        await externalIdentityService.upsertAlbumServiceMapping({
          albumId: album.albumId,
          service: row.service,
          externalAlbumId: row.externalAlbumId,
          externalArtist: row.externalArtist,
          externalAlbum: row.externalAlbum,
          externalUrl: row.url,
          confidence: row.confidence,
          strategy: row.strategy,
        });
      }
      await externalIdentityService.markAlbumAvailabilityResolved(
        album.albumId,
        AVAILABILITY_RESOLUTION_VERSION
      );
    }

    return { action: 'resolved', services: rows.map((r) => r.service) };
  }

  return { resolveAvailability };
}

module.exports = {
  AVAILABILITY_RESOLUTION_VERSION,
  createAvailabilityResolutionService,
  mergeCandidates,
  buildCandidates,
};
