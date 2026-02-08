/**
 * Cover Fetch Queue
 *
 * Asynchronously fetches album cover images in the background to avoid
 * blocking the main album-adding flow. Uses the existing RequestQueue
 * pattern for controlled concurrency.
 *
 * Tries multiple cover providers in order:
 * 1. Cover Art Archive (best for indie/classical, no rate limits)
 * 2. iTunes (excellent mainstream coverage)
 * 3. Deezer (good commercial coverage, European artists)
 *
 * All images are processed through sharp for consistent output:
 * - Resized to 512x512 (maintaining aspect ratio)
 * - Converted to JPEG at 100% quality
 */

const { RequestQueue } = require('./request-queue');
const logger = require('./logger');
const {
  normalizeForExternalApi,
  stringSimilarity,
} = require('./normalization');
const { processImage, upscaleItunesArtworkUrl } = require('./image-processing');

// Per-provider timeout in milliseconds
const PROVIDER_TIMEOUT_MS = 5000;

/**
 * Check if string is a valid MusicBrainz UUID
 * MusicBrainz release group IDs are standard UUID v4 format.
 * Manual entries have 'manual-' prefix and should be skipped for CAA.
 *
 * @param {string} id - Album ID to check
 * @returns {boolean} - True if valid MusicBrainz UUID
 */
function isValidMusicBrainzId(id) {
  if (!id || typeof id !== 'string') return false;
  if (id.startsWith('manual-')) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    id
  );
}

/**
 * Create cover art providers array
 * Each provider has a search function that returns an image buffer or null
 *
 * @param {Function} fetchFn - Fetch function to use (for dependency injection)
 * @returns {Array} - Array of provider objects
 */
function createCoverProviders(fetchFn) {
  return [
    // Provider 1: Cover Art Archive
    // Best for: indie, classical, jazz, metal (MusicBrainz has excellent coverage)
    // Requirements: Valid MusicBrainz UUID as album_id
    // Rate limits: None for image fetches
    {
      name: 'CoverArtArchive',
      search: async (albumId, _artist, _album) => {
        if (!isValidMusicBrainzId(albumId)) {
          return null;
        }

        // Try front-500 for higher quality
        const url = `https://coverartarchive.org/release-group/${albumId}/front-500`;

        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          PROVIDER_TIMEOUT_MS
        );

        try {
          const response = await fetchFn(url, {
            signal: controller.signal,
            headers: {
              'User-Agent': 'SuSheOnline/1.0 (cover-fetch-queue)',
            },
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            return null;
          }

          return Buffer.from(await response.arrayBuffer());
        } catch (error) {
          clearTimeout(timeoutId);
          if (error.name === 'AbortError') {
            logger.debug('CoverArtArchive request timed out', { albumId });
          }
          return null;
        }
      },
    },

    // Provider 2: iTunes
    // Best for: mainstream, commercial releases
    // Requirements: Artist and album name for search
    // Rate limits: ~20 req/min (handled gracefully)
    {
      name: 'iTunes',
      search: async (albumId, artist, album) => {
        if (!artist || !album) {
          return null;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          PROVIDER_TIMEOUT_MS
        );

        try {
          // Search iTunes API
          const normalizedArtist = normalizeForExternalApi(artist);
          const normalizedAlbum = normalizeForExternalApi(album);
          const searchTerm = `${normalizedArtist} ${normalizedAlbum}`;
          const searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(searchTerm)}&entity=album&country=us&limit=10`;

          const searchResponse = await fetchFn(searchUrl, {
            signal: controller.signal,
            headers: {
              'User-Agent': 'SuSheOnline/1.0 (cover-fetch-queue)',
              Accept: 'application/json',
            },
          });

          if (!searchResponse.ok) {
            clearTimeout(timeoutId);
            return null;
          }

          const data = await searchResponse.json();

          if (!data.results || data.results.length === 0) {
            clearTimeout(timeoutId);
            return null;
          }

          // Find best matching album using fuzzy matching
          let bestMatch = null;
          let bestScore = 0;

          for (const result of data.results) {
            if (!result.artworkUrl100) continue;

            const artistScore = stringSimilarity(
              artist,
              result.artistName || ''
            );
            const albumScore = stringSimilarity(
              album,
              result.collectionName || ''
            );
            const combinedScore = artistScore * 0.4 + albumScore * 0.6;

            if (combinedScore > bestScore) {
              bestScore = combinedScore;
              bestMatch = result;
            }
          }

          // Require minimum similarity threshold
          if (!bestMatch || bestScore < 0.5) {
            clearTimeout(timeoutId);
            return null;
          }

          // Convert artwork URL to high resolution
          const artworkUrl = upscaleItunesArtworkUrl(bestMatch.artworkUrl100);

          // Fetch the actual image
          const imageResponse = await fetchFn(artworkUrl, {
            signal: controller.signal,
            headers: {
              'User-Agent': 'SuSheOnline/1.0 (cover-fetch-queue)',
            },
          });

          clearTimeout(timeoutId);

          if (!imageResponse.ok) {
            return null;
          }

          return Buffer.from(await imageResponse.arrayBuffer());
        } catch (error) {
          clearTimeout(timeoutId);
          if (error.name === 'AbortError') {
            logger.debug('iTunes request timed out', {
              albumId,
              artist,
              album,
            });
          }
          return null;
        }
      },
    },

    // Provider 3: Deezer
    // Best for: European artists, electronic, commercial music
    // Requirements: Artist and album name for search
    // Rate limits: Generous, rarely an issue
    {
      name: 'Deezer',
      search: async (albumId, artist, album) => {
        if (!artist || !album) {
          return null;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          PROVIDER_TIMEOUT_MS
        );

        try {
          const normalizedArtist = normalizeForExternalApi(artist);
          const normalizedAlbum = normalizeForExternalApi(album);
          const deezerQuery = `${normalizedArtist} ${normalizedAlbum}`;
          const deezerUrl = `https://api.deezer.com/search/album?q=${encodeURIComponent(deezerQuery)}`;

          const searchResponse = await fetchFn(deezerUrl, {
            signal: controller.signal,
          });

          if (!searchResponse.ok) {
            clearTimeout(timeoutId);
            return null;
          }

          const data = await searchResponse.json();

          if (!data.data || data.data.length === 0) {
            clearTimeout(timeoutId);
            return null;
          }

          // Get high-res cover URL (prefer cover_xl, fallback to cover_big)
          const coverUrl = data.data[0].cover_xl || data.data[0].cover_big;
          if (!coverUrl) {
            clearTimeout(timeoutId);
            return null;
          }

          // Fetch the actual image
          const imageResponse = await fetchFn(coverUrl, {
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (!imageResponse.ok) {
            return null;
          }

          return Buffer.from(await imageResponse.arrayBuffer());
        } catch (error) {
          clearTimeout(timeoutId);
          if (error.name === 'AbortError') {
            logger.debug('Deezer request timed out', {
              albumId,
              artist,
              album,
            });
          }
          return null;
        }
      },
    },
  ];
}

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
  const coverProviders = createCoverProviders(fetchFn);

  /**
   * Add album to cover fetch queue
   *
   * @param {string} albumId - Album ID (MusicBrainz or internal)
   * @param {string} artist - Artist name for search-based providers
   * @param {string} album - Album name for search-based providers
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
   * Fetch cover from providers and store in database
   * Tries each provider in order until one succeeds.
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

    // Try each provider in order until one succeeds
    for (const provider of coverProviders) {
      try {
        logger.debug(`Trying ${provider.name} for cover`, {
          albumId,
          artist,
          album,
        });

        const rawBuffer = await provider.search(albumId, artist, album);

        if (rawBuffer && rawBuffer.length > 0) {
          // Process image through sharp for consistent output
          const processedBuffer = await processImage(rawBuffer);

          // Store in database
          const result = await pool.query(
            'UPDATE albums SET cover_image = $1, cover_image_format = $2, updated_at = NOW() WHERE album_id = $3',
            [processedBuffer, 'JPEG', albumId]
          );

          if (result.rowCount === 0) {
            logger.warn('Album not found when updating cover', { albumId });
            return;
          }

          logger.info('Cover fetched successfully', {
            albumId,
            artist,
            album,
            provider: provider.name,
            rawSize: rawBuffer.length,
            processedSize: processedBuffer.length,
          });

          return; // Success - exit loop
        }
      } catch (error) {
        logger.debug(`${provider.name} failed for cover`, {
          albumId,
          error: error.message,
        });
        // Continue to next provider
      }
    }

    // All providers failed
    logger.debug('All cover providers failed', { albumId, artist, album });
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
