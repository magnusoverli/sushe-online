// utils/lastfm-auth.js
// Last.fm API utilities for authentication, scrobbling, and data retrieval

const logger = require('./logger');
const { observeExternalApiCall, recordExternalApiError } = require('./metrics');
const {
  normalizeForExternalApi,
  stripEditionSuffix,
} = require('./normalization');

const API_URL = 'https://ws.audioscrobbler.com/2.0/';

/**
 * Wrap fetch function with metrics tracking
 * @param {Function} fetchFn - Original fetch function
 * @returns {Function} Wrapped fetch function with metrics
 */
function wrapFetchWithMetrics(fetchFn) {
  return async (url, options) => {
    // Extract method from URL params for metrics
    const urlObj = new URL(url);
    const method = urlObj.searchParams.get('method') || 'unknown';

    const startTime = Date.now();
    let response;
    try {
      response = await fetchFn(url, options);
      const duration = Date.now() - startTime;
      // Handle mock responses that may not have status property
      const statusCode = response.status ?? 200;
      observeExternalApiCall('lastfm', method, duration, statusCode);
      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      observeExternalApiCall('lastfm', method, duration, 0);
      recordExternalApiError('lastfm', 'network_error');
      throw error;
    }
  };
}

/**
 * Parse JSON response with retry on rate limit (error 29)
 * Last.fm error 29 = rate limit exceeded
 * @param {Response} response - Fetch response object
 * @param {Object} log - Logger instance
 * @param {Function} retryFn - Function to call for retry (should return response)
 * @returns {Object} - Parsed JSON data
 */
async function parseJsonWithRateLimitRetry(response, log, retryFn) {
  const data = await response.json();

  if (data.error === 29 && retryFn) {
    log.warn('Last.fm rate limit hit, retrying after 1.5s delay');
    await new Promise((r) => setTimeout(r, 1500));
    const retryResponse = await retryFn();
    return retryResponse.json();
  }

  return data;
}

// ============================================
// USER DATA API METHODS - CORE
// ============================================

/**
 * Normalize strings for Last.fm API compatibility and for comparing Last.fm
 * responses to our data. Use this whenever "same logical string" must match
 * across our DB (e.g. MusicBrainz … U+2026) and Last.fm (typically ASCII ...).
 *
 * This now uses the centralized normalizeForExternalApi() which:
 * - Strips diacritics (e.g., "Exxûl" → "Exxul", "Mötley Crüe" → "Motley Crue")
 * - Normalizes ellipsis, smart quotes, dashes
 * - Normalizes whitespace
 *
 * @param {string|null|undefined} str - Input string
 * @returns {string} Normalized string, or '' if str is null/undefined
 */
function normalizeForLastfm(str) {
  return normalizeForExternalApi(str);
}

/**
 * Common edition suffixes to try when looking for album variants
 * Used as fallback when artist.getTopAlbums doesn't find matches
 */
const EDITION_SUFFIXES_TO_TRY = [
  '(Deluxe Edition)',
  '(Deluxe)',
  '(Remastered)',
  '(Expanded Edition)',
  '(Special Edition)',
];

/**
 * Generate album name variations to try for Last.fm lookup
 * @param {string} albumName - Base album name (should already have edition suffix stripped)
 * @returns {string[]} - Array of album name variations
 */
function generateAlbumVariations(albumName) {
  if (!albumName) return [];
  const variations = [];
  for (const suffix of EDITION_SUFFIXES_TO_TRY) {
    variations.push(`${albumName} ${suffix}`);
  }
  return variations;
}

/**
 * Find album on Last.fm using artist.getTopAlbums
 * Used to find album variants (e.g., "Album" and "Album (Deluxe Edition)")
 * @param {boolean} returnAll - If true, return all matching variants; otherwise return first match
 */
async function findAlbumByArtist(
  fetchFn,
  log,
  artistName,
  albumName,
  apiKey,
  returnAll = false
) {
  const params = new URLSearchParams({
    method: 'artist.getTopAlbums',
    artist: artistName,
    api_key: apiKey,
    format: 'json',
    autocorrect: '1',
    limit: '100', // Get more albums to find all variants
  });

  const url = `${API_URL}?${params}`;
  const response = await fetchFn(url);
  const data = await parseJsonWithRateLimitRetry(response, log, () =>
    fetchFn(url)
  );

  const albums = data.topalbums?.album || [];
  if (albums.length === 0) return returnAll ? [] : null;

  // Get the corrected artist name from the response
  const correctedArtist = data.topalbums?.['@attr']?.artist || artistName;

  // Normalize for comparison (strip edition suffixes for matching)
  const normalizeStr = (s) =>
    s
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .trim();
  const targetAlbum = normalizeStr(albumName);
  const matches = [];

  // Find all albums that match (base name matches)
  for (const album of albums) {
    const resultAlbum = normalizeStr(album.name || '');
    const resultStripped = normalizeStr(stripEditionSuffix(album.name || ''));

    // Match if: normalized names match, or one contains the other
    if (
      resultStripped === targetAlbum ||
      resultAlbum.includes(targetAlbum) ||
      targetAlbum.includes(resultStripped)
    ) {
      matches.push({ artist: correctedArtist, album: album.name });
    }
  }

  if (matches.length > 0) {
    log.debug('Last.fm artist.getTopAlbums found matches', {
      searchArtist: artistName,
      searchAlbum: albumName,
      matchCount: matches.length,
      matches: matches.map((m) => m.album),
    });
  }

  return returnAll ? matches : matches[0] || null;
}

/**
 * Fetch album info from Last.fm by exact artist/album name
 */
async function fetchAlbumInfoExact(
  fetchFn,
  log,
  artistName,
  albumName,
  username,
  apiKey
) {
  const params = new URLSearchParams({
    method: 'album.getInfo',
    artist: artistName,
    album: albumName,
    api_key: apiKey,
    format: 'json',
    autocorrect: '1',
  });
  if (username) params.set('username', username);
  const url = `${API_URL}?${params}`;
  const response = await fetchFn(url);
  return parseJsonWithRateLimitRetry(response, log, () => fetchFn(url));
}

/**
 * Try to fetch album info and return it if playcount > 0
 * @returns {Object|null} - Album data if found with plays, null otherwise
 */
async function tryFetchWithPlaycount(fetchExact, artist, albumName) {
  const data = await fetchExact(artist, albumName);
  if (!data.error && data.album) {
    const up = parseInt(data.album.userplaycount || 0);
    if (up > 0) return data.album;
  }
  return null;
}

/**
 * Combine playcounts from multiple album variants
 */
async function combineVariantPlaycounts(fetchExact, artistAlbums, log) {
  let totalUserPlaycount = 0;
  let totalPlaycount = 0;
  let totalListeners = 0;
  let primaryAlbum = null;

  for (const v of artistAlbums) {
    const vd = await fetchExact(v.artist, v.album);
    if (!vd.error && vd.album) {
      const up = parseInt(vd.album.userplaycount || 0);
      totalUserPlaycount += up;
      totalPlaycount += parseInt(vd.album.playcount || 0);
      totalListeners = Math.max(
        totalListeners,
        parseInt(vd.album.listeners || 0)
      );
      if (!primaryAlbum || up > 0) primaryAlbum = vd.album;
    }
  }

  if (!primaryAlbum) return null;

  log.debug('Last.fm combined playcounts', {
    variants: artistAlbums.length,
    totalUserPlaycount,
  });

  return {
    ...primaryAlbum,
    userplaycount: String(totalUserPlaycount),
    playcount: String(totalPlaycount),
    listeners: String(totalListeners),
  };
}

/**
 * Get album info with variant detection and combined playcounts
 */
async function getAlbumInfoWithVariants(
  fetchFn,
  log,
  artist,
  album,
  username,
  apiKey
) {
  const normalizedArtist = normalizeForLastfm(artist);
  const normalizedAlbum = normalizeForLastfm(album);
  const strippedAlbum = stripEditionSuffix(normalizedAlbum);
  const fetchExact = (a, b) =>
    fetchAlbumInfoExact(fetchFn, log, a, b, username, apiKey);

  // Find all album variants via artist.getTopAlbums and sum playcounts
  const artistAlbums = await findAlbumByArtist(
    fetchFn,
    log,
    normalizedArtist,
    strippedAlbum,
    apiKey,
    true
  );

  if (artistAlbums && artistAlbums.length > 0) {
    const combined = await combineVariantPlaycounts(
      fetchExact,
      artistAlbums,
      log
    );
    if (combined) return combined;
  }

  // Fallback: try exact match first
  const exactResult = await tryFetchWithPlaycount(
    fetchExact,
    normalizedArtist,
    normalizedAlbum
  );
  if (exactResult) return exactResult;

  // Try without edition suffix if different
  if (strippedAlbum !== normalizedAlbum) {
    const strippedResult = await tryFetchWithPlaycount(
      fetchExact,
      normalizedArtist,
      strippedAlbum
    );
    if (strippedResult) return strippedResult;
  }

  // Try common variations (Deluxe Edition, Remastered, etc.)
  const variations = generateAlbumVariations(strippedAlbum);
  for (const variation of variations) {
    const varResult = await tryFetchWithPlaycount(
      fetchExact,
      normalizedArtist,
      variation
    );
    if (varResult) {
      log.debug('Last.fm matched via variation', {
        original: album,
        matched: variation,
        playcount: varResult.userplaycount,
      });
      return varResult;
    }
  }

  // Return whatever we found (even with 0 plays) or not found
  const fallbackData = await fetchExact(normalizedArtist, normalizedAlbum);
  if (!fallbackData.error && fallbackData.album) return fallbackData.album;

  log.debug('Last.fm album not found', { artist, album });
  return { userplaycount: '0', playcount: '0', listeners: '0', notFound: true };
}

/**
 * Create core user data fetching methods (individual endpoints)
 */
function createCoreUserDataMethods(fetchFn, log, env, lastfmGet) {
  async function getTopAlbums(
    username,
    period = 'overall',
    limit = 50,
    apiKey
  ) {
    const data = await lastfmGet({
      method: 'user.getTopAlbums',
      params: {
        user: username,
        period,
        limit: String(limit),
        api_key: apiKey,
      },
      withRetry: true,
    });
    return data.topalbums?.album || [];
  }

  async function getAlbumInfo(artist, album, username, apiKey) {
    return getAlbumInfoWithVariants(
      fetchFn,
      log,
      artist,
      album,
      username,
      apiKey || env.LASTFM_API_KEY
    );
  }

  async function getRecentTracks(username, limit = 50, apiKey) {
    const data = await lastfmGet({
      method: 'user.getRecentTracks',
      params: { user: username, limit: String(limit), api_key: apiKey },
    });
    return data.recenttracks?.track || [];
  }

  async function getTopArtists(
    username,
    period = 'overall',
    limit = 50,
    apiKey
  ) {
    const data = await lastfmGet({
      method: 'user.getTopArtists',
      params: {
        user: username,
        period,
        limit: String(limit),
        api_key: apiKey,
      },
      withRetry: true,
    });

    const artists = (data.topartists?.artist || []).map((artist) => ({
      name: artist.name,
      playcount: parseInt(artist.playcount, 10) || 0,
      mbid: artist.mbid || null,
      url: artist.url,
      rank: parseInt(artist['@attr']?.rank, 10) || 0,
    }));

    return {
      artists,
      total: parseInt(data.topartists?.['@attr']?.total, 10) || artists.length,
      period,
    };
  }

  async function getTopTags(username, limit = 50, apiKey) {
    const data = await lastfmGet({
      method: 'user.getTopTags',
      params: { user: username, limit: String(limit), api_key: apiKey },
    });

    const tags = (data.toptags?.tag || []).map((tag) => ({
      name: tag.name,
      count: parseInt(tag.count, 10) || 0,
      url: tag.url,
    }));

    return { tags };
  }

  async function getUserInfo(username, apiKey) {
    const data = await lastfmGet({
      method: 'user.getInfo',
      params: { user: username, api_key: apiKey },
    });

    const user = data.user || {};
    const reg = user.registered?.unixtime;
    return {
      username: user.name,
      realname: user.realname || null,
      playcount: parseInt(user.playcount, 10) || 0,
      artist_count: parseInt(user.artist_count, 10) || 0,
      album_count: parseInt(user.album_count, 10) || 0,
      track_count: parseInt(user.track_count, 10) || 0,
      registered: reg ? new Date(parseInt(reg, 10) * 1000) : null,
      country: user.country || null,
      url: user.url,
      image: user.image || [],
    };
  }

  return {
    getTopAlbums,
    getAlbumInfo,
    getRecentTracks,
    getTopArtists,
    getTopTags,
    getUserInfo,
  };
}

// ============================================
// USER DATA API METHODS - BATCH
// ============================================

const ALL_PERIODS = [
  '7day',
  '1month',
  '3month',
  '6month',
  '12month',
  'overall',
];

/**
 * Create batch user data fetching methods (multi-period aggregations)
 */
function createBatchUserDataMethods(coreMethods) {
  const { getTopArtists, getTopAlbums } = coreMethods;

  async function getAllTopArtists(username, limitPerPeriod = 50, apiKey) {
    const results = await Promise.all(
      ALL_PERIODS.map((period) =>
        getTopArtists(username, period, limitPerPeriod, apiKey)
      )
    );

    const output = {};
    ALL_PERIODS.forEach((period, index) => {
      output[period] = results[index].artists;
    });
    return output;
  }

  async function getAllTopAlbums(username, limitPerPeriod = 50, apiKey) {
    const results = await Promise.all(
      ALL_PERIODS.map((period) =>
        getTopAlbums(username, period, limitPerPeriod, apiKey)
      )
    );

    const output = {};
    ALL_PERIODS.forEach((period, index) => {
      output[period] = (results[index] || []).map((album) => ({
        name: album.name,
        artist: album.artist?.name || album.artist || 'Unknown',
        playcount: parseInt(album.playcount, 10) || 0,
        mbid: album.mbid || null,
        url: album.url,
        rank: parseInt(album['@attr']?.rank, 10) || 0,
      }));
    });
    return output;
  }

  return { getAllTopArtists, getAllTopAlbums };
}

/**
 * Create combined user data methods (core + batch)
 */
function createUserDataMethods(fetchFn, log, env, lastfmGet) {
  const coreMethods = createCoreUserDataMethods(fetchFn, log, env, lastfmGet);
  const batchMethods = createBatchUserDataMethods(coreMethods);
  return { ...coreMethods, ...batchMethods };
}

// ============================================
// DISCOVERY API METHODS
// ============================================

/**
 * Create discovery/exploration methods
 */
function createDiscoveryMethods(fetchFn, log, env, lastfmGet) {
  async function getSimilarArtists(artist, limit = 10, apiKey) {
    const data = await lastfmGet({
      method: 'artist.getSimilar',
      params: { artist, limit: String(limit), api_key: apiKey },
      notFoundValue: { similarartists: { artist: [] } },
    });
    return data.similarartists?.artist || [];
  }

  async function getArtistTopTags(artist, limit = 10, apiKey) {
    // Return empty array for any error (not just error 6) to match original behavior
    let data;
    try {
      data = await lastfmGet({
        method: 'artist.getTopTags',
        params: { artist, limit: String(limit), api_key: apiKey },
        notFoundValue: { toptags: { tag: [] } },
      });
    } catch {
      // Original logged non-6 errors but still returned [] instead of throwing
      return [];
    }

    return (data.toptags?.tag || []).map((tag) => ({
      name: tag.name,
      count: parseInt(tag.count, 10) || 0,
      url: tag.url,
    }));
  }

  async function getArtistTagsBatch(
    artists,
    tagsPerArtist = 5,
    apiKey,
    delayMs = 1100
  ) {
    const results = new Map();
    const artistNames = artists.map((a) =>
      typeof a === 'string' ? a : a.name
    );

    // Process in parallel batches (~5 req/sec for Last.fm rate limit)
    const BATCH_SIZE = 5;

    for (let i = 0; i < artistNames.length; i += BATCH_SIZE) {
      const batch = artistNames.slice(i, i + BATCH_SIZE);

      const batchPromises = batch.map(async (artistName) => {
        try {
          const tags = await getArtistTopTags(
            artistName,
            tagsPerArtist,
            apiKey
          );
          return { artistName, tags };
        } catch (err) {
          log.warn('Failed to fetch tags for artist:', {
            artist: artistName,
            error: err.message,
          });
          return { artistName, tags: [] };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      for (const { artistName, tags } of batchResults) {
        results.set(artistName, tags);
      }

      // Rate limit delay between batches (except for last batch)
      if (delayMs > 0 && i + BATCH_SIZE < artistNames.length) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    return results;
  }

  async function getTagTopArtists(tag, limit = 10, apiKey) {
    const data = await lastfmGet({
      method: 'tag.getTopArtists',
      params: { tag, limit: String(limit), api_key: apiKey },
      notFoundValue: { topartists: { artist: [] } },
    });
    return data.topartists?.artist || [];
  }

  async function getTagTopAlbums(tag, limit = 10, apiKey) {
    const data = await lastfmGet({
      method: 'tag.getTopAlbums',
      params: { tag, limit: String(limit), api_key: apiKey },
      notFoundValue: { albums: { album: [] } },
    });
    return data.albums?.album || [];
  }

  async function getArtistTopAlbums(artist, limit = 10, apiKey) {
    const data = await lastfmGet({
      method: 'artist.getTopAlbums',
      params: { artist, limit: String(limit), api_key: apiKey },
      notFoundValue: { topalbums: { album: [] } },
    });
    return data.topalbums?.album || [];
  }

  return {
    getSimilarArtists,
    getArtistTopTags,
    getArtistTagsBatch,
    getTagTopArtists,
    getTagTopAlbums,
    getArtistTopAlbums,
  };
}

// ============================================
// WRITE OPERATIONS (SCROBBLING)
// ============================================

/**
 * Create write operation methods (require session key)
 */
function createWriteMethods(
  fetchFn,
  generateSignature,
  log,
  env,
  lastfmSignedPost
) {
  async function scrobble(trackData, sessionKey, apiKey, secret) {
    // Normalize artist, track, and album names for better Last.fm matching
    // This strips diacritics (e.g., "Exxûl" → "Exxul") and normalizes special chars
    const normalizedArtist = normalizeForLastfm(trackData.artist);
    const normalizedTrack = normalizeForLastfm(trackData.track);
    const normalizedAlbum = trackData.album
      ? normalizeForLastfm(trackData.album)
      : null;

    const params = {
      sk: sessionKey,
      artist: normalizedArtist,
      track: normalizedTrack,
      timestamp: String(trackData.timestamp || Math.floor(Date.now() / 1000)),
    };

    if (normalizedAlbum) params.album = normalizedAlbum;
    if (trackData.duration)
      params.duration = String(Math.floor(trackData.duration / 1000));
    if (trackData.trackNumber)
      params.trackNumber = String(trackData.trackNumber);

    log.info('Scrobbling to Last.fm:', {
      artist: normalizedArtist,
      track: normalizedTrack,
      originalArtist:
        trackData.artist !== normalizedArtist ? trackData.artist : undefined,
    });

    const data = await lastfmSignedPost({
      method: 'track.scrobble',
      params,
      apiKey,
      secret,
    });

    const accepted = data.scrobbles?.['@attr']?.accepted || 0;
    log.info('Last.fm scrobble result:', { accepted });
    return data;
  }

  async function updateNowPlaying(trackData, sessionKey, apiKey, secret) {
    // Normalize artist, track, and album names for better Last.fm matching
    // This strips diacritics (e.g., "Exxûl" → "Exxul") and normalizes special chars
    const normalizedArtist = normalizeForLastfm(trackData.artist);
    const normalizedTrack = normalizeForLastfm(trackData.track);
    const normalizedAlbum = trackData.album
      ? normalizeForLastfm(trackData.album)
      : null;

    const params = {
      sk: sessionKey,
      artist: normalizedArtist,
      track: normalizedTrack,
    };

    if (normalizedAlbum) params.album = normalizedAlbum;
    if (trackData.duration)
      params.duration = String(Math.floor(trackData.duration / 1000));

    return lastfmSignedPost({
      method: 'track.updateNowPlaying',
      params,
      apiKey,
      secret,
    });
  }

  return { scrobble, updateNowPlaying };
}

// ============================================
// MAIN FACTORY
// ============================================

/**
 * Create Last.fm auth utilities with injected dependencies
 * @param {Object} deps - Dependencies
 * @param {Object} deps.logger - Logger instance
 * @param {Function} deps.fetch - Fetch function (defaults to global fetch)
 * @param {Object} deps.crypto - Crypto module (defaults to Node crypto)
 * @param {Object} deps.env - Environment variables (defaults to process.env)
 */
function createLastfmAuth(deps = {}) {
  const log = deps.logger || logger;
  const rawFetchFn = deps.fetch || global.fetch;
  // Wrap fetch with metrics tracking (unless disabled for testing)
  const fetchFn = deps.skipMetrics
    ? rawFetchFn
    : wrapFetchWithMetrics(rawFetchFn);
  const crypto = deps.crypto || require('crypto');
  const env = deps.env || process.env;

  /**
   * Generate Last.fm API signature (MD5 hash of sorted params + secret)
   */
  function generateSignature(params, secret) {
    const sortedKeys = Object.keys(params).sort();
    const sigString =
      sortedKeys.map((k) => `${k}${params[k]}`).join('') + secret;
    return crypto.createHash('md5').update(sigString, 'utf8').digest('hex');
  }

  /**
   * Check if Last.fm session is valid
   */
  function isSessionValid(lastfmAuth) {
    return !!(lastfmAuth?.session_key && lastfmAuth?.username);
  }

  /**
   * Exchange auth token for session key
   */
  async function getSession(token, apiKey, secret) {
    const params = {
      method: 'auth.getSession',
      api_key: apiKey,
      token,
    };
    params.api_sig = generateSignature(params, secret);

    const url = `${API_URL}?${new URLSearchParams({ ...params, format: 'json' })}`;

    log.info('Exchanging Last.fm token for session...');

    const response = await fetchFn(url);
    const data = await response.json();

    if (data.error) {
      log.error('Last.fm getSession failed:', {
        error: data.error,
        message: data.message,
      });
      throw new Error(data.message || 'Failed to get Last.fm session');
    }

    log.info('Last.fm session obtained for user:', data.session.name);

    return {
      session_key: data.session.key,
      username: data.session.name,
    };
  }

  /**
   * Shared helper for Last.fm GET API calls.
   * Builds URLSearchParams, fetches, optionally retries on rate limit, and checks for errors.
   * @param {Object} opts
   * @param {string} opts.method - Last.fm API method (e.g. 'user.getTopAlbums')
   * @param {Object} opts.params - Additional query parameters (api_key is auto-filled if missing)
   * @param {boolean} [opts.withRetry=false] - Use parseJsonWithRateLimitRetry for rate limit handling
   * @param {*} [opts.notFoundValue=null] - Value to return on error 6 (not found); null means throw
   */
  async function lastfmGet(opts) {
    const {
      method,
      params = {},
      withRetry = false,
      notFoundValue = null,
    } = opts;
    const searchParams = new URLSearchParams({
      method,
      api_key: params.api_key || env.LASTFM_API_KEY,
      format: 'json',
      ...params,
    });
    // Remove duplicate api_key if it was in params and we set it above
    const url = `${API_URL}?${searchParams}`;
    const response = await fetchFn(url);
    const data = withRetry
      ? await parseJsonWithRateLimitRetry(response, log, () => fetchFn(url))
      : await response.json();

    if (data.error) {
      if (data.error === 6 && notFoundValue !== null) return notFoundValue;
      log.error(`Last.fm ${method} failed:`, {
        error: data.error,
        message: data.message,
      });
      throw new Error(data.message || `Failed: ${method}`);
    }
    return data;
  }

  /**
   * Shared helper for Last.fm signed POST API calls.
   * Builds params, signs them, POSTs with urlencoded body, and checks for errors.
   * @param {Object} opts
   * @param {string} opts.method - Last.fm API method (e.g. 'track.scrobble')
   * @param {Object} opts.params - Parameters to include (excluding method, api_key, api_sig)
   * @param {string} [opts.apiKey] - Override API key
   * @param {string} [opts.secret] - Override API secret
   */
  async function lastfmSignedPost(opts) {
    const { method, params = {}, apiKey, secret } = opts;
    const allParams = {
      method,
      api_key: apiKey || env.LASTFM_API_KEY,
      ...params,
    };
    allParams.api_sig = generateSignature(
      allParams,
      secret || env.LASTFM_SECRET
    );

    const response = await fetchFn(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...allParams, format: 'json' }),
    });
    const data = await response.json();

    if (data.error) {
      log.error(`Last.fm ${method} failed:`, {
        error: data.error,
        message: data.message,
      });
      throw new Error(data.message || `Failed: ${method}`);
    }
    return data;
  }

  // Create helper modules
  const userData = createUserDataMethods(fetchFn, log, env, lastfmGet);
  const discovery = createDiscoveryMethods(fetchFn, log, env, lastfmGet);
  const write = createWriteMethods(
    fetchFn,
    generateSignature,
    log,
    env,
    lastfmSignedPost
  );

  return {
    // Signature generation
    generateSignature,
    // Session validation
    isSessionValid,
    // Auth
    getSession,
    // User data methods
    getTopAlbums: userData.getTopAlbums,
    getTopArtists: userData.getTopArtists,
    getTopTags: userData.getTopTags,
    getUserInfo: userData.getUserInfo,
    getAllTopArtists: userData.getAllTopArtists,
    getAllTopAlbums: userData.getAllTopAlbums,
    getAlbumInfo: userData.getAlbumInfo,
    getRecentTracks: userData.getRecentTracks,
    // Discovery methods
    getSimilarArtists: discovery.getSimilarArtists,
    getTagTopArtists: discovery.getTagTopArtists,
    getTagTopAlbums: discovery.getTagTopAlbums,
    getArtistTopAlbums: discovery.getArtistTopAlbums,
    getArtistTopTags: discovery.getArtistTopTags,
    getArtistTagsBatch: discovery.getArtistTagsBatch,
    // Write operations
    scrobble: write.scrobble,
    updateNowPlaying: write.updateNowPlaying,
  };
}

// Default instance for the app (uses real logger, fetch, crypto, and env)
const defaultInstance = createLastfmAuth();

module.exports = {
  // Factory for testing
  createLastfmAuth,
  // String normalization for Last.fm (used by API requests and by api.js when comparing artist names)
  normalizeForLastfm,
  // Default instance exports for app usage
  generateSignature: defaultInstance.generateSignature,
  isSessionValid: defaultInstance.isSessionValid,
  getSession: defaultInstance.getSession,
  // User data
  getTopAlbums: defaultInstance.getTopAlbums,
  getTopArtists: defaultInstance.getTopArtists,
  getTopTags: defaultInstance.getTopTags,
  getUserInfo: defaultInstance.getUserInfo,
  getAllTopArtists: defaultInstance.getAllTopArtists,
  getAllTopAlbums: defaultInstance.getAllTopAlbums,
  getAlbumInfo: defaultInstance.getAlbumInfo,
  getRecentTracks: defaultInstance.getRecentTracks,
  // Discovery
  getSimilarArtists: defaultInstance.getSimilarArtists,
  getTagTopArtists: defaultInstance.getTagTopArtists,
  getTagTopAlbums: defaultInstance.getTagTopAlbums,
  getArtistTopAlbums: defaultInstance.getArtistTopAlbums,
  getArtistTopTags: defaultInstance.getArtistTopTags,
  getArtistTagsBatch: defaultInstance.getArtistTagsBatch,
  // Write operations
  scrobble: defaultInstance.scrobble,
  updateNowPlaying: defaultInstance.updateNowPlaying,
};
