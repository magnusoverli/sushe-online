/**
 * Admin Audit Routes
 * Handles aggregate list audit and manual album reconciliation
 */

const { createAggregateAudit } = require('../../utils/aggregate-audit');

module.exports = (app, deps) => {
  const { ensureAuth, ensureAdmin } = deps;
  const logger = require('../../utils/logger');

  // Create aggregate audit instance
  const aggregateAudit = createAggregateAudit({ pool: deps.pool, logger });

  // ============ AGGREGATE LIST AUDIT ENDPOINTS ============

  /**
   * GET /api/admin/aggregate-audit/:year
   * Get audit report for a year's aggregate list
   * Shows albums with different album_ids that normalize to the same name
   */
  app.get(
    '/api/admin/aggregate-audit/:year',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const year = parseInt(req.params.year, 10);
        if (isNaN(year) || year < 1000 || year > 9999) {
          return res.status(400).json({ error: 'Invalid year' });
        }

        const report = await aggregateAudit.getAuditReport(year);
        res.json(report);
      } catch (error) {
        logger.error('Error running aggregate audit', {
          error: error.message,
          year: req.params.year,
        });
        res.status(500).json({ error: error.message });
      }
    }
  );

  /**
   * GET /api/admin/aggregate-audit/:year/preview
   * Preview what changes would be made to fix duplicates
   */
  app.get(
    '/api/admin/aggregate-audit/:year/preview',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const year = parseInt(req.params.year, 10);
        if (isNaN(year) || year < 1000 || year > 9999) {
          return res.status(400).json({ error: 'Invalid year' });
        }

        const preview = await aggregateAudit.previewFix(year);
        res.json(preview);
      } catch (error) {
        logger.error('Error previewing aggregate fix', {
          error: error.message,
          year: req.params.year,
        });
        res.status(500).json({ error: error.message });
      }
    }
  );

  /**
   * POST /api/admin/aggregate-audit/:year/fix
   * Execute the fix to normalize album_ids
   * Requires explicit confirmation in request body
   */
  app.post(
    '/api/admin/aggregate-audit/:year/fix',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const year = parseInt(req.params.year, 10);
        if (isNaN(year) || year < 1000 || year > 9999) {
          return res.status(400).json({ error: 'Invalid year' });
        }

        const { confirm, dryRun } = req.body;

        // Require explicit confirmation unless dry run
        if (!dryRun && confirm !== true) {
          return res.status(400).json({
            error: 'Confirmation required',
            message:
              'Set confirm: true in request body to execute the fix, or use dryRun: true to preview',
          });
        }

        const result = await aggregateAudit.executeFix(year, dryRun === true);

        logger.info('Aggregate audit fix executed', {
          year,
          dryRun: dryRun === true,
          changesApplied: result.changesApplied,
          adminId: req.user._id,
        });

        res.json(result);
      } catch (error) {
        logger.error('Error executing aggregate fix', {
          error: error.message,
          year: req.params.year,
        });
        res.status(500).json({ error: error.message });
      }
    }
  );

  /**
   * GET /api/admin/aggregate-audit/:year/diagnose
   * Diagnose normalization effectiveness for a year
   * Compares basic (lowercase+trim) vs sophisticated normalization
   * Shows albums that would be missed by basic normalization
   * and provides detailed overlap statistics
   */
  app.get(
    '/api/admin/aggregate-audit/:year/diagnose',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const year = parseInt(req.params.year, 10);
        if (isNaN(year) || year < 1000 || year > 9999) {
          return res.status(400).json({ error: 'Invalid year' });
        }

        const diagnostic = await aggregateAudit.diagnoseNormalization(year);
        res.json(diagnostic);
      } catch (error) {
        logger.error('Error running normalization diagnostic', {
          error: error.message,
          year: req.params.year,
        });
        res.status(500).json({ error: error.message });
      }
    }
  );

  // ============ MANUAL ALBUM RECONCILIATION ENDPOINTS ============

  /**
   * GET /api/admin/audit/manual-albums
   * Find manual albums that may match canonical albums
   * Returns list of manual albums with potential matches for admin review
   */
  app.get(
    '/api/admin/audit/manual-albums',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        // Parse threshold from query param, default to 0.15 (high sensitivity)
        const threshold = Math.max(
          0.03,
          Math.min(0.5, parseFloat(req.query.threshold) || 0.15)
        );
        const maxMatches = parseInt(req.query.maxMatches, 10) || 5;

        const result = await aggregateAudit.findManualAlbumsForReconciliation({
          threshold,
          maxMatchesPerAlbum: maxMatches,
        });

        res.json(result);
      } catch (error) {
        logger.error('Error finding manual albums for reconciliation', {
          error: error.message,
        });
        res.status(500).json({ error: error.message });
      }
    }
  );

  /**
   * POST /api/admin/audit/merge-album
   * Merge a manual album into a canonical album
   * Updates all list_items and optionally syncs metadata
   */
  app.post(
    '/api/admin/audit/merge-album',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const {
          manualAlbumId,
          canonicalAlbumId,
          syncMetadata = true,
        } = req.body;

        if (!manualAlbumId || !canonicalAlbumId) {
          return res.status(400).json({
            error: 'manualAlbumId and canonicalAlbumId are required',
          });
        }

        if (!manualAlbumId.startsWith('manual-')) {
          return res.status(400).json({
            error: 'manualAlbumId must be a manual album (manual-* prefix)',
          });
        }

        const result = await aggregateAudit.mergeManualAlbum(
          manualAlbumId,
          canonicalAlbumId,
          {
            syncMetadata,
            adminUserId: req.user._id,
          }
        );

        // Recompute aggregate lists for affected years
        if (result.affectedYears && result.affectedYears.length > 0) {
          const { createAggregateList } = require('../../utils/aggregate-list');
          const aggregateList = createAggregateList({
            pool: deps.pool,
            logger,
          });

          const recomputeResults = [];
          for (const year of result.affectedYears) {
            try {
              await aggregateList.recompute(year);
              recomputeResults.push({ year, success: true });
              logger.info(`Recomputed aggregate list for ${year} after merge`);
            } catch (recomputeErr) {
              recomputeResults.push({
                year,
                success: false,
                error: recomputeErr.message,
              });
              logger.error(`Failed to recompute aggregate list for ${year}`, {
                error: recomputeErr.message,
              });
            }
          }
          result.recomputeResults = recomputeResults;
        }

        logger.info('Manual album merged', {
          manualAlbumId,
          canonicalAlbumId,
          updatedListItems: result.updatedListItems,
          affectedYears: result.affectedYears,
          adminId: req.user._id,
        });

        res.json(result);
      } catch (error) {
        logger.error('Error merging manual album', {
          error: error.message,
          manualAlbumId: req.body?.manualAlbumId,
          canonicalAlbumId: req.body?.canonicalAlbumId,
        });
        res.status(500).json({ error: error.message });
      }
    }
  );

  /**
   * POST /api/admin/audit/delete-orphaned-references
   * Delete orphaned album references from list_items
   * (albums that don't exist in albums table)
   */
  app.post(
    '/api/admin/audit/delete-orphaned-references',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const { albumId } = req.body;

        if (!albumId || !albumId.startsWith('manual-')) {
          return res.status(400).json({
            error: 'albumId must be a manual album (manual-* prefix)',
          });
        }

        logger.info('Deleting orphaned album references', {
          albumId,
          adminId: req.user._id,
        });

        // Verify the album doesn't exist in albums table
        const albumCheck = await deps.pool.query(
          'SELECT album_id FROM albums WHERE album_id = $1',
          [albumId]
        );

        if (albumCheck.rows.length > 0) {
          return res.status(400).json({
            error: 'Album exists in albums table - not orphaned',
          });
        }

        // Get affected lists before deletion
        const affectedResult = await deps.pool.query(
          `
          SELECT DISTINCT 
            l._id as list_id,
            l.name as list_name,
            l.year,
            u.username
          FROM list_items li
          JOIN lists l ON li.list_id = l._id
          JOIN users u ON l.user_id = u._id
          WHERE li.album_id = $1
        `,
          [albumId]
        );

        const affectedLists = affectedResult.rows;
        const affectedYears = [...new Set(affectedLists.map((l) => l.year))];

        // Delete the orphaned references
        const deleteResult = await deps.pool.query(
          'DELETE FROM list_items WHERE album_id = $1',
          [albumId]
        );

        const deletedCount = deleteResult.rowCount;

        // Log admin event
        await deps.pool.query(
          `
          INSERT INTO admin_events (event_type, event_data, created_by)
          VALUES ($1, $2, $3)
        `,
          [
            'orphaned_album_deleted',
            JSON.stringify({
              albumId,
              deletedListItems: deletedCount,
              affectedLists: affectedLists.map((l) => l.list_name),
              affectedYears,
            }),
            req.user._id,
          ]
        );

        // Recompute affected aggregate lists
        if (affectedYears.length > 0) {
          const { createAggregateList } = require('../../utils/aggregate-list');
          const aggregateList = createAggregateList({
            pool: deps.pool,
            logger,
          });

          const recomputeResults = [];
          for (const year of affectedYears) {
            try {
              await aggregateList.recompute(year);
              recomputeResults.push({ year, success: true });
              logger.info(
                `Recomputed aggregate list for ${year} after orphan deletion`
              );
            } catch (recomputeErr) {
              recomputeResults.push({
                year,
                success: false,
                error: recomputeErr.message,
              });
              logger.error(`Failed to recompute aggregate list for ${year}`, {
                error: recomputeErr.message,
              });
            }
          }

          res.json({
            success: true,
            albumId,
            deletedListItems: deletedCount,
            affectedLists: affectedLists.map((l) => ({
              listId: l.list_id,
              listName: l.list_name,
              year: l.year,
              username: l.username,
            })),
            affectedYears,
            recomputeResults,
          });
        } else {
          res.json({
            success: true,
            albumId,
            deletedListItems: deletedCount,
            affectedLists: [],
            affectedYears: [],
          });
        }

        logger.info('Orphaned album references deleted', {
          albumId,
          deletedCount,
          affectedYears,
          adminId: req.user._id,
        });
      } catch (error) {
        logger.error('Error deleting orphaned references', {
          error: error.message,
        });
        res.status(500).json({ error: error.message });
      }
    }
  );
};
