/**
 * Playcount Sync Service
 *
 * Background service for periodically syncing Last.fm playcounts for all user albums.
 * Uses a three-tier refresh strategy:
 *   - Tier 1: Background job runs every 24 hours for all albums
 *   - Tier 2: List view refreshes only stale albums (>2 hours old)
 *   - Tier 3: Interaction-triggered refreshes (play, add album)
 */

const logger = require('../utils/logger');
const {
  getAlbumInfo: getLastfmAlbumInfo,
  normalizeForLastfm,
} = require('../utils/lastfm-auth');
const { normalizeAlbumKey } = require('../utils/fuzzy-match');
const {
  createExternalIdentityService,
} = require('./external-identity-service');

// Default intervals
const DEFAULT_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
const RATE_LIMIT_DELAY_MS = 2000; // 2 seconds between users
const STARTUP_DELAY_MS = 60000; // 60 seconds after startup
const BATCH_SIZE = 5; // Albums per batch
const BATCH_DELAY_MS = 1100; // 1.1 seconds between batches

// ============================================
// DATABASE HELPERS
// ============================================

/**
 * Get users who need playcount sync (have Last.fm connected)
 * @param {Object} pool - Database pool
 * @param {number} staleThresholdMs - Stale threshold in ms
 * @param {number} limit - Maximum users to return
 * @returns {Promise<Array>} Users needing sync
 */
async function getUsersNeedingSync(db, staleThresholdMs, limit = 50) {
  const staleIntervalSeconds = Math.floor(staleThresholdMs / 1000);

  const query = `
    WITH fresh_users AS (
      SELECT DISTINCT uas.user_id
      FROM user_album_stats uas
      WHERE uas.lastfm_updated_at > NOW() - make_interval(secs => $2)
    ),
    users_with_missing_coverage AS (
      SELECT DISTINCT l.user_id
      FROM lists l
      JOIN list_items li ON li.list_id = l._id
      JOIN albums a ON li.album_id = a.album_id
      LEFT JOIN user_album_stats uas
        ON uas.user_id = l.user_id
       AND uas.album_id = a.album_id
      WHERE a.album_id IS NOT NULL
        AND a.artist IS NOT NULL
        AND a.album IS NOT NULL
        AND uas.id IS NULL
    )
    SELECT
      u._id,
      u.username,
      u.lastfm_username
    FROM users u
    LEFT JOIN fresh_users f ON f.user_id = u._id
    LEFT JOIN users_with_missing_coverage m ON m.user_id = u._id
    WHERE u.lastfm_auth IS NOT NULL
      AND u.lastfm_username IS NOT NULL
      AND u.lastfm_username != ''
      AND (f.user_id IS NULL OR m.user_id IS NOT NULL)
    ORDER BY u._id
    LIMIT $1
  `;

  const result = await db.raw(query, [limit, staleIntervalSeconds]);
  return result.rows;
}

/**
 * Get all albums for a user across all their lists
 * @param {Object} pool - Database pool
 * @param {string} userId - User ID
 * @returns {Promise<Array>} Albums with artist, album name, and album_id
 */
async function getUserAlbums(db, userId) {
  const query = `
    SELECT DISTINCT
      a.album_id,
      a.artist,
      a.album
    FROM list_items li
    JOIN lists l ON li.list_id = l._id
    JOIN albums a ON li.album_id = a.album_id
    WHERE l.user_id = $1
      AND a.artist IS NOT NULL
      AND a.album IS NOT NULL
  `;

  const result = await db.raw(query, [userId]);
  return result.rows;
}

// ============================================
// PLAYCOUNT REFRESH HELPERS
// ============================================

/**
 * Upsert playcount into user_album_stats
 * @param {Object} pool - Database pool
 * @param {string} userId - User ID
 * @param {Object} album - Album object
 * @param {number|null} playcount - Playcount value (null for not_found)
 * @param {string} status - 'success' or 'not_found'
 */
async function upsertPlaycount(db, userId, album, playcount, status) {
  const canonicalArtist = normalizeForLastfm(album.artist).toLowerCase().trim();
  const canonicalAlbum = normalizeForLastfm(album.album).toLowerCase().trim();
  const normalizedKey = normalizeAlbumKey(canonicalArtist, canonicalAlbum);
  const albumId = album.album_id || null;

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

async function getLastfmArtistCandidates(db, log, album) {
  const canonicalArtist = album?.artist;
  const albumId = album?.album_id || null;

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
 * Refresh playcount for a single album
 * @param {Object} pool - Database pool
 * @param {Object} log - Logger instance
 * @param {string} userId - User ID
 * @param {string} lastfmUsername - Last.fm username
 * @param {Object} album - Album object with artist, album, album_id
 * @returns {Promise<{playcount: number|null, status: string}|null>} Result or null on failure
 */
async function refreshAlbumPlaycount(db, log, userId, lastfmUsername, album) {
  try {
    const albumId = album.album_id || null;
    const artistCandidates = await getLastfmArtistCandidates(db, log, album);

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
          db,
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
      await upsertPlaycount(db, userId, album, null, 'not_found');
      return { playcount: null, status: 'not_found' };
    }

    const playcount = parseInt(info.userplaycount || 0);
    await upsertPlaycount(db, userId, album, playcount, 'success');
    return { playcount, status: 'success' };
  } catch (err) {
    log.warn('Failed to fetch playcount for album', {
      artist: album.artist,
      album: album.album,
      error: err.message,
    });

    // Store as error state so we retry later
    try {
      await upsertPlaycount(db, userId, album, null, 'error');
    } catch (dbErr) {
      log.error('Failed to store error status', {
        error: dbErr.message,
      });
    }

    return null;
  }
}

/**
 * Sync all playcounts for a single user
 * @param {Object} pool - Database pool
 * @param {Object} log - Logger instance
 * @param {Object} user - User object with _id, lastfm_username
 * @returns {Promise<Object>} Sync result
 */
async function syncUserPlaycounts(db, log, user) {
  const userId = user._id;
  const lastfmUsername = user.lastfm_username;
  const startTime = Date.now();

  log.info('Starting playcount sync for user', {
    userId,
    username: user.username,
    lastfmUsername,
  });

  const albums = await getUserAlbums(db, userId);

  if (albums.length === 0) {
    log.info('No albums to sync for user', { userId });
    return { userId, success: true, synced: 0, failed: 0, duration: 0 };
  }

  let synced = 0;
  let failed = 0;

  // Process in batches with rate limiting
  for (let i = 0; i < albums.length; i += BATCH_SIZE) {
    const batch = albums.slice(i, i + BATCH_SIZE);

    const batchPromises = batch.map(async (album) => {
      const result = await refreshAlbumPlaycount(
        db,
        log,
        userId,
        lastfmUsername,
        album
      );
      if (result !== null) {
        synced++;
      } else {
        failed++;
      }
    });

    await Promise.all(batchPromises);

    // Rate limit delay between batches
    if (i + BATCH_SIZE < albums.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  const duration = Date.now() - startTime;

  log.info('Playcount sync complete for user', {
    userId,
    username: user.username,
    totalAlbums: albums.length,
    synced,
    failed,
    duration: `${duration}ms`,
  });

  return { userId, success: failed === 0, synced, failed, duration };
}

// ============================================
// MAIN FACTORY
// ============================================

/**
 * Create playcount sync service with injected dependencies
 * @param {Object} deps - Dependencies
 * @param {Object} deps.pool - PostgreSQL pool instance
 * @param {Object} deps.logger - Logger instance (optional)
 * @param {number} deps.syncIntervalMs - Sync interval in ms (optional, default 24h)
 * @param {number} deps.staleThresholdMs - Stale data threshold in ms (optional, default 24h)
 */
function createPlaycountSyncService(deps = {}) {
  const log = deps.logger || logger;
  const pool = deps.pool;
  const db =
    deps.db ||
    (pool ? { raw: (sql, params) => pool.query(sql, params) } : null);

  if (!pool) {
    throw new Error('Database pool is required for playcount sync service');
  }

  const syncIntervalMs = deps.syncIntervalMs || DEFAULT_SYNC_INTERVAL_MS;
  const staleThresholdMs = deps.staleThresholdMs || DEFAULT_STALE_THRESHOLD_MS;
  let syncInterval = null;
  let isRunning = false;

  /**
   * Refresh playcount for a single album (for interaction-triggered refreshes)
   * @param {string} userId - User ID
   * @param {string} lastfmUsername - Last.fm username
   * @param {Object} album - Album object with artist, album, albumId
   * @param {number} delayMs - Delay before fetching (optional)
   * @returns {Promise<number|null>} Playcount or null on failure
   */
  async function refreshSingleAlbum(
    userId,
    lastfmUsername,
    album,
    delayMs = 0
  ) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    log.debug('Refreshing single album playcount', {
      userId,
      artist: album.artist,
      album: album.album,
    });

    return refreshAlbumPlaycount(db, log, userId, lastfmUsername, album);
  }

  /**
   * Run a complete sync cycle for all users needing updates
   * @returns {Promise<Object>} Cycle results
   */
  async function runSyncCycle() {
    if (isRunning) {
      log.warn('Playcount sync cycle already running, skipping');
      return { skipped: true };
    }

    isRunning = true;
    const cycleStart = Date.now();

    log.info('Starting playcount sync cycle');
    const results = {
      total: 0,
      success: 0,
      failed: 0,
      totalAlbums: 0,
      errors: [],
    };

    try {
      const users = await getUsersNeedingSync(db, staleThresholdMs);
      results.total = users.length;

      log.info(`Found ${users.length} users needing playcount sync`);

      for (const user of users) {
        try {
          const result = await syncUserPlaycounts(db, log, user);
          results.totalAlbums += result.synced + result.failed;

          if (result.success) {
            results.success++;
          } else {
            results.failed++;
            results.errors.push({
              userId: user._id,
              synced: result.synced,
              failed: result.failed,
            });
          }

          // Rate limit delay between users
          if (users.indexOf(user) < users.length - 1) {
            await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS));
          }
        } catch (err) {
          results.failed++;
          results.errors.push({
            userId: user._id,
            error: err.message,
          });
          log.error('Error syncing user playcounts', {
            userId: user._id,
            error: err.message,
          });
        }
      }

      const cycleDuration = Date.now() - cycleStart;
      log.info('Playcount sync cycle complete', {
        totalUsers: results.total,
        successUsers: results.success,
        failedUsers: results.failed,
        totalAlbums: results.totalAlbums,
        duration: `${cycleDuration}ms`,
      });
    } catch (err) {
      log.error('Playcount sync cycle failed', { error: err.message });
      results.errors.push({ source: 'cycle', error: err.message });
    } finally {
      isRunning = false;
    }

    return results;
  }

  /**
   * Start the sync service
   * @param {Object} options - Start options
   * @param {boolean} options.immediate - Run immediately on start
   */
  function start(options = {}) {
    if (syncInterval) {
      log.warn('Playcount sync service already running');
      return;
    }

    log.info('Starting playcount sync service', {
      syncInterval: `${syncIntervalMs / 1000 / 60 / 60} hours`,
      staleThreshold: `${staleThresholdMs / 1000 / 60 / 60} hours`,
    });

    const initialDelay = options.immediate ? 0 : STARTUP_DELAY_MS;
    setTimeout(() => {
      runSyncCycle().catch((err) => {
        log.error('Initial playcount sync cycle failed', {
          error: err.message,
        });
      });
    }, initialDelay);

    syncInterval = setInterval(() => {
      runSyncCycle().catch((err) => {
        log.error('Scheduled playcount sync cycle failed', {
          error: err.message,
        });
      });
    }, syncIntervalMs);
  }

  function stop() {
    if (syncInterval) {
      clearInterval(syncInterval);
      syncInterval = null;
      log.info('Playcount sync service stopped');
    }
  }

  function isSyncing() {
    return isRunning;
  }

  function isStarted() {
    return syncInterval !== null;
  }

  return {
    start,
    stop,
    isStarted,
    isSyncing,
    runSyncCycle,
    syncUserPlaycounts: (user) => syncUserPlaycounts(db, log, user),
    getUsersNeedingSync: (limit) =>
      getUsersNeedingSync(db, staleThresholdMs, limit),
    getUserAlbums: (userId) => getUserAlbums(db, userId),
    refreshSingleAlbum,
  };
}

module.exports = {
  createPlaycountSyncService,
  upsertPlaycount,
  refreshAlbumPlaycount,
};
