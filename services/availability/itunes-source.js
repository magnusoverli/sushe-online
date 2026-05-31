/**
 * iTunes availability source (UPC-exact).
 *
 * Confirms an album on Apple's catalog by an exact barcode lookup
 * (`/lookup?upc=<UPC>&entity=album`), returning the canonical collection
 * url. Apple matches barcodes broadly, so the hit-rate on MusicBrainz UPCs is
 * good. Acts only on a UPC — the no-UPC path is already covered by Odesli plus
 * the iTunes text seed-provider.
 *
 * Pure adapter: returns normalized links on a hit, an empty list otherwise, and
 * never throws (a transient transport problem degrades to "no links").
 */

const defaultLogger = require('../../utils/logger');

const ITUNES_LOOKUP_URL = 'https://itunes.apple.com/lookup';
const ITUNES_COUNTRY = 'US';

// Exact barcode identity — high confidence, comfortably above the floor.
const ITUNES_UPC_CONFIDENCE = 0.97;

// The lookup's collectionViewUrl is a music.apple.com url with a `?uo=` tracking
// query; strip the query to store the clean canonical album url.
function cleanAppleUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function createItunesSource(deps = {}) {
  const fetchFn = deps.fetch || fetch;
  const logger = deps.logger || defaultLogger;
  const country = deps.country || ITUNES_COUNTRY;

  /**
   * @param {{upc?: string|null}} album
   * @returns {Promise<{links: Array<{service:string, url:string, confidence:number}>}>}
   */
  async function getLinks(album = {}) {
    const upc = album.upc && String(album.upc).trim();
    if (!upc) return { links: [] };

    try {
      const params = new URLSearchParams({
        upc,
        entity: 'album',
        country,
      });
      const resp = await fetchFn(`${ITUNES_LOOKUP_URL}?${params.toString()}`);
      if (!resp.ok) return { links: [] };

      const data = await resp.json();
      const results = (data && data.results) || [];
      const collection = results.find(
        (r) => r.wrapperType === 'collection' && r.collectionViewUrl
      );
      if (!collection) return { links: [] };

      return {
        links: [
          {
            service: 'itunes',
            url: cleanAppleUrl(collection.collectionViewUrl),
            confidence: ITUNES_UPC_CONFIDENCE,
          },
        ],
      };
    } catch (err) {
      logger.debug?.('iTunes UPC lookup failed', { upc, error: err.message });
      return { links: [] };
    }
  }

  return { getLinks };
}

module.exports = { createItunesSource, ITUNES_UPC_CONFIDENCE };
