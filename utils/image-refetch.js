/**
 * Image Refetch Service
 *
 * Refetches album cover images from external sources and reprocesses them
 * at higher quality (512x512 @ 100% JPEG).
 *
 * Uses Cover Art Archive and iTunes as image sources (no auth required).
 */

const sharp = require('sharp');
const logger = require('./logger');
const { normalizeForLookup } = require('./normalization');

// Image processing settings (matching migration 036)
const TARGET_SIZE = 512;
const JPEG_QUALITY = 100;

// Rate limiting for external APIs
const RATE_LIMIT_MS = 200; // 200ms between requests (5 req/sec)
const BATCH_SIZE = 50;

// Skip thresholds - images meeting these criteria are considered good quality
// Skip if: dimensions >= 512x512 OR file size >= 100KB
const SKIP_SIZE_THRESHOLD_KB = 100;
const SKIP_DIMENSION_THRESHOLD = 512;

// Cover art providers configuration
const COVER_ART_ARCHIVE_BASE = 'https://coverartarchive.org';
const ITUNES_API_BASE = 'https://itunes.apple.com/search';
const ITUNES_IMAGE_SIZE = 600; // Request 600x600 from iTunes

/**
 * Sleep for a specified duration
 * @param {number} ms - Milliseconds to sleep
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch image from URL and process it
 * @param {string} url - Image URL
 * @returns {Promise<Buffer|null>} - Processed image buffer or null
 */
async function fetchAndProcessImage(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'SuSheBot/1.0 (album-art-fetcher)',
      },
      signal: globalThis.AbortSignal.timeout(10000), // 10 second timeout
    });

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.startsWith('image/')) {
      return null;
    }

    const buffer = await response.arrayBuffer();

    // Process with sharp: resize and convert to JPEG
    const processedBuffer = await sharp(Buffer.from(buffer))
      .resize(TARGET_SIZE, TARGET_SIZE, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();

    return processedBuffer;
  } catch (_error) {
    // Silently return null for fetch errors
    return null;
  }
}

/**
 * Try to fetch cover art from Cover Art Archive using MusicBrainz data
 * @param {string} artist - Artist name
 * @param {string} album - Album name
 * @returns {Promise<Buffer|null>} - Image buffer or null
 */
async function fetchFromCoverArtArchive(artist, album) {
  try {
    // First, search MusicBrainz for the release group
    const searchQuery = encodeURIComponent(
      `artist:"${artist}" AND release:"${album}"`
    );
    const mbUrl = `https://musicbrainz.org/ws/2/release-group?query=${searchQuery}&limit=1&fmt=json`;

    const mbResponse = await fetch(mbUrl, {
      headers: {
        'User-Agent': 'SuSheBot/1.0 (album-art-fetcher)',
      },
      signal: globalThis.AbortSignal.timeout(10000),
    });

    if (!mbResponse.ok) {
      return null;
    }

    const mbData = await mbResponse.json();
    const releaseGroup = mbData['release-groups']?.[0];

    if (!releaseGroup?.id) {
      return null;
    }

    // Fetch cover art from Cover Art Archive
    // Try front-500 first for better quality, fall back to front-250
    const sizes = ['500', '250'];
    for (const size of sizes) {
      const coverUrl = `${COVER_ART_ARCHIVE_BASE}/release-group/${releaseGroup.id}/front-${size}`;
      const imageBuffer = await fetchAndProcessImage(coverUrl);
      if (imageBuffer) {
        return imageBuffer;
      }
    }

    return null;
  } catch (_error) {
    return null;
  }
}

/**
 * Try to fetch cover art from iTunes
 * @param {string} artist - Artist name
 * @param {string} album - Album name
 * @returns {Promise<Buffer|null>} - Image buffer or null
 */
async function fetchFromItunes(artist, album) {
  try {
    const searchTerm = `${artist} ${album}`;
    const url = `${ITUNES_API_BASE}?term=${encodeURIComponent(searchTerm)}&media=music&entity=album&limit=5`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'SuSheBot/1.0 (album-art-fetcher)',
      },
      signal: globalThis.AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    if (!data.results || data.results.length === 0) {
      return null;
    }

    // Find best matching result using centralized normalization
    const normalizedArtist = normalizeForLookup(artist);
    const normalizedAlbum = normalizeForLookup(album);

    let bestMatch = null;
    for (const result of data.results) {
      const resultArtist = normalizeForLookup(result.artistName);
      const resultAlbum = normalizeForLookup(result.collectionName);

      // Check for reasonable match
      if (
        resultArtist.includes(normalizedArtist) ||
        normalizedArtist.includes(resultArtist)
      ) {
        if (
          resultAlbum.includes(normalizedAlbum) ||
          normalizedAlbum.includes(resultAlbum)
        ) {
          bestMatch = result;
          break;
        }
      }
    }

    // Fall back to first result if no good match
    if (!bestMatch && data.results[0]?.artworkUrl100) {
      bestMatch = data.results[0];
    }

    if (!bestMatch?.artworkUrl100) {
      return null;
    }

    // Convert artwork URL to higher resolution
    const artworkUrl = bestMatch.artworkUrl100.replace(
      /\/\d+x\d+bb\./,
      `/${ITUNES_IMAGE_SIZE}x${ITUNES_IMAGE_SIZE}bb.`
    );

    return await fetchAndProcessImage(artworkUrl);
  } catch (_error) {
    return null;
  }
}

/**
 * Fetch cover art for an album from external sources
 * Tries Cover Art Archive first, then iTunes
 * @param {string} artist - Artist name
 * @param {string} album - Album name
 * @returns {Promise<Buffer|null>} - Image buffer or null
 */
async function fetchCoverArt(artist, album) {
  if (!artist || !album) {
    return null;
  }

  // Try Cover Art Archive first (generally better quality)
  let imageBuffer = await fetchFromCoverArtArchive(artist, album);
  if (imageBuffer) {
    return imageBuffer;
  }

  // Rate limit before trying next source
  await sleep(RATE_LIMIT_MS);

  // Try iTunes as fallback
  imageBuffer = await fetchFromItunes(artist, album);
  return imageBuffer;
}

/**
 * Create image refetch service
 * @param {Object} deps - Dependencies
 * @param {Object} deps.pool - PostgreSQL pool
 * @param {Object} deps.logger - Logger instance (optional)
 * @returns {Object} - Image refetch service
 */
// eslint-disable-next-line max-lines-per-function -- Factory function with multiple internal methods
function createImageRefetchService(deps = {}) {
  const pool = deps.pool;
  const log = deps.logger || logger;

  if (!pool) {
    throw new Error('PostgreSQL pool is required');
  }

  // Job state
  let isRunning = false;
  let shouldStop = false;
  let currentProgress = null;

  /**
   * Get statistics about album images
   * @returns {Promise<Object>} - Image statistics
   */
  async function getStats() {
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total_albums,
        COUNT(cover_image) as with_image,
        COUNT(*) - COUNT(cover_image) as without_image,
        ROUND(AVG(OCTET_LENGTH(cover_image)) / 1024, 1) as avg_size_kb,
        ROUND(MAX(OCTET_LENGTH(cover_image)) / 1024, 1) as max_size_kb,
        ROUND(MIN(NULLIF(OCTET_LENGTH(cover_image), 0)) / 1024, 1) as min_size_kb
      FROM albums
    `);

    const row = result.rows[0];
    return {
      totalAlbums: parseInt(row.total_albums, 10),
      withImage: parseInt(row.with_image, 10),
      withoutImage: parseInt(row.without_image, 10),
      avgSizeKb: parseFloat(row.avg_size_kb) || 0,
      maxSizeKb: parseFloat(row.max_size_kb) || 0,
      minSizeKb: parseFloat(row.min_size_kb) || 0,
    };
  }

  /**
   * Check if a job is currently running
   * @returns {boolean}
   */
  function isJobRunning() {
    return isRunning;
  }

  /**
   * Stop the current job
   * @returns {boolean} - True if a job was running and will be stopped
   */
  function stopJob() {
    if (isRunning) {
      shouldStop = true;
      return true;
    }
    return false;
  }

  /**
   * Get current job progress
   * @returns {Object|null} - Current progress or null if not running
   */
  function getProgress() {
    if (!isRunning || !currentProgress) {
      return null;
    }
    return { ...currentProgress };
  }

  /**
   * Check if an album should be skipped based on existing image quality
   * Skip if: file size >= 145KB OR dimensions >= 512x512
   * @param {string} albumId - Album ID
   * @param {number} imageSizeBytes - Current image size in bytes
   * @returns {Promise<boolean>} - True if album should be skipped
   */
  async function shouldSkipAlbum(albumId, imageSizeBytes) {
    const imageSizeKb = imageSizeBytes / 1024;

    // Quick check: file size threshold
    if (imageSizeKb >= SKIP_SIZE_THRESHOLD_KB) {
      return true;
    }

    // No image - don't skip
    if (imageSizeBytes === 0) {
      return false;
    }

    // Has image but under size threshold - check dimensions
    try {
      const imageResult = await pool.query(
        'SELECT cover_image FROM albums WHERE album_id = $1',
        [albumId]
      );
      if (imageResult.rows[0]?.cover_image) {
        const metadata = await sharp(
          imageResult.rows[0].cover_image
        ).metadata();
        if (
          metadata.width >= SKIP_DIMENSION_THRESHOLD &&
          metadata.height >= SKIP_DIMENSION_THRESHOLD
        ) {
          return true;
        }
      }
    } catch {
      // If we can't read the image, don't skip - try to refetch
    }

    return false;
  }

  /**
   * Refetch all album images
   * @returns {Promise<Object>} - Summary of the operation
   */
  async function refetchAllImages() {
    if (isRunning) {
      throw new Error('Image refetch job is already running');
    }

    isRunning = true;
    shouldStop = false;

    const summary = {
      total: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      startedAt: new Date().toISOString(),
      completedAt: null,
      durationSeconds: 0,
      stoppedEarly: false,
    };

    // Initialize progress tracking
    currentProgress = {
      total: 0,
      processed: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      percentComplete: 0,
      startedAt: summary.startedAt,
    };

    try {
      log.info('Starting image refetch job');

      const pageSize = parseInt(
        process.env.IMAGE_REFETCH_PAGE_SIZE || String(BATCH_SIZE),
        10
      );
      const skipSizeThresholdBytes = SKIP_SIZE_THRESHOLD_KB * 1024;

      const totalResult = await pool.query(
        'SELECT COUNT(*) AS total FROM albums'
      );
      const totalAlbums = parseInt(totalResult.rows[0]?.total, 10) || 0;

      const candidateResult = await pool.query(
        `SELECT COUNT(*) AS total
         FROM albums
         WHERE COALESCE(OCTET_LENGTH(cover_image), 0) < $1`,
        [skipSizeThresholdBytes]
      );
      const candidateAlbums = parseInt(candidateResult.rows[0]?.total, 10) || 0;

      summary.total = totalAlbums;
      currentProgress.total = totalAlbums;

      const preSkipped = Math.max(totalAlbums - candidateAlbums, 0);
      summary.skipped = preSkipped;
      currentProgress.skipped = preSkipped;
      currentProgress.processed = preSkipped;
      currentProgress.percentComplete =
        totalAlbums > 0 ? Math.round((preSkipped / totalAlbums) * 100) : 0;

      log.info(`Found ${candidateAlbums} albums to process`);

      if (candidateAlbums === 0) {
        summary.completedAt = new Date().toISOString();
        summary.durationSeconds = Math.round(
          (new Date(summary.completedAt) - new Date(summary.startedAt)) / 1000
        );
        log.info('Image refetch job completed', summary);
        return summary;
      }

      let lastAlbumId = null;
      while (true) {
        if (shouldStop) {
          summary.stoppedEarly = true;
          log.info('Image refetch job stopped by user');
          break;
        }
        const params = [skipSizeThresholdBytes];
        let whereClause = `WHERE COALESCE(OCTET_LENGTH(cover_image), 0) < $1`;
        if (lastAlbumId) {
          params.push(lastAlbumId);
          whereClause += ` AND album_id > $${params.length}`;
        }
        params.push(pageSize);
        const limitParam = `$${params.length}`;

        const albumsResult = await pool.query(
          `SELECT album_id, artist, album,
                  COALESCE(OCTET_LENGTH(cover_image), 0) as image_size_bytes
           FROM albums
           ${whereClause}
           ORDER BY album_id
           LIMIT ${limitParam}`,
          params
        );
        const batch = albumsResult.rows;
        if (batch.length === 0) {
          break;
        }
        lastAlbumId = batch[batch.length - 1].album_id;

        for (const album of batch) {
          if (shouldStop) {
            summary.stoppedEarly = true;
            break;
          }

          // Skip albums that already have good quality images
          // Skip if: file size >= 145KB OR dimensions >= 512x512
          const shouldSkip = await shouldSkipAlbum(
            album.album_id,
            album.image_size_bytes
          );

          if (shouldSkip) {
            summary.skipped++;
            currentProgress.skipped++;
            // Update progress
            const processed =
              summary.success + summary.failed + summary.skipped;
            currentProgress.processed = processed;
            currentProgress.percentComplete =
              summary.total > 0
                ? Math.round((processed / summary.total) * 100)
                : 0;
            continue;
          }

          try {
            // Fetch new cover art
            const imageBuffer = await fetchCoverArt(album.artist, album.album);

            if (imageBuffer) {
              // Update the album with new image
              await pool.query(
                `UPDATE albums 
                 SET cover_image = $1, cover_image_format = 'JPEG', updated_at = NOW()
                 WHERE album_id = $2`,
                [imageBuffer, album.album_id]
              );
              summary.success++;
              currentProgress.success++;
            } else {
              summary.failed++;
              currentProgress.failed++;
            }
          } catch (error) {
            log.error('Error processing album image', {
              albumId: album.album_id,
              artist: album.artist,
              album: album.album,
              error: error.message,
            });
            summary.failed++;
            currentProgress.failed++;
          }

          // Update progress (after fetch attempt)
          const processedAfterFetch =
            summary.success + summary.failed + summary.skipped;
          currentProgress.processed = processedAfterFetch;
          currentProgress.percentComplete =
            summary.total > 0
              ? Math.round((processedAfterFetch / summary.total) * 100)
              : 0;

          // Rate limiting between albums
          await sleep(RATE_LIMIT_MS);
        }

        // Log progress every page
        const processed = summary.success + summary.failed + summary.skipped;
        log.info('Image refetch progress', {
          processed,
          total: summary.total,
          success: summary.success,
          failed: summary.failed,
          progress: `${Math.round((processed / summary.total) * 100)}%`,
        });
      }

      summary.completedAt = new Date().toISOString();
      summary.durationSeconds = Math.round(
        (new Date(summary.completedAt) - new Date(summary.startedAt)) / 1000
      );

      log.info('Image refetch job completed', summary);

      return summary;
    } finally {
      isRunning = false;
      shouldStop = false;
      currentProgress = null;
    }
  }

  return {
    getStats,
    isJobRunning,
    stopJob,
    getProgress,
    refetchAllImages,
  };
}

module.exports = {
  createImageRefetchService,
};
