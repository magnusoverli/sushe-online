/**
 * MusicBrainz Release Helpers
 *
 * Shared utilities for scoring and selecting MusicBrainz releases,
 * and extracting track data from release media.
 *
 * Used by:
 * - routes/api/proxies.js (track list endpoint)
 * - routes/admin/reidentify.js (album re-identification)
 */

/**
 * User-Agent string for MusicBrainz and related API requests
 */
const SUSHE_USER_AGENT = 'SuSheBot/1.0 (kvlt.example.com)';

/**
 * EU + UK + MusicBrainz "Europe" country codes.
 * Used to prefer European releases (closer to typical user base).
 */
const EU_COUNTRIES = new Set([
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
  'GB',
  'XE',
]);

/**
 * Score a MusicBrainz release for selection.
 * Higher scores are preferred. Returns -1 for non-official releases.
 *
 * Scoring factors:
 * - EU country: +20
 * - Worldwide (XW): +10
 * - Digital media: +15
 * - Release date: minor weight (newer preferred)
 *
 * @param {Object} rel - MusicBrainz release object
 * @returns {number} - Score (-1 if unsuitable)
 */
function scoreRelease(rel) {
  if (rel.status !== 'Official' || rel.status === 'Pseudo-Release') return -1;
  let s = 0;
  if (EU_COUNTRIES.has(rel.country)) s += 20;
  if (rel.country === 'XW') s += 10;
  if ((rel.media || []).some((m) => (m.format || '').includes('Digital')))
    s += 15;
  const date = new Date(rel.date || '1900-01-01');
  if (!isNaN(date)) s += date.getTime() / 1e10; // minor weight
  return s;
}

/**
 * Select the best release from a list using scoreRelease.
 *
 * @param {Array} releases - Array of MusicBrainz release objects
 * @returns {Object|null} - Best release or null if none suitable
 */
function selectBestRelease(releases) {
  const scored = releases
    .map((r) => ({ ...r, _score: scoreRelease(r) }))
    .filter((r) => r._score >= 0)
    .sort((a, b) => b._score - a._score);
  return scored[0] || null;
}

/**
 * Extract tracks from MusicBrainz release media.
 *
 * @param {Array} media - Array of MusicBrainz media objects (with tracks/recordings)
 * @returns {Array<{name: string, length: number|null}>} - Extracted tracks
 */
function extractTracksFromMedia(media) {
  const tracks = [];
  for (const medium of media) {
    if (Array.isArray(medium.tracks)) {
      medium.tracks.forEach((t) => {
        const title = t.title || (t.recording && t.recording.title) || '';
        const length = t.length || (t.recording && t.recording.length) || null;
        tracks.push({ name: title, length });
      });
    }
  }
  return tracks;
}

module.exports = {
  SUSHE_USER_AGENT,
  EU_COUNTRIES,
  scoreRelease,
  selectBestRelease,
  extractTracksFromMedia,
};
