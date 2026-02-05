/**
 * API Routes Aggregator
 *
 * This module registers all API route modules and provides shared dependencies.
 * It serves as the main entry point for the modular API structure.
 */

// Ensure fetch is available
const fetch = globalThis.fetch || require('node-fetch');
const sharp = require('sharp');

// Import queue utilities
const {
  MusicBrainzQueue,
  RequestQueue,
  createMbFetch,
} = require('../../utils/request-queue');

// Deduplication helpers removed - list_items no longer stores album metadata

// Import other utilities
const { normalizeAlbumKey } = require('../../utils/fuzzy-match');
const { validateYear } = require('../../validators');
const { URLSearchParams } = require('url');
const {
  htmlTemplate,
  forgotPasswordTemplate,
  invalidTokenTemplate,
  resetPasswordTemplate,
} = require('../../templates');

// Import Last.fm utilities
const {
  getTopAlbums: getLastfmTopAlbums,
  getAlbumInfo: getLastfmAlbumInfo,
  scrobble: lastfmScrobble,
  updateNowPlaying: lastfmUpdateNowPlaying,
  getSimilarArtists: getLastfmSimilarArtists,
  getRecentTracks: getLastfmRecentTracks,
} = require('../../utils/lastfm-auth');

// Import services
const { createPlaylistService } = require('../../services/playlist');
const {
  refreshPlaycountsInBackground,
} = require('../../services/playcount-service');
const {
  createServiceAuthMiddleware,
} = require('../../middleware/service-auth');
const { getPointsForPosition } = require('../../utils/scoring');

// Import helpers
const { createHelpers } = require('./_helpers');

// Create queue instances (shared across routes)
const mbQueue = new MusicBrainzQueue({ fetch });
const mbFetch = createMbFetch(mbQueue);
const imageProxyQueue = new RequestQueue(10); // Max 10 concurrent image fetches
const itunesProxyQueue = new RequestQueue(5); // Limit iTunes API concurrency (~20 req/min)

/**
 * Register all API routes
 * @param {Object} app - Express app instance
 * @param {Object} deps - Dependencies from main app
 */
module.exports = (app, deps) => {
  const logger = require('../../utils/logger');
  const {
    cacheConfigs,
    responseCache,
  } = require('../../middleware/response-cache');
  const {
    forgotPasswordRateLimit,
    resetPasswordRateLimit,
  } = require('../../middleware/rate-limit');
  const { ensureValidSpotifyToken } = require('../../utils/spotify-auth');
  const { ensureValidTidalToken } = require('../../utils/tidal-auth');

  const {
    ensureAuthAPI,
    users,
    usersAsync,
    lists,
    listsAsync,
    listItemsAsync,
    albumsAsync,
    bcrypt,
    crypto,
    nodemailer,
    composeForgotPasswordEmail,
    csrfProtection,
    pool,
  } = deps;

  // Create helper functions
  const helpers = createHelpers({
    pool,
    logger,
    responseCache,
    app,
    crypto,
  });

  // Create service auth middleware
  const {
    requireSpotifyAuth,
    requireTidalAuth,
    requireLastfmAuth,
    requireLastfmSessionKey,
  } = createServiceAuthMiddleware({
    ensureValidSpotifyToken,
    ensureValidTidalToken,
    users,
    logger,
  });

  // Create playlist service
  const playlistService = createPlaylistService({ logger });

  // Shared dependencies for all route modules
  const sharedDeps = {
    // Core dependencies
    app,
    pool,
    logger,
    crypto,
    bcrypt,
    nodemailer,

    // Database accessors
    users,
    usersAsync,
    lists,
    listsAsync,
    listItemsAsync,
    albumsAsync,

    // Middleware
    ensureAuthAPI,
    csrfProtection,
    cacheConfigs,
    responseCache,
    forgotPasswordRateLimit,
    resetPasswordRateLimit,
    requireSpotifyAuth,
    requireTidalAuth,
    requireLastfmAuth,
    requireLastfmSessionKey,

    // Token validation
    ensureValidSpotifyToken,
    ensureValidTidalToken,

    // Services
    playlistService,
    refreshPlaycountsInBackground,

    // Helpers
    helpers,
    getPointsForPosition,

    // Utilities
    fetch,
    sharp,
    mbFetch,
    imageProxyQueue,
    itunesProxyQueue,
    normalizeAlbumKey,
    validateYear,
    URLSearchParams,

    // Templates
    htmlTemplate,
    forgotPasswordTemplate,
    invalidTokenTemplate,
    resetPasswordTemplate,
    composeForgotPasswordEmail,

    // Last.fm functions
    getLastfmTopAlbums,
    getLastfmAlbumInfo,
    lastfmScrobble,
    lastfmUpdateNowPlaying,
    getLastfmSimilarArtists,
    getLastfmRecentTracks,
  };

  // Register all route modules
  require('./albums')(app, sharedDeps);
  require('./groups')(app, sharedDeps);
  require('./lists')(app, sharedDeps);
  require('./track-picks')(app, sharedDeps);
  require('./password-reset')(app, sharedDeps);
  require('./proxies')(app, sharedDeps);
  require('./spotify')(app, sharedDeps);
  require('./tidal')(app, sharedDeps);
  require('./playlists')(app, sharedDeps);
  require('./lastfm')(app, sharedDeps);
  require('./telegram')(app, sharedDeps);
  require('./user')(app, sharedDeps);
  require('./recommendations')(app, sharedDeps);

  logger.info('API routes initialized (modular structure)');
};
