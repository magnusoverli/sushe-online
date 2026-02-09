/**
 * Recommendations API Routes
 *
 * Thin route handlers that delegate to recommendation-service.js.
 * Handles: request parsing, response formatting, admin logging, Telegram notifications.
 */

const { ensureAdmin } = require('../../middleware/auth');
const { validateYearParam } = require('../../middleware/validate-params');

/**
 * Register recommendations routes
 * @param {Object} app - Express app instance
 * @param {Object} deps - Dependencies
 */
module.exports = (appInstance, deps) => {
  const app = appInstance;
  const { ensureAuthAPI, logger, recommendationService } = deps;

  const { createAsyncHandler } = require('../../middleware/async-handler');
  const asyncHandler = createAsyncHandler(logger);

  // GET /api/recommendations/years
  app.get(
    '/api/recommendations/years',
    ensureAuthAPI,
    asyncHandler(
      async (req, res) => {
        const years = await recommendationService.getYears();
        res.json({ years });
      },
      'fetching recommendation years',
      { errorMessage: 'Database error' }
    )
  );

  // GET /api/recommendations/:year
  app.get(
    '/api/recommendations/:year',
    ensureAuthAPI,
    validateYearParam,
    asyncHandler(
      async (req, res) => {
        const result = await recommendationService.getRecommendations(
          req.validatedYear,
          req.user._id
        );
        res.json(result);
      },
      'fetching recommendations',
      { errorMessage: 'Database error' }
    )
  );

  // POST /api/recommendations/:year
  app.post(
    '/api/recommendations/:year',
    ensureAuthAPI,
    validateYearParam,
    asyncHandler(
      async (req, res) => {
        const year = req.validatedYear;
        const { album, reasoning } = req.body;

        const result = await recommendationService.addRecommendation(
          year,
          album,
          reasoning,
          req.user
        );

        // Send Telegram notification (fire-and-forget)
        const telegramNotifier = app.locals.telegramNotifier;
        if (telegramNotifier?.sendRecommendationNotification) {
          (async () => {
            try {
              const coverImage =
                await recommendationService.getCoverForNotification(
                  result.album_id
                );
              await telegramNotifier.sendRecommendationNotification(
                {
                  artist: album.artist,
                  album: album.album,
                  album_id: result.album_id,
                  release_date: album.release_date,
                  year,
                  recommended_by: req.user.username,
                  reasoning: reasoning?.trim(),
                },
                coverImage
              );
            } catch (err) {
              logger.warn('Failed to send Telegram notification', {
                error: err.message,
              });
            }
          })();
        }

        res.status(201).json({ success: true, ...result });
      },
      'adding recommendation',
      { errorMessage: 'Database error' }
    )
  );

  // DELETE /api/recommendations/:year/:albumId
  app.delete(
    '/api/recommendations/:year/:albumId',
    ensureAuthAPI,
    ensureAdmin,
    validateYearParam,
    asyncHandler(
      async (req, res) => {
        const year = req.validatedYear;
        const { albumId } = req.params;

        await recommendationService.removeRecommendation(year, albumId);

        logger.info('Admin action', {
          action: 'remove_recommendation',
          adminId: req.user._id,
          adminEmail: req.user.email,
          year,
          albumId,
          ip: req.ip,
        });

        res.json({ success: true, removed: true, year, albumId });
      },
      'removing recommendation',
      { errorMessage: 'Database error' }
    )
  );

  // PATCH /api/recommendations/:year/:albumId/reasoning
  app.patch(
    '/api/recommendations/:year/:albumId/reasoning',
    ensureAuthAPI,
    validateYearParam,
    asyncHandler(
      async (req, res) => {
        const year = req.validatedYear;
        const { albumId } = req.params;

        const trimmedReasoning = await recommendationService.editReasoning(
          year,
          albumId,
          req.body.reasoning,
          req.user._id
        );

        logger.info('Recommendation reasoning updated', {
          year,
          albumId,
          userId: req.user._id,
          username: req.user.username,
        });

        res.json({ success: true, year, albumId, reasoning: trimmedReasoning });
      },
      'updating recommendation reasoning',
      { errorMessage: 'Database error' }
    )
  );

  // GET /api/recommendations/:year/status
  app.get(
    '/api/recommendations/:year/status',
    ensureAuthAPI,
    validateYearParam,
    asyncHandler(
      async (req, res) => {
        const status = await recommendationService.getStatus(
          req.validatedYear,
          req.user._id
        );
        res.json(status);
      },
      'fetching recommendation status',
      { errorMessage: 'Database error' }
    )
  );

  // POST /api/recommendations/:year/lock
  app.post(
    '/api/recommendations/:year/lock',
    ensureAuthAPI,
    ensureAdmin,
    validateYearParam,
    asyncHandler(
      async (req, res) => {
        const year = req.validatedYear;
        await recommendationService.lock(year);

        logger.info('Admin action', {
          action: 'lock_recommendations',
          adminId: req.user._id,
          adminEmail: req.user.email,
          year,
          ip: req.ip,
        });

        res.json({ success: true, year, locked: true });
      },
      'locking recommendations',
      { errorMessage: 'Database error' }
    )
  );

  // POST /api/recommendations/:year/unlock
  app.post(
    '/api/recommendations/:year/unlock',
    ensureAuthAPI,
    ensureAdmin,
    validateYearParam,
    asyncHandler(
      async (req, res) => {
        const year = req.validatedYear;
        await recommendationService.unlock(year);

        logger.info('Admin action', {
          action: 'unlock_recommendations',
          adminId: req.user._id,
          adminEmail: req.user.email,
          year,
          ip: req.ip,
        });

        res.json({ success: true, year, locked: false });
      },
      'unlocking recommendations',
      { errorMessage: 'Database error' }
    )
  );

  // GET /api/recommendations/locked-years
  app.get(
    '/api/recommendations/locked-years',
    ensureAuthAPI,
    asyncHandler(
      async (req, res) => {
        const years = await recommendationService.getLockedYears();
        res.json({ years });
      },
      'fetching locked recommendation years',
      { errorMessage: 'Database error' }
    )
  );

  // GET /api/recommendations/:year/access
  app.get(
    '/api/recommendations/:year/access',
    ensureAuthAPI,
    ensureAdmin,
    validateYearParam,
    asyncHandler(
      async (req, res) => {
        const result = await recommendationService.getAccess(req.validatedYear);
        res.json(result);
      },
      'fetching recommendation access',
      { errorMessage: 'Database error' }
    )
  );

  // PUT /api/recommendations/:year/access
  app.put(
    '/api/recommendations/:year/access',
    ensureAuthAPI,
    ensureAdmin,
    validateYearParam,
    asyncHandler(
      async (req, res) => {
        const year = req.validatedYear;

        const result = await recommendationService.setAccess(
          year,
          req.body.userIds,
          req.user._id
        );

        logger.info('Admin action', {
          action: 'set_recommendation_access',
          adminId: req.user._id,
          adminEmail: req.user.email,
          year,
          userCount: result.userCount,
          ip: req.ip,
        });

        res.json({ success: true, ...result });
      },
      'setting recommendation access',
      { errorMessage: 'Database error' }
    )
  );

  // GET /api/recommendations/:year/eligible-users
  app.get(
    '/api/recommendations/:year/eligible-users',
    ensureAuthAPI,
    ensureAdmin,
    validateYearParam,
    asyncHandler(
      async (req, res) => {
        const result = await recommendationService.getEligibleUsers(
          req.validatedYear
        );
        res.json(result);
      },
      'fetching eligible users for recommendations',
      { errorMessage: 'Database error' }
    )
  );
};
