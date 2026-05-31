/**
 * Admin Availability Routes
 *
 * Bulk streaming-platform availability resolution across the album catalog.
 * Mirrors the image-refetch routes: a stoppable, long-running job whose progress
 * the settings drawer polls.
 */

const {
  createAvailabilityResolutionJob,
} = require('../../services/availability-resolution-job');

module.exports = (app, deps) => {
  const { ensureAuth, ensureAdmin, db } = deps;
  const logger = require('../../utils/logger');

  const availabilityResolutionService = createAvailabilityResolutionJob({
    db,
    logger,
  });

  app.locals.availabilityResolutionService = availabilityResolutionService;

  // Coverage statistics
  app.get(
    '/api/admin/availability/stats',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const stats = await availabilityResolutionService.getStats();
        const isRunning = availabilityResolutionService.isJobRunning();
        res.json({ stats, isRunning });
      } catch (error) {
        logger.error('Error fetching availability stats', {
          error: error.message,
        });
        res.status(500).json({ error: 'Failed to fetch availability stats' });
      }
    }
  );

  // Job progress
  app.get(
    '/api/admin/availability/progress',
    ensureAuth,
    ensureAdmin,
    (req, res) => {
      const isRunning = availabilityResolutionService.isJobRunning();
      const progress = availabilityResolutionService.getProgress();
      res.json({ isRunning, progress });
    }
  );

  // Start resolution job
  app.post(
    '/api/admin/availability/resolve',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        if (availabilityResolutionService.isJobRunning()) {
          return res.status(409).json({
            error: 'Availability resolution job is already running',
          });
        }

        const all = req.body?.all === true;
        logger.info('Admin started availability resolution job', {
          adminUsername: req.user.username,
          adminId: req.user._id,
          all,
        });

        const summary = await availabilityResolutionService.resolveAll({ all });
        res.json({ success: true, summary });
      } catch (error) {
        logger.error('Error during availability resolution', {
          error: error.message,
          adminId: req.user._id,
        });
        res.status(500).json({ error: error.message });
      }
    }
  );

  // Stop resolution job
  app.post(
    '/api/admin/availability/stop',
    ensureAuth,
    ensureAdmin,
    (req, res) => {
      const stopped = availabilityResolutionService.stopJob();
      logger.info('Admin stopped availability resolution job', {
        adminUsername: req.user.username,
        adminId: req.user._id,
        wasStopped: stopped,
      });
      res.json({ success: true, stopped });
    }
  );
};
