// services/album-summary.js
// Album summary fetching from Claude API

const logger = require('../utils/logger');
const {
  observeExternalApiCall,
  recordExternalApiError,
} = require('../utils/metrics');
const { fetchClaudeSummary } = require('../utils/claude-summary');

// Summary sources
const SUMMARY_SOURCES = {
  CLAUDE: 'claude',
};

/**
 * Strip HTML tags from a string
 * @param {string} html - HTML string to strip
 * @returns {string} Plain text
 */
function stripHtml(html) {
  if (!html) return '';
  return html
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
 * @returns {Promise<{summary: string|null, source: string|null, found: boolean}>}
 */
async function fetchAlbumSummary(artist, album) {
  if (!artist || !album) {
    return {
      summary: null,
      source: null,
      found: false,
    };
  }

  // Use Claude API as the sole source
  const claudeResult = await fetchClaudeSummary(artist, album);

  if (claudeResult.summary) {
    return {
      summary: claudeResult.summary,
      source: SUMMARY_SOURCES.CLAUDE,
      found: true,
    };
  }

  // No summary found
  return {
    summary: null,
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
  };
}

/**
 * Invalidate caches for all users who have a specific album in their lists
 * @param {Object} params - Parameters
 * @param {Object} params.pool - PostgreSQL pool
 * @param {Object} params.responseCache - Response cache instance
 * @param {Object} params.logger - Logger instance
 * @param {string} params.albumId - Album ID to invalidate caches for
 */
async function invalidateCachesForAlbum(pool, responseCache, logger, albumId) {
  if (!responseCache) return;

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
      logger.debug('Invalidated caches for users with album', {
        albumId,
        userCount: result.rows.length,
      });
    }
  } catch (err) {
    // Don't fail summary storage if cache invalidation fails
    logger.warn('Failed to invalidate caches after summary update', {
      albumId,
      error: err.message,
    });
  }
}

/**
 * Process batch job albums in background with controlled concurrency
 * @param {Object} batchJob - Batch job state object
 * @param {Function} fetchNextPage - Function that returns next page of albums
 * @param {Function} fetchAndStoreSummary - Function to fetch and store summary
 * @param {Object} log - Logger instance
 * @param {Object} pool - Database pool (for batch cache invalidation)
 * @param {Object} responseCache - Response cache instance (for batch cache invalidation)
 */
async function processBatchAlbumsPaged(
  batchJob,
  fetchNextPage,
  fetchAndStoreSummary,
  log,
  pool,
  responseCache
) {
  // Concurrent processing configuration
  // Default to 3 for improved batch processing speed
  const CONCURRENCY = parseInt(
    process.env.ALBUM_SUMMARY_CONCURRENCY || '3',
    10
  );

  setImmediate(async () => {
    const inFlight = new Map(); // Map to track promises with their album info
    const processedAlbumIds = []; // Track successfully processed album IDs for cache invalidation
    let queue = [];
    let isExhausted = false;

    try {
      while (!isExhausted || queue.length > 0 || inFlight.size > 0) {
        if (!batchJob.running) {
          log.info('Batch job cancelled', {
            processed: batchJob.processed,
            remaining: queue.length + inFlight.size,
          });
          break;
        }

        if (queue.length === 0 && !isExhausted) {
          const nextPage = await fetchNextPage();
          if (!nextPage || nextPage.length === 0) {
            isExhausted = true;
          } else {
            queue = nextPage;
          }
        }

        // Start new requests up to concurrency limit
        while (queue.length > 0 && inFlight.size < CONCURRENCY) {
          const album = queue.shift();

          const promise = (async () => {
            try {
              const result = await fetchAndStoreSummary(album.album_id, {
                skipCacheInvalidation: true, // Will invalidate in batch at the end
                skipBroadcast: true, // Prevent WebSocket flood during batch
              });
              batchJob.processed++;

              if (result.success) {
                if (result.hasSummary) {
                  batchJob.found++;
                  processedAlbumIds.push(album.album_id); // Track for cache invalidation
                } else {
                  batchJob.notFound++;
                }
              } else {
                batchJob.errors++;
              }

              if (batchJob.processed % 10 === 0) {
                log.info('Batch summary fetch progress', {
                  processed: batchJob.processed,
                  total: batchJob.total,
                  found: batchJob.found,
                  inFlight: inFlight.size,
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
          })();

          inFlight.set(promise, album);

          // Clean up completed promise
          promise.finally(() => {
            inFlight.delete(promise);
          });
        }

        // Wait for at least one request to complete before starting more
        if (inFlight.size > 0) {
          await Promise.race(inFlight.keys());
        }
      }
    } catch (err) {
      log.error('Batch summary fetch failed', {
        error: err.message,
        stack: err.stack,
      });
    }

    batchJob.running = false;

    const durationSeconds = Math.round(
      (Date.now() - new Date(batchJob.startedAt).getTime()) / 1000
    );

    log.info('Batch summary fetch completed', {
      total: batchJob.total,
      found: batchJob.found,
      notFound: batchJob.notFound,
      errors: batchJob.errors,
      duration: `${durationSeconds}s`,
    });

    // Batch cache invalidation: invalidate caches once at the end
    if (responseCache && pool && processedAlbumIds.length > 0) {
      try {
        // Use explicit album IDs instead of timestamps to avoid race conditions
        const affectedUsers = await pool.query(
          `SELECT DISTINCT l.user_id 
           FROM lists l 
           JOIN list_items li ON li.list_id = l._id 
           WHERE li.album_id = ANY($1::text[])`,
          [processedAlbumIds]
        );

        for (const row of affectedUsers.rows) {
          responseCache.invalidate(`GET:/api/lists:${row.user_id}`);
        }

        log.info('Batch cache invalidation completed', {
          userCount: affectedUsers.rows.length,
          albumsProcessed: processedAlbumIds.length,
        });
      } catch (err) {
        log.warn('Failed to invalidate caches after batch', {
          error: err.message,
        });
      }
    }
  });
}

/**
 * Create album summary service with injected dependencies
 * @param {Object} deps - Dependencies
 * @param {Object} deps.pool - PostgreSQL pool
 * @param {Object} deps.logger - Logger instance
 * @param {Object} deps.responseCache - Response cache instance (optional, for cache invalidation)
 * @param {Object} deps.broadcast - WebSocket broadcast service (optional, for real-time updates)
 */
function createAlbumSummaryService(deps = {}) {
  const log = deps.logger || logger;
  const pool = deps.pool;
  const responseCache = deps.responseCache;
  const broadcast = deps.broadcast;

  if (!pool) {
    throw new Error('Database pool is required');
  }

  // Batch job state
  let batchJob = null;

  /**
   * Fetch and store summary for a single album by album_id
   * @param {string} albumId - The album ID
   * @param {Object} options - Options
   * @param {boolean} options.skipCacheInvalidation - Skip immediate cache invalidation (for batch processing)
   * @param {boolean} options.skipBroadcast - Skip WebSocket broadcast (for batch processing)
   */
  async function fetchAndStoreSummary(albumId, options = {}) {
    const startTime = Date.now();
    let albumRecord = null;
    const { skipCacheInvalidation = false, skipBroadcast = false } = options;

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

      // Validate artist and album before API call
      if (
        !albumRecord.artist ||
        !albumRecord.album ||
        albumRecord.artist.trim() === '' ||
        albumRecord.album.trim() === ''
      ) {
        log.warn('Skipping summary fetch - invalid artist/album', {
          albumId,
          artist: albumRecord.artist || '(empty)',
          album: albumRecord.album || '(empty)',
          reason: 'empty_or_whitespace_only',
        });

        // Mark as attempted to prevent retries
        await pool.query(
          `UPDATE albums SET summary_fetched_at = NOW() WHERE album_id = $1`,
          [albumId]
        );

        return {
          success: true,
          hasSummary: false,
          source: null,
          skipped: true,
        };
      }

      const { summary, source } = await fetchAlbumSummary(
        albumRecord.artist.trim(),
        albumRecord.album.trim()
      );

      await pool.query(
        `UPDATE albums SET summary = $1, summary_source = $2, summary_fetched_at = NOW() WHERE album_id = $3`,
        [summary, source, albumId]
      );

      // Invalidate caches for all users who have this album in their lists
      // Skip during batch processing (will be done at the end for efficiency)
      if (!skipCacheInvalidation) {
        await invalidateCachesForAlbum(pool, responseCache, log, albumId);
      }

      // Broadcast summary update to all users who have this album in their lists
      // Skip during batch processing to avoid flooding WebSocket clients
      if (summary && broadcast && !skipBroadcast) {
        try {
          const usersResult = await pool.query(
            `SELECT DISTINCT l.user_id 
             FROM lists l 
             JOIN list_items li ON li.list_id = l._id 
             WHERE li.album_id = $1`,
            [albumId]
          );

          for (const row of usersResult.rows) {
            broadcast.albumSummaryUpdated(row.user_id, albumId);
          }

          if (usersResult.rows.length > 0) {
            log.debug('Broadcasted summary update to users', {
              albumId,
              userCount: usersResult.rows.length,
            });
          }
        } catch (broadcastErr) {
          // Don't fail summary storage if broadcast fails
          log.warn('Failed to broadcast summary update', {
            albumId,
            error: broadcastErr.message,
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
        artist: albumRecord?.artist || '(unknown)',
        album: albumRecord?.album || '(unknown)',
        operation: 'fetchAndStoreSummary',
      });
      return {
        success: false,
        hasSummary: false,
        source: null,
        error: err.message,
      };
    }
  }

  /**
   * Hash album ID to integer for PostgreSQL advisory lock
   * @param {string} albumId - Album ID string
   * @returns {number} Integer hash suitable for pg_advisory_lock
   */
  function hashAlbumId(albumId) {
    // Convert album_id string to integer for advisory lock
    // Use simple hash function (FNV-1a variant)
    let hash = 2166136261;
    for (let i = 0; i < albumId.length; i++) {
      hash ^= albumId.charCodeAt(i);
      hash +=
        (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return Math.abs(hash) % 2147483647; // PostgreSQL int4 range
  }

  /** Fetch summary for a new album (non-blocking) */
  function fetchSummaryAsync(albumId, _artist, _album) {
    // Use setImmediate to ensure this runs after the current call stack
    // Wrap in Promise.resolve().then() to properly handle async errors
    setImmediate(() => {
      Promise.resolve()
        .then(async () => {
          // Use advisory lock based on album_id hash to prevent race conditions
          const lockId = hashAlbumId(albumId);
          const client = await pool.connect();

          try {
            // Try to acquire lock (non-blocking)
            const lockResult = await client.query(
              'SELECT pg_try_advisory_lock($1) as acquired',
              [lockId]
            );

            if (!lockResult.rows[0].acquired) {
              log.debug('Summary fetch already in progress (lock held)', {
                albumId,
                lockId,
              });
              return; // Another process is handling this
            }

            log.debug('Acquired advisory lock for summary fetch', {
              albumId,
              lockId,
            });

            try {
              // Check if already fetched
              const existing = await client.query(
                'SELECT summary_fetched_at FROM albums WHERE album_id = $1',
                [albumId]
              );
              if (
                existing.rows.length > 0 &&
                existing.rows[0].summary_fetched_at
              ) {
                return; // Already fetched
              }
              await fetchAndStoreSummary(albumId);
            } finally {
              // Always release lock
              await client.query('SELECT pg_advisory_unlock($1)', [lockId]);
              log.debug('Released advisory lock for summary fetch', {
                albumId,
                lockId,
              });
            }
          } catch (err) {
            log.warn('Async summary fetch failed', {
              albumId,
              error: err.message,
            });
          } finally {
            client.release();
          }
        })
        .catch((err) => {
          // Catch any unhandled rejections from the promise chain
          log.warn('Unhandled error in async summary fetch', {
            albumId,
            error: err.message,
          });
        });
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
        COUNT(DISTINCT a.album_id) FILTER (WHERE a.summary_source = 'claude') AS from_claude
      FROM albums a INNER JOIN list_items li ON li.album_id = a.album_id
    `);
    return parseStatsRow(result.rows[0]);
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
    const pageSize = parseInt(process.env.ALBUM_SUMMARY_PAGE_SIZE || '500', 10);

    const countResult = await pool.query(
      `SELECT COUNT(DISTINCT a.album_id) AS total
       FROM albums a INNER JOIN list_items li ON li.album_id = a.album_id
       WHERE ${whereClause}`
    );
    const total = parseInt(countResult.rows[0]?.total, 10) || 0;

    if (total === 0) {
      log.info('No albums need summary fetching');
      return;
    }

    log.info('Starting batch summary fetch', {
      albumCount: total,
      includeRetries,
      regenerateAll: !!regenerateAll,
      concurrency: parseInt(process.env.ALBUM_SUMMARY_CONCURRENCY || '3', 10),
    });
    batchJob = {
      running: true,
      total: total,
      processed: 0,
      found: 0,
      notFound: 0,
      errors: 0,
      startedAt: new Date().toISOString(),
    };

    let lastAlbumId = null;
    const fetchNextPage = async () => {
      const params = [];
      let pageWhere = `WHERE ${whereClause}`;

      if (lastAlbumId) {
        params.push(lastAlbumId);
        pageWhere += ` AND a.album_id > $${params.length}`;
      }

      params.push(pageSize);
      const limitParam = `$${params.length}`;

      const query = `SELECT DISTINCT a.album_id, a.artist, a.album
        FROM albums a
        INNER JOIN list_items li ON li.album_id = a.album_id
        ${pageWhere}
        ORDER BY a.album_id
        LIMIT ${limitParam}`;

      const result = await pool.query(query, params);
      if (result.rows.length > 0) {
        lastAlbumId = result.rows[result.rows.length - 1].album_id;
      }
      return result.rows;
    };

    processBatchAlbumsPaged(
      batchJob,
      fetchNextPage,
      fetchAndStoreSummary,
      log,
      pool,
      responseCache
    );
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
