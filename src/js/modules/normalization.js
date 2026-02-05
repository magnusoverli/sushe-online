/**
 * Normalization Utilities (Browser-side)
 *
 * Re-exports from the canonical server-side utils/normalization.js.
 * Vite converts the CJS module to ESM during bundling via the @utils alias.
 *
 * Only the functions needed by browser code are re-exported here.
 * Server-only functions (normalizeGenre, findArtistInMap) stay in utils/normalization.js.
 */
import * as normalization from '@utils/normalization.js';

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
