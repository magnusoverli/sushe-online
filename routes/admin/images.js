/**
 * Admin Image Routes
 * Handles image refetch service operations
 */

const { createImageRefetchService } = require('../../services/image-refetch');

module.exports = (app, deps) => {
  const { ensureAuth, ensureAdmin } = deps;
  const logger = require('../../utils/logger');

  const imageRefetchService = createImageRefetchService({
    pool: deps.pool,
    logger,
  });

  // Get image statistics
  app.get(
    '/api/admin/images/stats',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const stats = await imageRefetchService.getStats();
        const isRunning = imageRefetchService.isJobRunning();
        res.json({ stats, isRunning });
      } catch (error) {
        logger.error('Error fetching image stats', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch image stats' });
      }
    }
  );

  // Get image refetch job progress
  app.get('/api/admin/images/progress', ensureAuth, ensureAdmin, (req, res) => {
    const isRunning = imageRefetchService.isJobRunning();
    const progress = imageRefetchService.getProgress();
    res.json({ isRunning, progress });
  });

  // Start image refetch job
  app.post(
    '/api/admin/images/refetch',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        // Check if already running
        if (imageRefetchService.isJobRunning()) {
          return res.status(409).json({
            error: 'Image refetch job is already running',
          });
        }

        logger.info('Admin started image refetch job', {
          adminUsername: req.user.username,
          adminId: req.user._id,
        });

        // Start the job and wait for completion
        const summary = await imageRefetchService.refetchAllImages();

        res.json({
          success: true,
          summary,
        });
      } catch (error) {
        logger.error('Error during image refetch', {
          error: error.message,
          adminId: req.user._id,
        });
        res.status(500).json({ error: error.message });
      }
    }
  );

  // Stop image refetch job
  app.post('/api/admin/images/stop', ensureAuth, ensureAdmin, (req, res) => {
    const stopped = imageRefetchService.stopJob();

    logger.info('Admin stopped image refetch job', {
      adminUsername: req.user.username,
      adminId: req.user._id,
      wasStopped: stopped,
    });

    res.json({
      success: true,
      stopped,
    });
  });
};
