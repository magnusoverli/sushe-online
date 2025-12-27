// utils/user-preferences.js
// Utilities for aggregating and managing user music preferences

const logger = require('./logger');

// ============================================
// Artist Name Normalization
// ============================================

/**
 * Normalize artist name for cross-source matching
 * Handles common variations in artist names across Spotify, Last.fm, and internal data
 * @param {string} name - Artist name to normalize
 * @returns {string} - Normalized name (lowercase, stripped of common variations)
 */
function normalizeArtistName(name) {
  if (!name) return '';

  return (
    name
      .toLowerCase()
      .trim()
      // Remove "the " prefix (e.g., "The Beatles" -> "beatles")
      .replace(/^the\s+/, '')
      // Remove common suffixes like "(band)", "[US]", etc.
      .replace(/\s*\([^)]*\)\s*/g, '')
      .replace(/\s*\[[^\]]*\]\s*/g, '')
      // Normalize special characters
      .replace(/[''`]/g, "'")
      .replace(/[""]/g, '"')
      // Remove diacritics (é -> e, ü -> u)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      // Remove punctuation except essential ones
      .replace(/[.,!?;:]/g, '')
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Normalize genre/tag name for matching
 * @param {string} genre - Genre/tag name
 * @returns {string} - Normalized genre
 */
function normalizeGenre(genre) {
  if (!genre) return '';

  return (
    genre
      .toLowerCase()
      .trim()
      // Normalize hyphens and spaces
      .replace(/[-_]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Check if two artist names match (after normalization)
 * @param {string} name1 - First artist name
 * @param {string} name2 - Second artist name
 * @returns {boolean} - True if names match
 */
function artistNamesMatch(name1, name2) {
  return normalizeArtistName(name1) === normalizeArtistName(name2);
}

/**
 * Find matching artist in a map by normalized name
 * @param {Map} map - Map with normalized keys
 * @param {string} artistName - Artist name to look up
 * @returns {*} - Value from map or undefined
 */
function findArtistInMap(map, artistName) {
  return map.get(normalizeArtistName(artistName));
}

/**
 * Common genre mappings to standardize Last.fm tags
 * Maps common variations to canonical names
 */
const GENRE_MAPPINGS = {
  'hip hop': 'hip-hop',
  hiphop: 'hip-hop',
  'hip-hop/rap': 'hip-hop',
  electronic: 'electronic',
  electronica: 'electronic',
  edm: 'electronic',
  'r&b': 'r&b',
  rnb: 'r&b',
  'rhythm and blues': 'r&b',
  'rock n roll': 'rock and roll',
  'rock & roll': 'rock and roll',
  'post punk': 'post-punk',
  postpunk: 'post-punk',
  'synth pop': 'synthpop',
  'synth-pop': 'synthpop',
  'death metal': 'death metal',
  deathmetal: 'death metal',
  'black metal': 'black metal',
  blackmetal: 'black metal',
  'thrash metal': 'thrash metal',
  thrashmetal: 'thrash metal',
  'nu metal': 'nu-metal',
  'nu-metal': 'nu-metal',
  numetal: 'nu-metal',
  'alt rock': 'alternative rock',
  'alt-rock': 'alternative rock',
  'indie rock': 'indie rock',
  indierock: 'indie rock',
  'dream pop': 'dream pop',
  dreampop: 'dream pop',
  'shoe gaze': 'shoegaze',
  'shoe-gaze': 'shoegaze',
  'trip hop': 'trip-hop',
  triphop: 'trip-hop',
  'drum and bass': 'drum and bass',
  'drum n bass': 'drum and bass',
  dnb: 'drum and bass',
  'd&b': 'drum and bass',
};

/**
 * Filter and normalize Last.fm tags to usable genres
 * Removes non-genre tags like decade tags, location tags, etc.
 * @param {Array} tags - Array of tag objects with name property
 * @returns {Array} - Filtered and normalized tags
 */
function filterGenreTags(tags) {
  if (!tags || !Array.isArray(tags)) return [];

  // Patterns to exclude
  const excludePatterns = [
    /^\d{2,4}s?$/, // Decade tags (80s, 90s, 1990s, 2000s)
    /^\d{4}$/, // Year tags (2024)
    /^seen live$/i, // Common non-genre tags
    /^favorite/i,
    /^favourite/i,
    /^my /i,
    /^under \d+/i, // "under 2000 listeners"
    /^albums i own/i,
    /^check out/i,
  ];

  // Country/location patterns (we want to keep these as we have a separate country field)
  const locationPatterns = [
    /^(usa?|uk|american|british|german|french|japanese|swedish|norwegian|finnish|australian|canadian|brazilian|korean|spanish|italian|mexican|dutch|belgian|polish|russian|danish|icelandic|irish|scottish|welsh|south african|new zealand)/i,
  ];

  return tags
    .filter((tag) => {
      const name = tag.name?.toLowerCase() || '';

      // Skip empty or very short tags
      if (name.length < 2) return false;

      // Skip excluded patterns
      for (const pattern of excludePatterns) {
        if (pattern.test(name)) return false;
      }

      // Skip location tags
      for (const pattern of locationPatterns) {
        if (pattern.test(name)) return false;
      }

      return true;
    })
    .map((tag) => {
      const normalized = normalizeGenre(tag.name);
      // Apply canonical mapping if exists
      const canonical = GENRE_MAPPINGS[normalized] || normalized;
      return {
        name: canonical,
        count: tag.count || 0,
      };
    })
    .slice(0, 5); // Top 5 genre tags per artist
}

/**
 * Position-based points for weighted aggregation
 * Albums ranked higher contribute more to preference scores
 */
const POSITION_POINTS = {
  1: 60,
  2: 54,
  3: 50,
  4: 46,
  5: 43,
  6: 40,
  7: 38,
  8: 36,
  9: 34,
  10: 32,
  11: 30,
  12: 28,
  13: 26,
  14: 24,
  15: 22,
  16: 20,
  17: 18,
  18: 16,
  19: 14,
  20: 12,
  21: 11,
  22: 10,
  23: 9,
  24: 8,
  25: 7,
  26: 6,
  27: 5,
  28: 4,
  29: 3,
  30: 2,
  31: 2,
  32: 2,
  33: 2,
  34: 2,
  35: 2,
  36: 1,
  37: 1,
  38: 1,
  39: 1,
  40: 1,
};

/**
 * Get points for a position (0 for positions beyond 40)
 */
function getPositionPoints(position) {
  return POSITION_POINTS[position] || 0;
}

// ============================================
// Affinity Calculation Helper Functions
// ============================================

/**
 * Normalize weights based on available data sources
 * @param {Object} weights - Original weights { internal, spotify, lastfm }
 * @param {Object} internalData - Internal data object
 * @param {Object} spotifyData - Spotify data object
 * @param {Object} lastfmData - Last.fm data object
 * @returns {Object} - Normalized active weights
 */
function normalizeActiveWeights(
  weights,
  internalData,
  spotifyData,
  lastfmData
) {
  const activeWeights = { ...weights };
  let totalWeight = 0;

  // Check for any internal data (artists, genres, or countries)
  const hasInternalData =
    internalData?.topArtists?.length > 0 ||
    internalData?.topGenres?.length > 0 ||
    internalData?.topCountries?.length > 0;
  if (hasInternalData) totalWeight += weights.internal;
  else activeWeights.internal = 0;

  if (
    spotifyData?.short_term?.length > 0 ||
    spotifyData?.medium_term?.length > 0
  ) {
    totalWeight += weights.spotify;
  } else {
    activeWeights.spotify = 0;
  }

  if (lastfmData?.overall?.length > 0) totalWeight += weights.lastfm;
  else activeWeights.lastfm = 0;

  // Normalize
  if (totalWeight > 0) {
    activeWeights.internal /= totalWeight;
    activeWeights.spotify /= totalWeight;
    activeWeights.lastfm /= totalWeight;
  }

  return activeWeights;
}

/**
 * Add internal artists to artist scores map
 * @param {Map} artistScores - Map to populate
 * @param {Array} topArtists - Internal top artists
 * @param {number} weight - Weight for internal source
 */
function addInternalArtists(artistScores, topArtists, weight) {
  if (!topArtists?.length) return;

  const maxPoints = topArtists[0]?.points || 1;
  for (const artist of topArtists) {
    const normalized = artist.points / maxPoints;
    const key = normalizeArtistName(artist.name);
    const existing = artistScores.get(key) || {
      name: artist.name,
      score: 0,
      sources: [],
      playcount: 0,
    };
    existing.score += normalized * weight;
    if (!existing.sources.includes('internal'))
      existing.sources.push('internal');
    artistScores.set(key, existing);
  }
}

/**
 * Add Spotify artists to artist scores map
 * @param {Map} artistScores - Map to populate
 * @param {Object} spotifyData - Spotify data with time ranges
 * @param {number} weight - Weight for Spotify source
 */
function addSpotifyArtists(artistScores, spotifyData, weight) {
  if (!spotifyData) return;

  const spotifyArtists = new Map();
  const timeRangeWeights = {
    short_term: 0.3,
    medium_term: 0.4,
    long_term: 0.3,
  };

  for (const [range, rangeWeight] of Object.entries(timeRangeWeights)) {
    const artists = spotifyData[range] || [];
    for (let i = 0; i < artists.length; i++) {
      const artist = artists[i];
      const positionScore = 1 - i / artists.length;
      const key = normalizeArtistName(artist.name);
      const existing = spotifyArtists.get(key) || {
        name: artist.name,
        score: 0,
        genres: artist.genres || [],
      };
      existing.score += positionScore * rangeWeight;
      if (artist.genres) {
        for (const g of artist.genres) {
          if (!existing.genres.includes(g)) existing.genres.push(g);
        }
      }
      spotifyArtists.set(key, existing);
    }
  }

  const maxSpotifyScore = Math.max(
    ...Array.from(spotifyArtists.values()).map((a) => a.score),
    1
  );

  for (const [key, artist] of spotifyArtists) {
    const normalized = artist.score / maxSpotifyScore;
    const existing = artistScores.get(key) || {
      name: artist.name,
      score: 0,
      sources: [],
      playcount: 0,
    };
    existing.score += normalized * weight;
    if (!existing.sources.includes('spotify')) existing.sources.push('spotify');
    existing.spotifyGenres = artist.genres;
    artistScores.set(key, existing);
  }
}

/**
 * Add Last.fm artists to artist scores map
 * @param {Map} artistScores - Map to populate
 * @param {Object} lastfmData - Last.fm data with overall artists
 * @param {number} weight - Weight for Last.fm source
 */
function addLastfmArtists(artistScores, lastfmData, weight) {
  if (!lastfmData?.overall) return;

  const maxPlaycount = lastfmData.overall[0]?.playcount || 1;
  for (const artist of lastfmData.overall) {
    const normalized = (artist.playcount || 0) / maxPlaycount;
    const key = normalizeArtistName(artist.name);
    const existing = artistScores.get(key) || {
      name: artist.name,
      score: 0,
      sources: [],
      playcount: 0,
    };
    existing.score += normalized * weight;
    existing.playcount = artist.playcount || 0;
    if (!existing.sources.includes('lastfm')) existing.sources.push('lastfm');
    if (artist.tags) {
      existing.lastfmTags = artist.tags;
    }
    artistScores.set(key, existing);
  }
}

/**
 * Build Last.fm artist tags map from lastfmData.artistTags
 * @param {Object} lastfmData - Last.fm data object
 * @returns {Map} - Map of normalized artist name -> filtered tags
 */
function buildLastfmArtistTagsMap(lastfmData) {
  const lastfmArtistTags = new Map();
  if (!lastfmData?.artistTags) return lastfmArtistTags;

  const tagsData =
    lastfmData.artistTags instanceof Map
      ? lastfmData.artistTags
      : new Map(Object.entries(lastfmData.artistTags || {}));

  for (const [artistName, tags] of tagsData) {
    const key = normalizeArtistName(artistName);
    lastfmArtistTags.set(key, filterGenreTags(tags));
  }

  return lastfmArtistTags;
}

/**
 * Add internal genres to genre scores map
 * @param {Map} genreScores - Map to populate
 * @param {Array} topGenres - Internal top genres
 * @param {number} weight - Weight for internal source
 */
function addInternalGenres(genreScores, topGenres, weight) {
  if (!topGenres?.length) return;

  const maxPoints = topGenres[0]?.points || 1;
  for (const genre of topGenres) {
    const normalized = genre.points / maxPoints;
    const key = normalizeGenre(genre.name);
    const existing = genreScores.get(key) || {
      name: genre.name,
      score: 0,
      sources: [],
    };
    existing.score += normalized * weight;
    if (!existing.sources.includes('internal'))
      existing.sources.push('internal');
    genreScores.set(key, existing);
  }
}

/**
 * Add Spotify genres to genre scores map
 * @param {Map} genreScores - Map to populate
 * @param {Object} spotifyData - Spotify data with time ranges
 * @param {number} weight - Weight for Spotify source
 */
function addSpotifyGenres(genreScores, spotifyData, weight) {
  if (!spotifyData || weight <= 0) return;

  const spotifyGenres = new Map();
  for (const range of ['short_term', 'medium_term', 'long_term']) {
    const artists = spotifyData[range] || [];
    for (const artist of artists) {
      for (const genre of artist.genres || []) {
        const key = normalizeGenre(genre);
        const existing = spotifyGenres.get(key) || { name: genre, count: 0 };
        existing.count += 1;
        spotifyGenres.set(key, existing);
      }
    }
  }

  const maxGenreCount = Math.max(
    ...Array.from(spotifyGenres.values()).map((g) => g.count),
    1
  );

  for (const [key, genre] of spotifyGenres) {
    const normalized = genre.count / maxGenreCount;
    const existing = genreScores.get(key) || {
      name: genre.name,
      score: 0,
      sources: [],
    };
    existing.score += normalized * weight;
    if (!existing.sources.includes('spotify')) existing.sources.push('spotify');
    genreScores.set(key, existing);
  }
}

/**
 * Add Last.fm genres (derived from artist tags weighted by playcount)
 * @param {Map} genreScores - Map to populate
 * @param {Object} lastfmData - Last.fm data with overall artists
 * @param {Map} lastfmArtistTags - Pre-built map of artist -> tags
 * @param {number} weight - Weight for Last.fm source
 */
function addLastfmGenres(genreScores, lastfmData, lastfmArtistTags, weight) {
  if (!lastfmData?.overall || weight <= 0) return;

  const lastfmGenres = new Map();
  const maxPlaycount = lastfmData.overall[0]?.playcount || 1;

  for (const artist of lastfmData.overall) {
    const artistKey = normalizeArtistName(artist.name);
    const playcount = artist.playcount || 0;
    const playcountWeight = playcount / maxPlaycount;

    let tags = lastfmArtistTags.get(artistKey) || [];
    if (tags.length === 0 && artist.tags) {
      tags = filterGenreTags(artist.tags);
    }

    for (const tag of tags) {
      const tagKey = normalizeGenre(tag.name);
      const existing = lastfmGenres.get(tagKey) || { name: tag.name, score: 0 };
      const tagWeight = tag.count > 0 ? Math.min(tag.count / 100, 1) : 0.5;
      existing.score += playcountWeight * tagWeight;
      lastfmGenres.set(tagKey, existing);
    }
  }

  const maxLastfmScore = Math.max(
    ...Array.from(lastfmGenres.values()).map((g) => g.score),
    1
  );

  for (const [key, genre] of lastfmGenres) {
    const normalized = genre.score / maxLastfmScore;
    const existing = genreScores.get(key) || {
      name: genre.name,
      score: 0,
      sources: [],
    };
    existing.score += normalized * weight;
    if (!existing.sources.includes('lastfm')) existing.sources.push('lastfm');
    genreScores.set(key, existing);
  }
}

/**
 * Build country affinity from internal data
 * @param {Object} internalData - Internal data with topCountries
 * @returns {Map} - Map of country scores
 */
function buildCountryScores(internalData) {
  const countryScores = new Map();

  if (!internalData?.topCountries) return countryScores;

  const maxPoints = internalData.topCountries[0]?.points || 1;
  for (const country of internalData.topCountries) {
    const key = country.name.toLowerCase();
    const normalizedScore = (country.points || 0) / maxPoints;
    countryScores.set(key, {
      name: country.name,
      score: normalizedScore,
      count: country.count || 0,
    });
  }

  return countryScores;
}

/**
 * Convert score maps to sorted affinity arrays
 * @param {Map} artistScores - Artist scores map
 * @param {Map} genreScores - Genre scores map
 * @param {Map} countryScores - Country scores map
 * @returns {Object} - { artistAffinity, genreAffinity, countryAffinity }
 */
function convertScoresToArrays(artistScores, genreScores, countryScores) {
  const artistAffinity = Array.from(artistScores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 100)
    .map(({ name, score, sources, playcount }) => ({
      name,
      score: Math.round(score * 1000) / 1000,
      sources,
      ...(playcount > 0 ? { playcount } : {}),
    }));

  const genreAffinity = Array.from(genreScores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 100)
    .map(({ name, score, sources }) => ({
      name,
      score: Math.round(score * 1000) / 1000,
      sources,
    }));

  const countryAffinity = Array.from(countryScores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 50)
    .map(({ name, score, count }) => ({
      name,
      score: Math.round(score * 1000) / 1000,
      count,
    }));

  return { artistAffinity, genreAffinity, countryAffinity };
}

/**
 * Convert a value to JSON string or null if falsy
 * @param {*} value - Value to stringify
 * @returns {string|null} - JSON string or null
 */
function jsonOrNull(value) {
  return value ? JSON.stringify(value) : null;
}

/**
 * Build query parameters array for savePreferences
 * @param {string} userId - User ID
 * @param {Object} data - Preference data
 * @returns {Array} - Array of query parameters
 */
function buildSavePreferencesParams(userId, data) {
  return [
    userId,
    jsonOrNull(data.topGenres),
    jsonOrNull(data.topArtists),
    jsonOrNull(data.topCountries),
    data.totalAlbums ?? null,
    jsonOrNull(data.spotifyTopArtists),
    jsonOrNull(data.spotifyTopTracks),
    jsonOrNull(data.spotifySavedAlbums),
    data.spotifySyncedAt ?? null,
    jsonOrNull(data.lastfmTopArtists),
    jsonOrNull(data.lastfmTopAlbums),
    data.lastfmTotalScrobbles ?? null,
    jsonOrNull(data.lastfmArtistTags),
    data.lastfmSyncedAt ?? null,
    jsonOrNull(data.genreAffinity),
    jsonOrNull(data.artistAffinity),
    jsonOrNull(data.countryAffinity),
    jsonOrNull(data.artistCountries),
  ];
}

// The SQL query for saving preferences (extracted for readability)
const SAVE_PREFERENCES_QUERY = `
  INSERT INTO user_preferences (
    user_id,
    top_genres,
    top_artists,
    top_countries,
    total_albums,
    spotify_top_artists,
    spotify_top_tracks,
    spotify_saved_albums,
    spotify_synced_at,
    lastfm_top_artists,
    lastfm_top_albums,
    lastfm_total_scrobbles,
    lastfm_artist_tags,
    lastfm_synced_at,
    genre_affinity,
    artist_affinity,
    country_affinity,
    artist_countries,
    updated_at
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW())
  ON CONFLICT (user_id) DO UPDATE SET
    top_genres = COALESCE($2, user_preferences.top_genres),
    top_artists = COALESCE($3, user_preferences.top_artists),
    top_countries = COALESCE($4, user_preferences.top_countries),
    total_albums = COALESCE($5, user_preferences.total_albums),
    spotify_top_artists = COALESCE($6, user_preferences.spotify_top_artists),
    spotify_top_tracks = COALESCE($7, user_preferences.spotify_top_tracks),
    spotify_saved_albums = COALESCE($8, user_preferences.spotify_saved_albums),
    spotify_synced_at = COALESCE($9, user_preferences.spotify_synced_at),
    lastfm_top_artists = COALESCE($10, user_preferences.lastfm_top_artists),
    lastfm_top_albums = COALESCE($11, user_preferences.lastfm_top_albums),
    lastfm_total_scrobbles = COALESCE($12, user_preferences.lastfm_total_scrobbles),
    lastfm_artist_tags = COALESCE($13, user_preferences.lastfm_artist_tags),
    lastfm_synced_at = COALESCE($14, user_preferences.lastfm_synced_at),
    genre_affinity = COALESCE($15, user_preferences.genre_affinity),
    artist_affinity = COALESCE($16, user_preferences.artist_affinity),
    country_affinity = COALESCE($17, user_preferences.country_affinity),
    artist_countries = COALESCE($18, user_preferences.artist_countries),
    updated_at = NOW()
  RETURNING *
`;

/**
 * Create user preferences utilities with injected dependencies
 * @param {Object} deps - Dependencies
 * @param {Object} deps.logger - Logger instance
 * @param {Object} deps.pool - PostgreSQL pool instance
 */
function createUserPreferences(deps = {}) {
  const log = deps.logger || logger;
  const pool = deps.pool;

  /**
   * Aggregate user's music preferences from their lists
   * Calculates top genres, artists, and countries with weighted scores
   * @param {string} userId - User ID
   * @param {Object} options - Aggregation options
   * @param {boolean} options.officialOnly - Only include official lists
   * @param {number} options.limit - Max items per category (default 50)
   * @returns {Object} - { topGenres, topArtists, topCountries, totalAlbums }
   */
  async function aggregateFromLists(userId, options = {}) {
    const { officialOnly = false, limit = 50 } = options;

    if (!pool) {
      throw new Error('Database pool not provided');
    }

    log.info('Aggregating preferences from lists for user:', userId);

    // Query all albums from user's lists with merged data
    const query = `
      SELECT 
        l.name as list_name,
        l.year as list_year,
        l.is_official,
        li.position,
        COALESCE(NULLIF(li.artist, ''), a.artist) as artist,
        COALESCE(NULLIF(li.country, ''), a.country) as country,
        COALESCE(NULLIF(li.genre_1, ''), a.genre_1) as genre_1,
        COALESCE(NULLIF(li.genre_2, ''), a.genre_2) as genre_2
      FROM lists l
      JOIN list_items li ON li.list_id = l._id
      LEFT JOIN albums a ON li.album_id = a.album_id
      WHERE l.user_id = $1
      ${officialOnly ? 'AND l.is_official = true' : ''}
      ORDER BY l.year DESC, l.name, li.position
    `;

    const result = await pool.query(query, [userId]);
    const rows = result.rows;

    if (rows.length === 0) {
      log.info('No albums found for user:', userId);
      return {
        topGenres: [],
        topArtists: [],
        topCountries: [],
        totalAlbums: 0,
      };
    }

    // Aggregation maps: name -> { count, points }
    const genreMap = new Map();
    const artistMap = new Map();
    const countryMap = new Map();

    for (const row of rows) {
      const points = getPositionPoints(row.position);

      // Aggregate artist
      if (row.artist) {
        const artistLower = row.artist.toLowerCase();
        const existing = artistMap.get(artistLower) || {
          name: row.artist,
          count: 0,
          points: 0,
        };
        existing.count += 1;
        existing.points += points;
        artistMap.set(artistLower, existing);
      }

      // Aggregate country
      if (row.country) {
        const countryLower = row.country.toLowerCase();
        const existing = countryMap.get(countryLower) || {
          name: row.country,
          count: 0,
          points: 0,
        };
        existing.count += 1;
        existing.points += points;
        countryMap.set(countryLower, existing);
      }

      // Aggregate genres (both genre_1 and genre_2)
      for (const genre of [row.genre_1, row.genre_2]) {
        if (genre) {
          const genreLower = genre.toLowerCase();
          const existing = genreMap.get(genreLower) || {
            name: genre,
            count: 0,
            points: 0,
          };
          existing.count += 1;
          existing.points += points;
          genreMap.set(genreLower, existing);
        }
      }
    }

    // Convert maps to sorted arrays
    const sortByPoints = (a, b) => b.points - a.points || b.count - a.count;

    const topGenres = Array.from(genreMap.values())
      .sort(sortByPoints)
      .slice(0, limit)
      .map(({ name, count, points }) => ({ name, count, points }));

    const topArtists = Array.from(artistMap.values())
      .sort(sortByPoints)
      .slice(0, limit)
      .map(({ name, count, points }) => ({ name, count, points }));

    const topCountries = Array.from(countryMap.values())
      .sort(sortByPoints)
      .slice(0, limit)
      .map(({ name, count, points }) => ({ name, count, points }));

    log.info('Aggregation complete for user:', {
      userId,
      totalAlbums: rows.length,
      uniqueGenres: genreMap.size,
      uniqueArtists: artistMap.size,
      uniqueCountries: countryMap.size,
    });

    return {
      topGenres,
      topArtists,
      topCountries,
      totalAlbums: rows.length,
    };
  }

  /**
   * Calculate affinity scores by combining internal data with external sources
   * Now with TRUE CONSOLIDATION - Last.fm playcounts contribute to genre scores
   * via artist tags fetched from Last.fm API
   *
   * @param {Object} internalData - Data from aggregateFromLists
   * @param {Object} spotifyData - Data from Spotify API (optional)
   * @param {Object} lastfmData - Data from Last.fm API (optional)
   * @param {Object} weights - Source weights (default: internal=0.4, spotify=0.35, lastfm=0.25)
   * @param {Object} _artistCountries - Map of artist name -> { country, countryCode } (unused)
   * @returns {Object} - { genreAffinity, artistAffinity, countryAffinity }
   */
  function calculateAffinity(
    internalData,
    spotifyData = null,
    lastfmData = null,
    weights = { internal: 0.4, spotify: 0.35, lastfm: 0.25 }
  ) {
    // Normalize weights based on available data
    const activeWeights = normalizeActiveWeights(
      weights,
      internalData,
      spotifyData,
      lastfmData
    );

    // Build artist affinity
    const artistScores = new Map();
    addInternalArtists(
      artistScores,
      internalData?.topArtists,
      activeWeights.internal
    );
    addSpotifyArtists(artistScores, spotifyData, activeWeights.spotify);
    addLastfmArtists(artistScores, lastfmData, activeWeights.lastfm);

    // Build artist tags map for genre consolidation
    const lastfmArtistTags = buildLastfmArtistTagsMap(lastfmData);

    // Build genre affinity
    const genreScores = new Map();
    addInternalGenres(
      genreScores,
      internalData?.topGenres,
      activeWeights.internal
    );
    addSpotifyGenres(genreScores, spotifyData, activeWeights.spotify);
    addLastfmGenres(
      genreScores,
      lastfmData,
      lastfmArtistTags,
      activeWeights.lastfm
    );

    // Build country affinity
    const countryScores = buildCountryScores(internalData);

    // Convert to sorted arrays
    return convertScoresToArrays(artistScores, genreScores, countryScores);
  }

  /**
   * Save aggregated preferences to user_preferences table
   * @param {string} userId - User ID
   * @param {Object} data - Preference data to save
   * @returns {Object} - Saved record
   */
  async function savePreferences(userId, data) {
    if (!pool) {
      throw new Error('Database pool not provided');
    }

    const params = buildSavePreferencesParams(userId, data);
    const result = await pool.query(SAVE_PREFERENCES_QUERY, params);

    log.info('Saved preferences for user:', userId);
    return result.rows[0];
  }

  /**
   * Get user's preferences from database
   * @param {string} userId - User ID
   * @returns {Object|null} - User preferences or null if not found
   */
  async function getPreferences(userId) {
    if (!pool) {
      throw new Error('Database pool not provided');
    }

    const result = await pool.query(
      'SELECT * FROM user_preferences WHERE user_id = $1',
      [userId]
    );

    return result.rows[0] || null;
  }

  /**
   * Check if user's preferences need refresh
   * @param {string} userId - User ID
   * @param {number} maxAgeMs - Max age in milliseconds (default 24 hours)
   * @returns {Object} - { needsInternalRefresh, needsSpotifyRefresh, needsLastfmRefresh }
   */
  async function checkRefreshNeeded(userId, maxAgeMs = 24 * 60 * 60 * 1000) {
    const prefs = await getPreferences(userId);
    const now = Date.now();

    if (!prefs) {
      return {
        needsInternalRefresh: true,
        needsSpotifyRefresh: true,
        needsLastfmRefresh: true,
      };
    }

    const updatedAt = prefs.updated_at
      ? new Date(prefs.updated_at).getTime()
      : 0;
    const spotifySyncedAt = prefs.spotify_synced_at
      ? new Date(prefs.spotify_synced_at).getTime()
      : 0;
    const lastfmSyncedAt = prefs.lastfm_synced_at
      ? new Date(prefs.lastfm_synced_at).getTime()
      : 0;

    return {
      needsInternalRefresh: now - updatedAt > maxAgeMs,
      needsSpotifyRefresh: now - spotifySyncedAt > maxAgeMs,
      needsLastfmRefresh: now - lastfmSyncedAt > maxAgeMs,
    };
  }

  return {
    getPositionPoints,
    aggregateFromLists,
    calculateAffinity,
    savePreferences,
    getPreferences,
    checkRefreshNeeded,
  };
}

// Default instance (pool must be set before use)
let defaultPool = null;

function setPool(pool) {
  defaultPool = pool;
}

const getDefaultInstance = () => createUserPreferences({ pool: defaultPool });

module.exports = {
  // Factory for testing
  createUserPreferences,
  // Pool setter for app initialization
  setPool,
  // Position points constant
  POSITION_POINTS,
  getPositionPoints,
  // Artist/genre normalization utilities
  normalizeArtistName,
  normalizeGenre,
  artistNamesMatch,
  findArtistInMap,
  filterGenreTags,
  GENRE_MAPPINGS,
  // Affinity helper functions (exported for testing)
  normalizeActiveWeights,
  addInternalArtists,
  addSpotifyArtists,
  addLastfmArtists,
  buildLastfmArtistTagsMap,
  addInternalGenres,
  addSpotifyGenres,
  addLastfmGenres,
  buildCountryScores,
  convertScoresToArrays,
  // Lazy default instance methods
  aggregateFromLists: (...args) =>
    getDefaultInstance().aggregateFromLists(...args),
  calculateAffinity: (...args) =>
    getDefaultInstance().calculateAffinity(...args),
  savePreferences: (...args) => getDefaultInstance().savePreferences(...args),
  getPreferences: (...args) => getDefaultInstance().getPreferences(...args),
  checkRefreshNeeded: (...args) =>
    getDefaultInstance().checkRefreshNeeded(...args),
};
