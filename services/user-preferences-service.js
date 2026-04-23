// services/user-preferences-service.js
// User music preferences — DB-dependent factory and runtime helpers

const logger = require('../utils/logger');
const { ensureDb } = require('../db/postgres');
const { getPositionPoints } = require('../utils/scoring');
const {
  buildSavePreferencesParams,
  calculateAffinity,
} = require('../utils/affinity-calculator');

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

function createUserPreferences(deps = {}) {
  const log = deps.logger || logger;
  const db = ensureDb(deps.db, 'user-preferences');

  async function aggregateFromLists(userId, options = {}) {
    const { mainOnly = false, limit = 50 } = options;

    log.info('Aggregating preferences from lists for user:', userId);

    const query = `
      SELECT 
        l.name as list_name,
        l.year as list_year,
        l.is_main,
        li.position,
        a.artist,
        a.country,
        a.genre_1,
        a.genre_2
      FROM lists l
      JOIN list_items li ON li.list_id = l._id
      LEFT JOIN albums a ON li.album_id = a.album_id
      WHERE l.user_id = $1
      ${mainOnly ? 'AND l.is_main = true' : ''}
      ORDER BY l.year DESC, l.name, li.position
    `;

    const result = await db.raw(query, [userId], {
      name: 'user-prefs-aggregate-from-lists',
      retryable: true,
    });
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

    const genreMap = new Map();
    const artistMap = new Map();
    const countryMap = new Map();

    for (const row of rows) {
      const points = getPositionPoints(row.position);

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

  async function savePreferences(userId, data) {
    const params = buildSavePreferencesParams(userId, data);
    const result = await db.raw(SAVE_PREFERENCES_QUERY, params, {
      name: 'user-prefs-save',
    });

    log.info('Saved preferences for user:', userId);
    return result.rows[0];
  }

  async function getPreferences(userId) {
    const result = await db.raw(
      `SELECT user_id, top_genres, top_artists, top_countries, total_albums,
              spotify_top_artists, spotify_top_tracks, spotify_saved_albums,
              spotify_synced_at, lastfm_top_artists, lastfm_top_albums,
              lastfm_total_scrobbles, lastfm_artist_tags, lastfm_synced_at,
              genre_affinity, artist_affinity, country_affinity,
              artist_countries, updated_at
       FROM user_preferences
       WHERE user_id = $1`,
      [userId],
      { name: 'user-prefs-get', retryable: true }
    );

    return result.rows[0] || null;
  }

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

let defaultDb = null;

function setDb(db) {
  defaultDb = db;
}

const getDefaultInstance = () => createUserPreferences({ db: defaultDb });

module.exports = {
  createUserPreferences,
  setDb,
  aggregateFromLists: (...args) =>
    getDefaultInstance().aggregateFromLists(...args),
  calculateAffinity: (...args) =>
    getDefaultInstance().calculateAffinity(...args),
  savePreferences: (...args) => getDefaultInstance().savePreferences(...args),
  getPreferences: (...args) => getDefaultInstance().getPreferences(...args),
  checkRefreshNeeded: (...args) =>
    getDefaultInstance().checkRefreshNeeded(...args),
};
