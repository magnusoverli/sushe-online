// utils/album-summary.js
// Album summary fetching from Claude API

const logger = require('./logger');
const { observeExternalApiCall, recordExternalApiError } = require('./metrics');
const { fetchClaudeSummary } = require('./claude-summary');

// Summary sources
const SUMMARY_SOURCES = {
  CLAUDE: 'claude',
  // Legacy sources kept for backward compatibility with existing data
  LASTFM: 'lastfm',
  WIKIPEDIA: 'wikipedia',
};

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
 * Fetch album summary from Claude API
 *
 * @param {string} artist - Artist name
 * @param {string} album - Album name
 * @returns {Promise<{summary: string|null, lastfmUrl: string|null, wikipediaUrl: string|null, source: string|null, found: boolean}>}
 */
async function fetchAlbumSummary(artist, album) {
  if (!artist || !album) {
    return {
      summary: null,
      lastfmUrl: null,
      wikipediaUrl: null,
      source: null,
      found: false,
    };
  }

  // Use Claude API as the sole source
  const claudeResult = await fetchClaudeSummary(artist, album);

  if (claudeResult.summary) {
    return {
      summary: claudeResult.summary,
      lastfmUrl: null, // Clear Last.fm URL for new Claude summaries
      wikipediaUrl: null, // Clear Wikipedia URL for new Claude summaries
      source: SUMMARY_SOURCES.CLAUDE,
      found: true,
    };
  }

  // No summary found
  return {
    summary: null,
    lastfmUrl: null,
    wikipediaUrl: null,
    source: null,
    found: false,
  };
}

/**
 * Parse stats row from database query
 * @param {Object} row - Database row
 * @returns {Object} Parsed stats object
 */
function parseStatsRow(row) {
  return {
    totalAlbums: parseInt(row.total_albums, 10),
    withSummary: parseInt(row.with_summary, 10),
    attemptedNoSummary: parseInt(row.attempted_no_summary, 10),
    neverAttempted: parseInt(row.never_attempted, 10),
    pending:
      parseInt(row.never_attempted, 10) +
      parseInt(row.attempted_no_summary, 10),
    fromClaude: parseInt(row.from_claude, 10),
    // Deprecated: kept for backward compatibility
    fromLastfm: parseInt(row.from_lastfm || '0', 10),
    fromWikipedia: parseInt(row.from_wikipedia || '0', 10),
  };
}

/**
 * Create album summary service with injected dependencies
 * @param {Object} deps - Dependencies
 * @param {Object} deps.pool - PostgreSQL pool
 * @param {Object} deps.logger - Logger instance
 * @param {Object} deps.responseCache - Response cache instance (optional, for cache invalidation)
 */
function createAlbumSummaryService(deps = {}) {
  const log = deps.logger || logger;
  const pool = deps.pool;
  const responseCache = deps.responseCache;

  if (!pool) {
    throw new Error('Database pool is required');
  }

  // Batch job state
  let batchJob = null;

  /**
   * Fetch and store summary for a single album by album_id
   */
  async function fetchAndStoreSummary(albumId) {
    const startTime = Date.now();
    let albumRecord = null;

    try {
      const albumResult = await pool.query(
        'SELECT album_id, artist, album FROM albums WHERE album_id = $1',
        [albumId]
      );

      if (albumResult.rows.length === 0) {
        return {
          success: false,
          hasSummary: false,
          source: null,
          error: 'Album not found',
        };
      }

      albumRecord = albumResult.rows[0];
      const { summary, source } = await fetchAlbumSummary(
        albumRecord.artist,
        albumRecord.album
      );

      // Clear lastfm_url and wikipedia_url for Claude summaries (set to NULL)
      await pool.query(
        `UPDATE albums SET summary = $1, lastfm_url = NULL, wikipedia_url = NULL,
          summary_source = $2, summary_fetched_at = NOW() WHERE album_id = $3`,
        [summary, source, albumId]
      );

      // Invalidate caches for all users who have this album in their lists
      // This ensures summaries appear immediately after refresh/change list
      if (responseCache) {
        try {
          const result = await pool.query(
            `SELECT DISTINCT l.user_id 
             FROM lists l 
             JOIN list_items li ON li.list_id = l._id 
             WHERE li.album_id = $1`,
            [albumId]
          );

          for (const row of result.rows) {
            responseCache.invalidate(`GET:/api/lists:${row.user_id}`);
          }

          if (result.rows.length > 0) {
            log.debug('Invalidated caches for users with album', {
              albumId,
              userCount: result.rows.length,
            });
          }
        } catch (err) {
          // Don't fail summary storage if cache invalidation fails
          log.warn('Failed to invalidate caches after summary update', {
            albumId,
            error: err.message,
          });
        }
      }

      const duration = Date.now() - startTime;
      observeExternalApiCall(
        source || 'claude',
        'album.getInfo',
        duration,
        summary ? 200 : 404
      );
      return { success: true, hasSummary: !!summary, source };
    } catch (err) {
      recordExternalApiError('album_summary', 'summary_fetch_error');
      log.error('Error fetching album summary', {
        albumId,
        error: err.message,
        stack: err.stack,
        artist: albumRecord?.artist,
        album: albumRecord?.album,
      });
      return {
        success: false,
        hasSummary: false,
        source: null,
        error: err.message,
      };
    }
  }

  /** Fetch summary for a new album (non-blocking) */
  function fetchSummaryAsync(albumId, _artist, _album) {
    setImmediate(async () => {
      try {
        const existing = await pool.query(
          'SELECT summary_fetched_at FROM albums WHERE album_id = $1',
          [albumId]
        );
        if (existing.rows.length > 0 && existing.rows[0].summary_fetched_at)
          return;
        await fetchAndStoreSummary(albumId);
      } catch (err) {
        log.warn('Async summary fetch failed', { albumId, error: err.message });
      }
    });
  }

  /** Get batch job status */
  function getBatchStatus() {
    if (!batchJob) return null;
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

  /** Get summary statistics (only for albums that are in lists) */
  async function getStats() {
    const result = await pool.query(`
      SELECT COUNT(DISTINCT a.album_id) AS total_albums,
        COUNT(DISTINCT a.album_id) FILTER (WHERE a.summary IS NOT NULL) AS with_summary,
        COUNT(DISTINCT a.album_id) FILTER (WHERE a.summary_fetched_at IS NOT NULL AND a.summary IS NULL) AS attempted_no_summary,
        COUNT(DISTINCT a.album_id) FILTER (WHERE a.summary_fetched_at IS NULL) AS never_attempted,
        COUNT(DISTINCT a.album_id) FILTER (WHERE a.summary_source = 'claude') AS from_claude,
        COUNT(DISTINCT a.album_id) FILTER (WHERE a.summary_source = 'lastfm') AS from_lastfm,
        COUNT(DISTINCT a.album_id) FILTER (WHERE a.summary_source = 'wikipedia') AS from_wikipedia
      FROM albums a INNER JOIN list_items li ON li.album_id = a.album_id
    `);
    return parseStatsRow(result.rows[0]);
  }

  /** Process batch job albums in background */
  function processBatchAlbums(albums) {
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
            artist: album.artist,
            album: album.album,
            error: err.message,
            stack: err.stack,
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

  /** Start batch fetch job for albums without summaries */
  async function startBatchFetch(options = {}) {
    const includeRetries = options.includeRetries !== false;
    const regenerateAll = options.regenerateAll === true; // New option to regenerate all summaries
    if (batchJob?.running) throw new Error('Batch job already running');

    // If regenerateAll is true, fetch all albums (including those with summaries)
    const whereClause = regenerateAll
      ? '1=1' // All albums
      : includeRetries
        ? 'a.summary IS NULL'
        : 'a.summary_fetched_at IS NULL';
    const query = `SELECT DISTINCT a.album_id, a.artist, a.album FROM albums a
      INNER JOIN list_items li ON li.album_id = a.album_id WHERE ${whereClause} ORDER BY a.album_id`;

    const albumsResult = await pool.query(query);
    const albums = albumsResult.rows;

    if (albums.length === 0) {
      log.info('No albums need summary fetching');
      return;
    }

    log.info('Starting batch summary fetch', {
      albumCount: albums.length,
      includeRetries,
      regenerateAll: !!regenerateAll,
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

    processBatchAlbums(albums);
  }

  /** Stop the running batch job */
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
    stripHtml,
    generateNameVariations,
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
  fetchAlbumSummary,
  // Constants
  SUMMARY_SOURCES,
};
