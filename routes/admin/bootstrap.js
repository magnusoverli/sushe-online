/**
 * Admin bootstrap route
 *
 * Provides a single payload for the admin settings drawer to avoid
 * multi-request waterfalls and reduce UI loading transitions.
 */

const logger = require('../../utils/logger');
const { createStatsService } = require('../../services/stats-service');
const { createAdminEventService } = require('../../services/admin-events');
const { createAggregateList } = require('../../services/aggregate-list');
const { createTelegramNotifier } = require('../../services/telegram');

function createDefaultAggregateStatus() {
  return {
    exists: false,
    revealed: false,
    locked: false,
    confirmations: [],
    confirmationCount: 0,
    requiredConfirmations: 2,
  };
}

function buildAggregateLists({ years, statusByYear, recByYear }) {
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

async function getAggregateStatuses(pool, years) {
  if (!Array.isArray(years) || years.length === 0) {
    return new Map();
  }

  const [masterListsResult, confirmationsResult] = await Promise.all([
    pool.query(
      `SELECT year, revealed, revealed_at, computed_at, COALESCE(locked, FALSE) AS locked, stats
       FROM master_lists
       WHERE year = ANY($1::int[])`,
      [years]
    ),
    pool.query(
      `SELECT c.year, c.confirmed_at, u.username
       FROM master_list_confirmations c
       JOIN users u ON c.admin_user_id = u._id
       WHERE c.year = ANY($1::int[])
       ORDER BY c.year, c.confirmed_at`,
      [years]
    ),
  ]);

  const confirmationsByYear = new Map();
  for (const row of confirmationsResult.rows) {
    const list = confirmationsByYear.get(row.year) || [];
    list.push({ username: row.username, confirmedAt: row.confirmed_at });
    confirmationsByYear.set(row.year, list);
  }

  const statusByYear = new Map();
  for (const row of masterListsResult.rows) {
    const confirmations = confirmationsByYear.get(row.year) || [];
    const rawStats = row.stats || null;
    statusByYear.set(row.year, {
      exists: true,
      revealed: row.revealed,
      revealedAt: row.revealed_at,
      computedAt: row.computed_at,
      locked: row.locked,
      totalAlbums: rawStats?.totalAlbums || 0,
      rankDistribution: rawStats?.rankDistribution || {},
      confirmations,
      confirmationCount: confirmations.length,
      requiredConfirmations: 2,
      rawStats,
    });
  }

  for (const year of years) {
    if (!statusByYear.has(year)) {
      statusByYear.set(year, createDefaultAggregateStatus());
    }
  }

  return statusByYear;
}

async function getRecommendationStatuses(pool, years, userId) {
  if (!Array.isArray(years) || years.length === 0) {
    return new Map();
  }

  const [settingsResult, accessCountResult, userAccessResult, recCountResult] =
    await Promise.all([
      pool.query(
        `SELECT year, locked
         FROM recommendation_settings
         WHERE year = ANY($1::int[])`,
        [years]
      ),
      pool.query(
        `SELECT year, COUNT(*)::int AS count
         FROM recommendation_access
         WHERE year = ANY($1::int[])
         GROUP BY year`,
        [years]
      ),
      pool.query(
        `SELECT year
         FROM recommendation_access
         WHERE year = ANY($1::int[])
           AND user_id = $2`,
        [years, userId]
      ),
      pool.query(
        `SELECT year, COUNT(*)::int AS count
         FROM recommendations
         WHERE year = ANY($1::int[])
         GROUP BY year`,
        [years]
      ),
    ]);

  const lockedByYear = new Map(
    settingsResult.rows.map((row) => [row.year, row.locked === true])
  );
  const accessCountByYear = new Map(
    accessCountResult.rows.map((row) => [row.year, row.count])
  );
  const userAccessYears = new Set(userAccessResult.rows.map((row) => row.year));
  const recommendationCountByYear = new Map(
    recCountResult.rows.map((row) => [row.year, row.count])
  );

  const recommendationStatusByYear = new Map();
  for (const year of years) {
    const accessCount = accessCountByYear.get(year) || 0;
    recommendationStatusByYear.set(year, {
      year,
      locked: lockedByYear.get(year) || false,
      hasAccess: accessCount === 0 || userAccessYears.has(year),
      count: recommendationCountByYear.get(year) || 0,
    });
  }

  return recommendationStatusByYear;
}

module.exports = (app, deps) => {
  const { ensureAuth, ensureAdmin, pool, usersAsync, listsAsync } = deps;

  const statsService = createStatsService({ usersAsync, listsAsync });
  const adminEventService = createAdminEventService({
    db: usersAsync,
    logger,
  });
  const aggregateListService = createAggregateList({ pool, logger });

  app.get('/api/admin/bootstrap', ensureAuth, ensureAdmin, async (req, res) => {
    try {
      const telegramNotifier =
        app.locals.telegramNotifier || createTelegramNotifier({ pool, logger });
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
          getAggregateStatuses(pool, years),
          getRecommendationStatuses(pool, years, req.user._id),
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
