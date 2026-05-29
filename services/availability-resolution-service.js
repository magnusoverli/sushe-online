/**
 * Availability resolution orchestration.
 *
 * Seeds an album (existing mapping / MusicBrainz / public search), expands the
 * seed via Odesli, unions the result with MusicBrainz direct links, gates by
 * confidence, and persists one album_service_mappings row per platform.
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
 * Union Odesli platform links with MusicBrainz direct links into one row per
 * canonical service, keeping the higher-confidence source on a conflict.
 */
function mergeLinks(odesliLinks, mbLinks, seedKind, seedConfidence) {
  const byService = new Map();

  const consider = (service, url, confidence, strategy) => {
    if (!service || !url) return;
    const existing = byService.get(service);
    if (!existing || confidence > existing.confidence) {
      byService.set(service, { service, url, confidence, strategy });
    }
  };

  for (const link of odesliLinks) {
    consider(
      normalizeOdesliPlatform(link.platform),
      link.url,
      seedConfidence,
      `availability:${seedKind}`
    );
  }
  for (const link of mbLinks) {
    consider(
      link.service,
      link.url,
      MB_LINK_CONFIDENCE,
      'availability:musicbrainz'
    );
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

  async function getMusicbrainz(albumId) {
    try {
      return await mbUrlRelsSource.getDirectLinks(albumId);
    } catch (err) {
      logger.debug?.('MusicBrainz url-rels lookup failed', {
        albumId,
        error: err.message,
      });
      return { seedUrl: null, links: [] };
    }
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
    const seedResult = await seedProviders.acquireSeed(album, mb.seedUrl);

    if (!seedResult && mb.links.length === 0) {
      return { action: 'skip', reason: 'no-seed', transient: false };
    }

    let odesliLinks = [];
    if (seedResult) {
      try {
        odesliLinks = await odesliClient.fetchLinksBySeed(seedResult.seed);
      } catch (err) {
        if (mb.links.length === 0) {
          return {
            action: 'skip',
            reason: 'odesli-error',
            transient: isTransientStatus(err.status),
          };
        }
        logger.debug?.(
          'Odesli expansion failed; using MusicBrainz links only',
          {
            albumId: album.albumId,
            error: err.message,
          }
        );
      }
    }

    const rows = mergeLinks(
      odesliLinks,
      mb.links,
      seedResult ? seedResult.kind : 'musicbrainz',
      seedResult ? seedResult.confidence : MB_LINK_CONFIDENCE
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
  mergeLinks,
};
