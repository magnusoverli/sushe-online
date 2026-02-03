/**
 * Cover Fetch Queue
 *
 * Asynchronously fetches album cover images in the background to avoid
 * blocking the main album-adding flow. Uses the existing RequestQueue
 * pattern for controlled concurrency.
 */

const { RequestQueue } = require('./request-queue');
const logger = require('./logger');
const { normalizeForExternalApi } = require('./normalization');

/**
 * Factory function to create a CoverFetchQueue with dependency injection
 *
 * @param {Object} deps - Dependencies
 * @param {Object} deps.pool - Database connection pool
 * @param {Function} deps.fetch - Fetch function (for testing)
 * @param {number} deps.maxConcurrent - Max concurrent fetches (default: 3)
 * @returns {Object} - CoverFetchQueue instance
 */
function createCoverFetchQueue(deps = {}) {
  const maxConcurrent = deps.maxConcurrent || 3;
  const queue = new RequestQueue(maxConcurrent);
  const fetchFn = deps.fetch || fetch;

  /**
   * Add album to cover fetch queue
   *
   * @param {string} albumId - Album ID (MusicBrainz or internal)
   * @param {string} artist - Artist name for Deezer search
   * @param {string} album - Album name for Deezer search
   * @returns {Promise<void>}
   */
  async function add(albumId, artist, album) {
    if (!albumId || !artist || !album) {
      logger.debug('Skipping cover fetch: missing required fields', {
        albumId,
        hasArtist: !!artist,
        hasAlbum: !!album,
      });
      return;
    }

    logger.debug('Queueing cover fetch', { albumId, artist, album });

    return queue.add(async () => {
      try {
        await fetchAndStoreCover(albumId, artist, album);
      } catch (error) {
        logger.warn('Cover fetch failed', {
          albumId,
          artist,
          album,
          error: error.message,
        });
        // Don't throw - cover fetch failures shouldn't block the queue
      }
    });
  }

  /**
   * Fetch cover from Deezer and store in database
   *
   * @param {string} albumId - Album ID to update
   * @param {string} artist - Artist name
   * @param {string} album - Album name
   * @returns {Promise<void>}
   */
  async function fetchAndStoreCover(albumId, artist, album) {
    const pool = deps.pool;
    if (!pool) {
      throw new Error('Database pool not initialized');
    }

    // Search Deezer for cover with normalized names for better matching
    // Strips diacritics (e.g., "Exxûl" → "Exxul") and normalizes special chars
    const normalizedArtist = normalizeForExternalApi(artist);
    const normalizedAlbum = normalizeForExternalApi(album);
    const deezerQuery = `${normalizedArtist} ${normalizedAlbum}`;
    const deezerUrl = `https://api.deezer.com/search/album?q=${encodeURIComponent(deezerQuery)}`;

    logger.debug('Fetching cover from Deezer', {
      albumId,
      query: deezerQuery,
    });

    const response = await fetchFn(deezerUrl);

    if (!response.ok) {
      throw new Error(
        `Deezer API error: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();

    if (!data.data || data.data.length === 0) {
      logger.debug('No Deezer cover found', { albumId, artist, album });
      return;
    }

    // Get high-res cover URL
    const coverUrl = data.data[0].cover_xl || data.data[0].cover_big;
    if (!coverUrl) {
      logger.debug('Deezer result has no cover URL', { albumId });
      return;
    }

    // Fetch image binary
    logger.debug('Downloading cover image', { albumId, coverUrl });
    const imageResponse = await fetchFn(coverUrl);

    if (!imageResponse.ok) {
      throw new Error(
        `Image download failed: ${imageResponse.status} ${imageResponse.statusText}`
      );
    }

    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

    // Detect format from content-type
    const contentType =
      imageResponse.headers.get('content-type') || 'image/jpeg';
    const format = contentType.split('/')[1].toUpperCase();

    // Update database
    logger.debug('Storing cover in database', {
      albumId,
      size: imageBuffer.length,
      format,
    });

    const result = await pool.query(
      'UPDATE albums SET cover_image = $1, cover_image_format = $2, updated_at = NOW() WHERE album_id = $3',
      [imageBuffer, format, albumId]
    );

    if (result.rowCount === 0) {
      logger.warn('Album not found when updating cover', { albumId });
      return;
    }

    logger.info('Cover fetched successfully', {
      albumId,
      artist,
      album,
      size: imageBuffer.length,
      format,
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
    fetchAndStoreCover,
    get length() {
      return getLength();
    },
  };
}

// Create and export singleton instance (will be initialized with pool later)
let coverFetchQueue = null;

/**
 * Initialize the singleton cover fetch queue
 * @param {Object} pool - Database connection pool
 */
function initializeCoverFetchQueue(pool) {
  if (!coverFetchQueue) {
    coverFetchQueue = createCoverFetchQueue({ pool });
    logger.info('Cover fetch queue initialized');
  }
  return coverFetchQueue;
}

/**
 * Get the singleton cover fetch queue instance
 * @returns {Object} - CoverFetchQueue instance
 */
function getCoverFetchQueue() {
  if (!coverFetchQueue) {
    throw new Error(
      'Cover fetch queue not initialized. Call initializeCoverFetchQueue(pool) first.'
    );
  }
  return coverFetchQueue;
}

module.exports = {
  createCoverFetchQueue,
  initializeCoverFetchQueue,
  getCoverFetchQueue,
};
