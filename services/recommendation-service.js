/**
 * Recommendation Service
 *
 * Business logic for shared recommendations per year:
 * - CRUD for recommendations
 * - Lock/unlock management
 * - Access control
 * - Validation and authorization
 *
 * Follows dependency injection pattern for testability.
 */

const defaultLogger = require('../utils/logger');
const { withTransaction, TransactionAbort } = require('../db/transaction');
const { normalizeImageBuffer } = require('../utils/image-processing');

/**
 * Create recommendation service with injected dependencies
 * @param {Object} deps
 * @param {Object} deps.pool - PostgreSQL pool
 * @param {Object} deps.logger - Logger instance
 * @param {Object} deps.crypto - Node.js crypto module
 * @param {Function} deps.upsertAlbumRecord - Helper from _helpers.js
 */
// eslint-disable-next-line max-lines-per-function -- Cohesive service module with related recommendation operations
function createRecommendationService(deps = {}) {
  const pool = deps.pool;
  const logger = deps.logger || defaultLogger;
  const crypto = deps.crypto || require('crypto');
  const { upsertAlbumRecord } = deps;

  // ============ Internal helpers ============

  async function isLocked(year) {
    const result = await pool.query(
      'SELECT locked FROM recommendation_settings WHERE year = $1',
      [year]
    );
    return result.rows.length > 0 && result.rows[0].locked === true;
  }

  async function hasAccess(year, userId) {
    const accessCount = await pool.query(
      'SELECT COUNT(*) as count FROM recommendation_access WHERE year = $1',
      [year]
    );

    if (parseInt(accessCount.rows[0].count, 10) === 0) {
      return true;
    }

    const userAccess = await pool.query(
      'SELECT 1 FROM recommendation_access WHERE year = $1 AND user_id = $2',
      [year, userId]
    );

    return userAccess.rows.length > 0;
  }

  function validateReasoning(reasoning) {
    if (!reasoning || typeof reasoning !== 'string' || !reasoning.trim()) {
      throw new TransactionAbort(400, { error: 'Reasoning is required' });
    }
    const trimmed = reasoning.trim();
    if (trimmed.length > 500) {
      throw new TransactionAbort(400, {
        error: 'Reasoning must be 500 characters or less',
      });
    }
    return trimmed;
  }

  // ============ Public methods ============

  /**
   * Get all years that have recommendations.
   * @returns {Promise<Array<number>>}
   */
  async function getYears() {
    const result = await pool.query(`
      SELECT DISTINCT year FROM recommendations
      ORDER BY year DESC
    `);
    return result.rows.map((r) => r.year);
  }

  /**
   * Get all recommendations for a year.
   * @param {number} year
   * @param {string} userId - Current user ID (for access check)
   * @returns {Promise<Object>} { year, locked, recommendations }
   */
  async function getRecommendations(year, userId) {
    const userHasAccess = await hasAccess(year, userId);
    if (!userHasAccess) {
      throw new TransactionAbort(403, {
        error: 'Access denied to recommendations for this year',
      });
    }

    const locked = await isLocked(year);

    const result = await pool.query(
      `SELECT 
        r._id,
        r.year,
        r.album_id,
        r.created_at,
        r.reasoning,
        r.recommended_by as recommender_id,
        a.artist,
        a.album,
        a.release_date,
        a.country,
        a.genre_1,
        a.genre_2,
        u.username as recommended_by
      FROM recommendations r
      JOIN albums a ON r.album_id = a.album_id
      JOIN users u ON r.recommended_by = u._id
      WHERE r.year = $1
      ORDER BY r.created_at DESC`,
      [year]
    );

    return {
      year,
      locked,
      recommendations: result.rows.map((row) => ({
        _id: row._id,
        album_id: row.album_id,
        artist: row.artist,
        album: row.album,
        release_date: row.release_date,
        country: row.country,
        genre_1: row.genre_1,
        genre_2: row.genre_2,
        recommended_by: row.recommended_by,
        recommender_id: row.recommender_id,
        reasoning: row.reasoning,
        created_at: row.created_at,
      })),
    };
  }

  /**
   * Add an album to recommendations.
   * @param {number} year
   * @param {Object} album - Album data { artist, album, ... }
   * @param {string} reasoning - Why the album is recommended
   * @param {Object} user - Current user { _id, username }
   * @returns {Promise<Object>} { _id, album_id, year, recommended_by }
   */
  async function addRecommendation(year, album, reasoning, user) {
    const userHasAccess = await hasAccess(year, user._id);
    if (!userHasAccess) {
      throw new TransactionAbort(403, {
        error: 'Access denied to recommendations for this year',
      });
    }

    const locked = await isLocked(year);
    if (locked) {
      throw new TransactionAbort(403, {
        error: 'Recommendations are locked for this year',
        locked: true,
      });
    }

    if (!album || !album.artist || !album.album) {
      throw new TransactionAbort(400, {
        error: 'Album data required (artist, album)',
      });
    }

    const trimmedReasoning = validateReasoning(reasoning);

    const timestamp = new Date();
    const _id = crypto.randomBytes(12).toString('hex');

    const albumId = await withTransaction(pool, async (client) => {
      const upsertedAlbumId = await upsertAlbumRecord(album, timestamp, client);

      const existing = await client.query(
        `SELECT r._id, u.username 
         FROM recommendations r 
         JOIN users u ON r.recommended_by = u._id
         WHERE r.year = $1 AND r.album_id = $2`,
        [year, upsertedAlbumId]
      );

      if (existing.rows.length > 0) {
        throw new TransactionAbort(409, {
          error: `This album was already recommended by ${existing.rows[0].username}`,
          recommended_by: existing.rows[0].username,
        });
      }

      await client.query(
        `INSERT INTO recommendations (_id, year, album_id, recommended_by, reasoning, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [_id, year, upsertedAlbumId, user._id, trimmedReasoning]
      );

      return upsertedAlbumId;
    });

    logger.info('Album recommended', {
      year,
      albumId,
      userId: user._id,
      username: user.username,
    });

    return { _id, album_id: albumId, year, recommended_by: user.username };
  }

  /**
   * Get cover image data for a recommendation notification.
   * @param {string} albumId
   * @returns {Promise<Object|null>} { buffer, format } or null
   */
  async function getCoverForNotification(albumId) {
    const coverResult = await pool.query(
      'SELECT cover_image, cover_image_format FROM albums WHERE album_id = $1',
      [albumId]
    );
    if (coverResult.rows.length > 0 && coverResult.rows[0].cover_image) {
      const row = coverResult.rows[0];
      return {
        buffer: normalizeImageBuffer(row.cover_image),
        format: row.cover_image_format || 'jpeg',
      };
    }
    return null;
  }

  /**
   * Remove a recommendation (admin only).
   * @param {number} year
   * @param {string} albumId
   * @returns {Promise<boolean>} true if removed
   */
  async function removeRecommendation(year, albumId) {
    if (!albumId) {
      throw new TransactionAbort(400, { error: 'Album ID required' });
    }

    const result = await pool.query(
      'DELETE FROM recommendations WHERE year = $1 AND album_id = $2 RETURNING _id',
      [year, albumId]
    );

    if (result.rows.length === 0) {
      throw new TransactionAbort(404, { error: 'Recommendation not found' });
    }

    return true;
  }

  /**
   * Edit reasoning for a recommendation.
   * Only the original recommender can edit.
   * @param {number} year
   * @param {string} albumId
   * @param {string} reasoning
   * @param {string} userId - Current user ID
   * @returns {Promise<string>} Trimmed reasoning
   */
  async function editReasoning(year, albumId, reasoning, userId) {
    if (!albumId) {
      throw new TransactionAbort(400, { error: 'Album ID required' });
    }

    const trimmedReasoning = validateReasoning(reasoning);

    const existing = await pool.query(
      'SELECT recommended_by FROM recommendations WHERE year = $1 AND album_id = $2',
      [year, albumId]
    );

    if (existing.rows.length === 0) {
      throw new TransactionAbort(404, { error: 'Recommendation not found' });
    }

    if (existing.rows[0].recommended_by !== userId) {
      throw new TransactionAbort(403, {
        error: 'Only the original recommender can edit reasoning',
      });
    }

    await pool.query(
      'UPDATE recommendations SET reasoning = $1 WHERE year = $2 AND album_id = $3',
      [trimmedReasoning, year, albumId]
    );

    return trimmedReasoning;
  }

  /**
   * Get status for a year (lock, access, count).
   * @param {number} year
   * @param {string} userId
   * @returns {Promise<Object>}
   */
  async function getStatus(year, userId) {
    const locked = await isLocked(year);
    const userHasAccess = await hasAccess(year, userId);

    const countResult = await pool.query(
      'SELECT COUNT(*) as count FROM recommendations WHERE year = $1',
      [year]
    );

    return {
      year,
      locked,
      hasAccess: userHasAccess,
      count: parseInt(countResult.rows[0].count, 10),
    };
  }

  /**
   * Lock recommendations for a year.
   * @param {number} year
   */
  async function lock(year) {
    await pool.query(
      `INSERT INTO recommendation_settings (year, locked, created_at, updated_at)
       VALUES ($1, TRUE, NOW(), NOW())
       ON CONFLICT (year) DO UPDATE SET locked = TRUE, updated_at = NOW()`,
      [year]
    );
  }

  /**
   * Unlock recommendations for a year.
   * @param {number} year
   */
  async function unlock(year) {
    await pool.query(
      `INSERT INTO recommendation_settings (year, locked, created_at, updated_at)
       VALUES ($1, FALSE, NOW(), NOW())
       ON CONFLICT (year) DO UPDATE SET locked = FALSE, updated_at = NOW()`,
      [year]
    );
  }

  /**
   * Get all locked years.
   * @returns {Promise<Array<number>>}
   */
  async function getLockedYears() {
    const result = await pool.query(
      `SELECT year FROM recommendation_settings WHERE locked = TRUE ORDER BY year DESC`
    );
    return result.rows.map((r) => r.year);
  }

  /**
   * Get users with access to recommendations for a year.
   * @param {number} year
   * @returns {Promise<Object>} { year, isRestricted, users }
   */
  async function getAccess(year) {
    const result = await pool.query(
      `SELECT 
        ra.user_id,
        ra.added_at,
        u.username,
        u.email,
        adder.username as added_by_username
      FROM recommendation_access ra
      JOIN users u ON ra.user_id = u._id
      JOIN users adder ON ra.added_by = adder._id
      WHERE ra.year = $1
      ORDER BY u.username`,
      [year]
    );

    return {
      year,
      isRestricted: result.rows.length > 0,
      users: result.rows.map((row) => ({
        user_id: row.user_id,
        username: row.username,
        email: row.email,
        added_at: row.added_at,
        added_by: row.added_by_username,
      })),
    };
  }

  /**
   * Set users with access to recommendations for a year.
   * Pass empty array to allow all authenticated users.
   * @param {number} year
   * @param {Array<string>} userIds
   * @param {string} adminUserId
   * @returns {Promise<Object>} { year, isRestricted, userCount }
   */
  async function setAccess(year, userIds, adminUserId) {
    if (!Array.isArray(userIds)) {
      throw new TransactionAbort(400, { error: 'userIds must be an array' });
    }

    await withTransaction(pool, async (client) => {
      await client.query('DELETE FROM recommendation_access WHERE year = $1', [
        year,
      ]);

      if (userIds.length > 0) {
        const values = userIds
          .map((_, i) => `($1, $${i + 2}, $${userIds.length + 2}, NOW())`)
          .join(', ');
        await client.query(
          `INSERT INTO recommendation_access (year, user_id, added_by, added_at)
           VALUES ${values}`,
          [year, ...userIds, adminUserId]
        );
      }
    });

    return {
      year,
      isRestricted: userIds.length > 0,
      userCount: userIds.length,
    };
  }

  /**
   * Get all eligible users for access selection UI.
   * @param {number} year
   * @returns {Promise<Object>} { year, users }
   */
  async function getEligibleUsers(year) {
    const result = await pool.query(
      `SELECT 
        u._id as user_id,
        u.username,
        u.email,
        CASE WHEN ra.user_id IS NOT NULL THEN true ELSE false END as has_access
      FROM users u
      LEFT JOIN recommendation_access ra ON u._id = ra.user_id AND ra.year = $1
      WHERE u.approval_status = 'approved' OR u.approval_status IS NULL
      ORDER BY u.username`,
      [year]
    );

    return {
      year,
      users: result.rows.map((row) => ({
        user_id: row.user_id,
        username: row.username,
        email: row.email,
        has_access: row.has_access,
      })),
    };
  }

  return {
    getYears,
    getRecommendations,
    addRecommendation,
    getCoverForNotification,
    removeRecommendation,
    editReasoning,
    getStatus,
    lock,
    unlock,
    getLockedYears,
    getAccess,
    setAccess,
    getEligibleUsers,
  };
}

module.exports = { createRecommendationService };
