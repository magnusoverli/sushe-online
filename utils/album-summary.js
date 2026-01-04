// utils/album-summary.js
// Album summary fetching from Last.fm and Wikipedia

const logger = require('./logger');
const { getAlbumInfo } = require('./lastfm-auth');
const { observeExternalApiCall, recordExternalApiError } = require('./metrics');

// Summary sources in order of preference
const SUMMARY_SOURCES = {
  LASTFM: 'lastfm',
  WIKIPEDIA: 'wikipedia',
};

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
 * Build Wikipedia search query for an album
 * @param {string} artist - Artist name
 * @param {string} album - Album name
 * @returns {string} Search query
 */
function buildWikipediaSearchQuery(artist, album) {
  return `${album} album ${artist}`;
}

/**
 * Find the best matching album result from Wikipedia search results
 * @param {Array} results - Wikipedia search results
 * @param {string} albumName - Album name to match
 * @param {string} artistName - Artist name to match
 * @returns {Object|null} Best matching result or null
 */
function findBestWikipediaMatch(results, albumName, artistName) {
  const albumLower = albumName.toLowerCase();
  const artistLower = artistName.toLowerCase();
  let bestMatch = null;

  for (const result of results) {
    const titleLower = result.title.toLowerCase();
    const snippetLower = (result.snippet || '').toLowerCase();

    // Check if it's likely an album article
    const isAlbumArticle =
      snippetLower.includes('album') ||
      snippetLower.includes('studio album') ||
      snippetLower.includes('released') ||
      titleLower.includes(albumLower);

    // Check if artist is mentioned
    const hasArtist =
      snippetLower.includes(artistLower) || titleLower.includes(artistLower);

    if (isAlbumArticle && hasArtist) {
      return result; // Best match found
    }

    // Fallback: first result that mentions artist
    if (!bestMatch && hasArtist) {
      bestMatch = result;
    }
  }

  return bestMatch;
}

/**
 * Check if Wikipedia page description indicates an artist/band (not an album)
 * @param {string} description - Wikipedia page description
 * @returns {boolean} True if page appears to be about an artist/band
 */
function isArtistDescription(description) {
  const artistIndicators = [
    'band',
    'musician',
    'singer',
    'rapper',
    'artist',
    'group',
    'duo',
    'trio',
    'quartet',
    'composer',
    'producer',
    'dj',
    'vocalist',
    'guitarist',
    'drummer',
    'pianist',
  ];
  return artistIndicators.some((indicator) => description.includes(indicator));
}

/**
 * Check if Wikipedia page data represents an album
 * @param {Object} summaryData - Wikipedia page summary data
 * @returns {boolean} True if page appears to be about an album
 */
function isWikipediaAlbumPage(summaryData) {
  const description = (summaryData.description || '').toLowerCase();

  // First, reject if it looks like an artist/band page
  if (isArtistDescription(description)) {
    return false;
  }

  // Check description for album indicators
  if (
    description.includes('album') ||
    description.includes(' ep ') ||
    description.includes(' ep,') ||
    description.endsWith(' ep') ||
    description.includes('mixtape') ||
    description.includes('soundtrack')
  ) {
    return true;
  }

  // Fall back to checking the extract - but be more strict
  if (summaryData.extract) {
    const extractLower = summaryData.extract.toLowerCase();
    // Must have "studio album" or "is the...album" pattern, not just "album" anywhere
    const hasAlbumPattern =
      extractLower.includes('studio album') ||
      extractLower.includes('debut album') ||
      extractLower.includes('second album') ||
      extractLower.includes('third album') ||
      extractLower.includes('fourth album') ||
      extractLower.includes('fifth album') ||
      /is the \w+ album/.test(extractLower) ||
      /is an album/.test(extractLower);

    return hasAlbumPattern;
  }

  return false;
}

/**
 * Search Wikipedia for an album and get the summary
 * Uses Wikipedia's REST API for search and page summary
 *
 * @param {string} artist - Artist name
 * @param {string} album - Album name
 * @param {Function} fetchFn - Fetch function (for dependency injection)
 * @returns {Promise<{summary: string|null, wikipediaUrl: string|null, found: boolean}>}
 */
async function fetchWikipediaSummary(artist, album, fetchFn = fetch) {
  if (!artist || !album) {
    return { summary: null, wikipediaUrl: null, found: false };
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

      const searchQuery = buildWikipediaSearchQuery(
        attempt.artist,
        attempt.album
      );
      const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(searchQuery)}&format=json&srlimit=5`;

      const searchResp = await fetchFn(searchUrl, {
        headers: { 'User-Agent': 'SusheOnline/1.0 (album summary fetcher)' },
      });

      if (!searchResp.ok) {
        logger.debug('Wikipedia search failed', {
          status: searchResp.status,
          query: searchQuery,
        });
        continue;
      }

      const searchData = await searchResp.json();
      const results = searchData?.query?.search || [];

      if (results.length === 0) {
        continue;
      }

      const bestMatch = findBestWikipediaMatch(
        results,
        attempt.album,
        attempt.artist
      );
      if (!bestMatch) {
        continue;
      }

      // Get the page summary using the REST API
      const pageTitle = bestMatch.title.replace(/ /g, '_');
      const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`;

      const summaryResp = await fetchFn(summaryUrl, {
        headers: { 'User-Agent': 'SusheOnline/1.0 (album summary fetcher)' },
      });

      if (!summaryResp.ok) {
        logger.debug('Wikipedia summary fetch failed', {
          status: summaryResp.status,
          title: bestMatch.title,
        });
        continue;
      }

      const summaryData = await summaryResp.json();

      // Verify this is actually an album article
      if (!isWikipediaAlbumPage(summaryData)) {
        logger.debug('Wikipedia result does not appear to be an album', {
          title: bestMatch.title,
          description: summaryData.description,
        });
        continue;
      }

      if (summaryData.extract) {
        const wikipediaUrl =
          summaryData.content_urls?.desktop?.page ||
          `https://en.wikipedia.org/wiki/${pageTitle}`;

        logger.debug('Found Wikipedia album summary', {
          artist: attempt.artist,
          album: attempt.album,
          title: bestMatch.title,
          summaryLength: summaryData.extract.length,
        });

        return {
          summary: summaryData.extract,
          wikipediaUrl,
          found: true,
        };
      }
    } catch (err) {
      logger.debug('Wikipedia lookup attempt failed', {
        artist: attempt.artist,
        album: attempt.album,
        error: err.message,
      });
      // Continue to next variation
    }
  }

  return { summary: null, wikipediaUrl: null, found: false };
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
 * Fetch album summary from Last.fm only
 * Tries name variations until a match is found
 *
 * @param {string} artist - Artist name
 * @param {string} album - Album name
 * @returns {Promise<{summary: string|null, lastfmUrl: string|null, found: boolean}>}
 */
async function fetchLastfmSummary(artist, album) {
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

        logger.debug('Found Last.fm album summary', {
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
 * Fetch album summary from all sources in order of preference
 * 1. Last.fm (primary)
 * 2. Wikipedia (fallback)
 *
 * @param {string} artist - Artist name
 * @param {string} album - Album name
 * @param {Function} fetchFn - Fetch function (for dependency injection in tests)
 * @returns {Promise<{summary: string|null, lastfmUrl: string|null, wikipediaUrl: string|null, source: string|null, found: boolean}>}
 */
async function fetchAlbumSummary(artist, album, fetchFn = fetch) {
  if (!artist || !album) {
    return {
      summary: null,
      lastfmUrl: null,
      wikipediaUrl: null,
      source: null,
      found: false,
    };
  }

  // Try Last.fm first (primary source)
  const lastfmResult = await fetchLastfmSummary(artist, album);

  if (lastfmResult.summary) {
    return {
      summary: lastfmResult.summary,
      lastfmUrl: lastfmResult.lastfmUrl,
      wikipediaUrl: null,
      source: SUMMARY_SOURCES.LASTFM,
      found: true,
    };
  }

  // Try Wikipedia as fallback
  logger.debug('No Last.fm summary found, trying Wikipedia', { artist, album });
  const wikiResult = await fetchWikipediaSummary(artist, album, fetchFn);

  if (wikiResult.summary) {
    return {
      summary: wikiResult.summary,
      lastfmUrl: lastfmResult.lastfmUrl, // Keep Last.fm URL if we found the album there
      wikipediaUrl: wikiResult.wikipediaUrl,
      source: SUMMARY_SOURCES.WIKIPEDIA,
      found: true,
    };
  }

  // No summary found from any source
  return {
    summary: null,
    lastfmUrl: lastfmResult.lastfmUrl,
    wikipediaUrl: null,
    source: null,
    found: lastfmResult.found || wikiResult.found,
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
    fromLastfm: parseInt(row.from_lastfm, 10),
    fromWikipedia: parseInt(row.from_wikipedia, 10),
  };
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
   */
  async function fetchAndStoreSummary(albumId) {
    const startTime = Date.now();

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

      const albumRecord = albumResult.rows[0];
      const { summary, lastfmUrl, wikipediaUrl, source } =
        await fetchAlbumSummary(albumRecord.artist, albumRecord.album);

      await pool.query(
        `UPDATE albums SET summary = $1, lastfm_url = $2, wikipedia_url = $3,
          summary_source = $4, summary_fetched_at = NOW() WHERE album_id = $5`,
        [summary, lastfmUrl, wikipediaUrl, source, albumId]
      );

      const duration = Date.now() - startTime;
      observeExternalApiCall(
        source || 'lastfm',
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

  /** Start batch fetch job for albums without summaries */
  async function startBatchFetch(options = {}) {
    const includeRetries = options.includeRetries !== false;
    if (batchJob?.running) throw new Error('Batch job already running');

    const whereClause = includeRetries
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
  buildWikipediaSearchQuery,
  fetchAlbumSummary,
  fetchLastfmSummary,
  fetchWikipediaSummary,
  // Constants
  SUMMARY_SOURCES,
};
