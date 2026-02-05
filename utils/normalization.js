/**
 * Normalization Utilities
 *
 * Shared string normalization functions for matching artists, albums,
 * and genres across different data sources (Spotify, Last.fm, MusicBrainz, etc.)
 *
 * IMPORTANT: This is the single source of truth for normalization logic.
 * The browser-side module (src/js/modules/normalization.js) re-exports from
 * this file via a Vite alias, so changes here apply to both server and client.
 *
 * NOTE: Do NOT modify normalizeForComparison in utils/fuzzy-match.js -
 * it is used in production database migrations and must remain stable.
 *
 * NORMALIZATION LAYERS:
 * 1. sanitizeForStorage() - Light cleanup for database storage (preserves diacritics)
 * 2. normalizeForLookup() - For database unique constraints (lowercase + sanitize)
 * 3. normalizeForExternalApi() - For external API calls (strips diacritics)
 * 4. normalizeArtistName/normalizeAlbumName() - For internal fuzzy matching
 */

// ============================================
// Storage and Lookup Normalization
// ============================================

/**
 * Sanitize artist/album names for consistent storage.
 * Converts Unicode variants to ASCII equivalents for better cross-source matching.
 *
 * This is applied at storage time to ensure data from different sources
 * (Spotify, MusicBrainz, manual entry) uses consistent character encoding.
 *
 * NOTE: Diacritics are PRESERVED for display purposes (e.g., "Mötley Crüe" stays as-is)
 *
 * Examples:
 * - "…and Oceans" (ellipsis U+2026) → "...and Oceans" (three periods)
 * - "Mötley Crüe" → preserved (diacritics are intentional for display)
 * - "  Artist  " → "Artist" (trimmed whitespace)
 *
 * @param {string|null|undefined} value - Value to sanitize
 * @returns {string} - Sanitized value
 */
function sanitizeForStorage(value) {
  if (!value) return '';

  return (
    String(value)
      .trim()
      // Convert ellipsis (…) to three periods for consistent matching
      // e.g., "…and Oceans" → "...and Oceans"
      .replace(/…/g, '...')
      // Convert en-dash (–) and em-dash (—) to hyphen
      .replace(/[–—]/g, '-')
      // Normalize smart quotes to straight quotes
      // U+2018 ('), U+2019 ('), U+0060 (`) -> straight single quote
      .replace(/[\u2018\u2019`]/g, "'")
      // U+201C ("), U+201D (") -> straight double quote
      .replace(/[\u201c\u201d]/g, '"')
      // Normalize multiple spaces to single space
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Normalize artist and album names for canonical lookup
 * Used to find existing albums regardless of casing or whitespace
 *
 * @param {string|null|undefined} value - Value to normalize
 * @returns {string} - Normalized value (lowercase, trimmed, sanitized)
 */
function normalizeForLookup(value) {
  // First sanitize, then lowercase for lookup
  return sanitizeForStorage(value).toLowerCase();
}

/**
 * Normalize string for external API calls (Last.fm, Spotify search, iTunes, etc.)
 *
 * This function strips diacritics to improve matching with external services
 * that may not handle special characters consistently.
 *
 * Examples:
 * - "Exxûl" → "Exxul" (diacritics stripped)
 * - "Mötley Crüe" → "Motley Crue" (diacritics stripped)
 * - "…and Oceans" → "...and Oceans" (ellipsis normalized)
 *
 * @param {string|null|undefined} str - String to normalize
 * @returns {string} - Normalized string for external API use
 */
function normalizeForExternalApi(str) {
  if (!str) return '';

  return (
    String(str)
      // Convert ellipsis (…) to three periods
      .replace(/\u2026/g, '...')
      // Normalize smart quotes to straight quotes
      .replace(/[\u2018\u2019`]/g, "'")
      .replace(/[\u201c\u201d]/g, '"')
      // Convert en-dash (–) and em-dash (—) to hyphen
      .replace(/[–—]/g, '-')
      // Strip diacritics (é -> e, ü -> u, û -> u)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      .trim()
  );
}

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
  // Storage and lookup normalization
  sanitizeForStorage,
  normalizeForLookup,
  normalizeForExternalApi,

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
