/**
 * Deezer availability source (UPC-exact).
 *
 * Confirms an album is on Deezer by an exact barcode lookup
 * (`/album/upc:<UPC>`), returning Deezer's own canonical album url. Identity is
 * exact, so the link is far more reliable than a fuzzy aggregator guess. Acts
 * only on a UPC — the no-UPC path is already covered by Odesli plus the iTunes /
 * Deezer text seed-providers. Deezer stores its own per-release UPC, which often
 * differs from a MusicBrainz barcode, so a miss is expected and not an error.
 *
 * Pure adapter: returns normalized links on a hit, an empty list otherwise, and
 * never throws (a transient transport problem degrades to "no links").
 */

const defaultLogger = require('../../utils/logger');

const DEEZER_ALBUM_UPC_URL = 'https://api.deezer.com/album/upc:';

// Exact barcode identity — high confidence, comfortably above the floor.
const DEEZER_UPC_CONFIDENCE = 0.97;

function createDeezerSource(deps = {}) {
  const fetchFn = deps.fetch || fetch;
  const logger = deps.logger || defaultLogger;

  /**
   * @param {{upc?: string|null}} album
   * @returns {Promise<{links: Array<{service:string, url:string, confidence:number}>}>}
   */
  async function getLinks(album = {}) {
    const upc = album.upc && String(album.upc).trim();
    if (!upc) return { links: [] };

    try {
      const resp = await fetchFn(
        `${DEEZER_ALBUM_UPC_URL}${encodeURIComponent(upc)}`
      );
      if (!resp.ok) return { links: [] };

      const data = await resp.json();
      // Deezer signals a barcode miss with an `error` object, not an HTTP error.
      if (!data || data.error || !data.link) return { links: [] };

      return {
        links: [
          {
            service: 'deezer',
            url: data.link,
            confidence: DEEZER_UPC_CONFIDENCE,
          },
        ],
      };
    } catch (err) {
      logger.debug?.('Deezer UPC lookup failed', { upc, error: err.message });
      return { links: [] };
    }
  }

  return { getLinks };
}

module.exports = { createDeezerSource, DEEZER_UPC_CONFIDENCE };
