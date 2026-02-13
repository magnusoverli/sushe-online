/**
 * Admin Statistics Routes
 *
 * Thin route layer — delegates business logic to statsService.
 * Handles statistics and status endpoints:
 * - /api/admin/status - Admin status check
 * - /api/stats - Public stats (all authenticated users)
 * - /api/admin/stats - Detailed admin stats with user list
 */

const logger = require('../../utils/logger');
const { createStatsService } = require('../../services/stats-service');

module.exports = (app, deps) => {
  const { ensureAuth, ensureAdmin, usersAsync, listsAsync, adminCodeState } =
    deps;
  const { pool } = deps;

  const statsService = createStatsService({ pool, usersAsync, listsAsync });

  // Admin status endpoint (for debugging)
  app.get('/api/admin/status', ensureAuth, (req, res) => {
    const adminCodeExpiry = adminCodeState
      ? adminCodeState.adminCodeExpiry
      : new Date(0);
    res.json({
      isAdmin: req.user.role === 'admin',
      codeValid: new Date() < adminCodeExpiry,
      codeExpiresIn:
        Math.max(0, Math.floor((adminCodeExpiry - new Date()) / 1000)) +
        ' seconds',
    });
  });

  // Public stats endpoint (accessible to all authenticated users)
  app.get('/api/stats', ensureAuth, async (req, res) => {
    try {
      const stats = await statsService.getPublicStats();
      res.json(stats);
    } catch (error) {
      logger.error('Error fetching public stats', { error: error.message });
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });

  // Admin stats endpoint
  app.get('/api/admin/stats', ensureAuth, ensureAdmin, async (req, res) => {
    try {
      const stats = await statsService.getAdminStats();
      res.json(stats);
    } catch (error) {
      logger.error('Error fetching admin stats', { error: error.message });
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });
};
