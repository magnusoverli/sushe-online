// utils/album-summary.js
// Album summary fetching from Last.fm wiki integration

const logger = require('./logger');
const { getAlbumInfo } = require('./lastfm-auth');
const { observeExternalApiCall, recordExternalApiError } = require('./metrics');

// Rate limiter: 2 requests per second to Last.fm
const RATE_LIMIT_MS = 500; // 500ms between requests = 2/sec
let lastRequestTime = 0;

/**
 * Strip HTML tags from a string
 * @param {string} html - HTML string to strip
 * @returns {string} Plain text
 */
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<a[^>]*href="([^"]*)"[^>]*>Read more on Last\.fm<\/a>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Generate name variations for matching
 * @param {string} name - Original name
 * @returns {string[]} Array of variations to try
 */
function generateNameVariations(name) {
  if (!name) return [];

  const variations = [name];

  // Remove "The " prefix
  if (name.toLowerCase().startsWith('the ')) {
    variations.push(name.slice(4));
  }

  // Remove parenthetical content like "(Deluxe Edition)", "(Remaster)"
  const withoutParens = name.replace(/\s*\([^)]*\)\s*/g, '').trim();
  if (withoutParens && withoutParens !== name) {
    variations.push(withoutParens);
  }

  // Normalize punctuation: remove special chars
  const normalized = name
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"')
    .replace(/[–—]/g, '-')
    .trim();
  if (normalized !== name) {
    variations.push(normalized);
  }

  // Combination: no "The", no parentheses
  if (name.toLowerCase().startsWith('the ') && withoutParens !== name) {
    const combo = withoutParens.slice(4);
    if (combo && !variations.includes(combo)) {
      variations.push(combo);
    }
  }

  // Deduplicate while preserving order
  return [...new Set(variations)];
}

/**
 * Build Last.fm URL from artist and album names
 * @param {string} artist - Artist name
 * @param {string} album - Album name
 * @returns {string} Last.fm URL
 */
function buildLastfmUrl(artist, album) {
  // Last.fm URLs use URL-encoded names with + for spaces
  const encodeForLastfm = (str) => encodeURIComponent(str).replace(/%20/g, '+');
  return `https://www.last.fm/music/${encodeForLastfm(artist)}/${encodeForLastfm(album)}`;
}

/**
 * Wait for rate limit
 */
async function waitForRateLimit() {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < RATE_LIMIT_MS) {
    await new Promise((r) =>
      setTimeout(r, RATE_LIMIT_MS - timeSinceLastRequest)
    );
  }
  lastRequestTime = Date.now();
}

/**
 * Fetch album summary from Last.fm
 * Tries name variations until a match is found
 *
 * @param {string} artist - Artist name
 * @param {string} album - Album name
 * @returns {Promise<{summary: string|null, lastfmUrl: string|null, found: boolean}>}
 */
async function fetchAlbumSummary(artist, album) {
  if (!artist || !album) {
    return { summary: null, lastfmUrl: null, found: false };
  }

  const artistVariations = generateNameVariations(artist);
  const albumVariations = generateNameVariations(album);

  // Try combinations up to ~5 attempts
  const attempts = [];
  for (let i = 0; i < Math.min(artistVariations.length, 3); i++) {
    for (let j = 0; j < Math.min(albumVariations.length, 3); j++) {
      attempts.push({
        artist: artistVariations[i],
        album: albumVariations[j],
      });
      if (attempts.length >= 5) break;
    }
    if (attempts.length >= 5) break;
  }

  for (const attempt of attempts) {
    try {
      await waitForRateLimit();

      const info = await getAlbumInfo(attempt.artist, attempt.album, '');

      // Check if we got wiki data
      if (info && info.wiki && info.wiki.summary) {
        const summary = stripHtml(info.wiki.summary);
        // Use the actual artist/album names from Last.fm response for URL
        const responseArtist = info.artist || attempt.artist;
        const responseAlbum = info.name || attempt.album;
        const lastfmUrl =
          info.url || buildLastfmUrl(responseArtist, responseAlbum);

        logger.debug('Found album summary', {
          artist: attempt.artist,
          album: attempt.album,
          summaryLength: summary.length,
        });

        return {
          summary: summary || null,
          lastfmUrl,
          found: true,
        };
      }

      // Found the album but no wiki
      if (info && (info.name || info.artist)) {
        const responseArtist = info.artist || attempt.artist;
        const responseAlbum = info.name || attempt.album;
        return {
          summary: null,
          lastfmUrl: info.url || buildLastfmUrl(responseArtist, responseAlbum),
          found: true,
        };
      }
    } catch (err) {
      logger.debug('Last.fm lookup attempt failed', {
        artist: attempt.artist,
        album: attempt.album,
        error: err.message,
      });
      // Continue to next variation
    }
  }

  // No match found after all attempts
  return { summary: null, lastfmUrl: null, found: false };
}

/**
 * Create album summary service with injected dependencies
 * @param {Object} deps - Dependencies
 * @param {Object} deps.pool - PostgreSQL pool
 * @param {Object} deps.logger - Logger instance
 */
function createAlbumSummaryService(deps = {}) {
  const log = deps.logger || logger;
  const pool = deps.pool;

  if (!pool) {
    throw new Error('Database pool is required');
  }

  // Batch job state
  let batchJob = null;

  /**
   * Fetch and store summary for a single album by album_id
   * @param {string} albumId - The album_id
   * @returns {Promise<{success: boolean, hasSummary: boolean}>}
   */
  async function fetchAndStoreSummary(albumId) {
    const startTime = Date.now();

    try {
      // Get album info from database
      const albumResult = await pool.query(
        'SELECT album_id, artist, album FROM albums WHERE album_id = $1',
        [albumId]
      );

      if (albumResult.rows.length === 0) {
        return { success: false, hasSummary: false, error: 'Album not found' };
      }

      const albumRecord = albumResult.rows[0];
      const { summary, lastfmUrl } = await fetchAlbumSummary(
        albumRecord.artist,
        albumRecord.album
      );

      // Update database
      await pool.query(
        `UPDATE albums SET 
          summary = $1, 
          lastfm_url = $2, 
          summary_fetched_at = NOW() 
        WHERE album_id = $3`,
        [summary, lastfmUrl, albumId]
      );

      const duration = Date.now() - startTime;
      observeExternalApiCall(
        'lastfm',
        'album.getInfo',
        duration,
        summary ? 200 : 404
      );

      return { success: true, hasSummary: !!summary };
    } catch (err) {
      const duration = Date.now() - startTime;
      recordExternalApiError('lastfm', 'summary_fetch_error');
      log.error('Error fetching album summary', {
        albumId,
        error: err.message,
        duration,
      });
      return { success: false, hasSummary: false, error: err.message };
    }
  }

  /**
   * Fetch summary for a new album (non-blocking)
   * Called from upsertAlbumRecord
   * @param {string} albumId
   * @param {string} _artist - Artist name (unused, fetched from DB)
   * @param {string} _album - Album name (unused, fetched from DB)
   */
  function fetchSummaryAsync(albumId, _artist, _album) {
    // Fire and forget - don't block the response
    setImmediate(async () => {
      try {
        // Check if already fetched
        const existing = await pool.query(
          'SELECT summary_fetched_at FROM albums WHERE album_id = $1',
          [albumId]
        );

        if (existing.rows.length > 0 && existing.rows[0].summary_fetched_at) {
          return; // Already fetched
        }

        await fetchAndStoreSummary(albumId);
      } catch (err) {
        log.warn('Async summary fetch failed', { albumId, error: err.message });
      }
    });
  }

  /**
   * Get batch job status
   * @returns {Object|null}
   */
  function getBatchStatus() {
    if (!batchJob) {
      return null;
    }
    return {
      running: batchJob.running,
      total: batchJob.total,
      processed: batchJob.processed,
      found: batchJob.found,
      notFound: batchJob.notFound,
      errors: batchJob.errors,
      startedAt: batchJob.startedAt,
      progress:
        batchJob.total > 0
          ? Math.round((batchJob.processed / batchJob.total) * 100)
          : 0,
    };
  }

  /**
   * Get summary statistics
   * @returns {Promise<Object>}
   */
  async function getStats() {
    const result = await pool.query(`
      SELECT 
        COUNT(*) AS total_albums,
        COUNT(summary) AS with_summary,
        COUNT(summary_fetched_at) FILTER (WHERE summary IS NULL) AS attempted_no_summary,
        COUNT(*) FILTER (WHERE summary_fetched_at IS NULL) AS never_attempted
      FROM albums
    `);

    const row = result.rows[0];
    return {
      totalAlbums: parseInt(row.total_albums, 10),
      withSummary: parseInt(row.with_summary, 10),
      attemptedNoSummary: parseInt(row.attempted_no_summary, 10),
      neverAttempted: parseInt(row.never_attempted, 10),
      pending:
        parseInt(row.never_attempted, 10) +
        parseInt(row.attempted_no_summary, 10),
    };
  }

  /**
   * Start batch fetch job for all albums without summaries
   * @param {Object} options
   * @param {boolean} options.includeRetries - Whether to retry previously failed albums
   * @returns {Promise<void>}
   */
  async function startBatchFetch(options = {}) {
    const includeRetries = options.includeRetries !== false;

    if (batchJob?.running) {
      throw new Error('Batch job already running');
    }

    // Get albums that need summaries
    let query;
    if (includeRetries) {
      // All albums without a summary (including previously attempted ones)
      query =
        'SELECT album_id, artist, album FROM albums WHERE summary IS NULL ORDER BY updated_at DESC';
    } else {
      // Only albums never attempted
      query =
        'SELECT album_id, artist, album FROM albums WHERE summary_fetched_at IS NULL ORDER BY updated_at DESC';
    }

    const albumsResult = await pool.query(query);
    const albums = albumsResult.rows;

    if (albums.length === 0) {
      log.info('No albums need summary fetching');
      return;
    }

    log.info('Starting batch summary fetch', {
      albumCount: albums.length,
      includeRetries,
    });

    batchJob = {
      running: true,
      total: albums.length,
      processed: 0,
      found: 0,
      notFound: 0,
      errors: 0,
      startedAt: new Date().toISOString(),
    };

    // Process in background
    setImmediate(async () => {
      for (const album of albums) {
        if (!batchJob.running) {
          log.info('Batch job cancelled');
          break;
        }

        try {
          const result = await fetchAndStoreSummary(album.album_id);
          batchJob.processed++;

          if (result.success) {
            if (result.hasSummary) {
              batchJob.found++;
            } else {
              batchJob.notFound++;
            }
          } else {
            batchJob.errors++;
          }

          // Log progress every 50 albums
          if (batchJob.processed % 50 === 0) {
            log.info('Batch summary fetch progress', {
              processed: batchJob.processed,
              total: batchJob.total,
              found: batchJob.found,
              progress: `${Math.round((batchJob.processed / batchJob.total) * 100)}%`,
            });
          }
        } catch (err) {
          batchJob.processed++;
          batchJob.errors++;
          log.error('Batch fetch error for album', {
            albumId: album.album_id,
            error: err.message,
          });
        }
      }

      batchJob.running = false;
      log.info('Batch summary fetch completed', {
        total: batchJob.total,
        found: batchJob.found,
        notFound: batchJob.notFound,
        errors: batchJob.errors,
        duration: `${Math.round((Date.now() - new Date(batchJob.startedAt).getTime()) / 1000)}s`,
      });
    });
  }

  /**
   * Stop the running batch job
   */
  function stopBatchFetch() {
    if (batchJob?.running) {
      batchJob.running = false;
      log.info('Batch fetch stop requested');
      return true;
    }
    return false;
  }

  return {
    fetchAndStoreSummary,
    fetchSummaryAsync,
    getBatchStatus,
    getStats,
    startBatchFetch,
    stopBatchFetch,
    // Expose helpers for testing
    stripHtml,
    generateNameVariations,
    buildLastfmUrl,
  };
}

// Default instance (will be initialized with pool when needed)
let defaultInstance = null;

function getDefaultInstance(pool) {
  if (!defaultInstance && pool) {
    defaultInstance = createAlbumSummaryService({ pool });
  }
  return defaultInstance;
}

module.exports = {
  createAlbumSummaryService,
  getDefaultInstance,
  // Export helpers for testing
  stripHtml,
  generateNameVariations,
  buildLastfmUrl,
  fetchAlbumSummary,
};
