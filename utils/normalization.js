/**
 * Normalization Utilities
 *
 * Shared string normalization functions for matching artists, albums,
 * and genres across different data sources (Spotify, Last.fm, MusicBrainz, etc.)
 *
 * IMPORTANT: These functions are used both server-side and have browser-side
 * equivalents in src/js/musicbrainz.js. When modifying normalization logic,
 * ensure consistency between server and browser implementations.
 *
 * NOTE: Do NOT modify normalizeForComparison in utils/fuzzy-match.js -
 * it is used in production database migrations and must remain stable.
 */

// ============================================
// Artist Name Normalization
// ============================================

/**
 * Normalize artist name for cross-source matching
 * Handles common variations in artist names across Spotify, Last.fm, and internal data
 * @param {string} name - Artist name to normalize
 * @returns {string} - Normalized name (lowercase, stripped of common variations)
 */
function normalizeArtistName(name) {
  if (!name) return '';

  return (
    name
      .toLowerCase()
      .trim()
      // Convert ellipsis (…) to three periods for consistent matching
      // e.g., "…and Oceans" -> "...and Oceans"
      .replace(/…/g, '...')
      // Remove "the " prefix (e.g., "The Beatles" -> "beatles")
      .replace(/^the\s+/, '')
      // Remove common suffixes like "(band)", "[US]", etc.
      .replace(/\s*\([^)]*\)\s*/g, '')
      .replace(/\s*\[[^\]]*\]\s*/g, '')
      // Normalize special characters
      .replace(/[''`]/g, "'")
      .replace(/[""]/g, '"')
      // Remove diacritics (é -> e, ü -> u)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      // Remove punctuation except essential ones
      .replace(/[.,!?;:]/g, '')
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      .trim()
  );
}

// ============================================
// Album Name Normalization
// ============================================

/**
 * Normalize album name for cross-source matching
 * Handles common variations in album titles across sources
 * @param {string} name - Album name to normalize
 * @returns {string} - Normalized name
 */
function normalizeAlbumName(name) {
  if (!name) return '';

  return (
    name
      .toLowerCase()
      .trim()
      // Convert ellipsis (…) to three periods for consistent matching
      .replace(/…/g, '...')
      // Remove "the " prefix for consistency across sources
      .replace(/^the\s+/, '')
      // Remove common suffixes like "(Deluxe Edition)", "[Remaster]", etc.
      .replace(/\s*\([^)]*\)\s*/g, '')
      .replace(/\s*\[[^\]]*\]\s*/g, '')
      // Normalize special characters
      .replace(/[''`]/g, "'")
      .replace(/[""]/g, '"')
      // Remove diacritics (é -> e, ü -> u)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      // Remove punctuation except essential ones
      .replace(/[.,!?;:]/g, '')
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      .trim()
  );
}

// ============================================
// Genre Normalization
// ============================================

/**
 * Normalize genre/tag name for matching
 * @param {string} genre - Genre/tag name
 * @returns {string} - Normalized genre
 */
function normalizeGenre(genre) {
  if (!genre) return '';

  return (
    genre
      .toLowerCase()
      .trim()
      // Normalize hyphens and spaces
      .replace(/[-_]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

// ============================================
// Fuzzy Matching Normalization
// ============================================

/**
 * Normalize string for fuzzy matching (simplified version)
 * Used for cover art and general string comparison
 * @param {string} str - String to normalize
 * @returns {string} - Normalized string for comparison
 */
function normalizeForMatch(str) {
  if (!str) return '';

  return (
    str
      .toLowerCase()
      // Remove special characters except spaces
      .replace(/[^\w\s]/g, '')
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      .trim()
  );
}

// ============================================
// Matching Helpers
// ============================================

/**
 * Check if two artist names match (after normalization)
 * @param {string} name1 - First artist name
 * @param {string} name2 - Second artist name
 * @returns {boolean} - True if names match
 */
function artistNamesMatch(name1, name2) {
  return normalizeArtistName(name1) === normalizeArtistName(name2);
}

/**
 * Check if two album names match (after normalization)
 * @param {string} name1 - First album name
 * @param {string} name2 - Second album name
 * @returns {boolean} - True if names match
 */
function albumNamesMatch(name1, name2) {
  return normalizeAlbumName(name1) === normalizeAlbumName(name2);
}

/**
 * Find matching artist in a map by normalized name
 * @param {Map} map - Map with normalized keys
 * @param {string} artistName - Artist name to look up
 * @returns {*} - Value from map or undefined
 */
function findArtistInMap(map, artistName) {
  return map.get(normalizeArtistName(artistName));
}

/**
 * Calculate similarity score between two strings (0-1)
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} - Similarity score between 0 and 1
 */
function stringSimilarity(str1, str2) {
  const s1 = normalizeForMatch(str1);
  const s2 = normalizeForMatch(str2);

  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  // Check if one contains the other
  if (s1.includes(s2) || s2.includes(s1)) return 0.9;

  // Simple word overlap scoring
  const words1 = s1.split(' ');
  const words2 = s2.split(' ');
  const commonWords = words1.filter((w) => words2.includes(w));

  return commonWords.length / Math.max(words1.length, words2.length);
}

module.exports = {
  // Core normalization functions
  normalizeArtistName,
  normalizeAlbumName,
  normalizeGenre,
  normalizeForMatch,

  // Matching helpers
  artistNamesMatch,
  albumNamesMatch,
  findArtistInMap,
  stringSimilarity,
};
