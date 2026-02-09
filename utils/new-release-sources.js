// utils/new-release-sources.js
// Fetch new album releases from multiple sources: Spotify, MusicBrainz, Claude web search

const logger = require('./logger');

const MUSICBRAINZ_API_BASE = 'https://musicbrainz.org/ws/2';
const MUSICBRAINZ_USER_AGENT =
  'SusheOnline/1.0 (https://github.com/sushe-online)';
const MUSICBRAINZ_RATE_LIMIT_MS = 1100; // 1 req/sec with buffer

/**
 * Parse Claude's JSON response text into structured release objects
 * @param {string} text - Raw text from Claude response
 * @returns {Array<{artist: string, album: string, genre: string, release_date: string}>}
 */
function parseClaudeReleaseResponse(text) {
  let jsonText = text.trim();
  const fenceMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    jsonText = fenceMatch[1].trim();
  }
  if (!jsonText.startsWith('[')) {
    const arrayMatch = jsonText.match(/\[[\s\S]*\]/);
    if (arrayMatch) jsonText = arrayMatch[0];
  }

  const parsed = JSON.parse(jsonText);
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter((item) => item.artist && item.album)
    .map((item) => ({
      artist: String(item.artist).trim(),
      album: String(item.album).trim(),
      genre: item.genre ? String(item.genre).trim() : '',
      release_date: item.release_date ? String(item.release_date).trim() : '',
    }));
}

/**
 * Deduplicate releases from multiple sources, preferring authoritative sources
 * @param {Array} allReleases - Combined releases with source attribution
 * @param {Function} normalizeAlbumKey - Key normalization function
 * @returns {Array} Deduplicated releases
 */
function deduplicateReleases(allReleases, normalizeAlbumKey) {
  const seen = new Map();
  for (const release of allReleases) {
    const key = normalizeAlbumKey(release.artist, release.album);
    if (!seen.has(key)) {
      seen.set(key, release);
    } else {
      const existing = seen.get(key);
      if (!existing.genre && release.genre) {
        existing.genre = release.genre;
      }
      if (
        existing.source === 'claude_search' &&
        release.source !== 'claude_search'
      ) {
        seen.set(key, { ...release, genre: existing.genre || release.genre });
      }
    }
  }
  return Array.from(seen.values());
}

/**
 * Create new release source fetchers with injected dependencies
 * @param {Object} deps - Dependencies
 * @param {Object} deps.logger - Logger instance
 * @param {Function} deps.fetch - Fetch function
 * @param {Object} deps.env - Environment variables
 * @param {Function} deps.getClientCredentialsToken - Spotify client credentials token getter
 * @param {Function} deps.spotifyApiRequest - Spotify API request function
 * @param {Function} deps.normalizeAlbumKey - Album key normalization function
 */
function createNewReleaseSources(deps = {}) {
  const log = deps.logger || logger;
  const fetchFn = deps.fetch || global.fetch;
  const env = deps.env || process.env;
  const getClientCredentialsToken =
    deps.getClientCredentialsToken ||
    require('./spotify-auth').getClientCredentialsToken;
  const spotifyApiRequest =
    deps.spotifyApiRequest || require('./spotify-auth').spotifyApiRequest;
  const normalizeAlbumKey =
    deps.normalizeAlbumKey || require('./fuzzy-match').normalizeAlbumKey;

  /**
   * Sleep for the specified milliseconds
   */
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * Fetch new releases from Spotify using client credentials flow
   * @param {string} dateStart - Start date (YYYY-MM-DD)
   * @param {string} dateEnd - End date (YYYY-MM-DD)
   * @returns {Promise<Array<{artist: string, album: string, genre: string, release_date: string, spotify_id: string}>>}
   */
  async function fetchSpotifyNewReleases(dateStart, dateEnd) {
    const accessToken = await getClientCredentialsToken();
    if (!accessToken) {
      log.warn(
        'Spotify client credentials not available, skipping Spotify new releases'
      );
      return [];
    }

    const releases = [];
    const limit = 50;
    const maxPages = 2; // Up to 100 albums
    // Use search API with year filter (browse/new-releases was deprecated)
    const year = dateStart.substring(0, 4);

    try {
      for (let page = 0; page < maxPages; page++) {
        const offset = page * limit;
        const data = await spotifyApiRequest(
          `/v1/search?q=tag%3Anew+year%3A${year}&type=album&limit=${limit}&offset=${offset}`,
          accessToken
        );

        if (!data?.albums?.items) break;

        for (const album of data.albums.items) {
          const releaseDate = album.release_date;
          // Filter by date range (only include albums within the window)
          if (
            releaseDate &&
            releaseDate >= dateStart &&
            releaseDate <= dateEnd
          ) {
            releases.push({
              artist: album.artists?.[0]?.name || 'Unknown',
              album: album.name,
              genre: '',
              release_date: releaseDate,
              spotify_id: album.id,
            });
          }
        }

        // Check if there are more pages
        if (!data.albums.next) break;
      }

      log.info('Fetched Spotify new releases', {
        count: releases.length,
        dateStart,
        dateEnd,
      });
    } catch (err) {
      log.error('Failed to fetch Spotify new releases', {
        error: err.message,
        dateStart,
        dateEnd,
      });
    }

    return releases;
  }

  /**
   * Fetch new releases from MusicBrainz using date range query
   * @param {string} dateStart - Start date (YYYY-MM-DD)
   * @param {string} dateEnd - End date (YYYY-MM-DD)
   * @returns {Promise<Array<{artist: string, album: string, release_date: string, musicbrainz_id: string}>>}
   */
  async function fetchMusicBrainzNewReleases(dateStart, dateEnd) {
    const releases = [];
    let offset = 0;
    const limit = 100;
    const maxResults = 500;

    try {
      while (offset < maxResults) {
        const query = `firstreleasedate:[${dateStart} TO ${dateEnd}] AND type:album`;
        const url = `${MUSICBRAINZ_API_BASE}/release-group/?query=${encodeURIComponent(query)}&fmt=json&limit=${limit}&offset=${offset}`;

        const response = await fetchFn(url, {
          headers: {
            'User-Agent': MUSICBRAINZ_USER_AGENT,
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          log.warn('MusicBrainz API error', {
            status: response.status,
            offset,
          });
          break;
        }

        const data = await response.json();
        const groups = data['release-groups'] || [];

        if (groups.length === 0) break;

        for (const group of groups) {
          const artistCredit = group['artist-credit'];
          const artistName =
            artistCredit?.[0]?.artist?.name ||
            artistCredit?.[0]?.name ||
            'Unknown';

          releases.push({
            artist: artistName,
            album: group.title || 'Unknown',
            release_date: group['first-release-date'] || '',
            musicbrainz_id: group.id || '',
          });
        }

        offset += limit;

        // If we got fewer than limit, no more results
        if (groups.length < limit) break;

        // Rate limit: 1 request per second
        await sleep(MUSICBRAINZ_RATE_LIMIT_MS);
      }

      log.info('Fetched MusicBrainz new releases', {
        count: releases.length,
        dateStart,
        dateEnd,
      });
    } catch (err) {
      log.error('Failed to fetch MusicBrainz new releases', {
        error: err.message,
        dateStart,
        dateEnd,
      });
    }

    return releases;
  }

  /**
   * Fetch new releases via Claude web search
   * @param {string} dateStart - Start date (YYYY-MM-DD)
   * @param {string} dateEnd - End date (YYYY-MM-DD)
   * @param {Function} callClaude - Claude API call function from claude-client
   * @param {Function} extractTextFromContent - Text extraction function from claude-client
   * @returns {Promise<Array<{artist: string, album: string, genre: string, release_date: string}>>}
   */
  async function fetchClaudeSearchNewReleases(
    dateStart,
    dateEnd,
    callClaude,
    extractTextFromContent
  ) {
    if (!callClaude) {
      log.warn('Claude client not available for new release search');
      return [];
    }

    const model = env.PERSONAL_RECS_POOL_MODEL || 'claude-haiku-4-5';

    try {
      const response = await callClaude({
        model,
        maxTokens: 2000,
        temperature: 0.3,
        system:
          'You are a music industry researcher. Search for and return newly released albums as a JSON array. Be thorough and include releases from all genres and regions.',
        tools: [
          { type: 'web_search_20250305', name: 'web_search', max_uses: 5 },
        ],
        messages: [
          {
            role: 'user',
            content: `Search for notable album releases between ${dateStart} and ${dateEnd}. Include indie, underground, and non-Western releases that may not be on major platforms. Return ONLY a JSON array with objects containing "artist", "album", "genre", and "release_date" fields. No other text.`,
          },
        ],
        metricsLabel: 'personal_recs_pool_search',
      });

      if (!response) return [];

      const text = extractTextFromContent(response.content);
      if (!text) return [];

      const releases = parseClaudeReleaseResponse(text);

      log.info('Fetched Claude search new releases', {
        count: releases.length,
        dateStart,
        dateEnd,
      });

      return releases;
    } catch (err) {
      log.error('Failed to fetch Claude search new releases', {
        error: err.message,
        dateStart,
        dateEnd,
      });
      return [];
    }
  }

  /**
   * Gather new releases from all sources, deduplicate, and return combined pool
   * @param {string} dateStart - Start date (YYYY-MM-DD)
   * @param {string} dateEnd - End date (YYYY-MM-DD)
   * @param {Object} options - Additional options
   * @param {Function} options.callClaude - Claude API call function
   * @param {Function} options.extractTextFromContent - Text extraction function
   * @returns {Promise<Array<{artist: string, album: string, genre: string, release_date: string, source: string}>>}
   */
  async function gatherWeeklyNewReleases(dateStart, dateEnd, options = {}) {
    log.info('Gathering weekly new releases', { dateStart, dateEnd });

    // Fetch from Spotify and MusicBrainz in parallel
    const [spotifyReleases, musicBrainzReleases] = await Promise.all([
      fetchSpotifyNewReleases(dateStart, dateEnd),
      fetchMusicBrainzNewReleases(dateStart, dateEnd),
    ]);

    // Fetch from Claude search after (to fill gaps)
    const claudeReleases = await fetchClaudeSearchNewReleases(
      dateStart,
      dateEnd,
      options.callClaude,
      options.extractTextFromContent
    );

    // Combine all sources with source attribution
    const allReleases = [
      ...spotifyReleases.map((r) => ({ ...r, source: 'spotify' })),
      ...musicBrainzReleases.map((r) => ({ ...r, source: 'musicbrainz' })),
      ...claudeReleases.map((r) => ({ ...r, source: 'claude_search' })),
    ];

    const deduplicated = deduplicateReleases(allReleases, normalizeAlbumKey);

    log.info('Weekly new releases gathered', {
      spotify: spotifyReleases.length,
      musicbrainz: musicBrainzReleases.length,
      claude: claudeReleases.length,
      total: allReleases.length,
      afterDedup: deduplicated.length,
    });

    return deduplicated;
  }

  return {
    fetchSpotifyNewReleases,
    fetchMusicBrainzNewReleases,
    fetchClaudeSearchNewReleases,
    gatherWeeklyNewReleases,
  };
}

// Default instance
const defaultInstance = createNewReleaseSources();

module.exports = {
  createNewReleaseSources,
  fetchSpotifyNewReleases: defaultInstance.fetchSpotifyNewReleases,
  fetchMusicBrainzNewReleases: defaultInstance.fetchMusicBrainzNewReleases,
  fetchClaudeSearchNewReleases: defaultInstance.fetchClaudeSearchNewReleases,
  gatherWeeklyNewReleases: defaultInstance.gatherWeeklyNewReleases,
};
