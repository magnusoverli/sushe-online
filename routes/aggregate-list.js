const { createAggregateList } = require('../services/aggregate-list');
const { aggregateListTemplate } = require('../templates');
const { validateYearNotLocked } = require('../utils/year-lock');
const { validateYearParam } = require('../middleware/validate-params');

module.exports = (app, deps) => {
  const logger = require('../utils/logger');
  const { ensureAuthAPI, ensureAuth, ensureAdmin, pool } = deps;
  const { createAsyncHandler } = require('../middleware/async-handler');
  const asyncHandler = createAsyncHandler(logger);

  // Create aggregate list utility instance
  const aggregateList = createAggregateList({ pool, logger });

  // ============ AGGREGATE LIST PAGE ROUTES ============

  /**
   * GET /aggregate-list/:year
   * Render the aggregate list page for a specific year
   */
  app.get(
    '/aggregate-list/:year',
    ensureAuth,
    validateYearParam,
    (req, res) => {
      res.send(aggregateListTemplate(req.user, req.validatedYear));
    }
  );

  // ============ AGGREGATE LIST API ENDPOINTS ============

  /**
   * GET /api/aggregate-list/:year
   * Get the full aggregate list for a year (only if revealed)
   */
  app.get(
    '/api/aggregate-list/:year',
    ensureAuthAPI,
    validateYearParam,
    asyncHandler(
      async (req, res) => {
        const year = req.validatedYear;
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
      },
      'fetching aggregate list',
      { errorMessage: 'Database error' }
    )
  );

  /**
   * GET /api/aggregate-list/:year/status
   * Get reveal status and confirmation info for a year
   */
  app.get(
    '/api/aggregate-list/:year/status',
    ensureAuthAPI,
    validateYearParam,
    asyncHandler(
      async (req, res) => {
        const year = req.validatedYear;
        const status = await aggregateList.getStatus(year);
        res.json(status);
      },
      'fetching aggregate list status',
      { errorMessage: 'Database error' }
    )
  );

  /**
   * GET /api/aggregate-list/:year/stats
   * Get anonymous stats for admin preview (no identifying album info)
   */
  app.get(
    '/api/aggregate-list/:year/stats',
    ensureAuthAPI,
    ensureAdmin,
    validateYearParam,
    asyncHandler(
      async (req, res) => {
        const year = req.validatedYear;

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
            .json({ error: 'No main lists found for this year' });
        }

        // Return only anonymous stats
        res.json({
          year,
          revealed: record.revealed,
          stats: record.stats,
        });
      },
      'fetching aggregate list stats',
      { errorMessage: 'Database error' }
    )
  );

  /**
   * POST /api/aggregate-list/:year/confirm
   * Add admin confirmation for reveal
   */
  app.post(
    '/api/aggregate-list/:year/confirm',
    ensureAuthAPI,
    ensureAdmin,
    validateYearParam,
    asyncHandler(
      async (req, res) => {
        const year = req.validatedYear;
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
      },
      'confirming aggregate list reveal',
      { errorMessage: 'Database error' }
    )
  );

  /**
   * DELETE /api/aggregate-list/:year/confirm
   * Remove admin confirmation
   */
  app.delete(
    '/api/aggregate-list/:year/confirm',
    ensureAuthAPI,
    ensureAdmin,
    validateYearParam,
    asyncHandler(
      async (req, res) => {
        const year = req.validatedYear;
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
      },
      'revoking aggregate list confirmation',
      { errorMessage: 'Database error' }
    )
  );

  /**
   * GET /api/aggregate-list/years
   * Get list of years with revealed aggregate lists
   */
  app.get(
    '/api/aggregate-list-years',
    ensureAuthAPI,
    asyncHandler(
      async (req, res) => {
        const years = await aggregateList.getRevealedYears();
        res.json({ years });
      },
      'fetching revealed years',
      { errorMessage: 'Database error' }
    )
  );

  /**
   * GET /api/aggregate-list-years/with-main-lists
   * Get list of years that have at least one main list (for admin panel)
   */
  app.get(
    '/api/aggregate-list-years/with-main-lists',
    ensureAuthAPI,
    ensureAdmin,
    asyncHandler(
      async (req, res) => {
        const result = await pool.query(`
          SELECT DISTINCT year 
          FROM lists 
          WHERE is_main = TRUE AND year IS NOT NULL
          ORDER BY year DESC
        `);
        res.json({ years: result.rows.map((r) => r.year) });
      },
      'fetching years with main lists',
      { errorMessage: 'Database error' }
    )
  );

  /**
   * POST /api/aggregate-list/:year/recompute
   * Force recomputation of aggregate list (admin only)
   */
  app.post(
    '/api/aggregate-list/:year/recompute',
    ensureAuthAPI,
    ensureAdmin,
    validateYearParam,
    asyncHandler(
      async (req, res) => {
        const year = req.validatedYear;
        await aggregateList.recompute(year);
        const status = await aggregateList.getStatus(year);

        res.json({
          success: true,
          message: `Aggregate list for ${year} recomputed`,
          status,
        });
      },
      'recomputing aggregate list',
      { errorMessage: 'Database error' }
    )
  );

  // ============ REVEAL VIEW TRACKING ENDPOINTS ============

  /**
   * GET /api/aggregate-list/:year/has-seen
   * Check if current user has seen the dramatic reveal for this year
   */
  app.get(
    '/api/aggregate-list/:year/has-seen',
    ensureAuthAPI,
    validateYearParam,
    asyncHandler(
      async (req, res) => {
        const year = req.validatedYear;
        const hasSeen = await aggregateList.hasSeen(year, req.user._id);
        res.json({ hasSeen, year });
      },
      'checking reveal view status',
      { errorMessage: 'Database error' }
    )
  );

  /**
   * POST /api/aggregate-list/:year/mark-seen
   * Mark that the current user has seen the dramatic reveal
   */
  app.post(
    '/api/aggregate-list/:year/mark-seen',
    ensureAuthAPI,
    validateYearParam,
    asyncHandler(
      async (req, res) => {
        const year = req.validatedYear;
        await aggregateList.markSeen(year, req.user._id);
        res.json({ success: true, year });
      },
      'marking reveal as seen',
      { errorMessage: 'Database error' }
    )
  );

  /**
   * DELETE /api/aggregate-list/:year/reset-seen
   * Reset reveal view status for current admin (for testing)
   */
  app.delete(
    '/api/aggregate-list/:year/reset-seen',
    ensureAuthAPI,
    ensureAdmin,
    validateYearParam,
    asyncHandler(
      async (req, res) => {
        const year = req.validatedYear;
        const result = await aggregateList.resetSeen(year, req.user._id);
        res.json({
          success: true,
          deleted: result.deleted,
          message: result.deleted
            ? `Reveal view status reset for ${year}`
            : 'No view record found to reset',
        });
      },
      'resetting reveal view status',
      { errorMessage: 'Database error' }
    )
  );

  /**
   * GET /api/aggregate-list/viewed-years
   * Get all years the current user has seen the reveal for (admin only, for reset UI)
   */
  app.get(
    '/api/aggregate-list/viewed-years',
    ensureAuthAPI,
    ensureAdmin,
    asyncHandler(
      async (req, res) => {
        const viewedYears = await aggregateList.getViewedYears(req.user._id);
        res.json({ viewedYears });
      },
      'fetching viewed years',
      { errorMessage: 'Database error' }
    )
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
    validateYearParam,
    asyncHandler(
      async (req, res) => {
        const year = req.validatedYear;
        const contributors = await aggregateList.getContributors(year);
        res.json({ year, contributors });
      },
      'fetching contributors',
      { errorMessage: 'Database error' }
    )
  );

  /**
   * GET /api/aggregate-list/:year/eligible-users
   * Get all users with main lists for a year (for contributor selection UI)
   */
  app.get(
    '/api/aggregate-list/:year/eligible-users',
    ensureAuthAPI,
    ensureAdmin,
    validateYearParam,
    asyncHandler(
      async (req, res) => {
        const year = req.validatedYear;
        const eligibleUsers = await aggregateList.getEligibleUsers(year);
        res.json({ year, eligibleUsers });
      },
      'fetching eligible users',
      { errorMessage: 'Database error' }
    )
  );

  /**
   * POST /api/aggregate-list/:year/contributors
   * Add a user as contributor (admin only)
   */
  app.post(
    '/api/aggregate-list/:year/contributors',
    ensureAuthAPI,
    ensureAdmin,
    validateYearParam,
    asyncHandler(
      async (req, res) => {
        const year = req.validatedYear;

        // Check if year is locked
        try {
          await validateYearNotLocked(pool, year, 'manage contributors');
        } catch (err) {
          return res.status(403).json({
            error: err.message,
            yearLocked: true,
            year: year,
          });
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
      },
      'adding contributor',
      { errorMessage: 'Database error' }
    )
  );

  /**
   * DELETE /api/aggregate-list/:year/contributors/:userId
   * Remove a user as contributor (admin only)
   */
  app.delete(
    '/api/aggregate-list/:year/contributors/:userId',
    ensureAuthAPI,
    ensureAdmin,
    validateYearParam,
    asyncHandler(
      async (req, res) => {
        const year = req.validatedYear;

        // Check if year is locked
        try {
          await validateYearNotLocked(pool, year, 'manage contributors');
        } catch (err) {
          return res.status(403).json({
            error: err.message,
            yearLocked: true,
            year: year,
          });
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
      },
      'removing contributor',
      { errorMessage: 'Database error' }
    )
  );

  /**
   * PUT /api/aggregate-list/:year/contributors
   * Bulk update contributors for a year (set all at once)
   */
  app.put(
    '/api/aggregate-list/:year/contributors',
    ensureAuthAPI,
    ensureAdmin,
    validateYearParam,
    asyncHandler(
      async (req, res) => {
        const year = req.validatedYear;
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
      },
      'setting contributors',
      { errorMessage: 'Database error' }
    )
  );

  // ============ YEAR LOCKING ENDPOINTS ============

  /**
   * POST /api/aggregate-list/:year/lock
   * Lock a year to prevent list modifications (admin only)
   */
  app.post(
    '/api/aggregate-list/:year/lock',
    ensureAuthAPI,
    ensureAdmin,
    validateYearParam,
    asyncHandler(
      async (req, res) => {
        const year = req.validatedYear;

        // Create master_lists record if doesn't exist, or update existing
        await pool.query(
          `
          INSERT INTO master_lists (year, locked, created_at, updated_at)
          VALUES ($1, TRUE, NOW(), NOW())
          ON CONFLICT (year) DO UPDATE SET
            locked = TRUE,
            updated_at = NOW()
        `,
          [year]
        );

        logger.info('Admin action', {
          action: 'lock_year',
          adminId: req.user._id,
          adminEmail: req.user.email,
          year,
          ip: req.ip,
        });

        res.json({ success: true, year, locked: true });
      },
      'locking year',
      { errorMessage: 'Database error' }
    )
  );

  /**
   * POST /api/aggregate-list/:year/unlock
   * Unlock a year to allow list modifications (admin only)
   */
  app.post(
    '/api/aggregate-list/:year/unlock',
    ensureAuthAPI,
    ensureAdmin,
    validateYearParam,
    asyncHandler(
      async (req, res) => {
        const year = req.validatedYear;
        await pool.query(
          `
          UPDATE master_lists 
          SET locked = FALSE, updated_at = NOW()
          WHERE year = $1
        `,
          [year]
        );

        logger.info('Admin action', {
          action: 'unlock_year',
          adminId: req.user._id,
          adminEmail: req.user.email,
          year,
          ip: req.ip,
        });

        res.json({ success: true, year, locked: false });
      },
      'unlocking year',
      { errorMessage: 'Database error' }
    )
  );

  /**
   * GET /api/locked-years
   * Get list of all locked years
   */
  app.get(
    '/api/locked-years',
    ensureAuthAPI,
    asyncHandler(
      async (req, res) => {
        const result = await pool.query(
          `
        SELECT year 
        FROM master_lists 
        WHERE locked = TRUE 
        ORDER BY year DESC
      `
        );

        res.json({ years: result.rows.map((r) => r.year) });
      },
      'fetching locked years',
      { errorMessage: 'Database error' }
    )
  );

  // Export the aggregateList instance for use in triggers
  return { aggregateList };
};
