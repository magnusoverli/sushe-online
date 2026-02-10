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
 * @returns {Array<{artist: string, album: string, genre_1: string, genre_2: string, country: string, release_date: string}>}
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
      genre_1: item.genre_1
        ? String(item.genre_1).trim()
        : item.genre
          ? String(item.genre).trim()
          : '',
      genre_2: item.genre_2 ? String(item.genre_2).trim() : '',
      country: item.country ? String(item.country).trim() : '',
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
      // Merge genre info from other sources
      if (!existing.genre_1 && release.genre_1) {
        existing.genre_1 = release.genre_1;
      }
      if (!existing.genre_2 && release.genre_2) {
        existing.genre_2 = release.genre_2;
      }
      // Merge country info
      if (!existing.country && release.country) {
        existing.country = release.country;
      }
      // Merge cover_image_url (prefer Spotify's high-res images)
      if (!existing.cover_image_url && release.cover_image_url) {
        existing.cover_image_url = release.cover_image_url;
      }
      // Merge tracks (prefer more complete track lists)
      if (
        release.tracks &&
        (!existing.tracks || release.tracks.length > existing.tracks.length)
      ) {
        existing.tracks = release.tracks;
      }
      // Prefer Spotify/MusicBrainz over Claude search
      if (
        existing.source === 'claude_search' &&
        release.source !== 'claude_search'
      ) {
        seen.set(key, {
          ...release,
          genre_1: existing.genre_1 || release.genre_1,
          genre_2: existing.genre_2 || release.genre_2,
          country: existing.country || release.country,
          cover_image_url: release.cover_image_url || existing.cover_image_url,
          tracks:
            release.tracks && release.tracks.length > 0
              ? release.tracks
              : existing.tracks,
        });
      }
    }
  }
  return Array.from(seen.values());
}

/**
 * Parse a MusicBrainz release-group into a structured release object
 * @param {Object} group - MusicBrainz release-group object
 * @returns {{artist: string, album: string, genre_1: string, genre_2: string, country: string, release_date: string, musicbrainz_id: string}}
 */
function parseMusicBrainzReleaseGroup(group) {
  const artistCredit = group['artist-credit'];
  const artistName =
    artistCredit?.[0]?.artist?.name || artistCredit?.[0]?.name || 'Unknown';

  // Extract genre tags (sorted by vote count descending)
  const tags = group.tags || [];
  const sortedTags = [...tags].sort((a, b) => (b.count || 0) - (a.count || 0));

  // Extract country from first release's release-events
  let country = '';
  const groupReleases = group.releases || [];
  for (const rel of groupReleases) {
    const events = rel['release-events'] || [];
    for (const event of events) {
      if (event.area && event.area.name) {
        country = event.area.name;
        break;
      }
    }
    if (country) break;
  }

  return {
    artist: artistName,
    album: group.title || 'Unknown',
    genre_1: sortedTags[0]?.name || '',
    genre_2: sortedTags[1]?.name || '',
    country,
    release_date: group['first-release-date'] || '',
    musicbrainz_id: group.id || '',
  };
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
// eslint-disable-next-line max-lines-per-function -- Cohesive factory with multiple related fetcher functions
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
   * Pick the best cover image URL from Spotify's images array
   * Prefers 640px, then largest available
   * @param {Array<{url: string, width: number, height: number}>} images
   * @returns {string} Best image URL or empty string
   */
  function pickBestSpotifyImageUrl(images) {
    if (!images || images.length === 0) return '';
    // Prefer 640px image (standard large), then sort by width descending
    const sorted = [...images].sort((a, b) => (b.width || 0) - (a.width || 0));
    return sorted[0]?.url || '';
  }

  /**
   * Fetch new releases from Spotify using client credentials flow.
   * Captures cover image URL and track listing for each album.
   * @param {string} dateStart - Start date (YYYY-MM-DD)
   * @param {string} dateEnd - End date (YYYY-MM-DD)
   * @returns {Promise<Array>}
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

    try {
      for (let page = 0; page < maxPages; page++) {
        const offset = page * limit;
        const data = await spotifyApiRequest(
          `/v1/browse/new-releases?limit=${limit}&offset=${offset}`,
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
              genre_1: '',
              genre_2: '',
              country: '',
              release_date: releaseDate,
              spotify_id: album.id,
              cover_image_url: pickBestSpotifyImageUrl(album.images),
            });
          }
        }

        // Check if there are more pages
        if (!data.albums.next) break;
      }

      // Fetch tracks for each Spotify album (batch, with rate limiting)
      for (const release of releases) {
        if (!release.spotify_id) continue;
        try {
          const trackData = await spotifyApiRequest(
            `/v1/albums/${release.spotify_id}/tracks?limit=50`,
            accessToken
          );
          if (trackData?.items) {
            release.tracks = trackData.items.map((t) => ({
              name: t.name,
              length: t.duration_ms || 0,
            }));
          }
        } catch (err) {
          log.debug('Failed to fetch Spotify tracks for album', {
            spotifyId: release.spotify_id,
            album: release.album,
            error: err.message,
          });
        }
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
   * Fetch new releases from MusicBrainz using date range query.
   * Captures genre tags (mapped to genre_1/genre_2) and country from releases.
   * @param {string} dateStart - Start date (YYYY-MM-DD)
   * @param {string} dateEnd - End date (YYYY-MM-DD)
   * @returns {Promise<Array>}
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
          releases.push(parseMusicBrainzReleaseGroup(group));
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
   * Fetch new releases via Claude web search.
   * Now requests country and two genre fields.
   * @param {string} dateStart - Start date (YYYY-MM-DD)
   * @param {string} dateEnd - End date (YYYY-MM-DD)
   * @param {Function} callClaude - Claude API call function from claude-client
   * @param {Function} extractTextFromContent - Text extraction function from claude-client
   * @returns {Promise<Array>}
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
            content: `Search for notable album releases between ${dateStart} and ${dateEnd}. Include indie, underground, and non-Western releases that may not be on major platforms. Return ONLY a JSON array with objects containing these fields: "artist", "album", "genre_1" (primary genre), "genre_2" (secondary genre or empty string), "country" (country of origin), and "release_date". No other text.`,
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
   * @returns {Promise<Array>}
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
  parseClaudeReleaseResponse,
  deduplicateReleases,
  fetchSpotifyNewReleases: defaultInstance.fetchSpotifyNewReleases,
  fetchMusicBrainzNewReleases: defaultInstance.fetchMusicBrainzNewReleases,
  fetchClaudeSearchNewReleases: defaultInstance.fetchClaudeSearchNewReleases,
  gatherWeeklyNewReleases: defaultInstance.gatherWeeklyNewReleases,
};
