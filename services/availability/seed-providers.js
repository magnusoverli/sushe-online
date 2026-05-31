/**
 * Seed acquisition for Odesli expansion.
 *
 * Returns the highest-confidence seed available, tried cheapest-first:
 *   (a) an existing Spotify/Tidal mapping (zero extra network calls),
 *   (b) a MusicBrainz streaming url passed in by the orchestrator,
 *   (c) a public iTunes search, gated by the shared entity-matching
 *       confidence check so a loose text match never seeds a wrong release.
 * This module only *acquires* a seed; it does not call Odesli or persist.
 */

const defaultLogger = require('../../utils/logger');
const { normalizeForExternalApi } = require('../../utils/normalization');
const { selectBestCandidate } = require('../../utils/entity-matching');

const SEED_CONFIDENCE = { existing: 0.95, musicbrainz: 0.9 };
const EXISTING_SEED_SERVICES = ['spotify', 'tidal'];

function clean(value) {
  return normalizeForExternalApi(value || '')
    .replace(/[()[\]{}]/g, '')
    .replace(/[.,!?]/g, '')
    .trim();
}

function createSeedProviders(deps = {}) {
  const fetchFn = deps.fetch || fetch;
  const logger = deps.logger || defaultLogger;
  const externalIdentityService = deps.externalIdentityService;

  async function existingMappingSeed(albumId) {
    if (!externalIdentityService || !albumId) return null;
    for (const service of EXISTING_SEED_SERVICES) {
      try {
        const mapping = await externalIdentityService.getAlbumServiceMapping(
          service,
          albumId
        );
        if (mapping && mapping.external_album_id) {
          return {
            kind: 'existing',
            confidence: SEED_CONFIDENCE.existing,
            seed: {
              platform: service,
              type: 'album',
              id: mapping.external_album_id,
            },
          };
        }
      } catch (err) {
        logger.debug?.('existing-mapping seed lookup failed', {
          service,
          error: err.message,
        });
      }
    }
    return null;
  }

  async function itunesSeed(artist, album) {
    const term = `${clean(artist)} ${clean(album)}`.trim();
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=album&limit=5`;
    const resp = await fetchFn(url);
    if (!resp.ok) return null;
    const data = await resp.json();
    const candidates = data.results || [];
    const { best, isConfident } = selectBestCandidate({
      target: { artist, album },
      candidates,
      getArtist: (r) => r.artistName,
      getAlbum: (r) => r.collectionName,
    });
    if (!isConfident || !best.candidate.collectionId) return null;
    return {
      kind: 'itunes',
      confidence: best.combined,
      seed: {
        platform: 'itunes',
        type: 'album',
        id: best.candidate.collectionId,
      },
    };
  }

  async function searchSeed(artist, album) {
    if (!artist || !album) return null;
    try {
      return await itunesSeed(artist, album);
    } catch (err) {
      logger.debug?.('search seed provider failed', { error: err.message });
    }
    return null;
  }

  /**
   * @param {{albumId:string, artist:string, album:string}} album
   * @param {string|null} mbSeedUrl - streaming url from MusicBrainz, if any
   * @returns {Promise<{kind:string, confidence:number, seed:Object}|null>}
   */
  async function acquireSeed(album, mbSeedUrl) {
    const existing = await existingMappingSeed(album.albumId);
    if (existing) return existing;

    if (mbSeedUrl) {
      return {
        kind: 'musicbrainz',
        confidence: SEED_CONFIDENCE.musicbrainz,
        seed: { url: mbSeedUrl },
      };
    }

    return searchSeed(album.artist, album.album);
  }

  return { acquireSeed };
}

module.exports = { createSeedProviders };
