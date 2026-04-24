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
 * @param {import('../db/types').DbFacade} deps.db - Canonical datastore
 * @returns {Object} Stats service methods
 */
const { ensureDb } = require('../db/postgres');

function createStatsService(deps = {}) {
  const db = ensureDb(deps.db, 'stats-service');

  /**
   * Get public stats visible to all authenticated users.
   * @returns {Promise<Object>} Stats summary
   */
  async function getPublicStats() {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [countResult, adminStatsResult] = await Promise.all([
      db.raw(
        `SELECT
           COUNT(*)::int AS total_users,
           COUNT(*) FILTER (WHERE role = 'admin')::int AS admin_users,
           (SELECT COUNT(*)::int FROM lists) AS total_lists
         FROM users`,
        [],
        { name: 'stats-public-counts', retryable: true }
      ),
      db.raw(
        `WITH unique_albums AS (
           SELECT COUNT(DISTINCT album_id) AS total
           FROM list_items
           WHERE album_id IS NOT NULL AND album_id != ''
         ),
         active_users AS (
           SELECT COUNT(DISTINCT user_id) AS count FROM lists WHERE updated_at >= $1
         )
         SELECT
           (SELECT total FROM unique_albums) AS total_albums,
           (SELECT count FROM active_users) AS active_users`,
        [sevenDaysAgo],
        { name: 'stats-public-aggregate', retryable: true }
      ),
    ]);

    const counts = countResult.rows[0] || {};

    const aggregateStats = adminStatsResult.rows[0] || {};
    const totalAlbums = parseInt(aggregateStats.total_albums, 10) || 0;
    const activeUsers = parseInt(aggregateStats.active_users, 10) || 0;

    return {
      totalUsers: counts.total_users || 0,
      totalLists: counts.total_lists || 0,
      totalAlbums,
      adminUsers: counts.admin_users || 0,
      activeUsers,
    };
  }

  /**
   * Get detailed admin stats including per-user breakdowns.
   * @returns {Promise<Object>} Admin stats with users array
   */
  async function getAdminStats() {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [
      countsResult,
      allUsersResult,
      userListCountsResult,
      adminStatsResult,
    ] = await Promise.all([
      db.raw(
        `SELECT
           COUNT(*)::int AS total_users,
           COUNT(*) FILTER (WHERE role = 'admin')::int AS admin_users,
           (SELECT COUNT(*)::int FROM lists) AS total_lists
         FROM users`,
        [],
        { name: 'stats-admin-counts', retryable: true }
      ),
      db.raw(
        `SELECT _id, username, email, role, last_activity, created_at
         FROM users
         ORDER BY created_at DESC`,
        [],
        { name: 'stats-admin-users', retryable: true }
      ),
      db.raw(
        'SELECT user_id, COUNT(*) as list_count FROM lists GROUP BY user_id',
        [],
        { name: 'stats-admin-list-counts', retryable: true }
      ),
      db.raw(
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
        [sevenDaysAgo],
        { name: 'stats-admin-aggregate', retryable: true }
      ),
    ]);

    const counts = countsResult.rows[0] || {};
    const allUsers = allUsersResult.rows.map((row) => ({
      _id: row._id,
      username: row.username,
      email: row.email,
      role: row.role,
      lastActivity: row.last_activity,
      createdAt: row.created_at,
    }));

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
      totalUsers: counts.total_users || allUsers.length,
      totalLists: counts.total_lists || 0,
      totalAlbums,
      adminUsers: counts.admin_users || 0,
      activeUsers,
      users: usersWithCounts,
    };
  }

  return { getPublicStats, getAdminStats };
}

module.exports = { createStatsService };
