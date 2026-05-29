/**
 * Playcount Engine
 *
 * The shared lower layer for Last.fm playcount work. Everything that actually
 * talks to Last.fm and writes the cache lives here, so the higher-level
 * services depend on this engine rather than on each other:
 *
 *   - playcount-service.js      (read / list-view + background refresh) ─┐
 *   - playcount-sync-service.js (Tier-1 scheduler)                     ─┤→ engine
 *   - routes/api/lastfm.js      (scrobble-triggered refresh)            ─┘
 *
 * Responsibilities: single-album fetch (`refreshAlbumPlaycount`), the batched
 * rate-limited driver (`refreshAlbumsBatched`), cache writes (`upsertPlaycount`
 * / `upsertPlaycountError`), artist-alias resolution, cache invalidation, and a
 * process-wide in-flight guard so overlapping tiers don't refetch the same
 * album concurrently.
 */

const { ensureDb } = require('../db/postgres');
const {
  getAlbumInfo: getLastfmAlbumInfo,
  normalizeForLastfm,
} = require('../utils/lastfm-auth');
const { normalizeAlbumKey } = require('../utils/fuzzy-match');
const { canonicalAlbumKey } = require('../utils/playcount-key');
const { runInBatches } = require('../utils/batch');
const { BATCH_SIZE, BATCH_DELAY_MS } = require('./playcount-constants');
const {
  createExternalIdentityService,
} = require('./external-identity-service');

// ============================================
// CACHE WRITES
// ============================================

/**
 * Canonicalize an album for storage: lowercased, diacritic-stripped artist and
 * album plus the shared normalized cache key (kept identical to the read path).
 */
function canonicalizeAlbum(album) {
  const canonicalArtist = normalizeForLastfm(album.artist).toLowerCase().trim();
  const canonicalAlbum = normalizeForLastfm(album.album).toLowerCase().trim();
  // Key composed via the shared helper so read and write paths never diverge.
  const normalizedKey = canonicalAlbumKey(
    normalizeAlbumKey,
    album.artist,
    album.album
  );
  const albumId = album.album_id || album.albumId || null;
  return { canonicalArtist, canonicalAlbum, normalizedKey, albumId };
}

/**
 * Upsert a playcount into user_album_stats.
 * @param {import('../db/types').DbFacade} db
 * @param {string} userId
 * @param {Object} album
 * @param {number|null} playcount
 * @param {string} status - 'success' or 'not_found'
 */
async function upsertPlaycount(db, userId, album, playcount, status) {
  const { canonicalArtist, canonicalAlbum, normalizedKey, albumId } =
    canonicalizeAlbum(album);

  await db.raw(
    `INSERT INTO user_album_stats (user_id, album_id, artist, album_name, normalized_key, lastfm_playcount, lastfm_status, lastfm_updated_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
     ON CONFLICT (user_id, LOWER(artist), LOWER(album_name))
     DO UPDATE SET
       album_id = COALESCE(EXCLUDED.album_id, user_album_stats.album_id),
       normalized_key = EXCLUDED.normalized_key,
       lastfm_playcount = EXCLUDED.lastfm_playcount,
       lastfm_status = EXCLUDED.lastfm_status,
       lastfm_updated_at = NOW(),
       updated_at = NOW()`,
    [
      userId,
      albumId,
      canonicalArtist,
      canonicalAlbum,
      normalizedKey,
      playcount,
      status,
    ]
  );
}

/**
 * Record a transient fetch failure WITHOUT clobbering a previously cached
 * value. If a row already exists it is left untouched so the last-known
 * playcount keeps displaying; only brand-new albums get an 'error' marker so
 * they stay eligible for retry. Prevents a momentary Last.fm hiccup from wiping
 * good playcounts.
 */
async function upsertPlaycountError(db, userId, album) {
  const { canonicalArtist, canonicalAlbum, normalizedKey, albumId } =
    canonicalizeAlbum(album);

  await db.raw(
    `INSERT INTO user_album_stats (user_id, album_id, artist, album_name, normalized_key, lastfm_playcount, lastfm_status, lastfm_updated_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NULL, 'error', NOW(), NOW())
     ON CONFLICT (user_id, LOWER(artist), LOWER(album_name))
     DO NOTHING`,
    [userId, albumId, canonicalArtist, canonicalAlbum, normalizedKey]
  );
}

/**
 * Delete all cached playcounts for a user (used on Last.fm disconnect).
 */
async function invalidateUserPlaycounts(db, log, userId) {
  const datastore = ensureDb(db, 'playcount-engine.invalidateUserPlaycounts');
  const result = await datastore.raw(
    `DELETE FROM user_album_stats WHERE user_id = $1`,
    [userId]
  );

  log.info('Invalidated Last.fm playcount cache', {
    userId,
    deleted: result.rowCount || 0,
  });

  return result.rowCount || 0;
}

// ============================================
// SINGLE-ALBUM FETCH
// ============================================

async function getLastfmArtistCandidates(db, log, album) {
  const canonicalArtist = album?.artist;
  const albumId = album?.album_id || album?.albumId || null;

  if (!canonicalArtist) {
    return [];
  }

  const candidates = [canonicalArtist];

  try {
    const externalIdentityService = createExternalIdentityService({
      db,
      logger: log,
    });

    if (albumId) {
      const lastfmMapping =
        await externalIdentityService.getAlbumServiceMapping('lastfm', albumId);
      if (lastfmMapping?.external_artist) {
        candidates.unshift(lastfmMapping.external_artist);
      }

      const spotifyMapping =
        await externalIdentityService.getAlbumServiceMapping(
          'spotify',
          albumId
        );
      if (spotifyMapping?.external_artist) {
        candidates.push(spotifyMapping.external_artist);
      }
    }

    const aliases = await externalIdentityService.getArtistAliasCandidates(
      'lastfm',
      canonicalArtist,
      { includeCrossService: true }
    );
    candidates.push(...aliases);
  } catch (err) {
    log.warn('Failed to load Last.fm artist alias candidates', {
      artist: canonicalArtist,
      albumId,
      error: err.message,
    });
  }

  return [...new Set(candidates.filter(Boolean))];
}

/**
 * Refresh playcount for a single album.
 * @returns {Promise<{playcount: number|null, status: string}|null>} Result or null on failure
 */
async function refreshAlbumPlaycount(db, log, userId, lastfmUsername, album) {
  try {
    const datastore = ensureDb(db, 'playcount-engine.refreshAlbumPlaycount');
    const albumId = album.album_id || album.albumId || null;
    const artistCandidates = await getLastfmArtistCandidates(
      datastore,
      log,
      album
    );

    let info = null;
    let matchedArtist = album.artist;

    for (const artistCandidate of artistCandidates) {
      const candidateInfo = await getLastfmAlbumInfo(
        artistCandidate,
        album.album,
        lastfmUsername,
        process.env.LASTFM_API_KEY
      );

      if (!candidateInfo?.notFound) {
        info = candidateInfo;
        matchedArtist = artistCandidate;
        break;
      }

      if (!info) {
        info = candidateInfo;
      }
    }

    if (!info) {
      info = {
        userplaycount: '0',
        playcount: '0',
        listeners: '0',
        notFound: true,
      };
    }

    if (matchedArtist !== album.artist) {
      try {
        const externalIdentityService = createExternalIdentityService({
          db: datastore,
          logger: log,
        });

        await externalIdentityService.upsertArtistAlias({
          service: 'lastfm',
          canonicalArtist: album.artist,
          serviceArtist: matchedArtist,
          sourceAlbumId: albumId,
        });

        if (albumId) {
          await externalIdentityService.upsertAlbumServiceMapping({
            albumId,
            service: 'lastfm',
            externalArtist: matchedArtist,
            externalAlbum: album.album,
            strategy: 'alias_fallback',
          });
        }
      } catch (err) {
        log.warn('Failed to persist Last.fm alias mapping', {
          artist: album.artist,
          matchedArtist,
          albumId,
          error: err.message,
        });
      }
    }

    // Check if album was not found on Last.fm
    if (info.notFound) {
      log.debug('Album not found on Last.fm', {
        artist: album.artist,
        album: album.album,
      });
      await upsertPlaycount(datastore, userId, album, null, 'not_found');
      return { playcount: null, status: 'not_found' };
    }

    const playcount = parseInt(info.userplaycount || 0);
    await upsertPlaycount(datastore, userId, album, playcount, 'success');
    return { playcount, status: 'success' };
  } catch (err) {
    log.warn('Failed to fetch playcount for album', {
      artist: album.artist,
      album: album.album,
      error: err.message,
    });

    // Mark as errored so we retry later — but preserve any existing cached
    // value rather than overwriting it with null.
    try {
      const datastore = ensureDb(db, 'playcount-engine.refreshAlbumPlaycount');
      await upsertPlaycountError(datastore, userId, album);
    } catch (dbErr) {
      log.error('Failed to store error status', {
        error: dbErr.message,
      });
    }

    return null;
  }
}

// ============================================
// IN-FLIGHT DEDUP (process-wide, all tiers)
// ============================================

// Albums currently being refreshed, keyed by `${userId}::${canonicalKey}`. A
// single module-level set is shared across every tier (list view, scrobble,
// add-album) so repeated/overlapping triggers don't spawn duplicate concurrent
// Last.fm fetches for the same album.
const inFlightRefreshes = new Set();

function inFlightKey(userId, album) {
  return `${userId}::${canonicalAlbumKey(normalizeAlbumKey, album.artist, album.album)}`;
}

/**
 * Reserve a set of albums for refresh, skipping any already in flight.
 * @returns {{ toLaunch: Array, release: Function }}
 *   `toLaunch` are the albums the caller now owns and should refresh;
 *   `release()` clears exactly those reservations (call it when done).
 */
function claimAlbumsForRefresh(userId, albums) {
  const claimedKeys = [];
  const toLaunch = albums.filter((album) => {
    const key = inFlightKey(userId, album);
    if (inFlightRefreshes.has(key)) return false;
    inFlightRefreshes.add(key);
    claimedKeys.push(key);
    return true;
  });

  const release = () => {
    for (const key of claimedKeys) inFlightRefreshes.delete(key);
  };

  return { toLaunch, release };
}

// ============================================
// BATCHED DRIVER
// ============================================

/**
 * Refresh a list of albums in rate-limited batches, returning a map of
 * itemId -> { playcount, status } | null. Logs a single completion summary.
 *
 * @param {import('../db/types').DbFacade} datastore - already ensured
 * @param {Object} log
 * @param {string} userId
 * @param {string} lastfmUsername
 * @param {Array} albums - { itemId, artist, album, album_id }
 * @param {Function} refreshFn - single-album refresh (injectable for tests)
 */
async function refreshAlbumsBatched(
  datastore,
  log,
  userId,
  lastfmUsername,
  albums,
  refreshFn = refreshAlbumPlaycount
) {
  const results = {};

  await runInBatches(
    albums,
    { batchSize: BATCH_SIZE, delayMs: BATCH_DELAY_MS },
    async (album) => {
      log.debug('Fetching Last.fm playcount', {
        artist: album.artist,
        album: album.album,
        lastfmUsername,
      });

      const result = await refreshFn(
        datastore,
        log,
        userId,
        lastfmUsername,
        album
      );

      if (result !== null) {
        results[album.itemId] = result;
        if (result.status === 'success') {
          log.debug('Fetched playcount', {
            artist: album.artist,
            album: album.album,
            playcount: result.playcount,
          });
        }
      } else {
        results[album.itemId] = null;
      }
    }
  );

  const successCount = Object.values(results).filter(
    (v) => v && v.status === 'success'
  ).length;
  const notFoundCount = Object.values(results).filter(
    (v) => v && v.status === 'not_found'
  ).length;
  log.info('Background playcount refresh completed', {
    total: albums.length,
    successful: successCount,
    notFound: notFoundCount,
    failed: albums.length - successCount - notFoundCount,
  });

  return results;
}

module.exports = {
  canonicalizeAlbum,
  upsertPlaycount,
  upsertPlaycountError,
  invalidateUserPlaycounts,
  getLastfmArtistCandidates,
  refreshAlbumPlaycount,
  refreshAlbumsBatched,
  claimAlbumsForRefresh,
};
