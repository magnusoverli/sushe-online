/**
 * Playcount Cache Key
 *
 * Single source of truth for the canonical Last.fm playcount cache key.
 *
 * The key is composed the SAME way on every path — list-view read, scrobble
 * lookup, and the sync/write path — so accented or punctuation-heavy names
 * (e.g. "Sigur Rós", "…and Oceans") are stored and looked up under one key.
 * Previously this composition was hand-assembled in several places and drifted,
 * which made playcounts silently fail to match. Keep it here, import it there.
 *
 * `normalizeForExternalApi` strips diacritics and normalizes punctuation;
 * `normalizeAlbumKey` (from utils/fuzzy-match) applies article/edition handling
 * and joins artist + album. normalizeAlbumKey is injected rather than imported
 * so callers can substitute a test double.
 */

const { normalizeForExternalApi } = require('./normalization');

/**
 * Build the canonical artist+album cache key.
 *
 * @param {Function} normalizeAlbumKey - normalizeAlbumKey(artist, album) => string
 * @param {string} artist
 * @param {string} album
 * @returns {string}
 */
function canonicalAlbumKey(normalizeAlbumKey, artist, album) {
  return normalizeAlbumKey(
    normalizeForExternalApi(artist).toLowerCase().trim(),
    normalizeForExternalApi(album).toLowerCase().trim()
  );
}

module.exports = { canonicalAlbumKey };
