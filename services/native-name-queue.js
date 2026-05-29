/**
 * Native Name Queue
 *
 * Background queue that restores native artist/album spelling after an album is
 * added. Albums ingested from a RateYourMusic URL slug arrive ASCII-folded
 * ("De l'Abîme Naît l'Aube" -> "De Labime Nait Laube"); this queue looks the
 * album up by its MusicBrainz id and rewrites the stored name to the native
 * spelling when the entity-matching gate confirms it's the same album.
 *
 * Runs in the background (like the cover/track fetch queues) so adds/imports are
 * never blocked, and serializes with a delay to respect MusicBrainz rate limits.
 *
 * Cheap pre-filter in add(): only albums with a MusicBrainz id AND a pure-ASCII
 * stored name (the only possible slug victims) are enqueued — non-MB ids and
 * names that already contain diacritics are skipped without any network call.
 */

const { RequestQueue } = require('../utils/request-queue');
const logger = require('../utils/logger');
const { ensureDb } = require('../db/postgres');
const {
  resolveNativeAlbumName,
  isMusicbrainzId,
} = require('./native-name-service');

const MB_RATE_LIMIT_MS = 1100; // MusicBrainz: ~1 request/second
const NON_ASCII = /[^\x20-\x7E]/;

function createNativeNameQueue(deps = {}) {
  const maxConcurrent = deps.maxConcurrent || 1; // serialize for MB rate limit
  const queue = new RequestQueue(maxConcurrent);
  const fetchFn = deps.fetch || fetch;
  const log = deps.logger || logger;
  const rateLimitMs =
    deps.rateLimitMs === undefined ? MB_RATE_LIMIT_MS : deps.rateLimitMs;
  const db =
    deps.db !== undefined && deps.db !== null
      ? ensureDb(deps.db, 'native-name-queue')
      : null;

  /**
   * Enqueue a native-name resolution for a freshly-added album. No-ops (without
   * a network call) unless the album is a plausible slug victim.
   */
  function add(albumId, artist, album) {
    if (!albumId || !artist || !album) return;
    if (!isMusicbrainzId(albumId)) return; // Spotify/other ids are already native
    if (NON_ASCII.test(artist) || NON_ASCII.test(album)) return; // already native

    return queue.add(async () => {
      try {
        const res = await resolveNativeAlbumName(
          { albumId, artist, album },
          { fetch: fetchFn, logger: log }
        );

        if (res.action === 'rewrite') {
          if (db) {
            await db.raw(
              `UPDATE albums SET artist = $1, album = $2, updated_at = NOW() WHERE album_id = $3`,
              [res.artist, res.album, albumId],
              { name: 'native-name-rewrite' }
            );
          }
          log.info('Restored native album spelling', {
            albumId,
            from: `${artist} — ${album}`,
            to: `${res.artist} — ${res.album}`,
          });
        } else if (res.action === 'review') {
          log.warn(
            'Native-name resolution flagged for review (album_id may be wrong)',
            {
              albumId,
              stored: `${artist} — ${album}`,
              mb: `${res.native.artist} — ${res.native.album}`,
            }
          );
        }
      } catch (err) {
        log.warn('Native-name resolution failed', {
          albumId,
          error: err.message,
        });
      } finally {
        // Space out MusicBrainz calls regardless of outcome.
        if (rateLimitMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, rateLimitMs));
        }
      }
    });
  }

  return {
    add,
    get length() {
      return queue.length;
    },
  };
}

// Singleton (initialized with db at startup)
let nativeNameQueue = null;

function initializeNativeNameQueue(db) {
  if (!nativeNameQueue) {
    nativeNameQueue = createNativeNameQueue({ db });
    logger.info('Native name queue initialized');
  }
  return nativeNameQueue;
}

function getNativeNameQueue() {
  if (!nativeNameQueue) {
    throw new Error(
      'Native name queue not initialized. Call initializeNativeNameQueue(db) first.'
    );
  }
  return nativeNameQueue;
}

module.exports = {
  createNativeNameQueue,
  initializeNativeNameQueue,
  getNativeNameQueue,
};
