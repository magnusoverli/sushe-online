/**
 * Fuzzy Matching Utilities for Album Deduplication
 *
 * Provides intelligent matching for album/artist names to detect potential duplicates.
 * Uses multiple strategies:
 * - Levenshtein distance for typo detection
 * - Token-based matching for word reordering
 * - Normalization for punctuation, articles, edition suffixes
 *
 * Threshold Configuration:
 * - AUTO_MERGE_THRESHOLD (0.98): Albums with >=98% confidence are auto-merged silently
 * - MODAL_THRESHOLD (0.10): Albums with 10-97% confidence trigger manual review modal
 * - Below 10%: Treated as distinct albums, no modal shown
 *
 * Follows dependency injection pattern for testability.
 */

/**
 * Threshold constants for album matching behavior
 */
const AUTO_MERGE_THRESHOLD = 0.98; // >= 98% confidence: auto-merge silently
const MODAL_THRESHOLD = 0.1; // >= 10% confidence: show manual review modal

/**
 * Calculate Levenshtein distance between two strings
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} - Edit distance
 */
function levenshteinDistance(a, b) {
  if (!a || !b) return Math.max((a || '').length, (b || '').length);

  const matrix = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity ratio (0-1) based on Levenshtein distance
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} - Similarity ratio (1 = identical, 0 = completely different)
 */
function similarityRatio(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;

  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;

  const distance = levenshteinDistance(a, b);
  return 1 - distance / maxLen;
}

const { EDITION_PATTERNS } = require('./normalization');

/**
 * Common words/suffixes to strip for comparison
 * Applied BEFORE punctuation removal.
 *
 * Extends the shared EDITION_PATTERNS with disc indicators and EP/LP patterns.
 */
const STRIP_PATTERNS = [
  ...EDITION_PATTERNS,
  // Disc indicators
  /\s*\(\s*disc\s*\d+\s*\)$/i,
  /\s*\[\s*disc\s*\d+\s*\]$/i,
  /\s*[-:]\s*cd\s*\d+$/i,
  // EP/LP indicators
  /\s*\(\s*(e\.?p\.?|l\.?p\.?|single)\s*\)$/i,
];

/**
 * Articles and common prefixes to normalize
 */
const ARTICLES = [
  'the',
  'a',
  'an',
  'el',
  'la',
  'le',
  'les',
  'der',
  'die',
  'das',
];

/**
 * Normalize a string for fuzzy comparison
 * - Lowercase
 * - Remove punctuation except alphanumeric and spaces
 * - Strip edition suffixes
 * - Normalize whitespace
 * - Optionally remove leading articles
 *
 * @param {string} str - String to normalize
 * @param {Object} options - Normalization options
 * @param {boolean} options.removeArticles - Remove leading articles (default: true)
 * @param {boolean} options.stripEditions - Strip edition suffixes (default: true)
 * @returns {string} - Normalized string
 */
function normalizeForComparison(str, options = {}) {
  const { removeArticles = true, stripEditions = true } = options;

  if (!str) return '';

  let result = str.toLowerCase().trim();

  // Strip edition suffixes BEFORE removing punctuation
  // (so parentheses are still present for matching)
  if (stripEditions) {
    for (const pattern of STRIP_PATTERNS) {
      result = result.replace(pattern, '');
    }
    result = result.trim();
  }

  // Remove punctuation (keep alphanumeric, spaces, and common chars)
  result = result
    .replace(/[''´`]/g, '') // Remove apostrophes and similar
    .replace(/[&+]/g, ' and ') // Replace & and + with 'and'
    .replace(/[/\\]/g, '') // Remove slashes (AC/DC -> ACDC)
    .replace(/[^\w\s]/g, ' ') // Remove other punctuation
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();

  // Remove leading articles
  if (removeArticles) {
    const words = result.split(' ');
    if (words.length > 1 && ARTICLES.includes(words[0])) {
      result = words.slice(1).join(' ');
    }
  }

  return result;
}

/**
 * Get tokens (words) from a string for token-based matching
 * @param {string} str - String to tokenize
 * @returns {Set<string>} - Set of tokens
 */
function getTokens(str) {
  const normalized = normalizeForComparison(str);
  return new Set(normalized.split(' ').filter((t) => t.length > 0));
}

/**
 * Calculate Jaccard similarity between two sets of tokens
 * @param {Set<string>} a - First token set
 * @param {Set<string>} b - Second token set
 * @returns {number} - Jaccard similarity (0-1)
 */
function jaccardSimilarity(a, b) {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;

  const intersection = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);

  return intersection.size / union.size;
}

/**
 * Check if strings match exactly after normalization
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {boolean} - True if exact match after normalization
 */
function isExactMatch(a, b) {
  return normalizeForComparison(a) === normalizeForComparison(b);
}

/**
 * Calculate overall similarity score between two album names
 * Combines multiple matching strategies
 *
 * @param {string} a - First album/artist name
 * @param {string} b - Second album/artist name
 * @returns {Object} - { score: number (0-1), reason: string }
 */
function calculateSimilarity(a, b) {
  if (!a || !b) {
    return { score: 0, reason: 'empty_input' };
  }

  const normA = normalizeForComparison(a);
  const normB = normalizeForComparison(b);

  // Exact match after normalization
  if (normA === normB) {
    return { score: 1.0, reason: 'exact_normalized' };
  }

  // Levenshtein-based similarity
  const levenshteinScore = similarityRatio(normA, normB);

  // Token-based (Jaccard) similarity
  const tokensA = getTokens(a);
  const tokensB = getTokens(b);
  const jaccardScore = jaccardSimilarity(tokensA, tokensB);

  // Combined score (weighted average)
  // For single-word strings, Jaccard is useless (tokens must match exactly)
  // So we weight Levenshtein more heavily for short strings
  const minTokens = Math.min(tokensA.size, tokensB.size);
  let combinedScore;

  if (minTokens <= 1) {
    // Single word: rely almost entirely on Levenshtein (typo detection)
    combinedScore = levenshteinScore * 0.95 + jaccardScore * 0.05;
  } else if (minTokens <= 2) {
    // Two words: balance between both
    combinedScore = levenshteinScore * 0.7 + jaccardScore * 0.3;
  } else {
    // Multi-word: Jaccard becomes more useful for word reordering
    combinedScore = levenshteinScore * 0.6 + jaccardScore * 0.4;
  }

  // Determine the primary reason for the match
  let reason = 'fuzzy_match';
  if (levenshteinScore > 0.9) {
    reason = 'very_similar_spelling';
  } else if (jaccardScore > 0.8) {
    reason = 'same_words_reordered';
  } else if (levenshteinScore > 0.7) {
    reason = 'similar_spelling';
  } else if (jaccardScore > 0.6) {
    reason = 'partial_word_match';
  }

  return { score: combinedScore, reason };
}

/**
 * Check if two albums are potentially the same
 * Considers both artist and album name
 *
 * @param {Object} album1 - First album { artist, album }
 * @param {Object} album2 - Second album { artist, album }
 * @param {Object} options - Matching options
 * @param {number} options.threshold - Minimum combined score to consider a match (default: MODAL_THRESHOLD)
 * @param {number} options.autoMergeThreshold - Confidence above which to auto-merge (default: AUTO_MERGE_THRESHOLD)
 * @param {number} options.artistMinScore - Minimum artist similarity score (default: derived from threshold)
 * @param {number} options.albumMinScore - Minimum album similarity score (default: derived from threshold)
 * @returns {Object} - { isPotentialMatch, shouldAutoMerge, confidence, artistScore, albumScore }
 */
function isPotentialDuplicate(album1, album2, options = {}) {
  // Support legacy call signature: isPotentialDuplicate(a, b, 0.2)
  const opts =
    typeof options === 'number'
      ? { threshold: options }
      : {
          threshold: MODAL_THRESHOLD,
          autoMergeThreshold: AUTO_MERGE_THRESHOLD,
          ...options,
        };

  const { threshold, autoMergeThreshold = AUTO_MERGE_THRESHOLD } = opts;

  // Derive minimum individual scores from threshold if not explicitly provided
  // Lower threshold = lower minimum scores = more aggressive matching
  const artistMinScore =
    opts.artistMinScore !== undefined
      ? opts.artistMinScore
      : deriveMinScoreFromThreshold(threshold);
  const albumMinScore =
    opts.albumMinScore !== undefined
      ? opts.albumMinScore
      : deriveMinScoreFromThreshold(threshold);

  const artistScore = calculateSimilarity(album1.artist, album2.artist);
  const albumScore = calculateSimilarity(album1.album, album2.album);

  // Both artist and album must be similar
  // Artist similarity is weighted slightly less (bands can have similar names)
  const combinedConfidence = artistScore.score * 0.4 + albumScore.score * 0.6;

  // For a potential match:
  // - Album name must meet minimum similarity
  // - Artist name must meet minimum similarity
  // - Combined score must meet threshold
  const isPotentialMatch =
    albumScore.score >= albumMinScore &&
    artistScore.score >= artistMinScore &&
    combinedConfidence >= threshold;

  // Auto-merge: confidence >= 98% means this is almost certainly the same album
  const shouldAutoMerge =
    isPotentialMatch && combinedConfidence >= autoMergeThreshold;

  return {
    isPotentialMatch,
    shouldAutoMerge,
    confidence: combinedConfidence,
    artistScore,
    albumScore,
  };
}

/**
 * Derive minimum individual scores from combined threshold
 * Lower threshold = more aggressive matching = lower minimum scores
 *
 * @param {number} threshold - Combined threshold (0-1)
 * @returns {number} - Minimum individual score (0-1)
 */
function deriveMinScoreFromThreshold(threshold) {
  // Map threshold ranges to minimum scores
  if (threshold <= 0.05) return 0.25; // Very High+ (extremely aggressive)
  if (threshold <= 0.15) return 0.35; // High (moderately aggressive)
  if (threshold <= 0.3) return 0.45; // Medium (balanced)
  return 0.5; // Low/default (conservative)
}

/**
 * Find potential duplicate albums from a list of candidates
 *
 * @param {Object} newAlbum - Album to check { artist, album }
 * @param {Array<Object>} candidates - List of existing albums to check against
 * @param {Object} options - Options
 * @param {number} options.threshold - Minimum confidence to include (default: MODAL_THRESHOLD)
 * @param {number} options.autoMergeThreshold - Confidence above which to auto-merge (default: AUTO_MERGE_THRESHOLD)
 * @param {number} options.artistMinScore - Minimum artist similarity score (default: derived from threshold)
 * @param {number} options.albumMinScore - Minimum album similarity score (default: derived from threshold)
 * @param {number} options.maxResults - Maximum results to return (default: 5)
 * @param {Set<string>} options.excludePairs - Set of "id1::id2" pairs to exclude (already confirmed different)
 * @returns {Array<Object>} - Sorted array of potential matches with confidence scores and shouldAutoMerge flags
 */
function findPotentialDuplicates(newAlbum, candidates, options = {}) {
  const {
    threshold = MODAL_THRESHOLD,
    autoMergeThreshold = AUTO_MERGE_THRESHOLD,
    artistMinScore,
    albumMinScore,
    maxResults = 5,
    excludePairs = new Set(),
  } = options;

  const results = [];

  for (const candidate of candidates) {
    // Skip if this pair was already confirmed as different
    if (candidate.album_id && newAlbum.album_id) {
      const pairKey1 = `${newAlbum.album_id}::${candidate.album_id}`;
      const pairKey2 = `${candidate.album_id}::${newAlbum.album_id}`;
      if (excludePairs.has(pairKey1) || excludePairs.has(pairKey2)) {
        continue;
      }
    }

    const result = isPotentialDuplicate(newAlbum, candidate, {
      threshold,
      autoMergeThreshold,
      artistMinScore,
      albumMinScore,
    });

    if (result.isPotentialMatch) {
      results.push({
        candidate,
        ...result,
      });
    }
  }

  // Sort by confidence (highest first) and limit results
  return results
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxResults);
}

/**
 * Create a normalized album key for duplicate detection
 * Consolidated from aggregate-list.js and aggregate-audit.js
 * @param {string|null|undefined} artist - Artist name
 * @param {string|null|undefined} album - Album name
 * @returns {string} Normalized key in format "artist::album"
 */
function normalizeAlbumKey(artist, album) {
  const normalizedArtist = normalizeForComparison(String(artist || ''));
  const normalizedAlbum = normalizeForComparison(String(album || ''));
  return `${normalizedArtist}::${normalizedAlbum}`;
}

module.exports = {
  // Core functions
  levenshteinDistance,
  similarityRatio,
  normalizeForComparison,
  getTokens,
  jaccardSimilarity,
  calculateSimilarity,
  isPotentialDuplicate,
  findPotentialDuplicates,
  isExactMatch,
  normalizeAlbumKey,
  deriveMinScoreFromThreshold,

  // Constants (for testing)
  STRIP_PATTERNS,
  ARTICLES,

  // Threshold constants
  AUTO_MERGE_THRESHOLD,
  MODAL_THRESHOLD,
};
