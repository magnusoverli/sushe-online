/**
 * Native Name Service
 *
 * Restores the NATIVE (original-spelling) artist/album for an album by looking
 * it up from its MusicBrainz release-group id. Albums added via the browser
 * extension are stored from the RateYourMusic URL slug, which ASCII-folds
 * diacritics and drops apostrophes ("De l'Abîme Naît l'Aube" -> "De Labime Nait
 * Laube"). The client already sends the MusicBrainz album_id, so the server can
 * authoritatively recover the native spelling regardless of which client (or
 * client version) sent the data.
 *
 * The decision is gated by the shared entity-matching layer: a rewrite happens
 * ONLY when the MusicBrainz name and the stored name reduce to the same
 * canonical key (i.e. they are the same album, differing only by
 * diacritics/punctuation/`&`). This guarantees we re-spell an album and never
 * swap it for a different one — a wrong album_id yields differing keys and is
 * reported for review instead.
 *
 * Pure resolver: one MusicBrainz fetch per call, no internal rate limiting —
 * callers (the backfill script, the on-add background queue) handle pacing.
 */

const defaultLogger = require('../utils/logger');
const { SUSHE_USER_AGENT } = require('../utils/musicbrainz-helpers');
const { externalMatchKey } = require('../utils/entity-matching');
const { sanitizeForStorage } = require('../utils/normalization');

const MB_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MB_RELEASE_GROUP_URL = 'https://musicbrainz.org/ws/2/release-group';
const MB_FETCH_TIMEOUT_MS = 15000;

/**
 * Fetch with a hard timeout. A stalled MusicBrainz request must never block the
 * caller indefinitely (the live queue and the backfill both rely on this).
 */
async function fetchWithTimeout(fetchFn, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Determine whether a string is a MusicBrainz UUID (vs a Spotify/other id).
 * @param {string} id
 * @returns {boolean}
 */
function isMusicbrainzId(id) {
  return typeof id === 'string' && MB_UUID_RE.test(id);
}

/**
 * Join a MusicBrainz artist-credit array into a single native artist string,
 * honoring join phrases (e.g. [{name:'A',joinphrase:' & '},{name:'B'}] -> "A & B").
 * @param {Array} credit
 * @returns {string}
 */
function joinArtistCredit(credit) {
  if (!Array.isArray(credit) || credit.length === 0) return '';
  return credit
    .map((c) => `${c?.name || c?.artist?.name || ''}${c?.joinphrase || ''}`)
    .join('')
    .trim();
}

/**
 * Resolve the native artist/album for an album from its MusicBrainz id.
 *
 * @param {Object} album - { albumId, artist, album }
 * @param {Object} [deps]
 * @param {Function} [deps.fetch] - fetch implementation (injected for tests)
 * @param {Object} [deps.logger]
 * @returns {Promise<{action: 'rewrite', artist: string, album: string}
 *   | {action: 'review', native: {artist: string, album: string}}
 *   | {action: 'noop'}
 *   | {action: 'skip', reason: string}>}
 */
async function resolveNativeAlbumName({ albumId, artist, album }, deps = {}) {
  const fetchFn = deps.fetch || fetch;
  const logger = deps.logger || defaultLogger;

  if (!isMusicbrainzId(albumId)) {
    return { action: 'skip', reason: 'non-mb-id' };
  }

  let group;
  try {
    const url = `${MB_RELEASE_GROUP_URL}/${albumId}?inc=artist-credits&fmt=json`;
    const resp = await fetchWithTimeout(
      fetchFn,
      url,
      { headers: { 'User-Agent': SUSHE_USER_AGENT } },
      MB_FETCH_TIMEOUT_MS
    );
    if (!resp.ok) {
      return { action: 'skip', reason: `mb-status-${resp.status}` };
    }
    group = await resp.json();
  } catch (err) {
    logger.warn('native-name: MusicBrainz lookup failed', {
      albumId,
      error: err.message,
    });
    return { action: 'skip', reason: 'mb-error' };
  }

  const nativeArtist = sanitizeForStorage(
    joinArtistCredit(group?.['artist-credit'])
  );
  const nativeAlbum = sanitizeForStorage(group?.title || '');

  if (!nativeArtist || !nativeAlbum) {
    return { action: 'skip', reason: 'no-native-name' };
  }

  const storedArtist = artist || '';
  const storedAlbum = album || '';

  // Same logical album? (diacritic / punctuation / `&` insensitive)
  const sameArtist =
    externalMatchKey(nativeArtist) === externalMatchKey(storedArtist);
  const sameAlbum =
    externalMatchKey(nativeAlbum) === externalMatchKey(storedAlbum);

  if (!sameArtist || !sameAlbum) {
    // The MusicBrainz id points at a different album than what's stored — most
    // likely a wrong album_id picked from a corrupted search. Do not rewrite.
    return {
      action: 'review',
      native: { artist: nativeArtist, album: nativeAlbum },
    };
  }

  // Same album — only rewrite if the native spelling actually differs.
  if (nativeArtist === storedArtist && nativeAlbum === storedAlbum) {
    return { action: 'noop' };
  }

  return { action: 'rewrite', artist: nativeArtist, album: nativeAlbum };
}

module.exports = {
  resolveNativeAlbumName,
  isMusicbrainzId,
  joinArtistCredit,
};
