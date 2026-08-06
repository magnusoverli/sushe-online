/**
 * Admin Album Summary Routes
 *
 * Handles batch fetching of album summaries from Claude API:
 * - /api/admin/album-summaries/stats - Get statistics
 * - /api/admin/album-summaries/status - Get batch job status
 * - /api/admin/album-summaries/fetch - Start batch fetch
 * - /api/admin/album-summaries/stop - Stop batch fetch
 * - /api/admin/album-summaries/regenerate - Regenerate one album's summary
 */

const logger = require('../../utils/logger');
const { createAlbumSummaryService } = require('../../services/album-summary');
const { responseCache } = require('../../middleware/response-cache');

/**
 * Reasons that mean the summary service failed, not that the album is obscure.
 *
 * Anything absent from this map is a genuine "nothing was found" and is
 * reported as such.
 */
const SERVICE_FAULTS = {
  not_configured: 'Claude is not configured — ANTHROPIC_API_KEY is missing',
  api_error: 'The Claude API call failed. Check the server logs for details.',
  unfinished: 'Claude did not finish the summary. Try again.',
  empty_response: 'Claude returned no usable content. Try again.',
};

module.exports = (app, deps) => {
  const { ensureAuth, ensureAdmin, db } = deps;

  // Create album summary service instance
  const albumSummaryService = createAlbumSummaryService({
    db,
    logger,
    responseCache,
    broadcast: app.locals.broadcast,
  });

  // Expose service for use by other modules (e.g., api.js for new album triggers)
  app.locals.albumSummaryService = albumSummaryService;

  // Get album summary statistics
  app.get(
    '/api/admin/album-summaries/stats',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const stats = await albumSummaryService.getStats();
        const batchStatus = albumSummaryService.getBatchStatus();
        res.json({ stats, batchStatus });
      } catch (error) {
        logger.error('Error fetching album summary stats', {
          error: error.message,
        });
        res.status(500).json({ error: 'Failed to fetch stats' });
      }
    }
  );

  // Get batch job status
  app.get(
    '/api/admin/album-summaries/status',
    ensureAuth,
    ensureAdmin,
    (req, res) => {
      const status = albumSummaryService.getBatchStatus();
      res.json({ status });
    }
  );

  // Start batch fetch job
  app.post(
    '/api/admin/album-summaries/fetch',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const { includeRetries, regenerateAll } = req.body;

        // Check if already running
        const currentStatus = albumSummaryService.getBatchStatus();
        if (currentStatus?.running) {
          return res.status(409).json({
            error: 'Batch job already running',
            status: currentStatus,
          });
        }

        logger.info('Admin started album summary batch fetch', {
          adminUsername: req.user.username,
          adminId: req.user._id,
          includeRetries: !!includeRetries,
          regenerateAll: !!regenerateAll,
        });

        await albumSummaryService.startBatchFetch({
          includeRetries,
          regenerateAll,
        });

        res.json({
          success: true,
          message: 'Batch fetch started',
          status: albumSummaryService.getBatchStatus(),
        });
      } catch (error) {
        logger.error('Error starting album summary batch fetch', {
          error: error.message,
          adminId: req.user._id,
        });
        res.status(500).json({ error: error.message });
      }
    }
  );

  // Stop batch fetch job
  app.post(
    '/api/admin/album-summaries/stop',
    ensureAuth,
    ensureAdmin,
    (req, res) => {
      const stopped = albumSummaryService.stopBatchFetch();

      logger.info('Admin stopped album summary batch fetch', {
        adminUsername: req.user.username,
        adminId: req.user._id,
        wasStopped: stopped,
      });

      res.json({
        success: true,
        stopped,
        status: albumSummaryService.getBatchStatus(),
      });
    }
  );

  // Regenerate the summary for a single album, synchronously.
  //
  // Deliberately not routed through the batch machinery: this is one album the
  // admin is watching, so the caller waits for the real outcome instead of
  // polling a job. Its cost is a single API call, which is why it needs no
  // confirmation step the way "Regenerate All" does.
  app.post(
    '/api/admin/album-summaries/regenerate',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      const { albumId } = req.body || {};

      if (!albumId || typeof albumId !== 'string') {
        return res.status(400).json({ error: 'albumId is required' });
      }

      // A batch writes the same rows, so let it finish rather than have the two
      // races overwrite each other's work on this album.
      if (albumSummaryService.getBatchStatus()?.running) {
        return res.status(409).json({
          error: 'A batch summary job is running. Stop it first.',
        });
      }

      try {
        const result = await albumSummaryService.fetchAndStoreSummary(albumId, {
          // Do not trade a good stored summary for a failed retry.
          keepExistingOnEmpty: true,
        });

        logger.info('Admin regenerated a single album summary', {
          adminUsername: req.user.username,
          adminId: req.user._id,
          albumId,
          success: result.success,
          hasSummary: result.hasSummary,
        });

        if (!result.success) {
          // 'Album not found' is the caller's mistake; anything else is ours.
          const notFound = result.error === 'Album not found';
          return res.status(notFound ? 404 : 502).json({
            status: 'failed',
            error: result.error || 'Summary regeneration failed',
          });
        }

        // Succeeded as an operation, but produced no usable summary — a
        // distinct outcome from both success and failure, and the one the
        // admin most needs named rather than guessed at.
        if (!result.hasSummary) {
          if (result.skipped) {
            return res.json({
              status: 'skipped',
              message: 'Album is missing artist or title, so it was skipped',
            });
          }

          // The service swallows its own errors and returns "no summary" for a
          // missing API key, a rejected request and a timeout alike. Reporting
          // those as "no summary found" blames the album for a fault that has
          // nothing to do with it, so they are named and surfaced as failures.
          const serviceFault = SERVICE_FAULTS[result.reason];
          if (serviceFault) {
            return res.status(502).json({
              status: 'failed',
              error: serviceFault,
            });
          }

          return res.json({
            status: 'no_summary',
            message: 'No summary could be found for this album',
          });
        }

        const summaryRow = await db.raw(
          'SELECT summary FROM albums WHERE album_id = $1',
          [albumId]
        );

        res.json({
          status: 'ok',
          source: result.source,
          summary: summaryRow.rows[0]?.summary || null,
        });
      } catch (error) {
        logger.error('Error regenerating album summary', {
          error: error.message,
          stack: error.stack,
          albumId,
          adminId: req.user._id,
        });
        res.status(500).json({
          status: 'failed',
          error: 'Summary regeneration failed',
        });
      }
    }
  );

  return { albumSummaryService };
};
