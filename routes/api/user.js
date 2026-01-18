/**
 * User API Routes
 *
 * Handles user-related endpoints.
 */

/**
 * Register user routes
 * @param {Object} app - Express app instance
 * @param {Object} deps - Dependencies
 */
module.exports = (app, deps) => {
  const { ensureAuthAPI, pool, logger } = deps;

  // GET /api/user/lists-summary - Get list names for the current user (for "Add to..." dropdown)
  app.get('/api/user/lists-summary', ensureAuthAPI, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT _id, name, year FROM lists WHERE user_id = $1 ORDER BY name`,
        [req.user._id]
      );

      res.json({
        lists: result.rows.map((row) => ({
          id: row._id,
          name: row.name,
          year: row.year,
        })),
      });
    } catch (error) {
      logger.error('Lists summary error:', error);
      res.status(500).json({ error: 'Failed to fetch lists' });
    }
  });
};
