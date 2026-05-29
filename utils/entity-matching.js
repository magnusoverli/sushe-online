/**
 * Entity Matching
 *
 * A small, reusable layer for matching artist/album/track names against
 * external music services (Last.fm, Spotify, MusicBrainz, iTunes, Deezer,
 * Qobuz, Tidal). It exists because every integration previously rolled its own
 * query building and result matching, and the string we *sent* to an API and
 * the string we *compared* results with followed different normalization rules
 * — which silently hid real matches (e.g. "Endarkenment Being And Death" vs
 * Last.fm's "Endarkenment, Being & Death", or "Caminhos de Água" stripped to
 * "Agua").
 *
 * Four primitives, all composed from the existing tested utilities in
 * normalization.js / fuzzy-match.js (nothing reinvented):
 *   - generateQueryForms : ordered query-string variants to try against an API
 *   - externalMatchKey   : one canonical key for exact cross-source comparison
 *   - nameSimilarity     : one fuzzy scorer (diacritic-insensitive, &/and-aware)
 *   - selectBestCandidate: generic scored best-of selection with thresholds
 */

const {
  sanitizeForStorage,
  normalizeForExternalApi,
  stripEditionSuffix,
} = require('./normalization');
const {
  normalizeForComparison,
  calculateSimilarity,
} = require('./fuzzy-match');

/**
 * Produce ampersand/"and" spelling variants of a string.
 * Sources frequently disagree ("Guns & Roses" vs "Guns and Roses"), so we try
 * both directions.
 * @param {string} s
 * @returns {string[]}
 */
function ampersandVariants(s) {
  const out = [s];
  if (/[&+]/.test(s)) {
    out.push(s.replace(/\s*[&+]\s*/g, ' and '));
  }
  if (/\band\b/i.test(s)) {
    out.push(s.replace(/\band\b/gi, '&'));
  }
  return out;
}

/**
 * Build an ordered, de-duplicated list of query strings to try against an
 * external API, most-canonical first:
 *   1. diacritic-PRESERVED form (services usually store the accented spelling)
 *   2. &/and spelling swaps of (1)
 *   3. diacritic-STRIPPED form + its swaps (the previous behavior, kept as a
 *      fallback so anything that relied on stripping still resolves)
 *   4. optional edition-stripped variants of all of the above
 *
 * Callers should try forms in order and stop at the first confident hit.
 *
 * @param {string} name
 * @param {{ stripEditions?: boolean }} [opts]
 * @returns {string[]}
 */
function generateQueryForms(name, opts = {}) {
  const { stripEditions = false } = opts;
  if (!name) return [];

  const forms = [];
  const add = (value) => {
    const trimmed = (value || '').replace(/\s+/g, ' ').trim();
    if (trimmed && !forms.includes(trimmed)) forms.push(trimmed);
  };

  // Diacritics preserved (ellipsis/dashes/smart quotes still normalized).
  const preserved = sanitizeForStorage(name);
  // Diacritics stripped (the historical query form).
  const stripped = normalizeForExternalApi(name);

  for (const variant of ampersandVariants(preserved)) add(variant);
  for (const variant of ampersandVariants(stripped)) add(variant);

  if (stripEditions) {
    for (const form of [...forms]) add(stripEditionSuffix(form));
  }

  return forms;
}

/**
 * Canonical key for EXACT cross-source comparison. Diacritics removed, `&`/`+`
 * treated as "and" (before punctuation is stripped), other punctuation removed,
 * lowercased, whitespace collapsed. Articles and edition suffixes are NOT
 * removed here (that is the variant logic's job), keeping this a conservative
 * exact-equality key.
 *
 * Implemented by composing the two frozen normalizers, so it stays consistent
 * with dedup/migration behavior without duplicating their rules.
 *
 * @param {string} name
 * @returns {string}
 */
function externalMatchKey(name) {
  return normalizeForComparison(normalizeForExternalApi(name), {
    removeArticles: false,
    stripEditions: false,
  });
}

/**
 * Fuzzy similarity (0..1) between two names, diacritic-insensitive and
 * &/and-aware. Reuses the Levenshtein+Jaccard scorer; both sides are
 * diacritic-stripped first so an accented name matches its ASCII spelling.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function nameSimilarity(a, b) {
  if (!a || !b) return 0;
  return calculateSimilarity(
    normalizeForExternalApi(a),
    normalizeForExternalApi(b)
  ).score;
}

/**
 * Generic "pick the best matching candidate" with confidence thresholds.
 * Generalizes the per-integration scorers (e.g. Spotify's
 * pickBestSpotifyAlbumCandidate) so every integration can replace
 * take-first-result with scored selection — and fall back to first result when
 * nothing is confident.
 *
 * @param {Object} params
 * @param {{ artist?: string, album?: string }} params.target
 * @param {Array} params.candidates
 * @param {(c:any)=>string} [params.getArtist]
 * @param {(c:any)=>string} [params.getAlbum]
 * @param {(c:any)=>number} [params.bonus] - extra score added to combined (e.g. year match)
 * @param {Object} [params.thresholds]
 * @returns {{ best: Object|null, isConfident: boolean, scores: Array }}
 */
function selectBestCandidate({
  target,
  candidates,
  getArtist = (c) => c?.artist || '',
  getAlbum = (c) => c?.album || c?.name || '',
  bonus,
  thresholds = {},
}) {
  const {
    minAlbum = 0.62,
    minCombined = 0.72,
    minArtist = 0.7,
    albumWeight = 0.7,
    artistWeight = 0.3,
    strongAlbum = 0.9,
    strongAlbumArtistFloor = 0.35,
  } = thresholds;

  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { best: null, isConfident: false, scores: [] };
  }

  const hasArtist = !!target?.artist;
  const hasAlbum = !!target?.album;

  const scores = candidates
    .map((candidate) => {
      const albumScore = hasAlbum
        ? nameSimilarity(target.album, getAlbum(candidate))
        : 0;
      const artistScore = hasArtist
        ? nameSimilarity(target.artist, getArtist(candidate))
        : 0;
      const combined =
        (hasAlbum ? albumScore * albumWeight : 0) +
        (hasArtist ? artistScore * artistWeight : 0) +
        (bonus ? bonus(candidate) : 0);
      return { candidate, albumScore, artistScore, combined };
    })
    .sort((a, b) => b.combined - a.combined);

  const best = scores[0];
  let isConfident;
  if (hasAlbum && hasArtist) {
    isConfident =
      (best.albumScore >= minAlbum && best.combined >= minCombined) ||
      (best.albumScore >= strongAlbum &&
        best.artistScore >= strongAlbumArtistFloor);
  } else if (hasAlbum) {
    isConfident = best.albumScore >= minAlbum;
  } else if (hasArtist) {
    isConfident = best.artistScore >= minArtist;
  } else {
    isConfident = false;
  }

  return { best, isConfident, scores };
}

module.exports = {
  generateQueryForms,
  externalMatchKey,
  nameSimilarity,
  selectBestCandidate,
};
