/**
 * Admin bootstrap route
 *
 * Provides a single payload for the admin settings drawer to avoid
 * multi-request waterfalls and reduce UI loading transitions.
 */

const logger = require('../../utils/logger');
const { createStatsService } = require('../../services/stats-service');
const { createAdminEventService } = require('../../services/admin-events');
const {
  createAdminBootstrapService,
} = require('../../services/admin-bootstrap-service');
const { createAggregateList } = require('../../services/aggregate-list');
const { createTelegramNotifier } = require('../../services/telegram');

function buildAggregateLists({
  years,
  statusByYear,
  recByYear,
  createDefaultAggregateStatus,
}) {
  return years.map((year) => {
    const status = statusByYear.get(year) || createDefaultAggregateStatus();
    const statusForResponse = { ...status };
    delete statusForResponse.rawStats;

    return {
      year,
      status: statusForResponse,
      stats: status.exists ? status.rawStats || null : null,
      recStatus: recByYear.get(year) || {
        year,
        locked: false,
        hasAccess: true,
        count: 0,
      },
    };
  });
}

module.exports = (app, deps) => {
  const { ensureAuth, ensureAdmin, db } = deps;

  const statsService = createStatsService({ db });
  const adminEventService = createAdminEventService({ db, logger });
  const adminBootstrapService = createAdminBootstrapService({ db });
  const aggregateListService = createAggregateList({ db, logger });

  app.get('/api/admin/bootstrap', ensureAuth, ensureAdmin, async (req, res) => {
    try {
      const telegramNotifier =
        app.locals.telegramNotifier || createTelegramNotifier({ db, logger });
      const albumSummaryService = app.locals.albumSummaryService;
      const imageRefetchService = app.locals.imageRefetchService;
      const catalogCleanupService = app.locals.catalogCleanupService;

      const [
        eventsResponse,
        eventsCounts,
        adminStats,
        telegramConfig,
        recThreads,
        years,
      ] = await Promise.all([
        adminEventService.getPendingEvents({ limit: 50, offset: 0 }),
        adminEventService.getPendingCountsByPriority(),
        statsService.getAdminStats(),
        telegramNotifier.getConfig(),
        telegramNotifier.getRecommendationThreads(),
        aggregateListService.getYearsWithMainLists(),
      ]);

      const [statusByYear, recByYear, summaryStats, imageStats] =
        await Promise.all([
          adminBootstrapService.getAggregateStatuses(years),
          adminBootstrapService.getRecommendationStatuses(years, req.user._id),
          albumSummaryService ? albumSummaryService.getStats() : null,
          imageRefetchService ? imageRefetchService.getStats() : null,
        ]);

      let catalogCleanupPreview = null;
      if (catalogCleanupService) {
        try {
          catalogCleanupPreview = await catalogCleanupService.getPreview({
            minAgeDays: 90,
            sampleLimit: 5,
          });
        } catch (cleanupPreviewError) {
          logger.warn(
            'Failed to include catalog cleanup preview in bootstrap',
            {
              error: cleanupPreviewError.message,
            }
          );
        }
      }

      const aggregateLists = buildAggregateLists({
        years,
        statusByYear,
        recByYear,
        createDefaultAggregateStatus:
          adminBootstrapService.createDefaultAggregateStatus,
      });

      const imageIsRunning = imageRefetchService
        ? imageRefetchService.isJobRunning()
        : false;

      res.json({
        hasData: true,
        events: {
          pending: eventsResponse.events || [],
          counts: eventsCounts || {
            total: 0,
            urgent: 0,
            high: 0,
            normal: 0,
            low: 0,
          },
        },
        telegram: telegramConfig
          ? {
              configured: true,
              enabled: telegramConfig.enabled,
              chatId: telegramConfig.chatId,
              chatTitle: telegramConfig.chatTitle,
              threadId: telegramConfig.threadId,
              topicName: telegramConfig.topicName,
              configuredAt: telegramConfig.configuredAt,
            }
          : { configured: false },
        telegramRecs: {
          configured: telegramConfig?.enabled || false,
          recommendationsEnabled:
            telegramConfig?.recommendationsEnabled || false,
          chatTitle: telegramConfig?.chatTitle || null,
          threads: recThreads || [],
        },
        stats: adminStats,
        users: adminStats?.users || [],
        aggregateLists,
        summaryStats: {
          stats: summaryStats || null,
          batchStatus: albumSummaryService
            ? albumSummaryService.getBatchStatus()
            : null,
        },
        imageStats: {
          stats: imageStats || null,
          isRunning: imageIsRunning,
          progress:
            imageRefetchService && imageIsRunning
              ? imageRefetchService.getProgress()
              : null,
        },
        catalogCleanupPreview,
      });
    } catch (error) {
      logger.error('Error fetching admin bootstrap payload', {
        error: error.message,
      });
      res.status(500).json({ error: 'Failed to fetch admin bootstrap data' });
    }
  });
};
