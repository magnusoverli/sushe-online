/**
 * Playlist API Routes
 *
 * Handles playlist creation and management across music services.
 */

const { createAsyncHandler } = require('../../middleware/async-handler');

/**
 * Register playlist routes
 * @param {Object} app - Express app instance
 * @param {Object} deps - Dependencies
 */
module.exports = (app, deps) => {
  const {
    ensureAuthAPI,
    users,
    logger,
    listsAsync,
    listItemsAsync,
    playlistService,
    ensureValidSpotifyToken,
    ensureValidTidalToken,
  } = deps;

  const asyncHandler = createAsyncHandler(logger);

  // Playlist management endpoint (by list ID)
  app.post(
    '/api/playlists/:listId',
    ensureAuthAPI,
    asyncHandler(
      async (req, res) => {
        const { listId } = req.params;
        const { action = 'update', service } = req.body;

        logger.info('Playlist endpoint called:', {
          listId,
          action,
          service,
          body: req.body,
        });

        // Determine target service: explicit service > user preference > auto-detect from auth
        let targetService = service || req.user.musicService;

        // If no explicit service is set, auto-detect from authenticated services
        if (!targetService || !['spotify', 'tidal'].includes(targetService)) {
          const hasSpotify = req.user.spotifyAuth?.access_token;
          const hasTidal = req.user.tidalAuth?.access_token;

          if (hasSpotify && !hasTidal) {
            targetService = 'spotify';
            logger.info('Auto-detected music service:', {
              targetService: 'spotify',
            });
          } else if (hasTidal && !hasSpotify) {
            targetService = 'tidal';
            logger.info('Auto-detected music service:', {
              targetService: 'tidal',
            });
          } else if (!hasSpotify && !hasTidal) {
            return res.status(400).json({
              error:
                'No music service connected. Please connect Spotify or Tidal in settings.',
              code: 'NOT_AUTHENTICATED',
            });
          } else {
            return res.status(400).json({
              error:
                'Multiple music services connected. Please set a preferred service in settings.',
              code: 'NO_SERVICE',
            });
          }
        }

        let auth;

        // Handle authentication differently for each service
        if (targetService === 'spotify') {
          const tokenResult = await ensureValidSpotifyToken(req.user, users);
          if (!tokenResult.success) {
            logger.warn('Spotify auth check failed', {
              error: tokenResult.error,
            });
            return res.status(401).json({
              error: tokenResult.message,
              code: tokenResult.error,
              service: 'spotify',
            });
          }
          auth = tokenResult.spotifyAuth;
        } else {
          const tokenResult = await ensureValidTidalToken(req.user, users);
          if (!tokenResult.success) {
            logger.warn('Tidal auth check failed', {
              error: tokenResult.error,
            });
            return res.status(401).json({
              error: tokenResult.message,
              code: tokenResult.error,
              service: 'tidal',
            });
          }
          auth = tokenResult.tidalAuth;
        }

        // Get the list first to get its name
        const list = await listsAsync.findOne({
          userId: req.user._id,
          _id: listId,
        });

        if (!list) {
          return res.status(404).json({ error: 'List not found' });
        }

        const listName = list.name;

        // Check if playlist exists (for confirmation dialog)
        if (action === 'check') {
          logger.info('Playlist check action received:', {
            listId,
            listName,
            targetService,
          });
          const exists = await playlistService.checkPlaylistExists(
            listName,
            targetService,
            auth
          );
          logger.info('Playlist check result:', { listName, exists });
          return res.json({ exists, playlistName: listName });
        }

        // Pass userId to get track picks from normalized table
        const items = await listItemsAsync.findWithAlbumData(
          list._id,
          req.user._id
        );

        // Debug logging for playlist track picks
        logger.info('Playlist creation - items loaded', {
          listId: list._id,
          userId: req.user._id,
          itemCount: items.length,
          sampleTracks: items.slice(0, 3).map((item) => ({
            album: item.album,
            primaryTrack: item.primaryTrack,
            secondaryTrack: item.secondaryTrack,
            trackPick: item.trackPick,
          })),
        });

        // Pre-flight validation
        const validation = await playlistService.validatePlaylistData(
          items,
          targetService,
          auth
        );

        if (action === 'validate') {
          return res.json(validation);
        }

        // Create or update playlist
        const result = await playlistService.createOrUpdatePlaylist(
          listName,
          items,
          targetService,
          auth,
          req.user,
          validation
        );

        res.json(result);
      },
      'updating playlist',
      {
        errorMessage:
          'Failed to update playlist. Please check your music service connection and try again.',
      }
    )
  );
};
