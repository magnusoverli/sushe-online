/**
 * Admin Album Summary Routes
 *
 * Handles batch fetching of album summaries from Claude API:
 * - /api/admin/album-summaries/stats - Get statistics
 * - /api/admin/album-summaries/status - Get batch job status
 * - /api/admin/album-summaries/fetch - Start batch fetch
 * - /api/admin/album-summaries/stop - Stop batch fetch
 * - /api/admin/album-summaries/fetch-single - Fetch single album summary
 */

const logger = require('../../utils/logger');
const { createAlbumSummaryService } = require('../../utils/album-summary');
const { responseCache } = require('../../middleware/response-cache');

module.exports = (app, deps) => {
  const { ensureAuth, ensureAdmin, pool } = deps;

  // Create album summary service instance
  const albumSummaryService = createAlbumSummaryService({
    pool,
    logger,
    responseCache,
    broadcast: app.locals.broadcast,
  });

  // Expose service for use by other modules (e.g., api.js for new album triggers)
  app.locals.albumSummaryService = albumSummaryService;

  // Get album summary statistics
  app.get(
    '/api/admin/album-summaries/stats',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const stats = await albumSummaryService.getStats();
        const batchStatus = albumSummaryService.getBatchStatus();
        res.json({ stats, batchStatus });
      } catch (error) {
        logger.error('Error fetching album summary stats', {
          error: error.message,
        });
        res.status(500).json({ error: 'Failed to fetch stats' });
      }
    }
  );

  // Get batch job status
  app.get(
    '/api/admin/album-summaries/status',
    ensureAuth,
    ensureAdmin,
    (req, res) => {
      const status = albumSummaryService.getBatchStatus();
      res.json({ status });
    }
  );

  // Start batch fetch job
  app.post(
    '/api/admin/album-summaries/fetch',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const { includeRetries, regenerateAll } = req.body;

        // Check if already running
        const currentStatus = albumSummaryService.getBatchStatus();
        if (currentStatus?.running) {
          return res.status(409).json({
            error: 'Batch job already running',
            status: currentStatus,
          });
        }

        logger.info('Admin started album summary batch fetch', {
          adminUsername: req.user.username,
          adminId: req.user._id,
          includeRetries: !!includeRetries,
          regenerateAll: !!regenerateAll,
        });

        await albumSummaryService.startBatchFetch({
          includeRetries,
          regenerateAll,
        });

        res.json({
          success: true,
          message: 'Batch fetch started',
          status: albumSummaryService.getBatchStatus(),
        });
      } catch (error) {
        logger.error('Error starting album summary batch fetch', {
          error: error.message,
          adminId: req.user._id,
        });
        res.status(500).json({ error: error.message });
      }
    }
  );

  // Stop batch fetch job
  app.post(
    '/api/admin/album-summaries/stop',
    ensureAuth,
    ensureAdmin,
    (req, res) => {
      const stopped = albumSummaryService.stopBatchFetch();

      logger.info('Admin stopped album summary batch fetch', {
        adminUsername: req.user.username,
        adminId: req.user._id,
        wasStopped: stopped,
      });

      res.json({
        success: true,
        stopped,
        status: albumSummaryService.getBatchStatus(),
      });
    }
  );

  // Fetch summary for a single album (for testing/manual trigger)
  app.post(
    '/api/admin/album-summaries/fetch-single',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const { albumId } = req.body;

        if (!albumId) {
          return res.status(400).json({ error: 'albumId is required' });
        }

        const result = await albumSummaryService.fetchAndStoreSummary(albumId);

        res.json({
          success: result.success,
          hasSummary: result.hasSummary,
          error: result.error,
        });
      } catch (error) {
        logger.error('Error fetching single album summary', {
          error: error.message,
          albumId: req.body?.albumId,
        });
        res.status(500).json({ error: error.message });
      }
    }
  );

  return { albumSummaryService };
};
