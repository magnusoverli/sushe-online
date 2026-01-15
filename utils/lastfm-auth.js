// utils/lastfm-auth.js
// Last.fm API utilities for authentication, scrobbling, and data retrieval

const logger = require('./logger');
const { observeExternalApiCall, recordExternalApiError } = require('./metrics');

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
 * Normalize strings for Last.fm API compatibility
 * - Replace ellipsis character (…) with three dots (...)
 * - Replace curly quotes with straight quotes
 */
const normalizeForLastfm = (str) =>
  str.replace(/\u2026/g, '...').replace(/[\u2018\u2019]/g, "'");

/**
 * Strip edition suffixes from album names for better Last.fm matching
 * e.g., "Album (Deluxe Edition)" -> "Album"
 */
const EDITION_PATTERNS = [
  /\s*\(\s*(deluxe|special|expanded|remastered|remaster|anniversary|limited|collector'?s?|bonus\s*track)\s*(edition|version|release)?\s*\)$/i,
  /\s*\[\s*(deluxe|special|expanded|remastered|remaster|anniversary|limited|collector'?s?|bonus\s*track)\s*(edition|version|release)?\s*\]$/i,
  /\s*[-:]\s*(deluxe|special|expanded|remastered|remaster|anniversary|limited)\s*(edition|version|release)?$/i,
  /\s*\(\s*\d{4}\s*(remaster|reissue|edition)?\s*\)$/i,
];

const stripEditionSuffix = (str) => {
  let result = str;
  for (const pattern of EDITION_PATTERNS) {
    result = result.replace(pattern, '');
  }
  return result.trim();
};

/**
 * Find album on Last.fm using artist.getTopAlbums as fallback
 * Used when exact album name doesn't match (e.g., "Album" vs "Album (Deluxe Edition)")
 */
async function findAlbumByArtist(fetchFn, log, artistName, albumName, apiKey) {
  const params = new URLSearchParams({
    method: 'artist.getTopAlbums',
    artist: artistName,
    api_key: apiKey,
    format: 'json',
    autocorrect: '1',
    limit: '50', // Get top 50 albums to search through
  });

  const url = `${API_URL}?${params}`;
  const response = await fetchFn(url);
  const data = await parseJsonWithRateLimitRetry(response, log, () =>
    fetchFn(url)
  );

  const albums = data.topalbums?.album || [];
  if (albums.length === 0) return null;

  // Get the corrected artist name from the response
  const correctedArtist = data.topalbums?.['@attr']?.artist || artistName;

  // Normalize for comparison
  const normalizeStr = (s) =>
    s
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .trim();
  const targetAlbum = normalizeStr(albumName);

  // Find best match - album name should contain our search term
  for (const album of albums) {
    const resultAlbum = normalizeStr(album.name || '');

    // Check if album name contains our search term or vice versa
    // This handles cases like "Album" matching "Album (Deluxe Edition)"
    if (
      resultAlbum.includes(targetAlbum) ||
      targetAlbum.includes(resultAlbum)
    ) {
      log.debug('Last.fm artist.getTopAlbums found match', {
        searchArtist: artistName,
        searchAlbum: albumName,
        foundArtist: correctedArtist,
        foundAlbum: album.name,
      });
      return { artist: correctedArtist, album: album.name };
    }
  }

  return null;
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

  if (username) {
    params.set('username', username);
  }

  const url = `${API_URL}?${params}`;
  const response = await fetchFn(url);
  return parseJsonWithRateLimitRetry(response, log, () => fetchFn(url));
}

/**
 * Create core user data fetching methods (individual endpoints)
 */
function createCoreUserDataMethods(fetchFn, log, env) {
  async function getTopAlbums(
    username,
    period = 'overall',
    limit = 50,
    apiKey
  ) {
    const params = new URLSearchParams({
      method: 'user.getTopAlbums',
      user: username,
      period,
      limit: String(limit),
      api_key: apiKey || env.LASTFM_API_KEY,
      format: 'json',
    });

    const url = `${API_URL}?${params}`;
    const response = await fetchFn(url);
    const data = await parseJsonWithRateLimitRetry(response, log, () =>
      fetchFn(url)
    );

    if (data.error) {
      log.error('Last.fm getTopAlbums failed:', {
        error: data.error,
        message: data.message,
      });
      throw new Error(data.message || 'Failed to fetch top albums');
    }

    return data.topalbums?.album || [];
  }

  async function getAlbumInfo(artist, album, username, apiKey) {
    const key = apiKey || env.LASTFM_API_KEY;
    const normalizedArtist = normalizeForLastfm(artist);
    const normalizedAlbum = normalizeForLastfm(album);
    const strippedAlbum = stripEditionSuffix(normalizedAlbum);

    // Helper using external function
    const fetchExact = (a, b) =>
      fetchAlbumInfoExact(fetchFn, log, a, b, username, key);

    // Try exact match first
    let data = await fetchExact(normalizedArtist, normalizedAlbum);

    // If not found and album has edition suffix, try without it
    if (data.error === 6 && strippedAlbum !== normalizedAlbum) {
      log.debug('Last.fm trying without edition suffix', {
        original: normalizedAlbum,
        stripped: strippedAlbum,
      });
      data = await fetchExact(normalizedArtist, strippedAlbum);
    }

    // If still not found, try artist.getTopAlbums to find fuzzy match
    if (data.error === 6) {
      log.debug('Last.fm exact match not found, trying artist.getTopAlbums', {
        artist: normalizedArtist,
        album: normalizedAlbum,
      });
      const searchResult = await findAlbumByArtist(
        fetchFn,
        log,
        normalizedArtist,
        strippedAlbum, // Use stripped album for better matching
        key
      );
      if (searchResult) {
        // Retry with the found album name
        data = await fetchExact(searchResult.artist, searchResult.album);
      }
    }

    if (data.error) {
      if (data.error === 6) {
        log.debug('Last.fm album not found even after search', {
          artist,
          album,
        });
        return {
          userplaycount: '0',
          playcount: '0',
          listeners: '0',
          notFound: true,
        };
      }
      log.error('Last.fm getAlbumInfo failed:', {
        error: data.error,
        message: data.message,
      });
      throw new Error(data.message || 'Failed to fetch album info');
    }

    return data.album || {};
  }

  async function getRecentTracks(username, limit = 50, apiKey) {
    const params = new URLSearchParams({
      method: 'user.getRecentTracks',
      user: username,
      limit: String(limit),
      api_key: apiKey || env.LASTFM_API_KEY,
      format: 'json',
    });

    const response = await fetchFn(`${API_URL}?${params}`);
    const data = await response.json();

    if (data.error) {
      log.error('Last.fm getRecentTracks failed:', {
        error: data.error,
        message: data.message,
      });
      throw new Error(data.message || 'Failed to fetch recent tracks');
    }

    return data.recenttracks?.track || [];
  }

  async function getTopArtists(
    username,
    period = 'overall',
    limit = 50,
    apiKey
  ) {
    const params = new URLSearchParams({
      method: 'user.getTopArtists',
      user: username,
      period,
      limit: String(limit),
      api_key: apiKey || env.LASTFM_API_KEY,
      format: 'json',
    });

    const url = `${API_URL}?${params}`;
    const response = await fetchFn(url);
    const data = await parseJsonWithRateLimitRetry(response, log, () =>
      fetchFn(url)
    );

    if (data.error) {
      log.error('Last.fm getTopArtists failed:', {
        error: data.error,
        message: data.message,
      });
      throw new Error(data.message || 'Failed to fetch top artists');
    }

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
    const params = new URLSearchParams({
      method: 'user.getTopTags',
      user: username,
      limit: String(limit),
      api_key: apiKey || env.LASTFM_API_KEY,
      format: 'json',
    });

    const response = await fetchFn(`${API_URL}?${params}`);
    const data = await response.json();

    if (data.error) {
      log.error('Last.fm getTopTags failed:', {
        error: data.error,
        message: data.message,
      });
      throw new Error(data.message || 'Failed to fetch top tags');
    }

    const tags = (data.toptags?.tag || []).map((tag) => ({
      name: tag.name,
      count: parseInt(tag.count, 10) || 0,
      url: tag.url,
    }));

    return { tags };
  }

  async function getUserInfo(username, apiKey) {
    const params = new URLSearchParams({
      method: 'user.getInfo',
      user: username,
      api_key: apiKey || env.LASTFM_API_KEY,
      format: 'json',
    });

    const response = await fetchFn(`${API_URL}?${params}`);
    const data = await response.json();

    if (data.error) {
      log.error('Last.fm getUserInfo failed:', {
        error: data.error,
        message: data.message,
      });
      throw new Error(data.message || 'Failed to fetch user info');
    }

    const user = data.user || {};
    return {
      username: user.name,
      realname: user.realname || null,
      playcount: parseInt(user.playcount, 10) || 0,
      artist_count: parseInt(user.artist_count, 10) || 0,
      album_count: parseInt(user.album_count, 10) || 0,
      track_count: parseInt(user.track_count, 10) || 0,
      registered: user.registered?.unixtime
        ? new Date(parseInt(user.registered.unixtime, 10) * 1000)
        : null,
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
function createUserDataMethods(fetchFn, log, env) {
  const coreMethods = createCoreUserDataMethods(fetchFn, log, env);
  const batchMethods = createBatchUserDataMethods(coreMethods);
  return { ...coreMethods, ...batchMethods };
}

// ============================================
// DISCOVERY API METHODS
// ============================================

/**
 * Create discovery/exploration methods
 */
function createDiscoveryMethods(fetchFn, log, env) {
  async function getSimilarArtists(artist, limit = 10, apiKey) {
    const params = new URLSearchParams({
      method: 'artist.getSimilar',
      artist,
      limit: String(limit),
      api_key: apiKey || env.LASTFM_API_KEY,
      format: 'json',
    });

    const response = await fetchFn(`${API_URL}?${params}`);
    const data = await response.json();

    if (data.error) {
      if (data.error === 6) return []; // Artist not found
      log.error('Last.fm getSimilarArtists failed:', {
        error: data.error,
        message: data.message,
      });
      throw new Error(data.message || 'Failed to fetch similar artists');
    }

    return data.similarartists?.artist || [];
  }

  async function getArtistTopTags(artist, limit = 10, apiKey) {
    const params = new URLSearchParams({
      method: 'artist.getTopTags',
      artist,
      limit: String(limit),
      api_key: apiKey || env.LASTFM_API_KEY,
      format: 'json',
    });

    const response = await fetchFn(`${API_URL}?${params}`);
    const data = await response.json();

    if (data.error) {
      if (data.error === 6) return [];
      log.error('Last.fm getArtistTopTags failed:', {
        error: data.error,
        message: data.message,
        artist,
      });
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
    const params = new URLSearchParams({
      method: 'tag.getTopArtists',
      tag,
      limit: String(limit),
      api_key: apiKey || env.LASTFM_API_KEY,
      format: 'json',
    });

    const response = await fetchFn(`${API_URL}?${params}`);
    const data = await response.json();

    if (data.error) {
      if (data.error === 6) return [];
      log.error('Last.fm getTagTopArtists failed:', {
        error: data.error,
        message: data.message,
      });
      throw new Error(data.message || 'Failed to fetch tag top artists');
    }

    return data.topartists?.artist || [];
  }

  async function getTagTopAlbums(tag, limit = 10, apiKey) {
    const params = new URLSearchParams({
      method: 'tag.getTopAlbums',
      tag,
      limit: String(limit),
      api_key: apiKey || env.LASTFM_API_KEY,
      format: 'json',
    });

    const response = await fetchFn(`${API_URL}?${params}`);
    const data = await response.json();

    if (data.error) {
      if (data.error === 6) return [];
      log.error('Last.fm getTagTopAlbums failed:', {
        error: data.error,
        message: data.message,
      });
      throw new Error(data.message || 'Failed to fetch tag top albums');
    }

    return data.albums?.album || [];
  }

  async function getArtistTopAlbums(artist, limit = 10, apiKey) {
    const params = new URLSearchParams({
      method: 'artist.getTopAlbums',
      artist,
      limit: String(limit),
      api_key: apiKey || env.LASTFM_API_KEY,
      format: 'json',
    });

    const response = await fetchFn(`${API_URL}?${params}`);
    const data = await response.json();

    if (data.error) {
      if (data.error === 6) return []; // Artist not found
      log.error('Last.fm getArtistTopAlbums failed:', {
        error: data.error,
        message: data.message,
      });
      throw new Error(data.message || 'Failed to fetch artist top albums');
    }

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
function createWriteMethods(fetchFn, generateSignature, log, env) {
  async function scrobble(trackData, sessionKey, apiKey, secret) {
    const params = {
      method: 'track.scrobble',
      api_key: apiKey || env.LASTFM_API_KEY,
      sk: sessionKey,
      artist: trackData.artist,
      track: trackData.track,
      timestamp: String(trackData.timestamp || Math.floor(Date.now() / 1000)),
    };

    if (trackData.album) params.album = trackData.album;
    if (trackData.duration)
      params.duration = String(Math.floor(trackData.duration / 1000));
    if (trackData.trackNumber)
      params.trackNumber = String(trackData.trackNumber);

    params.api_sig = generateSignature(params, secret || env.LASTFM_SECRET);

    log.info('Scrobbling to Last.fm:', {
      artist: trackData.artist,
      track: trackData.track,
    });

    const response = await fetchFn(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...params, format: 'json' }),
    });

    const data = await response.json();

    if (data.error) {
      log.error('Last.fm scrobble failed:', {
        error: data.error,
        message: data.message,
      });
      throw new Error(data.message || 'Failed to scrobble');
    }

    const accepted = data.scrobbles?.['@attr']?.accepted || 0;
    log.info('Last.fm scrobble result:', { accepted });
    return data;
  }

  async function updateNowPlaying(trackData, sessionKey, apiKey, secret) {
    const params = {
      method: 'track.updateNowPlaying',
      api_key: apiKey || env.LASTFM_API_KEY,
      sk: sessionKey,
      artist: trackData.artist,
      track: trackData.track,
    };

    if (trackData.album) params.album = trackData.album;
    if (trackData.duration)
      params.duration = String(Math.floor(trackData.duration / 1000));

    params.api_sig = generateSignature(params, secret || env.LASTFM_SECRET);

    const response = await fetchFn(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...params, format: 'json' }),
    });

    const data = await response.json();

    if (data.error) {
      log.error('Last.fm updateNowPlaying failed:', {
        error: data.error,
        message: data.message,
      });
      throw new Error(data.message || 'Failed to update now playing');
    }

    return data;
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

  // Create helper modules
  const userData = createUserDataMethods(fetchFn, log, env);
  const discovery = createDiscoveryMethods(fetchFn, log, env);
  const write = createWriteMethods(fetchFn, generateSignature, log, env);

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
