/**
 * Normalization Utilities (Browser-side)
 *
 * Re-exports from the canonical server-side utils/normalization.js.
 * Use a relative import so browser modules remain testable in Node without
 * requiring Vite-only aliases.
 *
 * Only the functions needed by browser code are re-exported here.
 * Server-only functions (normalizeGenre, findArtistInMap) stay in utils/normalization.js.
 */
import * as normalization from '../../../utils/normalization.js';

export const {
  sanitizeForStorage,
  normalizeForLookup,
  normalizeForExternalApi,
  normalizeArtistName,
  normalizeAlbumName,
  normalizeForMatch,
  artistNamesMatch,
  albumNamesMatch,
  stringSimilarity,
} = normalization;
