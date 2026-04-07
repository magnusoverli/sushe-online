/**
 * Qobuz Service
 *
 * Lightweight catalog lookup for Qobuz deep-linking.
 * Resolves album IDs from public Qobuz web search results
 * so the app can open qobuzapp:// links with web fallback.
 */

const {
  normalizeForExternalApi,
  stringSimilarity,
} = require('../utils/normalization');

const DEFAULT_STOREFRONT = 'us-en';

function decodeHtmlEntities(input) {
  if (!input) return '';

  return String(input)
    .replace(/&#(\d+);/g, (_m, codePoint) =>
      String.fromCodePoint(parseInt(codePoint, 10))
    )
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function normalizeSlugText(slug) {
  const decoded = decodeHtmlEntities(slug).replace(/-/g, ' ');
  return normalizeForExternalApi(decoded).toLowerCase();
}

function extractAlbumCandidates(html, storefront) {
  const escapedStorefront = storefront.replace('-', '\\-');
  const pattern = new RegExp(
    `href="\\/${escapedStorefront}\\/album\\/([^"\\/]+)\\/([A-Za-z0-9]+)"`,
    'g'
  );

  const seenIds = new Set();
  const candidates = [];
  let match;

  while ((match = pattern.exec(html)) !== null) {
    const slug = match[1];
    const id = match[2];
    if (!slug || !id || seenIds.has(id)) continue;
    seenIds.add(id);
    candidates.push({ id, slug });
  }

  return candidates;
}

function pickBestCandidate(candidates, artist, album) {
  if (!candidates.length) return null;

  const normalizedArtist = normalizeForExternalApi(artist).toLowerCase();
  const normalizedAlbum = normalizeForExternalApi(album).toLowerCase();
  const targetCombined = `${normalizedAlbum} ${normalizedArtist}`.trim();

  const scored = candidates
    .map((candidate) => {
      const slugText = normalizeSlugText(candidate.slug);
      const albumScore = stringSimilarity(normalizedAlbum, slugText);
      const artistScore = stringSimilarity(normalizedArtist, slugText);
      const combinedScore = stringSimilarity(targetCombined, slugText);

      return {
        ...candidate,
        score: combinedScore * 0.5 + albumScore * 0.35 + artistScore * 0.15,
      };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  return best && best.score >= 0.35 ? best : null;
}

function createQobuzService(deps = {}) {
  const fetch = deps.fetch || globalThis.fetch;
  const logger = deps.logger || require('../utils/logger');

  async function searchAlbum(artist, album, options = {}) {
    if (!artist || !album) return null;

    const storefront = options.storefront || DEFAULT_STOREFRONT;
    const query = `${artist} ${album}`.trim();
    const searchUrl = `https://www.qobuz.com/${storefront}/search?q=${encodeURIComponent(query)}`;

    const resp = await fetch(searchUrl);
    if (!resp.ok) {
      logger.warn('Qobuz search request failed', {
        status: resp.status,
        storefront,
      });
      throw new Error(`Qobuz search failed: ${resp.status}`);
    }

    const html = await resp.text();
    const candidates = extractAlbumCandidates(html, storefront);
    const best = pickBestCandidate(candidates, artist, album);

    if (!best) {
      return null;
    }

    return {
      id: best.id,
    };
  }

  return {
    searchAlbum,
    extractAlbumCandidates,
    pickBestCandidate,
  };
}

module.exports = { createQobuzService };
