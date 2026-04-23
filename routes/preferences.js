// routes/preferences.js
// API endpoints for user music preferences

const logger = require('../utils/logger');
const { createAsyncHandler } = require('../middleware/async-handler');
const { createPreferenceSyncService } = require('../services/preference-sync');
const { createUserPreferences } = require('../utils/user-preferences');
const {
  LASTFM_VALID_PERIODS,
  SPOTIFY_VALID_RANGES,
} = require('./preferences/constants');
const {
  createAffinityHandler,
  createTimeRangeHandler,
} = require('./preferences/handler-factories');
const { createPreferencesHandlers } = require('./preferences/handlers');

const asyncHandler = createAsyncHandler(logger);

module.exports = (app, deps) => {
  const { ensureAuthAPI, db } = deps;
  const userPrefs = createUserPreferences({ db, logger });

  let syncService = null;
  const getSyncService = () => {
    if (!syncService) {
      syncService = createPreferenceSyncService({ db, logger });
    }
    return syncService;
  };

  const handlers = createPreferencesHandlers({
    userPrefs,
    getSyncService,
    logger,
  });

  app.get(
    '/api/preferences',
    ensureAuthAPI,
    asyncHandler(handlers.getAll, 'fetching preferences')
  );

  app.get(
    '/api/preferences/status',
    ensureAuthAPI,
    asyncHandler(handlers.getStatus, 'fetching preference status')
  );

  app.post(
    '/api/preferences/sync',
    ensureAuthAPI,
    asyncHandler(handlers.postSync, 'syncing preferences')
  );

  app.get(
    '/api/preferences/genres',
    ensureAuthAPI,
    asyncHandler(handlers.getGenres, 'fetching genre preferences')
  );

  app.get(
    '/api/preferences/artists',
    ensureAuthAPI,
    asyncHandler(handlers.getArtists, 'fetching artist preferences')
  );

  app.get(
    '/api/preferences/countries',
    ensureAuthAPI,
    asyncHandler(handlers.getCountries, 'fetching country preferences')
  );

  app.get(
    '/api/preferences/spotify',
    ensureAuthAPI,
    asyncHandler(handlers.getSpotify, 'fetching Spotify preferences')
  );

  app.get(
    '/api/preferences/spotify/artists',
    ensureAuthAPI,
    asyncHandler(
      createTimeRangeHandler({
        getPreferences: handlers.getPreferences,
        field: 'spotify_top_artists',
        queryParam: 'range',
        validValues: SPOTIFY_VALID_RANGES,
        syncedAtField: 'spotify_synced_at',
      }),
      'fetching Spotify artists'
    )
  );

  app.get(
    '/api/preferences/spotify/tracks',
    ensureAuthAPI,
    asyncHandler(
      createTimeRangeHandler({
        getPreferences: handlers.getPreferences,
        field: 'spotify_top_tracks',
        queryParam: 'range',
        validValues: SPOTIFY_VALID_RANGES,
        syncedAtField: 'spotify_synced_at',
      }),
      'fetching Spotify tracks'
    )
  );

  app.get(
    '/api/preferences/spotify/albums',
    ensureAuthAPI,
    asyncHandler(handlers.getSpotifyAlbums, 'fetching Spotify albums')
  );

  app.get(
    '/api/preferences/lastfm',
    ensureAuthAPI,
    asyncHandler(handlers.getLastfm, 'fetching Last.fm preferences')
  );

  app.get(
    '/api/preferences/lastfm/artists',
    ensureAuthAPI,
    asyncHandler(
      createTimeRangeHandler({
        getPreferences: handlers.getPreferences,
        field: 'lastfm_top_artists',
        queryParam: 'period',
        validValues: LASTFM_VALID_PERIODS,
        syncedAtField: 'lastfm_synced_at',
      }),
      'fetching Last.fm artists'
    )
  );

  app.get(
    '/api/preferences/lastfm/albums',
    ensureAuthAPI,
    asyncHandler(
      createTimeRangeHandler({
        getPreferences: handlers.getPreferences,
        field: 'lastfm_top_albums',
        queryParam: 'period',
        validValues: LASTFM_VALID_PERIODS,
        syncedAtField: 'lastfm_synced_at',
      }),
      'fetching Last.fm albums'
    )
  );

  app.get(
    '/api/preferences/affinity',
    ensureAuthAPI,
    asyncHandler(handlers.getAffinity, 'fetching affinity scores')
  );

  app.get(
    '/api/preferences/affinity/genres',
    ensureAuthAPI,
    asyncHandler(
      createAffinityHandler({
        getPreferences: handlers.getPreferences,
        field: 'genre_affinity',
      }),
      'fetching genre affinity'
    )
  );

  app.get(
    '/api/preferences/affinity/artists',
    ensureAuthAPI,
    asyncHandler(
      createAffinityHandler({
        getPreferences: handlers.getPreferences,
        field: 'artist_affinity',
      }),
      'fetching artist affinity'
    )
  );

  app.post(
    '/api/preferences/aggregate',
    ensureAuthAPI,
    asyncHandler(handlers.postAggregate, 'aggregating preferences')
  );

  app.get(
    '/api/preferences/summary',
    ensureAuthAPI,
    asyncHandler(handlers.getSummary, 'fetching preference summary')
  );
};
