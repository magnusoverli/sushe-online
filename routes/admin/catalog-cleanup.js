const logger = require('../../utils/logger');
const {
  createCatalogCleanupService,
  DEFAULT_MIN_AGE_DAYS,
} = require('../../services/catalog-cleanup');

module.exports = (app, deps) => {
  const { ensureAuth, ensureAdmin, db } = deps;

  const catalogCleanupService = createCatalogCleanupService({ db, logger });
  app.locals.catalogCleanupService = catalogCleanupService;

  app.get(
    '/api/admin/catalog-cleanup/preview',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const minAgeDays = catalogCleanupService.normalizeMinAgeDays(
          req.query.minAgeDays
        );
        const preview = await catalogCleanupService.getPreview({ minAgeDays });
        res.json({ success: true, preview });
      } catch (error) {
        logger.error('Failed to build catalog cleanup preview', {
          error: error.message,
          adminId: req.user?._id,
        });
        res.status(500).json({ error: 'Failed to preview cleanup candidates' });
      }
    }
  );

  app.post(
    '/api/admin/catalog-cleanup/execute',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const minAgeDays = catalogCleanupService.normalizeMinAgeDays(
          req.body?.minAgeDays
        );
        const result = await catalogCleanupService.executeCleanup({
          minAgeDays,
          expectedDeleteCount: req.body?.expectedDeleteCount,
        });

        logger.info('Admin executed catalog cleanup', {
          adminUsername: req.user.username,
          adminId: req.user._id,
          minAgeDays,
          deletedAlbums: result.deletedAlbums,
          nullifiedUserAlbumStats: result.nullifiedUserAlbumStats,
          deletedDistinctPairs: result.deletedDistinctPairs,
        });

        res.json({
          success: true,
          result,
        });
      } catch (error) {
        if (error.code === 'CATALOG_CLEANUP_STALE_PREVIEW') {
          return res.status(error.statusCode || 409).json({
            error: error.message,
            ...error.details,
          });
        }

        logger.error('Failed to execute catalog cleanup', {
          error: error.message,
          adminId: req.user?._id,
        });
        res.status(500).json({
          error: 'Failed to execute catalog cleanup',
        });
      }
    }
  );

  app.get(
    '/api/admin/catalog-cleanup/default-age',
    ensureAuth,
    ensureAdmin,
    (req, res) => {
      res.json({ minAgeDays: DEFAULT_MIN_AGE_DAYS });
    }
  );
};
