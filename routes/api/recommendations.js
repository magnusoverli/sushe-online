/**
 * Recommendations API Routes
 *
 * Handles shared recommendations per year:
 * - Get recommendations for a year
 * - Add album to recommendations
 * - Remove recommendation (admin only)
 * - Lock/unlock recommendations (admin only)
 * - Manage access control (admin only)
 */

const { ensureAdmin } = require('../../middleware/auth');

/**
 * Register recommendations routes
 * @param {Object} app - Express app instance
 * @param {Object} deps - Dependencies
 */
module.exports = (appInstance, deps) => {
  const app = appInstance;
  const {
    ensureAuthAPI,
    pool,
    logger,
    crypto,
    helpers: { upsertAlbumRecord },
  } = deps;

  /**
   * Helper to validate year parameter
   */
  function validateYear(yearParam) {
    const year = parseInt(yearParam, 10);
    if (isNaN(year) || year < 1000 || year > 9999) {
      return null;
    }
    return year;
  }

  /**
   * Helper to check if recommendations are locked for a year
   */
  async function isRecommendationsLocked(year) {
    const result = await pool.query(
      'SELECT locked FROM recommendation_settings WHERE year = $1',
      [year]
    );
    return result.rows.length > 0 && result.rows[0].locked === true;
  }

  /**
   * Helper to check if user has access to recommendations for a year
   * Returns true if:
   * - No access restrictions exist for the year (empty recommendation_access)
   * - User is in the access list
   */
  async function hasRecommendationAccess(year, userId) {
    // Check if there are any access restrictions for this year
    const accessCount = await pool.query(
      'SELECT COUNT(*) as count FROM recommendation_access WHERE year = $1',
      [year]
    );

    // No restrictions = all authenticated users have access
    if (parseInt(accessCount.rows[0].count, 10) === 0) {
      return true;
    }

    // Check if user is in access list
    const userAccess = await pool.query(
      'SELECT 1 FROM recommendation_access WHERE year = $1 AND user_id = $2',
      [year, userId]
    );

    return userAccess.rows.length > 0;
  }

  // ============ RECOMMENDATIONS CRUD ENDPOINTS ============

  /**
   * GET /api/recommendations/years
   * Get all years that have recommendations or settings
   */
  app.get('/api/recommendations/years', ensureAuthAPI, async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT DISTINCT year FROM (
          SELECT year FROM recommendations
          UNION
          SELECT year FROM recommendation_settings
        ) combined
        ORDER BY year DESC
      `);

      res.json({ years: result.rows.map((r) => r.year) });
    } catch (err) {
      logger.error('Error fetching recommendation years', {
        error: err.message,
      });
      res.status(500).json({ error: 'Database error' });
    }
  });

  /**
   * GET /api/recommendations/:year
   * Get all recommendations for a year (with album data + recommender username)
   */
  app.get('/api/recommendations/:year', ensureAuthAPI, async (req, res) => {
    try {
      const year = validateYear(req.params.year);
      if (!year) {
        return res.status(400).json({ error: 'Invalid year' });
      }

      // Check access
      const hasAccess = await hasRecommendationAccess(year, req.user._id);
      if (!hasAccess) {
        return res
          .status(403)
          .json({ error: 'Access denied to recommendations for this year' });
      }

      // Get lock status
      const locked = await isRecommendationsLocked(year);

      // Get recommendations with album data and recommender info
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

      res.json({
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
      });
    } catch (err) {
      logger.error('Error fetching recommendations', {
        error: err.message,
        year: req.params.year,
      });
      res.status(500).json({ error: 'Database error' });
    }
  });

  /**
   * POST /api/recommendations/:year
   * Add an album to recommendations
   */
  app.post('/api/recommendations/:year', ensureAuthAPI, async (req, res) => {
    try {
      const year = validateYear(req.params.year);
      if (!year) {
        return res.status(400).json({ error: 'Invalid year' });
      }

      // Check access
      const hasAccess = await hasRecommendationAccess(year, req.user._id);
      if (!hasAccess) {
        return res
          .status(403)
          .json({ error: 'Access denied to recommendations for this year' });
      }

      // Check if locked
      const locked = await isRecommendationsLocked(year);
      if (locked) {
        return res.status(403).json({
          error: 'Recommendations are locked for this year',
          locked: true,
        });
      }

      const { album, reasoning } = req.body;
      if (!album || !album.artist || !album.album) {
        return res
          .status(400)
          .json({ error: 'Album data required (artist, album)' });
      }

      // Validate reasoning
      if (!reasoning || typeof reasoning !== 'string' || !reasoning.trim()) {
        return res.status(400).json({ error: 'Reasoning is required' });
      }

      const trimmedReasoning = reasoning.trim();
      if (trimmedReasoning.length > 500) {
        return res
          .status(400)
          .json({ error: 'Reasoning must be 500 characters or less' });
      }

      // Start transaction
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Upsert album to canonical albums table
        const timestamp = new Date();
        const albumId = await upsertAlbumRecord(album, timestamp, client);

        // Check if album already recommended for this year
        const existing = await client.query(
          `SELECT r._id, u.username 
           FROM recommendations r 
           JOIN users u ON r.recommended_by = u._id
           WHERE r.year = $1 AND r.album_id = $2`,
          [year, albumId]
        );

        if (existing.rows.length > 0) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            error: `This album was already recommended by ${existing.rows[0].username}`,
            recommended_by: existing.rows[0].username,
          });
        }

        // Generate unique ID for recommendation
        const _id = crypto.randomBytes(12).toString('hex');

        // Insert recommendation
        await client.query(
          `INSERT INTO recommendations (_id, year, album_id, recommended_by, reasoning, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [_id, year, albumId, req.user._id, trimmedReasoning]
        );

        await client.query('COMMIT');

        logger.info('Album recommended', {
          year,
          albumId,
          userId: req.user._id,
          username: req.user.username,
        });

        // Send Telegram notification (fire-and-forget)
        const telegramNotifier = app.locals.telegramNotifier;
        if (telegramNotifier?.sendRecommendationNotification) {
          // Fetch cover image from database for direct upload
          (async () => {
            try {
              let coverImage = null;
              const coverResult = await pool.query(
                'SELECT cover_image, cover_image_format FROM albums WHERE album_id = $1',
                [albumId]
              );
              if (
                coverResult.rows.length > 0 &&
                coverResult.rows[0].cover_image
              ) {
                const row = coverResult.rows[0];
                // Handle both BYTEA (Buffer) and legacy TEXT (base64 string) formats
                const imageBuffer = Buffer.isBuffer(row.cover_image)
                  ? row.cover_image
                  : Buffer.from(row.cover_image, 'base64');
                coverImage = {
                  buffer: imageBuffer,
                  format: row.cover_image_format || 'jpeg',
                };
              }

              await telegramNotifier.sendRecommendationNotification(
                {
                  artist: album.artist,
                  album: album.album,
                  album_id: albumId,
                  release_date: album.release_date,
                  year,
                  recommended_by: req.user.username,
                  reasoning: trimmedReasoning,
                },
                coverImage
              );
            } catch (err) {
              logger.warn('Failed to send Telegram notification', {
                error: err.message,
              });
            }
          })();
        }

        res.status(201).json({
          success: true,
          _id,
          album_id: albumId,
          year,
          recommended_by: req.user.username,
        });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      logger.error('Error adding recommendation', {
        error: err.message,
        year: req.params.year,
        userId: req.user._id,
      });
      res.status(500).json({ error: 'Database error' });
    }
  });

  /**
   * DELETE /api/recommendations/:year/:albumId
   * Remove a recommendation (admin only)
   */
  app.delete(
    '/api/recommendations/:year/:albumId',
    ensureAuthAPI,
    ensureAdmin,
    async (req, res) => {
      try {
        const year = validateYear(req.params.year);
        if (!year) {
          return res.status(400).json({ error: 'Invalid year' });
        }

        const { albumId } = req.params;
        if (!albumId) {
          return res.status(400).json({ error: 'Album ID required' });
        }

        const result = await pool.query(
          'DELETE FROM recommendations WHERE year = $1 AND album_id = $2 RETURNING _id',
          [year, albumId]
        );

        if (result.rows.length === 0) {
          return res.status(404).json({ error: 'Recommendation not found' });
        }

        logger.info('Admin action', {
          action: 'remove_recommendation',
          adminId: req.user._id,
          adminEmail: req.user.email,
          year,
          albumId,
          ip: req.ip,
        });

        res.json({
          success: true,
          removed: true,
          year,
          albumId,
        });
      } catch (err) {
        logger.error('Error removing recommendation', {
          error: err.message,
          year: req.params.year,
          albumId: req.params.albumId,
          adminId: req.user._id,
        });
        res.status(500).json({ error: 'Database error' });
      }
    }
  );

  /**
   * PATCH /api/recommendations/:year/:albumId/reasoning
   * Edit reasoning for a recommendation (only the original recommender can edit)
   */
  app.patch(
    '/api/recommendations/:year/:albumId/reasoning',
    ensureAuthAPI,
    async (req, res) => {
      try {
        const year = validateYear(req.params.year);
        if (!year) {
          return res.status(400).json({ error: 'Invalid year' });
        }

        const { albumId } = req.params;
        if (!albumId) {
          return res.status(400).json({ error: 'Album ID required' });
        }

        const { reasoning } = req.body;
        if (!reasoning || typeof reasoning !== 'string' || !reasoning.trim()) {
          return res.status(400).json({ error: 'Reasoning is required' });
        }

        const trimmedReasoning = reasoning.trim();
        if (trimmedReasoning.length > 500) {
          return res
            .status(400)
            .json({ error: 'Reasoning must be 500 characters or less' });
        }

        // Check if recommendation exists and user is the recommender
        const existing = await pool.query(
          'SELECT recommended_by FROM recommendations WHERE year = $1 AND album_id = $2',
          [year, albumId]
        );

        if (existing.rows.length === 0) {
          return res.status(404).json({ error: 'Recommendation not found' });
        }

        if (existing.rows[0].recommended_by !== req.user._id) {
          return res.status(403).json({
            error: 'Only the original recommender can edit reasoning',
          });
        }

        // Update reasoning
        await pool.query(
          'UPDATE recommendations SET reasoning = $1 WHERE year = $2 AND album_id = $3',
          [trimmedReasoning, year, albumId]
        );

        logger.info('Recommendation reasoning updated', {
          year,
          albumId,
          userId: req.user._id,
          username: req.user.username,
        });

        res.json({
          success: true,
          year,
          albumId,
          reasoning: trimmedReasoning,
        });
      } catch (err) {
        logger.error('Error updating recommendation reasoning', {
          error: err.message,
          year: req.params.year,
          albumId: req.params.albumId,
          userId: req.user._id,
        });
        res.status(500).json({ error: 'Database error' });
      }
    }
  );

  // ============ STATUS ENDPOINT ============

  /**
   * GET /api/recommendations/:year/status
   * Get lock status and access info for a year
   */
  app.get(
    '/api/recommendations/:year/status',
    ensureAuthAPI,
    async (req, res) => {
      try {
        const year = validateYear(req.params.year);
        if (!year) {
          return res.status(400).json({ error: 'Invalid year' });
        }

        const locked = await isRecommendationsLocked(year);
        const hasAccess = await hasRecommendationAccess(year, req.user._id);

        // Get count
        const countResult = await pool.query(
          'SELECT COUNT(*) as count FROM recommendations WHERE year = $1',
          [year]
        );

        res.json({
          year,
          locked,
          hasAccess,
          count: parseInt(countResult.rows[0].count, 10),
        });
      } catch (err) {
        logger.error('Error fetching recommendation status', {
          error: err.message,
          year: req.params.year,
        });
        res.status(500).json({ error: 'Database error' });
      }
    }
  );

  // ============ LOCK/UNLOCK ENDPOINTS ============

  /**
   * POST /api/recommendations/:year/lock
   * Lock recommendations for a year (admin only)
   */
  app.post(
    '/api/recommendations/:year/lock',
    ensureAuthAPI,
    ensureAdmin,
    async (req, res) => {
      try {
        const year = validateYear(req.params.year);
        if (!year) {
          return res.status(400).json({ error: 'Invalid year' });
        }

        await pool.query(
          `INSERT INTO recommendation_settings (year, locked, created_at, updated_at)
           VALUES ($1, TRUE, NOW(), NOW())
           ON CONFLICT (year) DO UPDATE SET
             locked = TRUE,
             updated_at = NOW()`,
          [year]
        );

        logger.info('Admin action', {
          action: 'lock_recommendations',
          adminId: req.user._id,
          adminEmail: req.user.email,
          year,
          ip: req.ip,
        });

        res.json({ success: true, year, locked: true });
      } catch (err) {
        logger.error('Error locking recommendations', {
          error: err.message,
          year: req.params.year,
          adminId: req.user._id,
        });
        res.status(500).json({ error: 'Database error' });
      }
    }
  );

  /**
   * POST /api/recommendations/:year/unlock
   * Unlock recommendations for a year (admin only)
   */
  app.post(
    '/api/recommendations/:year/unlock',
    ensureAuthAPI,
    ensureAdmin,
    async (req, res) => {
      try {
        const year = validateYear(req.params.year);
        if (!year) {
          return res.status(400).json({ error: 'Invalid year' });
        }

        await pool.query(
          `INSERT INTO recommendation_settings (year, locked, created_at, updated_at)
           VALUES ($1, FALSE, NOW(), NOW())
           ON CONFLICT (year) DO UPDATE SET
             locked = FALSE,
             updated_at = NOW()`,
          [year]
        );

        logger.info('Admin action', {
          action: 'unlock_recommendations',
          adminId: req.user._id,
          adminEmail: req.user.email,
          year,
          ip: req.ip,
        });

        res.json({ success: true, year, locked: false });
      } catch (err) {
        logger.error('Error unlocking recommendations', {
          error: err.message,
          year: req.params.year,
          adminId: req.user._id,
        });
        res.status(500).json({ error: 'Database error' });
      }
    }
  );

  /**
   * GET /api/recommendations/locked-years
   * Get all years with locked recommendations
   */
  app.get(
    '/api/recommendations/locked-years',
    ensureAuthAPI,
    async (req, res) => {
      try {
        const result = await pool.query(
          `SELECT year FROM recommendation_settings WHERE locked = TRUE ORDER BY year DESC`
        );

        res.json({ years: result.rows.map((r) => r.year) });
      } catch (err) {
        logger.error('Error fetching locked recommendation years', {
          error: err.message,
        });
        res.status(500).json({ error: 'Database error' });
      }
    }
  );

  // ============ ACCESS CONTROL ENDPOINTS ============

  /**
   * GET /api/recommendations/:year/access
   * Get users with access to recommendations for a year (admin only)
   */
  app.get(
    '/api/recommendations/:year/access',
    ensureAuthAPI,
    ensureAdmin,
    async (req, res) => {
      try {
        const year = validateYear(req.params.year);
        if (!year) {
          return res.status(400).json({ error: 'Invalid year' });
        }

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

        // Check if access is restricted (any entries exist)
        const isRestricted = result.rows.length > 0;

        res.json({
          year,
          isRestricted,
          users: result.rows.map((row) => ({
            user_id: row.user_id,
            username: row.username,
            email: row.email,
            added_at: row.added_at,
            added_by: row.added_by_username,
          })),
        });
      } catch (err) {
        logger.error('Error fetching recommendation access', {
          error: err.message,
          year: req.params.year,
        });
        res.status(500).json({ error: 'Database error' });
      }
    }
  );

  /**
   * PUT /api/recommendations/:year/access
   * Set users with access to recommendations (admin only)
   * Pass empty array to allow all authenticated users
   */
  app.put(
    '/api/recommendations/:year/access',
    ensureAuthAPI,
    ensureAdmin,
    async (req, res) => {
      try {
        const year = validateYear(req.params.year);
        if (!year) {
          return res.status(400).json({ error: 'Invalid year' });
        }

        const { userIds } = req.body;
        if (!Array.isArray(userIds)) {
          return res.status(400).json({ error: 'userIds must be an array' });
        }

        const client = await pool.connect();
        try {
          await client.query('BEGIN');

          // Clear existing access for this year
          await client.query(
            'DELETE FROM recommendation_access WHERE year = $1',
            [year]
          );

          // Insert new access entries
          if (userIds.length > 0) {
            const values = userIds
              .map((_, i) => `($1, $${i + 2}, $${userIds.length + 2}, NOW())`)
              .join(', ');
            await client.query(
              `INSERT INTO recommendation_access (year, user_id, added_by, added_at)
               VALUES ${values}`,
              [year, ...userIds, req.user._id]
            );
          }

          await client.query('COMMIT');

          logger.info('Admin action', {
            action: 'set_recommendation_access',
            adminId: req.user._id,
            adminEmail: req.user.email,
            year,
            userCount: userIds.length,
            ip: req.ip,
          });

          res.json({
            success: true,
            year,
            isRestricted: userIds.length > 0,
            userCount: userIds.length,
          });
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      } catch (err) {
        logger.error('Error setting recommendation access', {
          error: err.message,
          year: req.params.year,
          adminId: req.user._id,
        });
        res.status(500).json({ error: 'Database error' });
      }
    }
  );

  /**
   * GET /api/recommendations/:year/eligible-users
   * Get all approved users for access selection UI (admin only)
   */
  app.get(
    '/api/recommendations/:year/eligible-users',
    ensureAuthAPI,
    ensureAdmin,
    async (req, res) => {
      try {
        const year = validateYear(req.params.year);
        if (!year) {
          return res.status(400).json({ error: 'Invalid year' });
        }

        // Get all approved users with their current access status
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

        res.json({
          year,
          users: result.rows.map((row) => ({
            user_id: row.user_id,
            username: row.username,
            email: row.email,
            has_access: row.has_access,
          })),
        });
      } catch (err) {
        logger.error('Error fetching eligible users for recommendations', {
          error: err.message,
          year: req.params.year,
        });
        res.status(500).json({ error: 'Database error' });
      }
    }
  );
};
