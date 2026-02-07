/**
 * Track Fetch Queue
 *
 * Asynchronously fetches album track lists in the background to avoid
 * blocking the main album-adding flow. Uses the existing RequestQueue
 * pattern for controlled concurrency.
 *
 * Fetches tracks from Deezer and iTunes APIs (simpler and faster than
 * MusicBrainz for background operations).
 */

const { RequestQueue } = require('./request-queue');
const logger = require('./logger');
const { normalizeForExternalApi } = require('./normalization');

/**
 * Sanitize search query string for API requests
 * Now uses normalizeForExternalApi for consistent diacritic handling
 * @param {string} str - String to sanitize
 * @returns {string} - Sanitized string
 */
function sanitizeQuery(str = '') {
  // Use centralized normalization then remove extra punctuation
  return normalizeForExternalApi(str)
    .replace(/[()[\]{}]/g, '')
    .replace(/[.,!?]/g, '')
    .replace(/\s{2,}/g, ' ');
}

/**
 * Factory function to create a TrackFetchQueue with dependency injection
 *
 * @param {Object} deps - Dependencies
 * @param {Object} deps.pool - Database connection pool
 * @param {Function} deps.fetch - Fetch function (for testing)
 * @param {number} deps.maxConcurrent - Max concurrent fetches (default: 2)
 * @returns {Object} - TrackFetchQueue instance
 */
function createTrackFetchQueue(deps = {}) {
  const maxConcurrent = deps.maxConcurrent || 2;
  const queue = new RequestQueue(maxConcurrent);
  const fetchFn = deps.fetch || fetch;
  const log = deps.logger || logger;

  /**
   * Add album to track fetch queue
   *
   * @param {string} albumId - Album ID (MusicBrainz or internal)
   * @param {string} artist - Artist name for search
   * @param {string} album - Album name for search
   * @returns {Promise<void>}
   */
  async function add(albumId, artist, album) {
    if (!albumId || !artist || !album) {
      log.debug('Skipping track fetch: missing required fields', {
        albumId,
        hasArtist: !!artist,
        hasAlbum: !!album,
      });
      return;
    }

    log.debug('Queueing track fetch', { albumId, artist, album });

    return queue.add(async () => {
      try {
        await fetchAndStoreTracks(albumId, artist, album);
      } catch (error) {
        log.warn('Track fetch failed', {
          albumId,
          artist,
          album,
          error: error.message,
        });
        // Don't throw - track fetch failures shouldn't block the queue
      }
    });
  }

  /**
   * Fetch tracks from iTunes API
   *
   * @param {string} artistClean - Sanitized artist name
   * @param {string} albumClean - Sanitized album name
   * @returns {Promise<Object|null>} - { tracks, source } or null
   */
  async function fetchItunesTracks(artistClean, albumClean) {
    try {
      // artistClean and albumClean are already normalized via sanitizeQuery
      const term = `${artistClean} ${albumClean}`;
      const searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=album&limit=5`;
      const resp = await fetchFn(searchUrl);
      if (!resp.ok) return null;
      const data = await resp.json();
      if (!data.results || !data.results.length) return null;
      const best = data.results[0];
      if (!best.collectionId) return null;
      const lookup = await fetchFn(
        `https://itunes.apple.com/lookup?id=${best.collectionId}&entity=song`
      );
      if (!lookup.ok) return null;
      const lookupData = await lookup.json();
      const tracks = (lookupData.results || [])
        .filter((r) => r.wrapperType === 'track')
        .map((r) => ({
          name: r.trackName,
          length: r.trackTimeMillis || null,
        }));
      return tracks.length ? { tracks, source: 'itunes' } : null;
    } catch (err) {
      log.debug('iTunes track fetch error', { error: err.message });
      return null;
    }
  }

  /**
   * Fetch tracks from Deezer API
   *
   * @param {string} artistClean - Sanitized artist name
   * @param {string} albumClean - Sanitized album name
   * @returns {Promise<Object|null>} - { tracks, source } or null
   */
  async function fetchDeezerTracks(artistClean, albumClean) {
    try {
      // artistClean and albumClean are already normalized via sanitizeQuery
      const q = `${artistClean} ${albumClean}`;
      const searchResp = await fetchFn(
        `https://api.deezer.com/search/album?q=${encodeURIComponent(q)}&limit=5`
      );
      if (!searchResp.ok) return null;
      const data = await searchResp.json();
      const deezerAlbumId = data.data && data.data[0] && data.data[0].id;
      if (!deezerAlbumId) return null;
      const albumResp = await fetchFn(
        `https://api.deezer.com/album/${deezerAlbumId}`
      );
      if (!albumResp.ok) return null;
      const albumData = await albumResp.json();
      const tracks = (albumData.tracks?.data || []).map((t) => ({
        name: t.title,
        length: t.duration ? t.duration * 1000 : null,
      }));
      return tracks.length ? { tracks, source: 'deezer' } : null;
    } catch (err) {
      log.debug('Deezer track fetch error', { error: err.message });
      return null;
    }
  }

  /**
   * Fetch tracks from available sources and store in database
   *
   * @param {string} albumId - Album ID to update
   * @param {string} artist - Artist name
   * @param {string} album - Album name
   * @returns {Promise<void>}
   */
  async function fetchAndStoreTracks(albumId, artist, album) {
    const pool = deps.pool;
    if (!pool) {
      throw new Error('Database pool not initialized');
    }

    const artistClean = sanitizeQuery(artist);
    const albumClean = sanitizeQuery(album);

    log.debug('Fetching tracks', {
      albumId,
      artistClean,
      albumClean,
    });

    // Try both sources in parallel and use first successful result
    // Wrap each fetch to reject on null so Promise.any waits for actual data
    const wrapFetch = async (fetchFn) => {
      const result = await fetchFn();
      if (!result || !result.tracks || result.tracks.length === 0) {
        throw new Error('No tracks found');
      }
      return result;
    };

    let result;
    try {
      result = await Promise.any([
        wrapFetch(() => fetchDeezerTracks(artistClean, albumClean)),
        wrapFetch(() => fetchItunesTracks(artistClean, albumClean)),
      ]);
    } catch (_err) {
      // All sources failed or returned null
      log.debug('No tracks found from any source', { albumId, artist, album });
      return;
    }

    // Update database
    log.debug('Storing tracks in database', {
      albumId,
      trackCount: result.tracks.length,
      source: result.source,
    });

    const dbResult = await pool.query(
      'UPDATE albums SET tracks = $1, updated_at = NOW() WHERE album_id = $2',
      [JSON.stringify(result.tracks), albumId]
    );

    if (dbResult.rowCount === 0) {
      log.warn('Album not found when updating tracks', { albumId });
      return;
    }

    log.info('Tracks fetched successfully', {
      albumId,
      artist,
      album,
      trackCount: result.tracks.length,
      source: result.source,
    });
  }

  /**
   * Get current queue length (for monitoring)
   * @returns {number}
   */
  function getLength() {
    return queue.length;
  }

  return {
    add,
    fetchAndStoreTracks,
    // Expose internal functions for testing
    fetchItunesTracks,
    fetchDeezerTracks,
    get length() {
      return getLength();
    },
  };
}

// Create and export singleton instance (will be initialized with pool later)
let trackFetchQueue = null;

/**
 * Initialize the singleton track fetch queue
 * @param {Object} pool - Database connection pool
 */
function initializeTrackFetchQueue(pool) {
  if (!trackFetchQueue) {
    trackFetchQueue = createTrackFetchQueue({ pool });
    logger.info('Track fetch queue initialized');
  }
  return trackFetchQueue;
}

/**
 * Get the singleton track fetch queue instance
 * @returns {Object} - TrackFetchQueue instance
 */
function getTrackFetchQueue() {
  if (!trackFetchQueue) {
    throw new Error(
      'Track fetch queue not initialized. Call initializeTrackFetchQueue(pool) first.'
    );
  }
  return trackFetchQueue;
}

module.exports = {
  createTrackFetchQueue,
  initializeTrackFetchQueue,
  getTrackFetchQueue,
};
