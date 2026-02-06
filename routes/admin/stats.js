/**
 * Admin Statistics Routes
 *
 * Handles statistics and status endpoints:
 * - /api/admin/status - Admin status check
 * - /api/stats - Public stats (all authenticated users)
 * - /api/admin/stats - Detailed admin stats with user list
 */

const logger = require('../../utils/logger');

module.exports = (app, deps) => {
  const { ensureAuth, ensureAdmin, usersAsync, listsAsync, adminCodeState } =
    deps;
  const { pool } = deps;

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
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      // Parallel fetch of aggregate stats only (no user details)
      const [totalUsers, totalLists, adminUsers, adminStatsResult] =
        await Promise.all([
          usersAsync.count({}),
          listsAsync.count({}),
          usersAsync.count({ role: 'admin' }),
          pool.query(
            `
            WITH unique_albums AS (
              SELECT COUNT(DISTINCT album_id) as total 
              FROM list_items 
              WHERE album_id IS NOT NULL AND album_id != ''
            ),
            active_users AS (
              SELECT COUNT(DISTINCT user_id) as count FROM lists WHERE updated_at >= $1
            )
            SELECT 
              (SELECT total FROM unique_albums) as total_albums,
              (SELECT count FROM active_users) as active_users
          `,
            [sevenDaysAgo]
          ),
        ]);

      // Extract stats from aggregate query
      const aggregateStats = adminStatsResult.rows[0] || {};
      const totalAlbums = parseInt(aggregateStats.total_albums, 10) || 0;
      const activeUsers = parseInt(aggregateStats.active_users, 10) || 0;

      res.json({
        totalUsers,
        totalLists,
        totalAlbums,
        adminUsers,
        activeUsers,
      });
    } catch (error) {
      logger.error('Error fetching public stats', { error: error.message });
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });

  // Admin stats endpoint
  app.get('/api/admin/stats', ensureAuth, ensureAdmin, async (req, res) => {
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      // Parallel fetch of all independent data
      const [
        allUsers,
        totalLists,
        adminUsers,
        userListCountsResult,
        adminStatsResult,
      ] = await Promise.all([
        usersAsync.find({}),
        listsAsync.count({}),
        usersAsync.count({ role: 'admin' }),
        pool.query(
          'SELECT user_id, COUNT(*) as list_count FROM lists GROUP BY user_id'
        ),
        pool.query(
          `
            WITH album_genres AS (
              SELECT DISTINCT li.album_id, a.genre_1, a.genre_2 
              FROM list_items li
              LEFT JOIN albums a ON li.album_id = a.album_id
            ),
            unique_albums AS (
              SELECT COUNT(DISTINCT album_id) as total 
              FROM album_genres 
              WHERE album_id IS NOT NULL AND album_id != ''
            ),
            active_users AS (
              SELECT COUNT(DISTINCT user_id) as count FROM lists WHERE updated_at >= $1
            )
            SELECT 
              (SELECT total FROM unique_albums) as total_albums,
              (SELECT count FROM active_users) as active_users
          `,
          [sevenDaysAgo]
        ),
      ]);

      // Build Map for O(1) list count lookup
      const listCountMap = new Map(
        userListCountsResult.rows.map((r) => [
          r.user_id,
          parseInt(r.list_count, 10),
        ])
      );

      const usersWithCounts = allUsers.map((user) => ({
        _id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        listCount: listCountMap.get(user._id) || 0,
        lastActivity: user.lastActivity,
        createdAt: user.createdAt,
      }));

      // Extract stats from aggregate query
      const aggregateStats = adminStatsResult.rows[0] || {};
      const totalAlbums = parseInt(aggregateStats.total_albums, 10) || 0;
      const activeUsers = parseInt(aggregateStats.active_users, 10) || 0;

      res.json({
        totalUsers: allUsers.length,
        totalLists,
        totalAlbums,
        adminUsers,
        activeUsers,
        users: usersWithCounts,
      });
    } catch (error) {
      logger.error('Error fetching admin stats', { error: error.message });
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });
};
