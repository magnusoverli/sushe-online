const { createMasterList } = require('../utils/master-list');
const { masterListTemplate } = require('../templates');

module.exports = (app, deps) => {
  const logger = require('../utils/logger');
  const { ensureAuthAPI, ensureAuth, ensureAdmin, pool } = deps;

  // Create master list utility instance
  const masterList = createMasterList({ pool, logger });

  // ============ MASTER LIST PAGE ROUTES ============

  /**
   * GET /master-list/:year
   * Render the master list page for a specific year
   */
  app.get('/master-list/:year', ensureAuth, (req, res) => {
    const year = parseInt(req.params.year, 10);
    if (isNaN(year) || year < 1000 || year > 9999) {
      return res.status(400).send('Invalid year');
    }

    const isAdmin = req.user && req.user.role === 'admin';
    res.send(masterListTemplate(req.user, year, isAdmin));
  });

  // ============ MASTER LIST API ENDPOINTS ============

  /**
   * GET /api/master-list/:year
   * Get the full master list for a year (only if revealed)
   */
  app.get('/api/master-list/:year', ensureAuthAPI, async (req, res) => {
    try {
      const year = parseInt(req.params.year, 10);
      if (isNaN(year) || year < 1000 || year > 9999) {
        return res.status(400).json({ error: 'Invalid year' });
      }

      const record = await masterList.get(year);

      if (!record) {
        return res
          .status(404)
          .json({ error: 'Master list not found for this year' });
      }

      if (!record.revealed) {
        return res.status(403).json({
          error: 'Master list has not been revealed yet',
          status: await masterList.getStatus(year),
        });
      }

      // Return the full data
      res.json({
        year,
        revealed: true,
        revealedAt: record.revealed_at,
        data: record.data,
      });
    } catch (err) {
      logger.error('Error fetching master list:', err);
      res.status(500).json({ error: 'Database error' });
    }
  });

  /**
   * GET /api/master-list/:year/status
   * Get reveal status and confirmation info for a year
   */
  app.get('/api/master-list/:year/status', ensureAuthAPI, async (req, res) => {
    try {
      const year = parseInt(req.params.year, 10);
      if (isNaN(year) || year < 1000 || year > 9999) {
        return res.status(400).json({ error: 'Invalid year' });
      }

      const status = await masterList.getStatus(year);
      res.json(status);
    } catch (err) {
      logger.error('Error fetching master list status:', err);
      res.status(500).json({ error: 'Database error' });
    }
  });

  /**
   * GET /api/master-list/:year/stats
   * Get anonymous stats for admin preview (no identifying album info)
   */
  app.get(
    '/api/master-list/:year/stats',
    ensureAuthAPI,
    ensureAdmin,
    async (req, res) => {
      try {
        const year = parseInt(req.params.year, 10);
        if (isNaN(year) || year < 1000 || year > 9999) {
          return res.status(400).json({ error: 'Invalid year' });
        }

        // First ensure the master list is computed
        let record = await masterList.get(year);
        if (!record) {
          // Recompute if it doesn't exist
          await masterList.recompute(year);
          record = await masterList.get(year);
        }

        if (!record) {
          return res
            .status(404)
            .json({ error: 'No official lists found for this year' });
        }

        // Return only anonymous stats
        res.json({
          year,
          revealed: record.revealed,
          stats: record.stats,
        });
      } catch (err) {
        logger.error('Error fetching master list stats:', err);
        res.status(500).json({ error: 'Database error' });
      }
    }
  );

  /**
   * POST /api/master-list/:year/confirm
   * Add admin confirmation for reveal
   */
  app.post(
    '/api/master-list/:year/confirm',
    ensureAuthAPI,
    ensureAdmin,
    async (req, res) => {
      try {
        const year = parseInt(req.params.year, 10);
        if (isNaN(year) || year < 1000 || year > 9999) {
          return res.status(400).json({ error: 'Invalid year' });
        }

        const result = await masterList.addConfirmation(year, req.user._id);

        if (result.alreadyRevealed) {
          return res.status(400).json({
            error: 'Master list has already been revealed',
            status: result.status,
          });
        }

        res.json({
          success: true,
          revealed: result.revealed,
          status: result.status,
        });
      } catch (err) {
        logger.error('Error confirming master list reveal:', err);
        res.status(500).json({ error: 'Database error' });
      }
    }
  );

  /**
   * DELETE /api/master-list/:year/confirm
   * Remove admin confirmation
   */
  app.delete(
    '/api/master-list/:year/confirm',
    ensureAuthAPI,
    ensureAdmin,
    async (req, res) => {
      try {
        const year = parseInt(req.params.year, 10);
        if (isNaN(year) || year < 1000 || year > 9999) {
          return res.status(400).json({ error: 'Invalid year' });
        }

        const result = await masterList.removeConfirmation(year, req.user._id);

        if (result.alreadyRevealed) {
          return res.status(400).json({
            error:
              'Cannot revoke confirmation - master list has already been revealed',
            status: result.status,
          });
        }

        res.json({
          success: true,
          status: result.status,
        });
      } catch (err) {
        logger.error('Error revoking master list confirmation:', err);
        res.status(500).json({ error: 'Database error' });
      }
    }
  );

  /**
   * GET /api/master-list/years
   * Get list of years with revealed master lists
   */
  app.get('/api/master-list-years', ensureAuthAPI, async (req, res) => {
    try {
      const years = await masterList.getRevealedYears();
      res.json({ years });
    } catch (err) {
      logger.error('Error fetching revealed years:', err);
      res.status(500).json({ error: 'Database error' });
    }
  });

  /**
   * GET /api/master-list-years/with-official-lists
   * Get list of years that have at least one official list (for admin panel)
   */
  app.get(
    '/api/master-list-years/with-official-lists',
    ensureAuthAPI,
    ensureAdmin,
    async (req, res) => {
      try {
        const result = await pool.query(`
          SELECT DISTINCT year 
          FROM lists 
          WHERE is_official = TRUE AND year IS NOT NULL
          ORDER BY year DESC
        `);
        res.json({ years: result.rows.map((r) => r.year) });
      } catch (err) {
        logger.error('Error fetching years with official lists:', err);
        res.status(500).json({ error: 'Database error' });
      }
    }
  );

  /**
   * POST /api/master-list/:year/recompute
   * Force recomputation of master list (admin only)
   */
  app.post(
    '/api/master-list/:year/recompute',
    ensureAuthAPI,
    ensureAdmin,
    async (req, res) => {
      try {
        const year = parseInt(req.params.year, 10);
        if (isNaN(year) || year < 1000 || year > 9999) {
          return res.status(400).json({ error: 'Invalid year' });
        }

        await masterList.recompute(year);
        const status = await masterList.getStatus(year);

        res.json({
          success: true,
          message: `Master list for ${year} recomputed`,
          status,
        });
      } catch (err) {
        logger.error('Error recomputing master list:', err);
        res.status(500).json({ error: 'Database error' });
      }
    }
  );

  // Export the masterList instance for use in triggers
  return { masterList };
};
