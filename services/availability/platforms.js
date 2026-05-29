/**
 * Music platform allowlist + name normalization (single source of truth).
 *
 * "Which services exist" is application policy, not a storage invariant, so the
 * DB no longer constrains it (migration 063). Add a platform by editing the
 * maps here only — the repository, resolution service and queue all read from
 * this module.
 */

// Services that prior code already used for cross-platform identity resolution.
const IDENTITY_SERVICES = ['spotify', 'tidal', 'lastfm'];

// Canonical (snake_case) names for the streaming/store platforms whose
// availability we resolve and store.
const AVAILABILITY_SERVICES = [
  'spotify',
  'apple_music',
  'itunes',
  'tidal',
  'deezer',
  'amazon_music',
  'amazon_store',
  'youtube',
  'youtube_music',
  'soundcloud',
  'bandcamp',
  'pandora',
  'napster',
  'anghami',
  'boomplay',
  'yandex',
  'audiomack',
  'audius',
];

// Full set the repository accepts on read/write (replaces the dropped DB CHECK).
const SUPPORTED_SERVICES = new Set([
  ...IDENTITY_SERVICES,
  ...AVAILABILITY_SERVICES,
]);

// Odesli (song.link) platform keys -> canonical service name.
const ODESLI_PLATFORM_TO_SERVICE = {
  spotify: 'spotify',
  appleMusic: 'apple_music',
  itunes: 'itunes',
  tidal: 'tidal',
  deezer: 'deezer',
  amazonMusic: 'amazon_music',
  amazonStore: 'amazon_store',
  youtube: 'youtube',
  youtubeMusic: 'youtube_music',
  soundcloud: 'soundcloud',
  bandcamp: 'bandcamp',
  pandora: 'pandora',
  napster: 'napster',
  anghami: 'anghami',
  boomplay: 'boomplay',
  yandex: 'yandex',
  audiomack: 'audiomack',
  audius: 'audius',
};

// MusicBrainz url-rels hostnames -> canonical service. Ordered most-specific
// first; first substring hit wins (so music.apple.com beats itunes.apple.com,
// music.youtube.com beats youtube.com).
const MB_HOST_MATCHERS = [
  ['music.apple.com', 'apple_music'],
  ['itunes.apple.com', 'itunes'],
  ['music.youtube.com', 'youtube_music'],
  ['youtube.com', 'youtube'],
  ['youtu.be', 'youtube'],
  ['music.amazon', 'amazon_music'],
  ['open.spotify.com', 'spotify'],
  ['spotify.com', 'spotify'],
  ['tidal.com', 'tidal'],
  ['deezer.com', 'deezer'],
  ['bandcamp.com', 'bandcamp'],
  ['soundcloud.com', 'soundcloud'],
  ['anghami.com', 'anghami'],
  ['boomplay.com', 'boomplay'],
  ['audiomack.com', 'audiomack'],
];

// Odesli request configuration. Rate is held under the free tier's ~10 req/min.
const ODESLI_BASE_URL = 'https://api.song.link/v1-alpha.1/links';
const ODESLI_USER_COUNTRY = 'US';
const ODESLI_RATE_LIMIT_MS = 6500;

// Drop any resolved service whose seed confidence is below this floor.
const AVAILABILITY_CONFIDENCE_FLOOR = 0.5;

/**
 * @param {string} platformKey - Odesli platform key (e.g. 'appleMusic')
 * @returns {string|null} canonical service name, or null if unknown
 */
function normalizeOdesliPlatform(platformKey) {
  return ODESLI_PLATFORM_TO_SERVICE[platformKey] || null;
}

/**
 * @param {string} url - A url-rels resource url from MusicBrainz
 * @returns {string|null} canonical service name, or null if unrecognised
 */
function normalizeMusicbrainzUrl(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const [needle, service] of MB_HOST_MATCHERS) {
    if (host.includes(needle)) return service;
  }
  return null;
}

module.exports = {
  IDENTITY_SERVICES,
  AVAILABILITY_SERVICES,
  SUPPORTED_SERVICES,
  ODESLI_PLATFORM_TO_SERVICE,
  MB_HOST_MATCHERS,
  ODESLI_BASE_URL,
  ODESLI_USER_COUNTRY,
  ODESLI_RATE_LIMIT_MS,
  AVAILABILITY_CONFIDENCE_FLOOR,
  normalizeOdesliPlatform,
  normalizeMusicbrainzUrl,
};
