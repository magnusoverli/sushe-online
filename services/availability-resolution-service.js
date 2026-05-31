/**
 * Availability resolution orchestration.
 *
 * Seeds an album (existing mapping / MusicBrainz / public search), expands the
 * seed via Odesli, unions the result with MusicBrainz direct links and any
 * UPC-exact direct sources (Deezer, iTunes, ...), gates by confidence, and
 * persists one album_service_mappings row per platform.
 *
 * Pure orchestration: no SQL and no HTTP of its own — it composes the injected
 * strategy modules and the external-identity repository.
 */

const defaultLogger = require('../utils/logger');
const {
  normalizeOdesliPlatform,
  AVAILABILITY_CONFIDENCE_FLOOR,
} = require('./availability/platforms');

const MB_LINK_CONFIDENCE = 0.9; // MusicBrainz url-rels are identity-confirmed

function isTransientStatus(status) {
  return !status || status === 429 || status >= 500;
}

/**
 * Collapse a flat candidate list into one row per canonical service, keeping the
 * higher-confidence candidate on a conflict and dropping anything below the
 * confidence floor.
 *
 * @param {Array<{service:string, url:string, confidence:number, strategy:string}>} candidates
 * @returns {Array<{service:string, url:string, confidence:number, strategy:string}>}
 */
function mergeCandidates(candidates) {
  const byService = new Map();

  for (const cand of candidates) {
    const { service, url, confidence, strategy } = cand;
    if (!service || !url) continue;
    const existing = byService.get(service);
    if (!existing || confidence > existing.confidence) {
      byService.set(service, { service, url, confidence, strategy });
    }
  }

  return [...byService.values()].filter(
    (row) => row.confidence >= AVAILABILITY_CONFIDENCE_FLOOR
  );
}

/**
 * Build the flat candidate list from every source contribution.
 *
 * @param {Object} params
 * @param {Array<{platform:string, url:string}>} params.odesliLinks
 * @param {string} params.seedKind
 * @param {number} params.seedConfidence
 * @param {Array<{service:string, url:string}>} params.mbLinks
 * @param {Array<{name:string, links:Array<{service:string, url:string, confidence:number}>}>} params.directContributions
 */
function buildCandidates({
  odesliLinks,
  seedKind,
  seedConfidence,
  mbLinks,
  directContributions,
}) {
  const candidates = [];

  for (const link of odesliLinks) {
    candidates.push({
      service: normalizeOdesliPlatform(link.platform),
      url: link.url,
      confidence: seedConfidence,
      strategy: `availability:${seedKind}`,
    });
  }

  for (const link of mbLinks) {
    candidates.push({
      service: link.service,
      url: link.url,
      confidence: MB_LINK_CONFIDENCE,
      strategy: 'availability:musicbrainz',
    });
  }

  for (const contribution of directContributions) {
    for (const link of contribution.links) {
      candidates.push({
        service: link.service,
        url: link.url,
        confidence: link.confidence,
        strategy: `availability:${contribution.name}`,
      });
    }
  }

  return candidates;
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
      return { seedUrl: null, upc: null, links: [] };
    }
  }

  /**
   * Run every UPC-exact direct source for this album, in parallel. Each source
   * is self-protecting (returns {links:[]} on a miss or transport error), so the
   * gathered contributions are always usable.
   */
  async function getDirectContributions(album, upc) {
    if (!directSources.length || !upc) return [];
    const results = await Promise.all(
      directSources.map(async (entry) => {
        const { links } = await entry.getLinks({
          upc,
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
    const mb = await getMusicbrainz(album.albumId);
    const directContributions = await getDirectContributions(album, mb.upc);
    const seedResult = await seedProviders.acquireSeed(album, mb.seedUrl);

    const hasNonOdesliLinks =
      mb.links.length > 0 || directContributions.length > 0;

    if (!seedResult && !hasNonOdesliLinks) {
      return { action: 'skip', reason: 'no-seed', transient: false };
    }

    let odesliLinks = [];
    if (seedResult) {
      try {
        odesliLinks = await odesliClient.fetchLinksBySeed(seedResult.seed);
      } catch (err) {
        if (!hasNonOdesliLinks) {
          return {
            action: 'skip',
            reason: 'odesli-error',
            transient: isTransientStatus(err.status),
          };
        }
        logger.debug?.(
          'Odesli expansion failed; using MusicBrainz / direct links only',
          {
            albumId: album.albumId,
            error: err.message,
          }
        );
      }
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
      return { action: 'skip', reason: 'no-links', transient: false };
    }

    if (persist) {
      for (const row of rows) {
        await externalIdentityService.upsertAlbumServiceMapping({
          albumId: album.albumId,
          service: row.service,
          externalUrl: row.url,
          confidence: row.confidence,
          strategy: row.strategy,
        });
      }
    }

    return { action: 'resolved', services: rows.map((r) => r.service) };
  }

  return { resolveAvailability };
}

module.exports = {
  createAvailabilityResolutionService,
  mergeCandidates,
  buildCandidates,
};
