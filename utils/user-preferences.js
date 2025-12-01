// utils/user-preferences.js
// Utilities for aggregating and managing user music preferences

const logger = require('./logger');

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
   * @param {Object} internalData - Data from aggregateFromLists
   * @param {Object} spotifyData - Data from Spotify API (optional)
   * @param {Object} lastfmData - Data from Last.fm API (optional)
   * @param {Object} weights - Source weights (default: internal=0.4, spotify=0.35, lastfm=0.25)
   * @returns {Object} - { genreAffinity, artistAffinity }
   */
  function calculateAffinity(
    internalData,
    spotifyData = null,
    lastfmData = null,
    weights = { internal: 0.4, spotify: 0.35, lastfm: 0.25 }
  ) {
    // Normalize weights if not all sources present
    const activeWeights = { ...weights };
    let totalWeight = 0;

    if (internalData?.topArtists?.length > 0) totalWeight += weights.internal;
    else activeWeights.internal = 0;

    if (
      spotifyData?.short_term?.length > 0 ||
      spotifyData?.medium_term?.length > 0
    )
      totalWeight += weights.spotify;
    else activeWeights.spotify = 0;

    if (lastfmData?.overall?.length > 0) totalWeight += weights.lastfm;
    else activeWeights.lastfm = 0;

    // Normalize
    if (totalWeight > 0) {
      activeWeights.internal /= totalWeight;
      activeWeights.spotify /= totalWeight;
      activeWeights.lastfm /= totalWeight;
    }

    // Build artist affinity
    const artistScores = new Map();

    // Add internal artists
    if (internalData?.topArtists) {
      const maxPoints = internalData.topArtists[0]?.points || 1;
      for (const artist of internalData.topArtists) {
        const normalized = artist.points / maxPoints;
        const key = artist.name.toLowerCase();
        artistScores.set(key, {
          name: artist.name,
          score:
            (artistScores.get(key)?.score || 0) +
            normalized * activeWeights.internal,
          sources: [...(artistScores.get(key)?.sources || []), 'internal'],
        });
      }
    }

    // Add Spotify artists (combine all time ranges)
    if (spotifyData) {
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
          const positionScore = 1 - i / artists.length; // 1.0 for first, decreasing
          const key = artist.name.toLowerCase();
          const existing = spotifyArtists.get(key) || {
            name: artist.name,
            score: 0,
          };
          existing.score += positionScore * rangeWeight;
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
        };
        existing.score += normalized * activeWeights.spotify;
        if (!existing.sources.includes('spotify'))
          existing.sources.push('spotify');
        artistScores.set(key, existing);
      }
    }

    // Add Last.fm artists
    if (lastfmData?.overall) {
      const maxPlaycount = lastfmData.overall[0]?.playcount || 1;
      for (const artist of lastfmData.overall) {
        const normalized = artist.playcount / maxPlaycount;
        const key = artist.name.toLowerCase();
        const existing = artistScores.get(key) || {
          name: artist.name,
          score: 0,
          sources: [],
        };
        existing.score += normalized * activeWeights.lastfm;
        if (!existing.sources.includes('lastfm'))
          existing.sources.push('lastfm');
        artistScores.set(key, existing);
      }
    }

    // Build genre affinity (from internal and Spotify)
    const genreScores = new Map();

    // Add internal genres
    if (internalData?.topGenres) {
      const maxPoints = internalData.topGenres[0]?.points || 1;
      for (const genre of internalData.topGenres) {
        const normalized = genre.points / maxPoints;
        const key = genre.name.toLowerCase();
        genreScores.set(key, {
          name: genre.name,
          score:
            (genreScores.get(key)?.score || 0) +
            normalized * activeWeights.internal,
          sources: [...(genreScores.get(key)?.sources || []), 'internal'],
        });
      }
    }

    // Add Spotify genres (from artist genres)
    if (spotifyData) {
      const spotifyGenres = new Map();
      for (const range of ['short_term', 'medium_term', 'long_term']) {
        const artists = spotifyData[range] || [];
        for (const artist of artists) {
          for (const genre of artist.genres || []) {
            const key = genre.toLowerCase();
            const existing = spotifyGenres.get(key) || {
              name: genre,
              count: 0,
            };
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
        existing.score += normalized * activeWeights.spotify;
        if (!existing.sources.includes('spotify'))
          existing.sources.push('spotify');
        genreScores.set(key, existing);
      }
    }

    // Convert to sorted arrays
    const artistAffinity = Array.from(artistScores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 100)
      .map(({ name, score, sources }) => ({
        name,
        score: Math.round(score * 1000) / 1000,
        sources,
      }));

    const genreAffinity = Array.from(genreScores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 100)
      .map(({ name, score, sources }) => ({
        name,
        score: Math.round(score * 1000) / 1000,
        sources,
      }));

    return { artistAffinity, genreAffinity };
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

    const {
      topGenres = null,
      topArtists = null,
      topCountries = null,
      totalAlbums = null,
      spotifyTopArtists = null,
      spotifyTopTracks = null,
      spotifySavedAlbums = null,
      spotifySyncedAt = null,
      lastfmTopArtists = null,
      lastfmTopAlbums = null,
      lastfmTotalScrobbles = null,
      lastfmSyncedAt = null,
      genreAffinity = null,
      artistAffinity = null,
    } = data;

    const query = `
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
        lastfm_synced_at,
        genre_affinity,
        artist_affinity,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
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
        lastfm_synced_at = COALESCE($13, user_preferences.lastfm_synced_at),
        genre_affinity = COALESCE($14, user_preferences.genre_affinity),
        artist_affinity = COALESCE($15, user_preferences.artist_affinity),
        updated_at = NOW()
      RETURNING *
    `;

    const result = await pool.query(query, [
      userId,
      topGenres ? JSON.stringify(topGenres) : null,
      topArtists ? JSON.stringify(topArtists) : null,
      topCountries ? JSON.stringify(topCountries) : null,
      totalAlbums,
      spotifyTopArtists ? JSON.stringify(spotifyTopArtists) : null,
      spotifyTopTracks ? JSON.stringify(spotifyTopTracks) : null,
      spotifySavedAlbums ? JSON.stringify(spotifySavedAlbums) : null,
      spotifySyncedAt,
      lastfmTopArtists ? JSON.stringify(lastfmTopArtists) : null,
      lastfmTopAlbums ? JSON.stringify(lastfmTopAlbums) : null,
      lastfmTotalScrobbles,
      lastfmSyncedAt,
      genreAffinity ? JSON.stringify(genreAffinity) : null,
      artistAffinity ? JSON.stringify(artistAffinity) : null,
    ]);

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
