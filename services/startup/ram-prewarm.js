const defaultLogger = require('../../utils/logger');
const { observeStartupPrewarm } = require('../../utils/metrics');
const { runDbPrewarm } = require('./db-prewarm');
const { coverVersion, warmCoverCache } = require('./cover-prewarm');

const USER_RESPONSE_TTL_MS = 5 * 60 * 1000;
const AGGREGATE_RESPONSE_TTL_MS = 10 * 60 * 1000;

async function observePhase(phase, log, fn) {
  const startedAt = Date.now();
  try {
    const result = await fn();
    observeStartupPrewarm(phase, Date.now() - startedAt, 'success');
    return result;
  } catch (error) {
    observeStartupPrewarm(phase, Date.now() - startedAt, 'error');
    log.warn('RAM prewarm phase failed', { phase, error: error.message });
    return { error };
  }
}

async function selectActiveUserIds(db, limit) {
  if (!limit) return [];

  const result = await db.raw(
    `SELECT u._id
     FROM users u
     WHERE EXISTS (
       SELECT 1 FROM lists l WHERE l.user_id = u._id
     )
     ORDER BY u.updated_at DESC NULLS LAST, u._id
     LIMIT $1`,
    [limit]
  );
  return result.rows.map((row) => row._id);
}

async function selectCoverWarmTargets(db, userIds, limit) {
  if (!limit || !Array.isArray(userIds) || userIds.length === 0) return [];

  const result = await db.raw(
    `SELECT li.album_id,
            COALESCE(a.cover_thumbnail_updated_at, a.cover_image_updated_at, a.updated_at) AS version
     FROM list_items li
     JOIN lists l ON l._id = li.list_id
     JOIN albums a ON a.album_id = li.album_id
     WHERE l.user_id = ANY($1)
       AND a.cover_image IS NOT NULL
     GROUP BY li.album_id, a.cover_thumbnail_updated_at, a.cover_image_updated_at, a.updated_at
     ORDER BY MAX(l.updated_at) DESC NULLS LAST, li.album_id
     LIMIT $2`,
    [userIds, limit]
  );
  return result.rows;
}

async function warmUserResponses({
  userIds,
  listService,
  groupService,
  recommendationService,
  responseCache,
  logger,
}) {
  if (!responseCache || userIds.length === 0) return { users: 0 };

  let warmed = 0;
  const recommendationYears = recommendationService?.getYears
    ? await recommendationService.getYears().catch((error) => {
        logger.warn('Failed to prewarm recommendation years', {
          error: error.message,
        });
        return [];
      })
    : [];

  for (const userId of userIds) {
    try {
      const [lists, fullLists, groups] = await Promise.all([
        listService.getAllLists(userId),
        listService.getAllLists(userId, { full: true }),
        groupService?.getGroups ? groupService.getGroups(userId) : [],
      ]);

      responseCache.set(
        `GET:/api/lists:${userId}`,
        lists,
        USER_RESPONSE_TTL_MS
      );
      responseCache.set(
        `GET:/api/lists?full=true:${userId}`,
        fullLists,
        USER_RESPONSE_TTL_MS
      );
      responseCache.set(
        `GET:/api/app-bootstrap:${userId}`,
        {
          lists,
          groups,
          recommendationYears,
          selectedListId: null,
          selectedListItems: null,
          selectedListProfile: null,
        },
        USER_RESPONSE_TTL_MS
      );
      warmed++;
    } catch (error) {
      logger.warn('Failed to prewarm user responses', {
        userId,
        error: error.message,
      });
    }
  }

  return { users: warmed };
}

async function warmAggregateResponses({
  db,
  aggregateList,
  responseCache,
  logger,
}) {
  if (!aggregateList || !responseCache) return { years: 0 };

  const currentYear = new Date().getFullYear();
  const result = await db.raw(
    `SELECT year
     FROM master_lists
     WHERE revealed = TRUE OR year = ANY($1::int[])
     ORDER BY year DESC
     LIMIT 10`,
    [[currentYear, currentYear - 1]]
  );

  let warmed = 0;
  for (const row of result.rows) {
    const year = row.year;
    try {
      const [record, status] = await Promise.all([
        aggregateList.get(year),
        aggregateList.getStatus(year),
      ]);
      if (record?.revealed) {
        responseCache.set(
          `aggregate:GET:/api/aggregate-list/${year}`,
          {
            year,
            revealed: true,
            revealedAt: record.revealed_at,
            data: record.data,
          },
          AGGREGATE_RESPONSE_TTL_MS
        );
      }
      responseCache.set(
        `aggregate:GET:/api/aggregate-list/${year}/status`,
        status,
        AGGREGATE_RESPONSE_TTL_MS
      );
      responseCache.set(
        `aggregate:GET:/api/aggregate-list/${year}/stats`,
        {
          year,
          revealed: record?.revealed || false,
          stats: record?.stats || null,
        },
        AGGREGATE_RESPONSE_TTL_MS
      );
      warmed++;
    } catch (error) {
      logger.warn('Failed to prewarm aggregate responses', {
        year,
        error: error.message,
      });
    }
  }

  return { years: warmed };
}

async function runRamPrewarm({
  db,
  config,
  logger = defaultLogger,
  services = {},
  responseCache,
}) {
  const startedAt = Date.now();
  const summary = {
    db: null,
    users: 0,
    aggregates: 0,
    covers: 0,
    durationMs: 0,
  };

  summary.db = await runDbPrewarm({ db, config, logger });

  if (!config?.appPrewarmEnabled) {
    summary.durationMs = Date.now() - startedAt;
    logger.info('RAM app prewarm skipped', { duration_ms: summary.durationMs });
    return summary;
  }

  const userIds = await observePhase('select_active_users', logger, () =>
    selectActiveUserIds(db, config.appPrewarmUsersLimit)
  );
  const activeUserIds = Array.isArray(userIds) ? userIds : [];

  const userResult = await observePhase('response_prewarm', logger, () =>
    warmUserResponses({
      userIds: activeUserIds,
      listService: services.listService,
      groupService: services.groupService,
      recommendationService: services.recommendationService,
      responseCache,
      logger,
    })
  );
  summary.users = userResult.users || 0;

  const aggregateResult = await observePhase('aggregate_prewarm', logger, () =>
    warmAggregateResponses({
      db,
      aggregateList: services.aggregateList,
      responseCache,
      logger,
    })
  );
  summary.aggregates = aggregateResult.years || 0;

  if (config.coverCacheEnabled) {
    const coverTargets = await observePhase(
      'select_cover_targets',
      logger,
      () =>
        selectCoverWarmTargets(db, activeUserIds, config.appPrewarmCoversLimit)
    );
    const coverResult = await observePhase('cover_prewarm', logger, () =>
      warmCoverCache({
        albumService: services.albumService,
        coverTargets: Array.isArray(coverTargets) ? coverTargets : [],
        logger,
      })
    );
    summary.covers = coverResult.covers || 0;
  } else {
    logger.info('RAM cover prewarm skipped', {
      reason: 'cover_cache_disabled',
    });
  }
  summary.durationMs = Date.now() - startedAt;
  observeStartupPrewarm('ram_prewarm_total', summary.durationMs, 'success');

  logger.info('RAM prewarm completed', {
    users: summary.users,
    aggregates: summary.aggregates,
    covers: summary.covers,
    duration_ms: summary.durationMs,
  });
  return summary;
}

module.exports = {
  coverVersion,
  runRamPrewarm,
  selectActiveUserIds,
  selectCoverWarmTargets,
  warmAggregateResponses,
  warmCoverCache,
  warmUserResponses,
};
