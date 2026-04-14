const { createAggregateList } = require('../services/aggregate-list');
const { aggregateListTemplate } = require('../templates');
const { validateYearNotLocked } = require('../utils/year-lock');
const { validateYearParam } = require('../middleware/validate-params');
const { createAggregateListHandlers } = require('./aggregate-list/handlers');

module.exports = (app, deps) => {
  const logger = require('../utils/logger');
  const { ensureAuthAPI, ensureAuth, ensureAdmin, pool } = deps;
  const { createAsyncHandler } = require('../middleware/async-handler');
  const asyncHandler = createAsyncHandler(logger);

  const aggregateList = createAggregateList({ pool, logger });

  function scheduleAggregateRecompute(year, reason) {
    if (!year) return;

    aggregateList.recompute(year).catch((error) => {
      logger.error('Failed to recompute aggregate list', {
        year,
        reason,
        error: error.message,
      });
    });
  }

  const handlers = createAggregateListHandlers({
    aggregateList,
    logger,
    pool,
    validateYearNotLocked,
    scheduleAggregateRecompute,
  });

  app.get(
    '/aggregate-list/:year',
    ensureAuth,
    validateYearParam,
    (req, res) => {
      handlers.renderPage(req, res, aggregateListTemplate);
    }
  );

  app.get(
    '/api/aggregate-list/:year',
    ensureAuthAPI,
    validateYearParam,
    asyncHandler(handlers.getAggregateList, 'fetching aggregate list', {
      errorMessage: 'Database error',
    })
  );

  app.get(
    '/api/aggregate-list/:year/status',
    ensureAuthAPI,
    validateYearParam,
    asyncHandler(handlers.getStatus, 'fetching aggregate list status', {
      errorMessage: 'Database error',
    })
  );

  app.get(
    '/api/aggregate-list/:year/stats',
    ensureAuthAPI,
    ensureAdmin,
    validateYearParam,
    asyncHandler(handlers.getStats, 'fetching aggregate list stats', {
      errorMessage: 'Database error',
    })
  );

  app.post(
    '/api/aggregate-list/:year/confirm',
    ensureAuthAPI,
    ensureAdmin,
    validateYearParam,
    asyncHandler(handlers.addConfirmation, 'confirming aggregate list reveal', {
      errorMessage: 'Database error',
    })
  );

  app.delete(
    '/api/aggregate-list/:year/confirm',
    ensureAuthAPI,
    ensureAdmin,
    validateYearParam,
    asyncHandler(
      handlers.removeConfirmation,
      'revoking aggregate list confirmation',
      { errorMessage: 'Database error' }
    )
  );

  app.get(
    '/api/aggregate-list-years',
    ensureAuthAPI,
    asyncHandler(handlers.getRevealedYears, 'fetching revealed years', {
      errorMessage: 'Database error',
    })
  );

  app.get(
    '/api/aggregate-list-years/with-main-lists',
    ensureAuthAPI,
    ensureAdmin,
    asyncHandler(
      handlers.getYearsWithMainLists,
      'fetching years with main lists',
      {
        errorMessage: 'Database error',
      }
    )
  );

  app.post(
    '/api/aggregate-list/:year/recompute',
    ensureAuthAPI,
    ensureAdmin,
    validateYearParam,
    asyncHandler(handlers.recompute, 'recomputing aggregate list', {
      errorMessage: 'Database error',
    })
  );

  app.get(
    '/api/aggregate-list/:year/has-seen',
    ensureAuthAPI,
    validateYearParam,
    asyncHandler(handlers.hasSeen, 'checking reveal view status', {
      errorMessage: 'Database error',
    })
  );

  app.post(
    '/api/aggregate-list/:year/mark-seen',
    ensureAuthAPI,
    validateYearParam,
    asyncHandler(handlers.markSeen, 'marking reveal as seen', {
      errorMessage: 'Database error',
    })
  );

  app.delete(
    '/api/aggregate-list/:year/reset-seen',
    ensureAuthAPI,
    ensureAdmin,
    validateYearParam,
    asyncHandler(handlers.resetSeen, 'resetting reveal view status', {
      errorMessage: 'Database error',
    })
  );

  app.get(
    '/api/aggregate-list/viewed-years',
    ensureAuthAPI,
    ensureAdmin,
    asyncHandler(handlers.getViewedYears, 'fetching viewed years', {
      errorMessage: 'Database error',
    })
  );

  app.get(
    '/api/aggregate-list/:year/contributors',
    ensureAuthAPI,
    ensureAdmin,
    validateYearParam,
    asyncHandler(handlers.getContributors, 'fetching contributors', {
      errorMessage: 'Database error',
    })
  );

  app.get(
    '/api/aggregate-list/:year/eligible-users',
    ensureAuthAPI,
    ensureAdmin,
    validateYearParam,
    asyncHandler(handlers.getEligibleUsers, 'fetching eligible users', {
      errorMessage: 'Database error',
    })
  );

  app.post(
    '/api/aggregate-list/:year/contributors',
    ensureAuthAPI,
    ensureAdmin,
    validateYearParam,
    asyncHandler(handlers.addContributor, 'adding contributor', {
      errorMessage: 'Database error',
    })
  );

  app.delete(
    '/api/aggregate-list/:year/contributors/:userId',
    ensureAuthAPI,
    ensureAdmin,
    validateYearParam,
    asyncHandler(handlers.removeContributor, 'removing contributor', {
      errorMessage: 'Database error',
    })
  );

  app.put(
    '/api/aggregate-list/:year/contributors',
    ensureAuthAPI,
    ensureAdmin,
    validateYearParam,
    asyncHandler(handlers.setContributors, 'setting contributors', {
      errorMessage: 'Database error',
    })
  );

  app.post(
    '/api/aggregate-list/:year/lock',
    ensureAuthAPI,
    ensureAdmin,
    validateYearParam,
    asyncHandler(handlers.lockYear, 'locking year', {
      errorMessage: 'Database error',
    })
  );

  app.post(
    '/api/aggregate-list/:year/unlock',
    ensureAuthAPI,
    ensureAdmin,
    validateYearParam,
    asyncHandler(handlers.unlockYear, 'unlocking year', {
      errorMessage: 'Database error',
    })
  );

  app.get(
    '/api/locked-years',
    ensureAuthAPI,
    asyncHandler(handlers.getLockedYears, 'fetching locked years', {
      errorMessage: 'Database error',
    })
  );

  return { aggregateList };
};
