const { createAggregateList } = require('../utils/aggregate-list');
const { aggregateListTemplate } = require('../templates');

module.exports = (app, deps) => {
  const logger = require('../utils/logger');
  const { ensureAuthAPI, ensureAuth, ensureAdmin, pool } = deps;

  // Create aggregate list utility instance
  const aggregateList = createAggregateList({ pool, logger });

  // ============ AGGREGATE LIST PAGE ROUTES ============

  /**
   * GET /aggregate-list/:year
   * Render the aggregate list page for a specific year
   */
  app.get('/aggregate-list/:year', ensureAuth, (req, res) => {
    const year = parseInt(req.params.year, 10);
    if (isNaN(year) || year < 1000 || year > 9999) {
      return res.status(400).send('Invalid year');
    }

    const isAdmin = req.user && req.user.role === 'admin';
    res.send(aggregateListTemplate(req.user, year, isAdmin));
  });

  // ============ AGGREGATE LIST API ENDPOINTS ============

  /**
   * GET /api/aggregate-list/:year
   * Get the full aggregate list for a year (only if revealed)
   */
  app.get('/api/aggregate-list/:year', ensureAuthAPI, async (req, res) => {
    try {
      const year = parseInt(req.params.year, 10);
      if (isNaN(year) || year < 1000 || year > 9999) {
        return res.status(400).json({ error: 'Invalid year' });
      }

      const record = await aggregateList.get(year);

      if (!record) {
        return res
          .status(404)
          .json({ error: 'Aggregate list not found for this year' });
      }

      if (!record.revealed) {
        return res.status(403).json({
          error: 'Aggregate list has not been revealed yet',
          status: await aggregateList.getStatus(year),
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
      logger.error('Error fetching aggregate list:', err);
      res.status(500).json({ error: 'Database error' });
    }
  });

  /**
   * GET /api/aggregate-list/:year/status
   * Get reveal status and confirmation info for a year
   */
  app.get(
    '/api/aggregate-list/:year/status',
    ensureAuthAPI,
    async (req, res) => {
      try {
        const year = parseInt(req.params.year, 10);
        if (isNaN(year) || year < 1000 || year > 9999) {
          return res.status(400).json({ error: 'Invalid year' });
        }

        const status = await aggregateList.getStatus(year);
        res.json(status);
      } catch (err) {
        logger.error('Error fetching aggregate list status:', err);
        res.status(500).json({ error: 'Database error' });
      }
    }
  );

  /**
   * GET /api/aggregate-list/:year/stats
   * Get anonymous stats for admin preview (no identifying album info)
   */
  app.get(
    '/api/aggregate-list/:year/stats',
    ensureAuthAPI,
    ensureAdmin,
    async (req, res) => {
      try {
        const year = parseInt(req.params.year, 10);
        if (isNaN(year) || year < 1000 || year > 9999) {
          return res.status(400).json({ error: 'Invalid year' });
        }

        // First ensure the aggregate list is computed
        let record = await aggregateList.get(year);
        if (!record) {
          // Recompute if it doesn't exist
          await aggregateList.recompute(year);
          record = await aggregateList.get(year);
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
        logger.error('Error fetching aggregate list stats:', err);
        res.status(500).json({ error: 'Database error' });
      }
    }
  );

  /**
   * POST /api/aggregate-list/:year/confirm
   * Add admin confirmation for reveal
   */
  app.post(
    '/api/aggregate-list/:year/confirm',
    ensureAuthAPI,
    ensureAdmin,
    async (req, res) => {
      try {
        const year = parseInt(req.params.year, 10);
        if (isNaN(year) || year < 1000 || year > 9999) {
          return res.status(400).json({ error: 'Invalid year' });
        }

        const result = await aggregateList.addConfirmation(year, req.user._id);

        if (result.alreadyRevealed) {
          return res.status(400).json({
            error: 'Aggregate list has already been revealed',
            status: result.status,
          });
        }

        res.json({
          success: true,
          revealed: result.revealed,
          status: result.status,
        });
      } catch (err) {
        logger.error('Error confirming aggregate list reveal:', err);
        res.status(500).json({ error: 'Database error' });
      }
    }
  );

  /**
   * DELETE /api/aggregate-list/:year/confirm
   * Remove admin confirmation
   */
  app.delete(
    '/api/aggregate-list/:year/confirm',
    ensureAuthAPI,
    ensureAdmin,
    async (req, res) => {
      try {
        const year = parseInt(req.params.year, 10);
        if (isNaN(year) || year < 1000 || year > 9999) {
          return res.status(400).json({ error: 'Invalid year' });
        }

        const result = await aggregateList.removeConfirmation(
          year,
          req.user._id
        );

        if (result.alreadyRevealed) {
          return res.status(400).json({
            error:
              'Cannot revoke confirmation - aggregate list has already been revealed',
            status: result.status,
          });
        }

        res.json({
          success: true,
          status: result.status,
        });
      } catch (err) {
        logger.error('Error revoking aggregate list confirmation:', err);
        res.status(500).json({ error: 'Database error' });
      }
    }
  );

  /**
   * GET /api/aggregate-list/years
   * Get list of years with revealed aggregate lists
   */
  app.get('/api/aggregate-list-years', ensureAuthAPI, async (req, res) => {
    try {
      const years = await aggregateList.getRevealedYears();
      res.json({ years });
    } catch (err) {
      logger.error('Error fetching revealed years:', err);
      res.status(500).json({ error: 'Database error' });
    }
  });

  /**
   * GET /api/aggregate-list-years/with-official-lists
   * Get list of years that have at least one official list (for admin panel)
   */
  app.get(
    '/api/aggregate-list-years/with-official-lists',
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
   * POST /api/aggregate-list/:year/recompute
   * Force recomputation of aggregate list (admin only)
   */
  app.post(
    '/api/aggregate-list/:year/recompute',
    ensureAuthAPI,
    ensureAdmin,
    async (req, res) => {
      try {
        const year = parseInt(req.params.year, 10);
        if (isNaN(year) || year < 1000 || year > 9999) {
          return res.status(400).json({ error: 'Invalid year' });
        }

        await aggregateList.recompute(year);
        const status = await aggregateList.getStatus(year);

        res.json({
          success: true,
          message: `Aggregate list for ${year} recomputed`,
          status,
        });
      } catch (err) {
        logger.error('Error recomputing aggregate list:', err);
        res.status(500).json({ error: 'Database error' });
      }
    }
  );

  // ============ CONTRIBUTOR MANAGEMENT ENDPOINTS ============

  /**
   * GET /api/aggregate-list/:year/contributors
   * Get approved contributors for a year (admin only)
   */
  app.get(
    '/api/aggregate-list/:year/contributors',
    ensureAuthAPI,
    ensureAdmin,
    async (req, res) => {
      try {
        const year = parseInt(req.params.year, 10);
        if (isNaN(year) || year < 1000 || year > 9999) {
          return res.status(400).json({ error: 'Invalid year' });
        }

        const contributors = await aggregateList.getContributors(year);
        res.json({ year, contributors });
      } catch (err) {
        logger.error('Error fetching contributors:', err);
        res.status(500).json({ error: 'Database error' });
      }
    }
  );

  /**
   * GET /api/aggregate-list/:year/eligible-users
   * Get all users with official lists for a year (for contributor selection UI)
   */
  app.get(
    '/api/aggregate-list/:year/eligible-users',
    ensureAuthAPI,
    ensureAdmin,
    async (req, res) => {
      try {
        const year = parseInt(req.params.year, 10);
        if (isNaN(year) || year < 1000 || year > 9999) {
          return res.status(400).json({ error: 'Invalid year' });
        }

        const eligibleUsers = await aggregateList.getEligibleUsers(year);
        res.json({ year, eligibleUsers });
      } catch (err) {
        logger.error('Error fetching eligible users:', err);
        res.status(500).json({ error: 'Database error' });
      }
    }
  );

  /**
   * POST /api/aggregate-list/:year/contributors
   * Add a user as contributor (admin only)
   */
  app.post(
    '/api/aggregate-list/:year/contributors',
    ensureAuthAPI,
    ensureAdmin,
    async (req, res) => {
      try {
        const year = parseInt(req.params.year, 10);
        if (isNaN(year) || year < 1000 || year > 9999) {
          return res.status(400).json({ error: 'Invalid year' });
        }

        const { userId } = req.body;
        if (!userId) {
          return res.status(400).json({ error: 'userId is required' });
        }

        await aggregateList.addContributor(year, userId, req.user._id);

        // Recompute the aggregate list with the new contributor
        await aggregateList.recompute(year);

        res.json({
          success: true,
          message: `User added as contributor for ${year}`,
        });
      } catch (err) {
        logger.error('Error adding contributor:', err);
        res.status(500).json({ error: 'Database error' });
      }
    }
  );

  /**
   * DELETE /api/aggregate-list/:year/contributors/:userId
   * Remove a user as contributor (admin only)
   */
  app.delete(
    '/api/aggregate-list/:year/contributors/:userId',
    ensureAuthAPI,
    ensureAdmin,
    async (req, res) => {
      try {
        const year = parseInt(req.params.year, 10);
        if (isNaN(year) || year < 1000 || year > 9999) {
          return res.status(400).json({ error: 'Invalid year' });
        }

        const { userId } = req.params;
        if (!userId) {
          return res.status(400).json({ error: 'userId is required' });
        }

        const result = await aggregateList.removeContributor(year, userId);

        // Recompute the aggregate list without this contributor
        await aggregateList.recompute(year);

        res.json({
          success: true,
          removed: result.removed,
          message: result.removed
            ? `User removed as contributor for ${year}`
            : 'User was not a contributor',
        });
      } catch (err) {
        logger.error('Error removing contributor:', err);
        res.status(500).json({ error: 'Database error' });
      }
    }
  );

  /**
   * PUT /api/aggregate-list/:year/contributors
   * Bulk update contributors for a year (set all at once)
   */
  app.put(
    '/api/aggregate-list/:year/contributors',
    ensureAuthAPI,
    ensureAdmin,
    async (req, res) => {
      try {
        const year = parseInt(req.params.year, 10);
        if (isNaN(year) || year < 1000 || year > 9999) {
          return res.status(400).json({ error: 'Invalid year' });
        }

        const { userIds } = req.body;
        if (!Array.isArray(userIds)) {
          return res.status(400).json({ error: 'userIds must be an array' });
        }

        await aggregateList.setContributors(year, userIds, req.user._id);

        // Recompute the aggregate list with new contributors
        await aggregateList.recompute(year);

        res.json({
          success: true,
          count: userIds.length,
          message: `Set ${userIds.length} contributors for ${year}`,
        });
      } catch (err) {
        logger.error('Error setting contributors:', err);
        res.status(500).json({ error: 'Database error' });
      }
    }
  );

  // Export the aggregateList instance for use in triggers
  return { aggregateList };
};
