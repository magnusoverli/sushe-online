/**
 * Admin Audit Routes
 * Handles aggregate list audit and manual album reconciliation
 */

const { createAggregateAudit } = require('../../services/aggregate-audit');
const { validateYearParam } = require('../../middleware/validate-params');

module.exports = (app, deps) => {
  const { ensureAuth, ensureAdmin } = deps;
  const logger = require('../../utils/logger');

  // Create aggregate audit instance
  const aggregateAudit = createAggregateAudit({ pool: deps.pool, logger });

  // Shared helper: recompute aggregate lists for affected years
  async function recomputeAffectedYears(affectedYears) {
    if (!affectedYears || affectedYears.length === 0) return [];

    const { createAggregateList } = require('../../services/aggregate-list');
    const aggregateList = createAggregateList({ pool: deps.pool, logger });

    const results = [];
    for (const year of affectedYears) {
      try {
        await aggregateList.recompute(year);
        results.push({ year, success: true });
        logger.info(`Recomputed aggregate list for ${year}`);
      } catch (recomputeErr) {
        results.push({ year, success: false, error: recomputeErr.message });
        logger.error(`Failed to recompute aggregate list for ${year}`, {
          error: recomputeErr.message,
        });
      }
    }
    return results;
  }

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
    validateYearParam,
    async (req, res) => {
      try {
        const year = req.validatedYear;
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
    validateYearParam,
    async (req, res) => {
      try {
        const year = req.validatedYear;
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
    validateYearParam,
    async (req, res) => {
      try {
        const year = req.validatedYear;
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
    validateYearParam,
    async (req, res) => {
      try {
        const year = req.validatedYear;
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
          result.recomputeResults = await recomputeAffectedYears(
            result.affectedYears
          );
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

        logger.info('Deleting orphaned album references', {
          albumId,
          adminId: req.user._id,
        });

        const result = await aggregateAudit.deleteOrphanedReferences(
          albumId,
          req.user._id
        );

        // Recompute affected aggregate lists
        const recomputeResults = await recomputeAffectedYears(
          result.affectedYears
        );

        res.json({
          success: true,
          ...result,
          recomputeResults,
        });
      } catch (error) {
        // Convert known validation errors to 400
        if (
          error.message.includes('manual album') ||
          error.message.includes('not orphaned')
        ) {
          return res.status(400).json({ error: error.message });
        }
        logger.error('Error deleting orphaned references', {
          error: error.message,
        });
        res.status(500).json({ error: error.message });
      }
    }
  );
};
