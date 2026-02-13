/**
 * Stats Service
 *
 * Encapsulates business logic for public and admin statistics.
 * Extracts DB queries and data aggregation from routes/admin/stats.js.
 *
 * Uses dependency injection via createStatsService(deps) factory.
 *
 * @module services/stats-service
 */

/**
 * @param {Object} deps
 * @param {Object} deps.pool - PostgreSQL pool
 * @param {Object} deps.usersAsync - Async user datastore
 * @param {Object} deps.listsAsync - Async list datastore
 * @returns {Object} Stats service methods
 */
function createStatsService(deps = {}) {
  const pool = deps.pool;
  const usersAsync = deps.usersAsync;
  const listsAsync = deps.listsAsync;

  if (!pool) throw new Error('pool is required for StatsService');
  if (!usersAsync) throw new Error('usersAsync is required for StatsService');
  if (!listsAsync) throw new Error('listsAsync is required for StatsService');

  /**
   * Get public stats visible to all authenticated users.
   * @returns {Promise<Object>} Stats summary
   */
  async function getPublicStats() {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [totalUsers, totalLists, adminUsers, adminStatsResult] =
      await Promise.all([
        usersAsync.count({}),
        listsAsync.count({}),
        usersAsync.count({ role: 'admin' }),
        pool.query(
          `WITH unique_albums AS (
             SELECT COUNT(DISTINCT album_id) as total
             FROM list_items
             WHERE album_id IS NOT NULL AND album_id != ''
           ),
           active_users AS (
             SELECT COUNT(DISTINCT user_id) as count FROM lists WHERE updated_at >= $1
           )
           SELECT
             (SELECT total FROM unique_albums) as total_albums,
             (SELECT count FROM active_users) as active_users`,
          [sevenDaysAgo]
        ),
      ]);

    const aggregateStats = adminStatsResult.rows[0] || {};
    const totalAlbums = parseInt(aggregateStats.total_albums, 10) || 0;
    const activeUsers = parseInt(aggregateStats.active_users, 10) || 0;

    return { totalUsers, totalLists, totalAlbums, adminUsers, activeUsers };
  }

  /**
   * Get detailed admin stats including per-user breakdowns.
   * @returns {Promise<Object>} Admin stats with users array
   */
  async function getAdminStats() {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

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
        `WITH album_genres AS (
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
           (SELECT count FROM active_users) as active_users`,
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

    const aggregateStats = adminStatsResult.rows[0] || {};
    const totalAlbums = parseInt(aggregateStats.total_albums, 10) || 0;
    const activeUsers = parseInt(aggregateStats.active_users, 10) || 0;

    return {
      totalUsers: allUsers.length,
      totalLists,
      totalAlbums,
      adminUsers,
      activeUsers,
      users: usersWithCounts,
    };
  }

  return { getPublicStats, getAdminStats };
}

module.exports = { createStatsService };
