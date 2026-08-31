const logger = require('../../utils/logger');
const {
  createHistoricalListImportService,
  HistoricalImportError,
} = require('../../services/historical-list-import-service');

module.exports = (app, deps) => {
  const {
    db,
    listService,
    invalidateListCaches,
    triggerAggregateListRecompute,
    ensureAuthAPI,
    ensureAdmin,
    csrfProtection,
    rateLimitAdminRequest,
  } = deps;
  const service = createHistoricalListImportService({
    db,
    listService,
    invalidateListCaches,
    triggerAggregateListRecompute,
    logger,
  });
  const middleware = [ensureAuthAPI, ensureAdmin];
  if (typeof rateLimitAdminRequest === 'function') {
    middleware.push(rateLimitAdminRequest);
  }
  if (typeof csrfProtection === 'function') middleware.push(csrfProtection);

  const handleError = (res, error) => {
    if (error instanceof HistoricalImportError) {
      return res.status(error.status).json({
        error: error.message,
        ...error.details,
      });
    }
    logger.error('Historical list import request failed', {
      error: error.message,
    });
    return res.status(500).json({ error: 'Historical list import failed' });
  };

  app.post(
    '/api/admin/historical-list-import/preview',
    ...middleware,
    async (req, res) => {
      try {
        res.json(await service.preview(req.body));
      } catch (error) {
        handleError(res, error);
      }
    }
  );

  app.post(
    '/api/admin/historical-list-import/commit',
    ...middleware,
    async (req, res) => {
      try {
        res.json(await service.commit(req.body, req.user));
      } catch (error) {
        handleError(res, error);
      }
    }
  );

  return { historicalListImportService: service };
};
