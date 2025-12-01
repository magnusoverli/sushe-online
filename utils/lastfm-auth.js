// utils/lastfm-auth.js
// Last.fm API utilities for authentication, scrobbling, and data retrieval

const logger = require('./logger');

const API_URL = 'https://ws.audioscrobbler.com/2.0/';

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
  const fetchFn = deps.fetch || global.fetch;
  const crypto = deps.crypto || require('crypto');
  const env = deps.env || process.env;

  /**
   * Generate Last.fm API signature (MD5 hash of sorted params + secret)
   * Required for all authenticated API calls
   * @param {Object} params - API parameters (excluding format and api_sig)
   * @param {string} secret - Last.fm API secret
   * @returns {string} MD5 signature
   */
  function generateSignature(params, secret) {
    const sortedKeys = Object.keys(params).sort();
    const sigString =
      sortedKeys.map((k) => `${k}${params[k]}`).join('') + secret;
    return crypto.createHash('md5').update(sigString, 'utf8').digest('hex');
  }

  /**
   * Check if Last.fm session is valid
   * Last.fm sessions don't expire, so we just check for presence
   * @param {Object} lastfmAuth - Last.fm auth object
   * @returns {boolean}
   */
  function isSessionValid(lastfmAuth) {
    return !!(lastfmAuth?.session_key && lastfmAuth?.username);
  }

  /**
   * Exchange auth token for session key
   * Called after user authorizes on Last.fm website
   * @param {string} token - Token from Last.fm callback
   * @param {string} apiKey - Last.fm API key
   * @param {string} secret - Last.fm API secret
   * @returns {Object} - { session_key, username }
   */
  async function getSession(token, apiKey, secret) {
    const params = {
      method: 'auth.getSession',
      api_key: apiKey,
      token: token,
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

  // ============================================
  // READ OPERATIONS (require API key only)
  // ============================================

  /**
   * Get user's top albums by time period
   * @param {string} username - Last.fm username
   * @param {string} period - Time period: 7day, 1month, 3month, 6month, 12month, overall
   * @param {number} limit - Number of albums to return (max 1000)
   * @param {string} apiKey - Last.fm API key
   * @returns {Array} - Array of album objects
   */
  async function getTopAlbums(
    username,
    period = 'overall',
    limit = 50,
    apiKey
  ) {
    const params = new URLSearchParams({
      method: 'user.getTopAlbums',
      user: username,
      period: period,
      limit: String(limit),
      api_key: apiKey || env.LASTFM_API_KEY,
      format: 'json',
    });

    const response = await fetchFn(`${API_URL}?${params}`);
    const data = await response.json();

    if (data.error) {
      log.error('Last.fm getTopAlbums failed:', {
        error: data.error,
        message: data.message,
      });
      throw new Error(data.message || 'Failed to fetch top albums');
    }

    return data.topalbums?.album || [];
  }

  /**
   * Get album info including user's play count
   * @param {string} artist - Artist name
   * @param {string} album - Album name
   * @param {string} username - Last.fm username (for user-specific playcount)
   * @param {string} apiKey - Last.fm API key
   * @returns {Object} - Album info with userplaycount
   */
  async function getAlbumInfo(artist, album, username, apiKey) {
    const params = new URLSearchParams({
      method: 'album.getInfo',
      artist: artist,
      album: album,
      username: username,
      api_key: apiKey || env.LASTFM_API_KEY,
      format: 'json',
    });

    const response = await fetchFn(`${API_URL}?${params}`);
    const data = await response.json();

    if (data.error) {
      // Don't log as error for "album not found" - common case
      if (data.error === 6) {
        return { userplaycount: '0', playcount: '0', listeners: '0' };
      }
      log.error('Last.fm getAlbumInfo failed:', {
        error: data.error,
        message: data.message,
      });
      throw new Error(data.message || 'Failed to fetch album info');
    }

    return data.album || {};
  }

  /**
   * Get user's recent tracks
   * @param {string} username - Last.fm username
   * @param {number} limit - Number of tracks to return
   * @param {string} apiKey - Last.fm API key
   * @returns {Array} - Array of track objects
   */
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

  /**
   * Get similar artists
   * @param {string} artist - Artist name
   * @param {number} limit - Number of similar artists to return
   * @param {string} apiKey - Last.fm API key
   * @returns {Array} - Array of artist objects with match scores
   */
  async function getSimilarArtists(artist, limit = 10, apiKey) {
    const params = new URLSearchParams({
      method: 'artist.getSimilar',
      artist: artist,
      limit: String(limit),
      api_key: apiKey || env.LASTFM_API_KEY,
      format: 'json',
    });

    const response = await fetchFn(`${API_URL}?${params}`);
    const data = await response.json();

    if (data.error) {
      log.error('Last.fm getSimilarArtists failed:', {
        error: data.error,
        message: data.message,
      });
      throw new Error(data.message || 'Failed to fetch similar artists');
    }

    return data.similarartists?.artist || [];
  }

  /**
   * Get top tags (genres) for an artist
   * @param {string} artist - Artist name
   * @param {number} limit - Number of tags to return
   * @param {string} apiKey - Last.fm API key
   * @returns {Array} - Array of tag objects with name and count
   */
  async function getArtistTopTags(artist, limit = 10, apiKey) {
    const params = new URLSearchParams({
      method: 'artist.getTopTags',
      artist: artist,
      limit: String(limit),
      api_key: apiKey || env.LASTFM_API_KEY,
      format: 'json',
    });

    const response = await fetchFn(`${API_URL}?${params}`);
    const data = await response.json();

    if (data.error) {
      // Artist not found is common - return empty array
      if (data.error === 6) {
        return [];
      }
      log.error('Last.fm getArtistTopTags failed:', {
        error: data.error,
        message: data.message,
        artist,
      });
      return []; // Don't throw, just return empty
    }

    return (data.toptags?.tag || []).map((tag) => ({
      name: tag.name,
      count: parseInt(tag.count, 10) || 0,
      url: tag.url,
    }));
  }

  /**
   * Get top tags for multiple artists (with rate limiting)
   * @param {Array} artists - Array of artist names or objects with name property
   * @param {number} tagsPerArtist - Tags to fetch per artist
   * @param {string} apiKey - Last.fm API key
   * @param {number} delayMs - Delay between requests in ms
   * @returns {Map} - Map of artist name -> tags array
   */
  async function getArtistTagsBatch(
    artists,
    tagsPerArtist = 5,
    apiKey,
    delayMs = 200
  ) {
    const results = new Map();
    const artistNames = artists.map((a) =>
      typeof a === 'string' ? a : a.name
    );

    for (const artistName of artistNames) {
      try {
        const tags = await getArtistTopTags(artistName, tagsPerArtist, apiKey);
        results.set(artistName, tags);

        // Rate limiting
        if (
          delayMs > 0 &&
          artistNames.indexOf(artistName) < artistNames.length - 1
        ) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      } catch (err) {
        log.warn('Failed to fetch tags for artist:', {
          artist: artistName,
          error: err.message,
        });
        results.set(artistName, []);
      }
    }

    return results;
  }

  /**
   * Get user's top artists by time period
   * @param {string} username - Last.fm username
   * @param {string} period - Time period: 7day, 1month, 3month, 6month, 12month, overall
   * @param {number} limit - Number of artists to return (max 1000)
   * @param {string} apiKey - Last.fm API key
   * @returns {Object} - { artists: Array, total: number, period: string }
   */
  async function getTopArtists(
    username,
    period = 'overall',
    limit = 50,
    apiKey
  ) {
    const params = new URLSearchParams({
      method: 'user.getTopArtists',
      user: username,
      period: period,
      limit: String(limit),
      api_key: apiKey || env.LASTFM_API_KEY,
      format: 'json',
    });

    const response = await fetchFn(`${API_URL}?${params}`);
    const data = await response.json();

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

  /**
   * Get user's top tags (genres they listen to most)
   * @param {string} username - Last.fm username
   * @param {number} limit - Number of tags to return
   * @param {string} apiKey - Last.fm API key
   * @returns {Object} - { tags: Array }
   */
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

  /**
   * Get user profile info (total scrobbles, registration, etc.)
   * @param {string} username - Last.fm username
   * @param {string} apiKey - Last.fm API key
   * @returns {Object} - User profile data
   */
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

  /**
   * Get user's top artists across multiple time periods
   * @param {string} username - Last.fm username
   * @param {number} limitPerPeriod - Number of artists per period
   * @param {string} apiKey - Last.fm API key
   * @returns {Object} - { '7day': [], '1month': [], '3month': [], '6month': [], '12month': [], 'overall': [] }
   */
  async function getAllTopArtists(username, limitPerPeriod = 50, apiKey) {
    const periods = [
      '7day',
      '1month',
      '3month',
      '6month',
      '12month',
      'overall',
    ];

    const results = await Promise.all(
      periods.map((period) =>
        getTopArtists(username, period, limitPerPeriod, apiKey)
      )
    );

    const output = {};
    periods.forEach((period, index) => {
      output[period] = results[index].artists;
    });

    return output;
  }

  /**
   * Get user's top albums across multiple time periods
   * @param {string} username - Last.fm username
   * @param {number} limitPerPeriod - Number of albums per period
   * @param {string} apiKey - Last.fm API key
   * @returns {Object} - { '7day': [], '1month': [], ... }
   */
  async function getAllTopAlbums(username, limitPerPeriod = 50, apiKey) {
    const periods = [
      '7day',
      '1month',
      '3month',
      '6month',
      '12month',
      'overall',
    ];

    const results = await Promise.all(
      periods.map((period) =>
        getTopAlbums(username, period, limitPerPeriod, apiKey)
      )
    );

    const output = {};
    periods.forEach((period, index) => {
      // Transform the raw data to a cleaner format
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

  /**
   * Get top artists for a tag/genre
   * @param {string} tag - Tag/genre name (e.g., "black metal", "post-rock")
   * @param {number} limit - Number of artists to return
   * @param {string} apiKey - Last.fm API key
   * @returns {Array} - Array of artist objects
   */
  async function getTagTopArtists(tag, limit = 10, apiKey) {
    const params = new URLSearchParams({
      method: 'tag.getTopArtists',
      tag: tag,
      limit: String(limit),
      api_key: apiKey || env.LASTFM_API_KEY,
      format: 'json',
    });

    const response = await fetchFn(`${API_URL}?${params}`);
    const data = await response.json();

    if (data.error) {
      // Tag not found is common - return empty array instead of throwing
      if (data.error === 6) {
        return [];
      }
      log.error('Last.fm getTagTopArtists failed:', {
        error: data.error,
        message: data.message,
      });
      throw new Error(data.message || 'Failed to fetch tag top artists');
    }

    return data.topartists?.artist || [];
  }

  /**
   * Get artist's top albums
   * @param {string} artist - Artist name
   * @param {number} limit - Number of albums to return
   * @param {string} apiKey - Last.fm API key
   * @returns {Array} - Array of album objects
   */
  async function getArtistTopAlbums(artist, limit = 10, apiKey) {
    const params = new URLSearchParams({
      method: 'artist.getTopAlbums',
      artist: artist,
      limit: String(limit),
      api_key: apiKey || env.LASTFM_API_KEY,
      format: 'json',
    });

    const response = await fetchFn(`${API_URL}?${params}`);
    const data = await response.json();

    if (data.error) {
      log.error('Last.fm getArtistTopAlbums failed:', {
        error: data.error,
        message: data.message,
      });
      throw new Error(data.message || 'Failed to fetch artist top albums');
    }

    return data.topalbums?.album || [];
  }

  /**
   * Get top albums for a tag/genre
   * @param {string} tag - Tag/genre name (e.g., "black metal", "post-rock")
   * @param {number} limit - Number of albums to return
   * @param {string} apiKey - Last.fm API key
   * @returns {Array} - Array of album objects
   */
  async function getTagTopAlbums(tag, limit = 10, apiKey) {
    const params = new URLSearchParams({
      method: 'tag.getTopAlbums',
      tag: tag,
      limit: String(limit),
      api_key: apiKey || env.LASTFM_API_KEY,
      format: 'json',
    });

    const response = await fetchFn(`${API_URL}?${params}`);
    const data = await response.json();

    if (data.error) {
      // Tag not found is common - return empty array instead of throwing
      if (data.error === 6) {
        return [];
      }
      log.error('Last.fm getTagTopAlbums failed:', {
        error: data.error,
        message: data.message,
      });
      throw new Error(data.message || 'Failed to fetch tag top albums');
    }

    return data.albums?.album || [];
  }

  // ============================================
  // WRITE OPERATIONS (require session key)
  // ============================================

  /**
   * Scrobble a track to Last.fm
   * Track must be >30 seconds and played for >50% or >4 minutes
   * @param {Object} trackData - Track data
   * @param {string} trackData.artist - Artist name (required)
   * @param {string} trackData.track - Track name (required)
   * @param {string} trackData.album - Album name (optional)
   * @param {number} trackData.duration - Track duration in ms (optional)
   * @param {number} trackData.timestamp - Unix timestamp when track started (optional)
   * @param {number} trackData.trackNumber - Track number (optional)
   * @param {string} sessionKey - Last.fm session key
   * @param {string} apiKey - Last.fm API key
   * @param {string} secret - Last.fm API secret
   * @returns {Object} - Scrobble response
   */
  async function scrobble(trackData, sessionKey, apiKey, secret) {
    const params = {
      method: 'track.scrobble',
      api_key: apiKey || env.LASTFM_API_KEY,
      sk: sessionKey,
      artist: trackData.artist,
      track: trackData.track,
      timestamp: String(trackData.timestamp || Math.floor(Date.now() / 1000)),
    };

    // Add optional parameters
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

  /**
   * Update "Now Playing" status on Last.fm
   * @param {Object} trackData - Track data
   * @param {string} trackData.artist - Artist name (required)
   * @param {string} trackData.track - Track name (required)
   * @param {string} trackData.album - Album name (optional)
   * @param {number} trackData.duration - Track duration in ms (optional)
   * @param {string} sessionKey - Last.fm session key
   * @param {string} apiKey - Last.fm API key
   * @param {string} secret - Last.fm API secret
   * @returns {Object} - Now playing response
   */
  async function updateNowPlaying(trackData, sessionKey, apiKey, secret) {
    const params = {
      method: 'track.updateNowPlaying',
      api_key: apiKey || env.LASTFM_API_KEY,
      sk: sessionKey,
      artist: trackData.artist,
      track: trackData.track,
    };

    // Add optional parameters
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

  return {
    // Signature generation
    generateSignature,
    // Session validation
    isSessionValid,
    // Auth
    getSession,
    // Read operations - User data
    getTopAlbums,
    getTopArtists,
    getTopTags,
    getUserInfo,
    getAllTopArtists,
    getAllTopAlbums,
    getAlbumInfo,
    getRecentTracks,
    // Read operations - Discovery
    getSimilarArtists,
    getTagTopArtists,
    getTagTopAlbums,
    getArtistTopAlbums,
    getArtistTopTags,
    getArtistTagsBatch,
    // Write operations
    scrobble,
    updateNowPlaying,
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
