// utils/musicbrainz.js
// Server-side MusicBrainz API utilities for artist metadata lookups

const logger = require('./logger');

const MUSICBRAINZ_API = 'https://musicbrainz.org/ws/2';
const USER_AGENT = 'SusheOnline/1.0 (https://sushe.online)';

// Rate limiting: MusicBrainz allows 1 request per second
const MIN_REQUEST_INTERVAL_MS = 1100; // Slightly over 1 second to be safe

// Country code to full name mapping (ISO 3166-1 alpha-2)
// Complete coverage of all ISO 3166-1 codes for MusicBrainz artist country resolution
const COUNTRY_CODE_MAP = {
  // A
  AD: 'Andorra',
  AE: 'United Arab Emirates',
  AF: 'Afghanistan',
  AG: 'Antigua and Barbuda',
  AI: 'Anguilla',
  AL: 'Albania',
  AM: 'Armenia',
  AO: 'Angola',
  AQ: 'Antarctica',
  AR: 'Argentina',
  AS: 'American Samoa',
  AT: 'Austria',
  AU: 'Australia',
  AW: 'Aruba',
  AX: 'Åland Islands',
  AZ: 'Azerbaijan',
  // B
  BA: 'Bosnia and Herzegovina',
  BB: 'Barbados',
  BD: 'Bangladesh',
  BE: 'Belgium',
  BF: 'Burkina Faso',
  BG: 'Bulgaria',
  BH: 'Bahrain',
  BI: 'Burundi',
  BJ: 'Benin',
  BL: 'Saint Barthélemy',
  BM: 'Bermuda',
  BN: 'Brunei',
  BO: 'Bolivia',
  BQ: 'Caribbean Netherlands',
  BR: 'Brazil',
  BS: 'Bahamas',
  BT: 'Bhutan',
  BV: 'Bouvet Island',
  BW: 'Botswana',
  BY: 'Belarus',
  BZ: 'Belize',
  // C
  CA: 'Canada',
  CC: 'Cocos (Keeling) Islands',
  CD: 'Congo (Democratic Republic)',
  CF: 'Central African Republic',
  CG: 'Congo (Republic)',
  CH: 'Switzerland',
  CI: "Côte d'Ivoire",
  CK: 'Cook Islands',
  CL: 'Chile',
  CM: 'Cameroon',
  CN: 'China',
  CO: 'Colombia',
  CR: 'Costa Rica',
  CU: 'Cuba',
  CV: 'Cape Verde',
  CW: 'Curaçao',
  CX: 'Christmas Island',
  CY: 'Cyprus',
  CZ: 'Czech Republic',
  // D
  DE: 'Germany',
  DJ: 'Djibouti',
  DK: 'Denmark',
  DM: 'Dominica',
  DO: 'Dominican Republic',
  DZ: 'Algeria',
  // E
  EC: 'Ecuador',
  EE: 'Estonia',
  EG: 'Egypt',
  EH: 'Western Sahara',
  ER: 'Eritrea',
  ES: 'Spain',
  ET: 'Ethiopia',
  // F
  FI: 'Finland',
  FJ: 'Fiji',
  FK: 'Falkland Islands',
  FM: 'Micronesia',
  FO: 'Faroe Islands',
  FR: 'France',
  // G
  GA: 'Gabon',
  GB: 'United Kingdom',
  GD: 'Grenada',
  GE: 'Georgia',
  GF: 'French Guiana',
  GG: 'Guernsey',
  GH: 'Ghana',
  GI: 'Gibraltar',
  GL: 'Greenland',
  GM: 'Gambia',
  GN: 'Guinea',
  GP: 'Guadeloupe',
  GQ: 'Equatorial Guinea',
  GR: 'Greece',
  GS: 'South Georgia and the South Sandwich Islands',
  GT: 'Guatemala',
  GU: 'Guam',
  GW: 'Guinea-Bissau',
  GY: 'Guyana',
  // H
  HK: 'Hong Kong',
  HM: 'Heard Island and McDonald Islands',
  HN: 'Honduras',
  HR: 'Croatia',
  HT: 'Haiti',
  HU: 'Hungary',
  // I
  ID: 'Indonesia',
  IE: 'Ireland',
  IL: 'Israel',
  IM: 'Isle of Man',
  IN: 'India',
  IO: 'British Indian Ocean Territory',
  IQ: 'Iraq',
  IR: 'Iran',
  IS: 'Iceland',
  IT: 'Italy',
  // J
  JE: 'Jersey',
  JM: 'Jamaica',
  JO: 'Jordan',
  JP: 'Japan',
  // K
  KE: 'Kenya',
  KG: 'Kyrgyzstan',
  KH: 'Cambodia',
  KI: 'Kiribati',
  KM: 'Comoros',
  KN: 'Saint Kitts and Nevis',
  KP: 'North Korea',
  KR: 'South Korea',
  KW: 'Kuwait',
  KY: 'Cayman Islands',
  KZ: 'Kazakhstan',
  // L
  LA: 'Laos',
  LB: 'Lebanon',
  LC: 'Saint Lucia',
  LI: 'Liechtenstein',
  LK: 'Sri Lanka',
  LR: 'Liberia',
  LS: 'Lesotho',
  LT: 'Lithuania',
  LU: 'Luxembourg',
  LV: 'Latvia',
  LY: 'Libya',
  // M
  MA: 'Morocco',
  MC: 'Monaco',
  MD: 'Moldova',
  ME: 'Montenegro',
  MF: 'Saint Martin',
  MG: 'Madagascar',
  MH: 'Marshall Islands',
  MK: 'North Macedonia',
  ML: 'Mali',
  MM: 'Myanmar',
  MN: 'Mongolia',
  MO: 'Macao',
  MP: 'Northern Mariana Islands',
  MQ: 'Martinique',
  MR: 'Mauritania',
  MS: 'Montserrat',
  MT: 'Malta',
  MU: 'Mauritius',
  MV: 'Maldives',
  MW: 'Malawi',
  MX: 'Mexico',
  MY: 'Malaysia',
  MZ: 'Mozambique',
  // N
  NA: 'Namibia',
  NC: 'New Caledonia',
  NE: 'Niger',
  NF: 'Norfolk Island',
  NG: 'Nigeria',
  NI: 'Nicaragua',
  NL: 'Netherlands',
  NO: 'Norway',
  NP: 'Nepal',
  NR: 'Nauru',
  NU: 'Niue',
  NZ: 'New Zealand',
  // O
  OM: 'Oman',
  // P
  PA: 'Panama',
  PE: 'Peru',
  PF: 'French Polynesia',
  PG: 'Papua New Guinea',
  PH: 'Philippines',
  PK: 'Pakistan',
  PL: 'Poland',
  PM: 'Saint Pierre and Miquelon',
  PN: 'Pitcairn Islands',
  PR: 'Puerto Rico',
  PS: 'Palestine',
  PT: 'Portugal',
  PW: 'Palau',
  PY: 'Paraguay',
  // Q
  QA: 'Qatar',
  // R
  RE: 'Réunion',
  RO: 'Romania',
  RS: 'Serbia',
  RU: 'Russia',
  RW: 'Rwanda',
  // S
  SA: 'Saudi Arabia',
  SB: 'Solomon Islands',
  SC: 'Seychelles',
  SD: 'Sudan',
  SE: 'Sweden',
  SG: 'Singapore',
  SH: 'Saint Helena',
  SI: 'Slovenia',
  SJ: 'Svalbard and Jan Mayen',
  SK: 'Slovakia',
  SL: 'Sierra Leone',
  SM: 'San Marino',
  SN: 'Senegal',
  SO: 'Somalia',
  SR: 'Suriname',
  SS: 'South Sudan',
  ST: 'São Tomé and Príncipe',
  SV: 'El Salvador',
  SX: 'Sint Maarten',
  SY: 'Syria',
  SZ: 'Eswatini',
  // T
  TC: 'Turks and Caicos Islands',
  TD: 'Chad',
  TF: 'French Southern Territories',
  TG: 'Togo',
  TH: 'Thailand',
  TJ: 'Tajikistan',
  TK: 'Tokelau',
  TL: 'Timor-Leste',
  TM: 'Turkmenistan',
  TN: 'Tunisia',
  TO: 'Tonga',
  TR: 'Turkey',
  TT: 'Trinidad and Tobago',
  TV: 'Tuvalu',
  TW: 'Taiwan',
  TZ: 'Tanzania',
  // U
  UA: 'Ukraine',
  UG: 'Uganda',
  UM: 'United States Minor Outlying Islands',
  US: 'United States',
  UY: 'Uruguay',
  UZ: 'Uzbekistan',
  // V
  VA: 'Vatican City',
  VC: 'Saint Vincent and the Grenadines',
  VE: 'Venezuela',
  VG: 'British Virgin Islands',
  VI: 'U.S. Virgin Islands',
  VN: 'Vietnam',
  VU: 'Vanuatu',
  // W
  WF: 'Wallis and Futuna',
  WS: 'Samoa',
  // X - Special MusicBrainz codes
  XE: 'Europe',
  XU: 'Unknown',
  XW: 'Worldwide',
  // Y
  YE: 'Yemen',
  YT: 'Mayotte',
  // Z
  ZA: 'South Africa',
  ZM: 'Zambia',
  ZW: 'Zimbabwe',
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
