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
// Shared Character Normalization
// ============================================

/**
 * Normalize common Unicode special characters to ASCII equivalents.
 * Handles ellipsis, dashes, and smart quotes.
 *
 * @param {string} str - String to normalize (must already be a String)
 * @returns {string} - String with special characters replaced
 */
function normalizeSpecialChars(str) {
  return (
    str
      // Convert ellipsis (…) to three periods
      .replace(/…/g, '...')
      // Convert en-dash (–) and em-dash (—) to hyphen
      .replace(/[–—]/g, '-')
      // Normalize smart quotes to straight quotes
      .replace(/[\u2018\u2019`]/g, "'")
      .replace(/[\u201c\u201d]/g, '"')
  );
}

/**
 * Non-decomposable Latin letters \u2192 ASCII transliteration.
 *
 * NFD-based diacritic stripping only handles precomposed accents (\u00e1\u2192a, \u00fc\u2192u).
 * It does NOT touch distinct letters that have no canonical decomposition
 * (\u00f8, \u00e6, \u00e5, \u00f0, \u00fe, \u00df, \u0142, \u2026). Those slip through unchanged, so an external query
 * or match key for "Blod\u00f8rn" / "Det hjems\u00f8kte hjertet" never bridges to the
 * ASCII "Blodorn" / "hjemsokte" that other sources (and slug-folded data) use.
 * This map folds them explicitly (standard unidecode-style transliterations).
 */
const SPECIAL_LETTER_MAP = {
  '\u00f8': 'o', // \u00f8
  '\u00d8': 'O', // \u00d8
  '\u00e6': 'ae', // \u00e6
  '\u00c6': 'Ae', // \u00c6
  '\u00e5': 'a', // \u00e5
  '\u00c5': 'A', // \u00c5
  '\u0153': 'oe', // \u0153
  '\u0152': 'Oe', // \u0152
  '\u00f0': 'd', // \u00f0
  '\u00d0': 'D', // \u00d0
  '\u00fe': 'th', // \u00fe
  '\u00de': 'Th', // \u00de
  '\u00df': 'ss', // \u00df
  '\u0142': 'l', // \u0142
  '\u0141': 'L', // \u0141
  '\u0111': 'd', // \u0111
  '\u0110': 'D', // \u0110
  '\u0167': 't', // \u0167
  '\u0166': 'T', // \u0166
  '\u0131': 'i', // \u0131 (dotless i)
  '\u0130': 'I', // \u0130
};

const SPECIAL_LETTER_RE = new RegExp(
  `[${Object.keys(SPECIAL_LETTER_MAP).join('')}]`,
  'g'
);

/**
 * Fold non-decomposable special Latin letters to ASCII (\u00f8\u2192o, \u00e6\u2192ae, \u2026),
 * preserving case where it maps cleanly.
 * @param {string} str
 * @returns {string}
 */
function transliterateSpecialLetters(str) {
  return str.replace(SPECIAL_LETTER_RE, (ch) => SPECIAL_LETTER_MAP[ch]);
}

/**
 * Cyrillic + Greek → Latin transliteration (best-effort, deterministic).
 *
 * External services (Spotify, iTunes, Deezer) index these under a romanized
 * form, so a native-script query returns nothing. Romanizing gives us a query
 * fallback AND — crucially — a non-empty match key: without it, the comparison
 * layer strips non-Latin to nothing (its punctuation rule is ASCII-only), so
 * EVERY Cyrillic name collapses to "" and any two are scored as identical.
 *
 * Applied AFTER NFD-stripping, so precomposed letters (ё, й, ї, accented Greek)
 * have already decomposed to their base form. Best-effort: it won't always
 * match a service's exact romanization, but it's deterministic and distinct per
 * name (fixing the false-equality bug) and close enough for fuzzy search.
 *
 * Scripts without a simple letter mapping (CJK, etc.) are NOT handled here —
 * those would need a dictionary-based library and are out of scope.
 */
const SCRIPT_MAP = {
  // Cyrillic (Russian + common Ukrainian/Serbian), lowercase
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  ё: 'e',
  і: 'i',
  ї: 'yi',
  є: 'ye',
  ґ: 'g',
  ј: 'j',
  ђ: 'dj',
  ћ: 'c',
  // Cyrillic, uppercase
  А: 'A',
  Б: 'B',
  В: 'V',
  Г: 'G',
  Д: 'D',
  Е: 'E',
  Ж: 'Zh',
  З: 'Z',
  И: 'I',
  Й: 'Y',
  К: 'K',
  Л: 'L',
  М: 'M',
  Н: 'N',
  О: 'O',
  П: 'P',
  Р: 'R',
  С: 'S',
  Т: 'T',
  У: 'U',
  Ф: 'F',
  Х: 'Kh',
  Ц: 'Ts',
  Ч: 'Ch',
  Ш: 'Sh',
  Щ: 'Shch',
  Ъ: '',
  Ы: 'Y',
  Ь: '',
  Э: 'E',
  Ю: 'Yu',
  Я: 'Ya',
  Ё: 'E',
  І: 'I',
  Ї: 'Yi',
  Є: 'Ye',
  Ґ: 'G',
  Ј: 'J',
  Ђ: 'Dj',
  Ћ: 'C',
  // Greek, lowercase
  α: 'a',
  β: 'v',
  γ: 'g',
  δ: 'd',
  ε: 'e',
  ζ: 'z',
  η: 'i',
  θ: 'th',
  ι: 'i',
  κ: 'k',
  λ: 'l',
  μ: 'm',
  ν: 'n',
  ξ: 'x',
  ο: 'o',
  π: 'p',
  ρ: 'r',
  σ: 's',
  ς: 's',
  τ: 't',
  υ: 'y',
  φ: 'f',
  χ: 'ch',
  ψ: 'ps',
  ω: 'o',
  // Greek, uppercase
  Α: 'A',
  Β: 'V',
  Γ: 'G',
  Δ: 'D',
  Ε: 'E',
  Ζ: 'Z',
  Η: 'I',
  Θ: 'Th',
  Ι: 'I',
  Κ: 'K',
  Λ: 'L',
  Μ: 'M',
  Ν: 'N',
  Ξ: 'X',
  Ο: 'O',
  Π: 'P',
  Ρ: 'R',
  Σ: 'S',
  Τ: 'T',
  Υ: 'Y',
  Φ: 'F',
  Χ: 'Ch',
  Ψ: 'Ps',
  Ω: 'O',
};

const SCRIPT_RE = new RegExp(`[${Object.keys(SCRIPT_MAP).join('')}]`, 'g');

/**
 * Transliterate Cyrillic/Greek to Latin. See SCRIPT_MAP.
 * @param {string} str
 * @returns {string}
 */
function transliterateScripts(str) {
  return str.replace(SCRIPT_RE, (ch) => SCRIPT_MAP[ch]);
}

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

  return normalizeSpecialChars(String(value).trim())
    .replace(/\s+/g, ' ')
    .trim();
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
 * This function strips diacritics AND folds non-decomposable special Latin
 * letters (ø, æ, å, ð, þ, ß, ł, …) to improve matching with external services
 * that may not handle special characters consistently.
 *
 * Examples:
 * - "Exxûl" → "Exxul" (diacritics stripped)
 * - "Mötley Crüe" → "Motley Crue" (diacritics stripped)
 * - "Det hjemsøkte hjertet" → "Det hjemsokte hjertet" (ø folded)
 * - "Kjærlighet" → "Kjaerlighet" (æ folded)
 * - "…and Oceans" → "...and Oceans" (ellipsis normalized)
 *
 * @param {string|null|undefined} str - String to normalize
 * @returns {string} - Normalized string for external API use
 */
function normalizeForExternalApi(str) {
  if (!str) return '';

  // Strip combining marks first (so precomposed accents AND precomposed
  // Cyrillic/Greek decompose to base letters), THEN transliterate the remaining
  // non-ASCII letters (special Latin + Cyrillic/Greek) to ASCII.
  const stripped = normalizeSpecialChars(String(str))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return transliterateScripts(transliterateSpecialLetters(stripped))
    .replace(/\s+/g, ' ')
    .trim();
}

// ============================================
// Name Normalization (Artist + Album)
// ============================================

/**
 * Shared base normalization for cross-source matching of names.
 * Used by both normalizeArtistName and normalizeAlbumName (which are identical).
 *
 * Steps: lowercase, normalize special chars, strip diacritics,
 * remove "the " prefix, parenthetical/bracket suffixes, and punctuation.
 *
 * @param {string} name - Name to normalize
 * @returns {string} - Normalized name
 */
function normalizeNameForMatching(name) {
  if (!name) return '';

  return normalizeSpecialChars(name.toLowerCase().trim())
    .replace(/^the\s+/, '')
    .replace(/\s*\([^)]*\)\s*/g, '')
    .replace(/\s*\[[^\]]*\]\s*/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.,!?;:]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize artist name for cross-source matching
 * Handles common variations in artist names across Spotify, Last.fm, and internal data
 * @param {string} name - Artist name to normalize
 * @returns {string} - Normalized name (lowercase, stripped of common variations)
 */
function normalizeArtistName(name) {
  return normalizeNameForMatching(name);
}

/**
 * Normalize album name for cross-source matching
 * Handles common variations in album titles across sources
 * @param {string} name - Album name to normalize
 * @returns {string} - Normalized name
 */
function normalizeAlbumName(name) {
  return normalizeNameForMatching(name);
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

// ============================================
// Edition Suffix Patterns
// ============================================

/**
 * Common edition/remaster suffix patterns for stripping from album names.
 * Shared between lastfm-auth.js (playcount matching) and fuzzy-match.js (deduplication).
 *
 * NOTE: fuzzy-match.js extends this with additional patterns (disc indicators, EP/LP).
 */
const EDITION_PATTERNS = [
  /\s*\(\s*(deluxe|special|expanded|remastered|remaster|anniversary|limited|collector'?s?|bonus\s*track)\s*(edition|version|release)?\s*\)$/i,
  /\s*\[\s*(deluxe|special|expanded|remastered|remaster|anniversary|limited|collector'?s?|bonus\s*track)\s*(edition|version|release)?\s*\]$/i,
  /\s*[-:]\s*(deluxe|special|expanded|remastered|remaster|anniversary|limited)\s*(edition|version|release)?$/i,
  /\s*\(\s*\d{4}\s*(remaster|reissue|edition)?\s*\)$/i,
];

/**
 * Strip edition suffixes from an album name.
 * e.g., "Album (Deluxe Edition)" -> "Album"
 *
 * @param {string} str - Album name
 * @returns {string} - Album name with edition suffix removed
 */
function stripEditionSuffix(str) {
  let result = str;
  for (const pattern of EDITION_PATTERNS) {
    result = result.replace(pattern, '');
  }
  return result.trim();
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

  // Edition suffix handling
  EDITION_PATTERNS,
  stripEditionSuffix,
};
