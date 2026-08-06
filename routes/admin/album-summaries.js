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
const {
  createAlbumSummaryConfig,
  EFFORT_LEVELS,
} = require('../../services/album-summary-config');
const { listAvailableModels } = require('../../utils/claude-summary');

/**
 * Reasons that mean the summary service failed, not that the album is obscure.
 *
 * Anything absent from this map is a genuine "nothing was found" and is
 * reported as such.
 */
const SERVICE_FAULTS = {
  not_configured: 'Claude is not configured — ANTHROPIC_API_KEY is missing',
  auth_error: 'Claude rejected the API key',
  rate_limited: 'Claude rate-limited the request. Try again shortly.',
  overloaded: 'Claude is overloaded. Try again shortly.',
  upstream_error: 'Claude returned a server error. Try again.',
  timeout: 'Claude did not respond in time',
  api_error: 'The Claude API call failed',
  unfinished: 'Claude did not finish the summary. Try again.',
  empty_response: 'Claude returned no usable content. Try again.',
};

/**
 * Turn a fetchAndStoreSummary result into the outcome an admin polls for.
 *
 * The three not-found cases are kept apart on purpose: an album that was
 * skipped, a service that broke, and an album genuinely nobody has written
 * about call for three different reactions.
 *
 * @param {{success: boolean, hasSummary: boolean, skipped?: boolean,
 *   reason?: string, reasonDetail?: string, error?: string,
 *   source?: string|null}} result
 * @returns {{status: string, message?: string, source?: string|null}}
 */
function describeOutcome(result) {
  if (!result.success) {
    return {
      status: 'failed',
      message: result.error || 'Summary regeneration failed',
    };
  }

  if (result.hasSummary) {
    return { status: 'ok', source: result.source ?? null };
  }

  if (result.skipped) {
    return {
      status: 'skipped',
      message: 'Album is missing artist or title, so it was skipped',
    };
  }

  const serviceFault = SERVICE_FAULTS[result.reason];
  if (serviceFault) {
    // The detail carries the status and the API's own words, which is the
    // difference between an admin knowing what to do next and being told to go
    // read a log they may not have access to.
    return {
      status: 'failed',
      message: result.reasonDetail
        ? `${serviceFault} (${result.reasonDetail})`
        : serviceFault,
    };
  }

  return {
    status: 'no_summary',
    message: 'No summary could be found for this album',
  };
}

module.exports = (app, deps) => {
  const { ensureAuth, ensureAdmin, db } = deps;

  // One config store, shared with the service, so a saved change is visible to
  // the next summary immediately rather than after its cache expires.
  const summaryConfig = createAlbumSummaryConfig({ db, logger });

  // Create album summary service instance
  const albumSummaryService = createAlbumSummaryService({
    db,
    logger,
    responseCache,
    broadcast: app.locals.broadcast,
    summaryConfig,
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

  /** Outcome of the most recent regeneration per album, awaiting collection. */
  const regenerations = new Map();

  /**
   * Resolve one album's regeneration and record the outcome for polling.
   *
   * Never rejects: the outcome is the product, and an unhandled rejection in a
   * detached job would take the process down.
   */
  async function runRegeneration(albumId, adminId) {
    try {
      const result = await albumSummaryService.fetchAndStoreSummary(albumId, {
        // Do not trade a good stored summary for a failed retry.
        keepExistingOnEmpty: true,
      });

      logger.info('Single album summary regeneration finished', {
        albumId,
        adminId,
        success: result.success,
        hasSummary: result.hasSummary,
        reason: result.reason,
      });

      regenerations.set(albumId, describeOutcome(result));
    } catch (error) {
      logger.error('Error regenerating album summary', {
        error: error.message,
        stack: error.stack,
        albumId,
        adminId,
      });
      regenerations.set(albumId, {
        status: 'failed',
        message: 'Summary regeneration failed',
      });
    }
  }

  // Regenerate the summary for a single album.
  //
  // Start-and-poll rather than a blocking request, for one reason: a Sonnet 5
  // summary takes 17-120s, and holding an HTTP connection open that long puts
  // the result at the mercy of whatever gateway sits in front of the app.
  // Behind a proxy with a 30-60s timeout the caller gets a 502 with an HTML
  // body while the work is still running perfectly well, which is exactly what
  // happened. The batch endpoints already work this way.
  //
  // Job state is in-memory and keyed by album, matching the batch job's own
  // assumption of a single app process. A restart loses a running job; the
  // client stops polling on a 404 and says so.
  app.post(
    '/api/admin/album-summaries/regenerate',
    ensureAuth,
    ensureAdmin,
    (req, res) => {
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

      if (regenerations.get(albumId)?.status === 'running') {
        return res.status(202).json({ status: 'running' });
      }

      regenerations.set(albumId, { status: 'running' });

      logger.info('Admin started a single album summary regeneration', {
        adminUsername: req.user.username,
        adminId: req.user._id,
        albumId,
      });

      runRegeneration(albumId, req.user._id);

      // 202: accepted and started, outcome to follow on the status endpoint.
      res.status(202).json({ status: 'running' });
    }
  );

  // Poll the outcome of a regeneration.
  app.get(
    '/api/admin/album-summaries/regenerate/status',
    ensureAuth,
    ensureAdmin,
    (req, res) => {
      const albumId = String(req.query.albumId || '');
      const job = regenerations.get(albumId);

      if (!job) {
        return res
          .status(404)
          .json({ error: 'No regeneration for this album' });
      }

      // Settled jobs are read once and dropped, so the map cannot grow without
      // bound and a later run never reads a stale outcome.
      if (job.status !== 'running') {
        regenerations.delete(albumId);
      }

      res.json(job);
    }
  );

  // Models this API key can use, plus the configuration in force.
  app.get(
    '/api/admin/album-summaries/models',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      const config = await summaryConfig.getConfig();
      try {
        res.json({ models: await listAvailableModels(), config });
      } catch (error) {
        // Still return the configuration: the admin needs to see what is in
        // force even when the model list cannot be fetched.
        logger.warn('Could not list Claude models', { error: error.message });
        res.json({ models: [], config, error: error.message });
      }
    }
  );

  // Save the summary model configuration.
  app.post(
    '/api/admin/album-summaries/config',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      const { model, effort, maxTokens } = req.body || {};

      try {
        const saved = await summaryConfig.saveConfig(
          { model, effort, maxTokens },
          req.user._id
        );

        logger.info('Admin changed the album summary configuration', {
          adminUsername: req.user.username,
          adminId: req.user._id,
          model: saved.model,
          effort: saved.effort,
          maxTokens: saved.maxTokens,
        });

        res.json({ config: saved });
      } catch (error) {
        // Validation faults are the caller's; anything else is ours.
        const invalid =
          error.message.includes('required') ||
          error.message.includes('must be');
        if (!invalid) {
          logger.error('Failed to save album summary configuration', {
            error: error.message,
            adminId: req.user._id,
          });
        }
        res.status(invalid ? 400 : 500).json({
          error: invalid ? error.message : 'Failed to save configuration',
          effortLevels: invalid ? EFFORT_LEVELS : undefined,
        });
      }
    }
  );

  return { albumSummaryService, summaryConfig };
};
