// utils/musicbrainz.js
// Server-side MusicBrainz API utilities for artist metadata lookups

const logger = require('./logger');

const MUSICBRAINZ_API = 'https://musicbrainz.org/ws/2';
const USER_AGENT = 'SusheOnline/1.0 (https://sushe.online)';

// Rate limiting: MusicBrainz allows 1 request per second
const MIN_REQUEST_INTERVAL_MS = 1100; // Slightly over 1 second to be safe

// Country code to full name mapping (ISO 3166-1 alpha-2)
// This covers the most common countries in music; MusicBrainz uses these codes
const COUNTRY_CODE_MAP = {
  // Major music markets
  US: 'United States',
  GB: 'United Kingdom',
  CA: 'Canada',
  AU: 'Australia',
  DE: 'Germany',
  FR: 'France',
  JP: 'Japan',
  SE: 'Sweden',
  NO: 'Norway',
  FI: 'Finland',
  DK: 'Denmark',
  IS: 'Iceland',
  NL: 'Netherlands',
  BE: 'Belgium',
  IT: 'Italy',
  ES: 'Spain',
  PT: 'Portugal',
  BR: 'Brazil',
  MX: 'Mexico',
  AR: 'Argentina',
  // Metal strongholds
  PL: 'Poland',
  CZ: 'Czech Republic',
  AT: 'Austria',
  CH: 'Switzerland',
  GR: 'Greece',
  // Asia
  KR: 'South Korea',
  CN: 'China',
  TW: 'Taiwan',
  HK: 'Hong Kong',
  IN: 'India',
  // Other notable
  IE: 'Ireland',
  NZ: 'New Zealand',
  ZA: 'South Africa',
  RU: 'Russia',
  UA: 'Ukraine',
  IL: 'Israel',
  TR: 'Turkey',
  // Special MusicBrainz codes
  XW: 'Worldwide',
  XE: 'Europe',
  XU: 'Unknown',
};

/**
 * Create MusicBrainz utilities with injected dependencies
 * @param {Object} deps - Dependencies
 * @param {Object} deps.logger - Logger instance
 * @param {Function} deps.fetch - Fetch function (defaults to global fetch)
 */
function createMusicBrainz(deps = {}) {
  const log = deps.logger || logger;
  const fetchFn = deps.fetch || global.fetch;

  let lastRequestTime = 0;

  /**
   * Rate-limited fetch from MusicBrainz API
   * @param {string} endpoint - API endpoint (e.g., 'artist/mbid')
   * @returns {Object} - JSON response
   */
  async function mbFetch(endpoint) {
    // Enforce rate limiting
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL_MS) {
      await new Promise((r) =>
        setTimeout(r, MIN_REQUEST_INTERVAL_MS - timeSinceLastRequest)
      );
    }
    lastRequestTime = Date.now();

    const url = `${MUSICBRAINZ_API}/${endpoint}`;
    const response = await fetchFn(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`MusicBrainz API error: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Resolve a 2-letter country code to full country name
   * @param {string} code - ISO 3166-1 alpha-2 country code
   * @returns {string} - Full country name or empty string
   */
  function resolveCountryCode(code) {
    if (!code || code.length !== 2) return '';
    return COUNTRY_CODE_MAP[code.toUpperCase()] || '';
  }

  /**
   * Search for an artist by name and get their MBID
   * @param {string} artistName - Artist name to search
   * @returns {Object|null} - { mbid, name, country, countryCode } or null
   */
  async function searchArtist(artistName) {
    if (!artistName) return null;

    try {
      const query = encodeURIComponent(artistName);
      const data = await mbFetch(`artist/?query=${query}&fmt=json&limit=5`);

      if (!data?.artists?.length) {
        return null;
      }

      // Find best match (exact or close match)
      const normalizedSearch = artistName.toLowerCase().trim();
      let bestMatch = data.artists.find(
        (a) => a.name.toLowerCase() === normalizedSearch
      );

      // If no exact match, use the first result (MusicBrainz ranks by relevance)
      if (!bestMatch) {
        bestMatch = data.artists[0];
      }

      const countryCode =
        bestMatch.country || bestMatch.area?.iso_3166_1_codes?.[0];

      return {
        mbid: bestMatch.id,
        name: bestMatch.name,
        countryCode: countryCode || null,
        country: resolveCountryCode(countryCode) || null,
        disambiguation: bestMatch.disambiguation || null,
      };
    } catch (err) {
      log.warn('MusicBrainz artist search failed:', {
        artist: artistName,
        error: err.message,
      });
      return null;
    }
  }

  /**
   * Get artist details by MBID
   * @param {string} mbid - MusicBrainz artist ID
   * @returns {Object|null} - { mbid, name, country, countryCode } or null
   */
  async function getArtistById(mbid) {
    if (!mbid) return null;

    try {
      const data = await mbFetch(`artist/${mbid}?fmt=json`);

      if (!data) return null;

      const countryCode = data.country || data.area?.iso_3166_1_codes?.[0];

      return {
        mbid: data.id,
        name: data.name,
        countryCode: countryCode || null,
        country: resolveCountryCode(countryCode) || null,
        disambiguation: data.disambiguation || null,
      };
    } catch (err) {
      log.warn('MusicBrainz artist lookup failed:', {
        mbid,
        error: err.message,
      });
      return null;
    }
  }

  /**
   * Get countries for a batch of artists (with rate limiting)
   * @param {Array} artists - Array of { name, mbid? } objects
   * @returns {Map} - Map of normalized artist name -> { country, countryCode }
   */
  async function getArtistCountriesBatch(artists) {
    const results = new Map();

    for (const artist of artists) {
      const name = typeof artist === 'string' ? artist : artist.name;
      const mbid = typeof artist === 'string' ? null : artist.mbid;

      try {
        let data;
        if (mbid) {
          data = await getArtistById(mbid);
        } else {
          data = await searchArtist(name);
        }

        if (data?.country) {
          results.set(name, {
            country: data.country,
            countryCode: data.countryCode,
            mbid: data.mbid,
          });
        } else {
          results.set(name, null);
        }
      } catch (err) {
        log.warn('Failed to fetch country for artist:', {
          artist: name,
          error: err.message,
        });
        results.set(name, null);
      }
    }

    return results;
  }

  return {
    mbFetch,
    resolveCountryCode,
    searchArtist,
    getArtistById,
    getArtistCountriesBatch,
    COUNTRY_CODE_MAP,
  };
}

// Default instance
const defaultInstance = createMusicBrainz();

module.exports = {
  createMusicBrainz,
  resolveCountryCode: defaultInstance.resolveCountryCode,
  searchArtist: defaultInstance.searchArtist,
  getArtistById: defaultInstance.getArtistById,
  getArtistCountriesBatch: defaultInstance.getArtistCountriesBatch,
  COUNTRY_CODE_MAP: defaultInstance.COUNTRY_CODE_MAP,
};
