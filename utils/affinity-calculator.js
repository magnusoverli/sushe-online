/**
 * Affinity Calculator
 *
 * Pure functions for calculating music affinity scores from multiple data
 * sources (internal lists, Spotify, Last.fm). No database calls or side effects.
 *
 * These functions are used by user-preferences.js to compute genre, artist,
 * and country affinity scores from normalized data.
 */

const { normalizeArtistName, normalizeGenre } = require('./normalization');

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

/**
 * Calculate affinity scores by combining internal data with external sources.
 * Pure orchestration function — delegates to helper functions above.
 *
 * @param {Object} internalData - Data from aggregateFromLists
 * @param {Object} spotifyData - Data from Spotify API (optional)
 * @param {Object} lastfmData - Data from Last.fm API (optional)
 * @param {Object} weights - Source weights (default: internal=0.4, spotify=0.35, lastfm=0.25)
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

module.exports = {
  GENRE_MAPPINGS,
  filterGenreTags,
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
  jsonOrNull,
  buildSavePreferencesParams,
  calculateAffinity,
};
