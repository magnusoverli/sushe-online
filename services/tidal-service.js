/**
 * Tidal Service
 *
 * Business logic for Tidal API interactions:
 * - Album search with country code detection
 * - Track search with multi-step matching (number → name → fallback)
 *
 * Uses dependency injection via createTidalService(deps) factory.
 *
 * @module services/tidal-service
 */

const {
  matchTrackByNumber,
  extractTrackName,
  matchTrackByName,
} = require('../utils/track-matching');

/**
 * @param {Object} deps
 * @param {Object} deps.fetch - Fetch implementation
 * @param {Object} deps.usersAsync - Async user datastore
 * @param {Object} [deps.logger] - Logger instance
 * @returns {Object} Tidal service methods
 */
function createTidalService(deps = {}) {
  const fetch = deps.fetch || globalThis.fetch;
  const usersAsync = deps.usersAsync;
  const logger = deps.logger || require('../utils/logger');

  /**
   * Build common Tidal API request headers.
   * @param {string} accessToken - Tidal OAuth access token
   * @returns {Object} Headers object
   */
  function buildHeaders(accessToken) {
    return {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.api+json',
      'X-Tidal-Token': process.env.TIDAL_CLIENT_ID || '',
    };
  }

  /**
   * Resolve user's country code for Tidal API calls.
   * Fetches from Tidal profile if not cached, then persists to DB.
   *
   * @param {Object} user - User object with _id, tidalCountry
   * @param {string} accessToken - Tidal OAuth access token
   * @returns {Promise<string>} Two-letter country code
   */
  async function resolveCountryCode(user, accessToken) {
    if (user.tidalCountry) return user.tidalCountry;

    try {
      const profileResp = await fetch('https://openapi.tidal.com/v2/me', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.api+json',
        },
      });

      if (profileResp.ok) {
        const profileData = await profileResp.json();
        const countryCode = profileData?.data?.attributes?.country || 'US';

        // Save for future requests (fire-and-forget)
        if (usersAsync) {
          usersAsync
            .update(
              { _id: user._id },
              { $set: { tidalCountry: countryCode, updatedAt: new Date() } }
            )
            .catch((err) =>
              logger.error('Failed to save Tidal country', {
                error: err.message,
                userId: user._id,
              })
            );
        }

        return countryCode;
      }

      logger.warn('Tidal profile request failed:', profileResp.status);
    } catch (profileErr) {
      logger.error('Tidal profile fetch error:', profileErr);
    }

    return 'US';
  }

  /**
   * Search for an album on Tidal.
   *
   * @param {string} artist - Artist name
   * @param {string} album - Album name
   * @param {string} accessToken - Tidal OAuth access token
   * @param {string} countryCode - Two-letter country code
   * @returns {Promise<{ id: string } | null>} Album ID or null if not found
   */
  async function searchAlbum(artist, album, accessToken, countryCode) {
    const query = `${album} ${artist}`;
    const searchPath = encodeURIComponent(query).replace(/'/g, '%27');
    const params = new URLSearchParams({ countryCode });
    const url = `https://openapi.tidal.com/v2/searchResults/${searchPath}/relationships/albums?${params.toString()}`;

    logger.debug('Tidal search URL:', url);

    const resp = await fetch(url, { headers: buildHeaders(accessToken) });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '<body read failed>');
      logger.warn('Tidal API request failed:', resp.status, body);
      throw new Error(`Tidal API error ${resp.status}`);
    }

    const data = await resp.json();
    const albumId = data?.data?.[0]?.id;
    return albumId ? { id: albumId } : null;
  }

  /**
   * Search for a track on Tidal using multi-step matching:
   * 1. Find album → get tracks → match by number
   * 2. Fetch track details → match by name
   * 3. Fallback: direct track search
   *
   * @param {string} artist - Artist name
   * @param {string} album - Album name
   * @param {string} track - Track identifier (e.g. "3. Track Name")
   * @param {string} accessToken - Tidal OAuth access token
   * @param {string} countryCode - Two-letter country code
   * @returns {Promise<{ id: string } | null>} Track ID or null if not found
   */
  async function searchTrack(artist, album, track, accessToken, countryCode) {
    const headers = buildHeaders(accessToken);

    // Step 1: Find the album
    const albumQuery = `${album} ${artist}`;
    const searchPath = encodeURIComponent(albumQuery).replace(/'/g, '%27');
    const albumResp = await fetch(
      `https://openapi.tidal.com/v2/searchResults/${searchPath}/relationships/albums?countryCode=${countryCode}`,
      { headers }
    );
    if (!albumResp.ok) {
      throw new Error(`Tidal API error ${albumResp.status}`);
    }
    const albumData = await albumResp.json();
    const tidalAlbumId = albumData?.data?.[0]?.id;
    if (!tidalAlbumId) return null;

    // Step 2: Get album tracks
    const tracksResp = await fetch(
      `https://openapi.tidal.com/v2/albums/${tidalAlbumId}/relationships/items?countryCode=${countryCode}`,
      { headers }
    );
    if (!tracksResp.ok) {
      throw new Error(`Tidal API error ${tracksResp.status}`);
    }
    const tracksData = await tracksResp.json();
    const tracks = tracksData.data || [];

    // Step 3: Match by track number
    const numberMatch = matchTrackByNumber(tracks, track);
    if (numberMatch) {
      logger.info('Tidal track matched by number', { trackId: numberMatch.id });
      return { id: numberMatch.id };
    }

    // Step 4: Fetch details and match by name
    const searchName = extractTrackName(track);
    const trackDetailsPromises = tracks.slice(0, 20).map(async (t) => {
      try {
        const detailResp = await fetch(
          `https://openapi.tidal.com/v2/tracks/${t.id}?countryCode=${countryCode}`,
          { headers }
        );
        if (detailResp.ok) {
          const detail = await detailResp.json();
          return { id: t.id, name: detail.data?.attributes?.title || '' };
        }
      } catch {
        // Ignore individual track fetch errors
      }
      return { id: t.id, name: '' };
    });

    const trackDetails = await Promise.all(trackDetailsPromises);
    const matchingTrack = matchTrackByName(trackDetails, searchName);
    if (matchingTrack) {
      logger.info('Tidal track matched by name', { trackId: matchingTrack.id });
      return { id: matchingTrack.id };
    }

    // Step 5: Fallback direct track search
    const trackSearchPath = encodeURIComponent(
      `${searchName} ${artist}`
    ).replace(/'/g, '%27');
    const fallbackResp = await fetch(
      `https://openapi.tidal.com/v2/searchResults/${trackSearchPath}/relationships/tracks?countryCode=${countryCode}&limit=1`,
      { headers }
    );
    if (fallbackResp.ok) {
      const fallbackData = await fallbackResp.json();
      if (fallbackData.data && fallbackData.data.length > 0) {
        logger.info(
          'Tidal track matched by fallback search:',
          fallbackData.data[0].id
        );
        return { id: fallbackData.data[0].id };
      }
    }

    return null;
  }

  return {
    resolveCountryCode,
    searchAlbum,
    searchTrack,
  };
}

module.exports = { createTidalService };
