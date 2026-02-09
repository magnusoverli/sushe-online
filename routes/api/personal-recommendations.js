// routes/api/personal-recommendations.js
// API endpoints for personal weekly album recommendations

module.exports = (app, deps) => {
  const { ensureAuthAPI, personalRecsService, logger: log } = deps;

  if (!personalRecsService) {
    // Service not initialized - skip route registration
    return;
  }

  // =========================================================================
  // User endpoints (require authentication)
  // =========================================================================

  /**
   * GET /api/personal-recommendations
   * Get the user's recommendation lists (max 2: current + last week)
   */
  app.get(
    '/api/personal-recommendations',
    ensureAuthAPI,
    async (req, res, next) => {
      try {
        const lists = await personalRecsService.getListsForUser(req.user._id);
        res.json({ success: true, lists });
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * GET /api/personal-recommendations/prompts
   * Get the user's prompt settings
   * NOTE: This route must be before /:listId to avoid conflict
   */
  app.get(
    '/api/personal-recommendations/prompts',
    ensureAuthAPI,
    async (req, res, next) => {
      try {
        const settings = await personalRecsService.getUserPromptSettings(
          req.user._id
        );
        res.json({ success: true, ...settings });
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * PUT /api/personal-recommendations/prompts
   * Update the user's prompt settings
   */
  app.put(
    '/api/personal-recommendations/prompts',
    ensureAuthAPI,
    async (req, res, next) => {
      try {
        const { customPrompt, isEnabled } = req.body;

        // Validate
        if (customPrompt !== undefined && typeof customPrompt !== 'string') {
          return res
            .status(400)
            .json({ success: false, error: 'customPrompt must be a string' });
        }

        if (customPrompt !== undefined && customPrompt.length > 1000) {
          return res.status(400).json({
            success: false,
            error: 'customPrompt must be 1000 characters or less',
          });
        }

        if (isEnabled !== undefined && typeof isEnabled !== 'boolean') {
          return res
            .status(400)
            .json({ success: false, error: 'isEnabled must be a boolean' });
        }

        await personalRecsService.updateUserPromptSettings(req.user._id, {
          customPrompt,
          isEnabled,
        });

        res.json({ success: true });
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * GET /api/personal-recommendations/:listId
   * Get a specific recommendation list
   */
  app.get(
    '/api/personal-recommendations/:listId',
    ensureAuthAPI,
    async (req, res, next) => {
      try {
        const list = await personalRecsService.getListById(
          req.params.listId,
          req.user._id
        );

        if (!list) {
          return res
            .status(404)
            .json({ success: false, error: 'List not found' });
        }

        res.json({ success: true, list, items: list.items || [] });
      } catch (err) {
        next(err);
      }
    }
  );

  // =========================================================================
  // Admin endpoints
  // =========================================================================

  function getCurrentWeekStart() {
    const now = new Date();
    const day = now.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + mondayOffset);
    return monday.toISOString().split('T')[0];
  }

  /**
   * POST /api/admin/personal-recommendations/generate
   * Trigger generation for all eligible users (admin only, fire-and-forget)
   */
  app.post(
    '/api/admin/personal-recommendations/generate',
    ensureAuthAPI,
    async (req, res, next) => {
      try {
        if (req.user.role !== 'admin') {
          return res
            .status(403)
            .json({ success: false, error: 'Admin access required' });
        }

        const weekStart = getCurrentWeekStart();

        // Run async (don't block response), force regeneration for stale lists
        personalRecsService
          .generateForAllUsers(weekStart, { force: true })
          .catch((err) => {
            log.error('Admin-triggered generation failed', {
              error: err.message,
            });
          });

        res.json({
          success: true,
          message: 'Generation started',
          weekStart,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * GET /api/admin/personal-recommendations/generate/stream
   * SSE endpoint: trigger generation and stream progress logs (admin only)
   */
  app.get(
    '/api/admin/personal-recommendations/generate/stream',
    ensureAuthAPI,
    async (req, res) => {
      if (req.user.role !== 'admin') {
        return res
          .status(403)
          .json({ success: false, error: 'Admin access required' });
      }

      // Set up SSE headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const weekStart = getCurrentWeekStart();
      const startTime = Date.now();

      function sendEvent(type, data) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const payload = { ...data, elapsed: `${elapsed}s` };
        res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
      }

      sendEvent('log', {
        message: `Generation started for week ${weekStart}`,
      });

      let aborted = false;
      req.on('close', () => {
        aborted = true;
      });

      try {
        // Rotate old data first
        sendEvent('log', { message: 'Rotating old recommendation data...' });
        await personalRecsService.rotateAndCleanup(weekStart);
        sendEvent('log', { message: 'Rotation complete' });

        // Generate with progress callback and force mode (regenerate stale lists)
        const result = await personalRecsService.generateForAllUsers(
          weekStart,
          {
            force: true,
            onProgress: (message, data) => {
              if (!aborted) {
                sendEvent('log', { message, ...data });
              }
            },
          }
        );

        if (!aborted) {
          sendEvent('complete', {
            message: 'Generation finished',
            ...result,
            weekStart,
          });
          res.write('event: done\ndata: {}\n\n');
          res.end();
        }
      } catch (err) {
        log.error('SSE generation failed', { error: err.message });
        if (!aborted) {
          sendEvent('error', { message: `Error: ${err.message}` });
          res.write('event: done\ndata: {}\n\n');
          res.end();
        }
      }
    }
  );

  /**
   * POST /api/admin/personal-recommendations/generate/:userId
   * Trigger generation for a single user (admin only)
   */
  app.post(
    '/api/admin/personal-recommendations/generate/:userId',
    ensureAuthAPI,
    async (req, res, next) => {
      try {
        if (req.user.role !== 'admin') {
          return res
            .status(403)
            .json({ success: false, error: 'Admin access required' });
        }

        const weekStart = getCurrentWeekStart();

        const force = req.body.force !== false; // Default to force for admin
        const result = await personalRecsService.generateForUser(
          req.params.userId,
          weekStart,
          { force }
        );

        res.json({ success: true, result, weekStart });
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * GET /api/admin/personal-recommendations/stats
   * Get aggregate stats for personal recommendations (admin only)
   */
  app.get(
    '/api/admin/personal-recommendations/stats',
    ensureAuthAPI,
    async (req, res, next) => {
      try {
        if (req.user.role !== 'admin') {
          return res
            .status(403)
            .json({ success: false, error: 'Admin access required' });
        }

        const pool_db = deps.pool;

        const [listsStats, poolStats, enabledUsers] = await Promise.all([
          pool_db.query(`
            SELECT
              COUNT(*) as total_lists,
              COUNT(*) FILTER (WHERE status = 'completed') as completed,
              COUNT(*) FILTER (WHERE status = 'failed') as failed,
              SUM(COALESCE(input_tokens, 0)) as total_input_tokens,
              SUM(COALESCE(output_tokens, 0)) as total_output_tokens
            FROM personal_recommendation_lists
            WHERE week_start >= (CURRENT_DATE - INTERVAL '14 days')
          `),
          pool_db.query(`
            SELECT source, COUNT(*) as count
            FROM weekly_new_releases
            WHERE week_start >= (CURRENT_DATE - INTERVAL '14 days')
            GROUP BY source
          `),
          pool_db.query(`
            SELECT COUNT(*) as count
            FROM personal_recommendation_prompts
            WHERE is_enabled = TRUE
          `),
        ]);

        res.json({
          success: true,
          stats: {
            lists: listsStats.rows[0],
            poolBySource: poolStats.rows,
            enabledUsers: parseInt(enabledUsers.rows[0].count, 10),
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );
};
