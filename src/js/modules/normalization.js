/**
 * Normalization Utilities (Browser-side)
 *
 * Shared string normalization functions for matching artists, albums,
 * and genres across different data sources (Spotify, Last.fm, MusicBrainz, etc.)
 *
 * IMPORTANT: This module mirrors the server-side utils/normalization.js.
 * When modifying normalization logic, ensure consistency between
 * server and browser implementations.
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
export function sanitizeForStorage(value) {
  if (!value) return '';

  return (
    String(value)
      .trim()
      // Convert ellipsis (…) to three periods for consistent matching
      .replace(/…/g, '...')
      // Convert en-dash (–) and em-dash (—) to hyphen
      .replace(/[–—]/g, '-')
      // Normalize smart quotes to straight quotes
      .replace(/[\u2018\u2019`]/g, "'")
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
export function normalizeForLookup(value) {
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
export function normalizeForExternalApi(str) {
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
export function normalizeArtistName(name) {
  if (!name) return '';

  return (
    name
      .toLowerCase()
      .trim()
      // Convert ellipsis (…) to three periods for consistent matching
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
export function normalizeAlbumName(name) {
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
// Fuzzy Matching Normalization
// ============================================

/**
 * Normalize string for fuzzy matching (simplified version)
 * Used for cover art and general string comparison
 * @param {string} str - String to normalize
 * @returns {string} - Normalized string for comparison
 */
export function normalizeForMatch(str) {
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
export function artistNamesMatch(name1, name2) {
  return normalizeArtistName(name1) === normalizeArtistName(name2);
}

/**
 * Check if two album names match (after normalization)
 * @param {string} name1 - First album name
 * @param {string} name2 - Second album name
 * @returns {boolean} - True if names match
 */
export function albumNamesMatch(name1, name2) {
  return normalizeAlbumName(name1) === normalizeAlbumName(name2);
}

/**
 * Calculate similarity score between two strings (0-1)
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} - Similarity score between 0 and 1
 */
export function stringSimilarity(str1, str2) {
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
