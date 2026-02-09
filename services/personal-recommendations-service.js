// services/personal-recommendations-service.js
// Core business logic for personal weekly album recommendations

const logger = require('../utils/logger');
const crypto = require('crypto');

/**
 * Create a failed recommendation list entry in the database
 */
async function createFailedList(
  pool,
  listId,
  userId,
  weekStart,
  model,
  errorMessage
) {
  await pool.query(
    `INSERT INTO personal_recommendation_lists (_id, user_id, week_start, model, status, error_message)
     VALUES ($1, $2, $3, $4, 'failed', $5)
     ON CONFLICT (user_id, week_start) DO UPDATE SET status = 'failed', error_message = $5,
       retry_count = personal_recommendation_lists.retry_count + 1`,
    [listId, userId, weekStart, model, errorMessage]
  );
  return { _id: listId, status: 'failed' };
}

/**
 * Fetch user context data needed for recommendation generation
 */
async function fetchUserContext(pool, userId, normalizeAlbumKey) {
  const [affinityResult, ownedAlbums, promptResult] = await Promise.all([
    pool.query(
      'SELECT genre_affinity, artist_affinity, country_affinity FROM user_preferences WHERE user_id = $1',
      [userId]
    ),
    pool.query(
      `SELECT DISTINCT a.artist, a.album FROM list_items li
       JOIN albums a ON li.album_id = a.album_id
       JOIN lists l ON li.list_id = l._id
       WHERE l.user_id = $1`,
      [userId]
    ),
    pool.query(
      'SELECT custom_prompt FROM personal_recommendation_prompts WHERE user_id = $1',
      [userId]
    ),
  ]);

  return {
    affinity: affinityResult.rows[0] || {},
    userAlbumKeys: ownedAlbums.rows.map((r) =>
      normalizeAlbumKey(r.artist, r.album)
    ),
    customPrompt: promptResult.rows[0]?.custom_prompt || '',
  };
}

/**
 * Insert recommendation items into the database
 * @param {Object} ctx - Context object with pool, log, upsertAlbumRecord, normalizeAlbumKey, generateId
 * @param {string} listId - List ID
 * @param {Array} recommendations - Recommendation items
 * @param {Array} releasePool - Source release pool
 */
async function insertRecommendationItems(
  ctx,
  listId,
  recommendations,
  releasePool
) {
  const { pool, log, upsertAlbumRecord, normalizeAlbumKey, generateId } = ctx;
  for (let i = 0; i < recommendations.length; i++) {
    const rec = recommendations[i];
    const itemId = generateId();

    let albumId = null;
    if (upsertAlbumRecord) {
      try {
        const albumRecord = await upsertAlbumRecord({
          artist: rec.artist,
          album: rec.album,
        });
        albumId = albumRecord?.album_id || albumRecord?._id;
      } catch (err) {
        log.warn('Failed to upsert album record for recommendation', {
          artist: rec.artist,
          album: rec.album,
          error: err.message,
        });
      }
    }

    if (!albumId) {
      const poolMatch = releasePool.find(
        (r) =>
          normalizeAlbumKey(r.artist, r.album) ===
          normalizeAlbumKey(rec.artist, rec.album)
      );
      albumId = poolMatch?.album_id || `rec_${listId}_${i}`;
    }

    await pool.query(
      `INSERT INTO personal_recommendation_items (_id, list_id, album_id, position, reasoning)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (list_id, position) DO NOTHING`,
      [itemId, listId, albumId, i + 1, rec.reasoning]
    );
  }
}

const LIST_WITH_ITEMS_QUERY = `
  SELECT prl.*,
    COALESCE(json_agg(
      json_build_object('_id', pri._id, 'album_id', pri.album_id, 'position', pri.position,
        'reasoning', pri.reasoning, 'artist', a.artist, 'album', a.album, 'cover_image', a.cover_image)
      ORDER BY pri.position
    ) FILTER (WHERE pri._id IS NOT NULL), '[]') as items
  FROM personal_recommendation_lists prl
  LEFT JOIN personal_recommendation_items pri ON pri.list_id = prl._id
  LEFT JOIN albums a ON pri.album_id = a.album_id`;

/**
 * Query for user's recommendation lists with items
 */
async function queryListsForUser(pool, userId) {
  const result = await pool.query(
    `${LIST_WITH_ITEMS_QUERY}
     WHERE prl.user_id = $1 GROUP BY prl.id ORDER BY prl.week_start DESC LIMIT 2`,
    [userId]
  );
  return result.rows;
}

/**
 * Query a single recommendation list by ID for a user
 */
async function queryListById(pool, listId, userId) {
  const result = await pool.query(
    `${LIST_WITH_ITEMS_QUERY}
     WHERE prl._id = $1 AND prl.user_id = $2 GROUP BY prl.id`,
    [listId, userId]
  );
  return result.rows[0] || null;
}

/**
 * Get user prompt settings from the database
 */
async function queryUserPromptSettings(pool, userId) {
  const result = await pool.query(
    'SELECT custom_prompt, is_enabled FROM personal_recommendation_prompts WHERE user_id = $1',
    [userId]
  );
  if (result.rows.length === 0) {
    return { customPrompt: '', isEnabled: true };
  }
  return {
    customPrompt: result.rows[0].custom_prompt || '',
    isEnabled: result.rows[0].is_enabled,
  };
}

/**
 * Update user prompt settings in the database
 */
async function upsertUserPromptSettings(pool, log, userId, settings) {
  const { customPrompt, isEnabled } = settings;
  if (customPrompt && customPrompt.length > 1000) {
    throw new Error('Custom prompt must be 1000 characters or less');
  }
  await pool.query(
    `INSERT INTO personal_recommendation_prompts (user_id, custom_prompt, is_enabled, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       custom_prompt = COALESCE($2, personal_recommendation_prompts.custom_prompt),
       is_enabled = COALESCE($3, personal_recommendation_prompts.is_enabled),
       updated_at = NOW()`,
    [userId, customPrompt ?? null, isEnabled ?? null]
  );
  log.info('Updated user prompt settings', {
    userId,
    hasCustomPrompt: !!customPrompt,
    isEnabled,
  });
}

/**
 * Check if a user is eligible for recommendations
 */
async function checkEligibility(pool, userId, minAlbums, activeDays) {
  const promptSettings = await pool.query(
    'SELECT is_enabled FROM personal_recommendation_prompts WHERE user_id = $1',
    [userId]
  );
  if (promptSettings.rows.length > 0 && !promptSettings.rows[0].is_enabled) {
    return { eligible: false, reason: 'recommendations_disabled' };
  }

  const albumCount = await pool.query(
    'SELECT COUNT(DISTINCT li.album_id) as count FROM list_items li JOIN lists l ON li.list_id = l._id WHERE l.user_id = $1',
    [userId]
  );
  if (parseInt(albumCount.rows[0].count, 10) < minAlbums) {
    return {
      eligible: false,
      reason: `insufficient_albums (${albumCount.rows[0].count}/${minAlbums})`,
    };
  }

  const activeCheck = await pool.query(
    'SELECT last_login FROM users WHERE _id = $1 AND last_login > NOW() - $2::interval',
    [userId, `${activeDays} days`]
  );
  if (activeCheck.rows.length === 0) {
    return { eligible: false, reason: 'inactive_user' };
  }

  return { eligible: true, reason: '' };
}

/**
 * Delete old recommendation lists and cleanup pools
 */
async function performRotateAndCleanup(pool, log, weekStart, poolService) {
  const weekDate = new Date(weekStart);
  weekDate.setDate(weekDate.getDate() - 7);
  const cutoffDate = weekDate.toISOString().split('T')[0];

  const result = await pool.query(
    'DELETE FROM personal_recommendation_lists WHERE week_start < $1',
    [cutoffDate]
  );
  log.info('Rotated old recommendation lists', {
    cutoffDate,
    deletedLists: result.rowCount,
  });

  if (poolService) {
    await poolService.cleanupOldPools();
  }
}

/**
 * Process all active users for recommendation generation
 */
async function processAllUsers(ctx, weekStart, options) {
  const { pool, log, poolService, activeDays, rateLimitMs, generateForUser } =
    ctx;
  const onProgress = options.onProgress || null;
  const notify = (msg, data) => {
    if (onProgress) onProgress(msg, data);
  };

  notify('Starting weekly pool build...', { phase: 'pool_build' });
  if (poolService) {
    const poolCount = await poolService.buildWeeklyPool(weekStart);
    notify(`Pool ready: ${poolCount} releases gathered`, {
      phase: 'pool_ready',
      poolCount,
    });
  } else {
    notify('No pool service configured, skipping pool build', {
      phase: 'pool_skip',
    });
  }

  const usersResult = await pool.query(
    'SELECT _id, email, username FROM users WHERE last_login > NOW() - $1::interval',
    [`${activeDays} days`]
  );

  const totalUsers = usersResult.rows.length;
  notify(`Found ${totalUsers} active users to evaluate`, {
    phase: 'users_found',
    totalUsers,
  });

  let success = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < usersResult.rows.length; i++) {
    const user = usersResult.rows[i];
    const userLabel = user.username || user.email || user._id;
    const progress = `[${i + 1}/${totalUsers}]`;
    try {
      const result = await generateForUser(user._id, weekStart);
      if (!result) {
        skipped++;
        notify(`${progress} ${userLabel}: skipped (ineligible)`, {
          phase: 'user_done',
          userId: user._id,
          status: 'skipped',
        });
      } else if (result.status === 'failed') {
        failed++;
        notify(`${progress} ${userLabel}: failed`, {
          phase: 'user_done',
          userId: user._id,
          status: 'failed',
        });
      } else {
        success++;
        notify(`${progress} ${userLabel}: completed`, {
          phase: 'user_done',
          userId: user._id,
          status: 'completed',
        });
      }
    } catch (err) {
      log.error('Unexpected error generating for user', {
        userId: user._id,
        weekStart,
        error: err.message,
      });
      failed++;
      notify(`${progress} ${userLabel}: error - ${err.message}`, {
        phase: 'user_done',
        userId: user._id,
        status: 'error',
      });
    }
    await new Promise((r) => setTimeout(r, rateLimitMs));
  }

  log.info('Completed generation for all users', {
    weekStart,
    totalUsers,
    success,
    failed,
    skipped,
  });

  notify(`Done: ${success} completed, ${failed} failed, ${skipped} skipped`, {
    phase: 'complete',
    success,
    failed,
    skipped,
  });
  return { success, failed, skipped };
}

/**
 * Create the personal recommendations service
 * @param {Object} deps - Dependencies
 * @param {Object} deps.pool - PostgreSQL connection pool (required)
 * @param {Object} deps.logger - Logger instance
 * @param {Object} deps.recommendationEngine - Recommendation engine instance
 * @param {Object} deps.poolService - New release pool service instance
 * @param {Function} deps.upsertAlbumRecord - Function to upsert albums
 * @param {Function} deps.normalizeAlbumKey - Album key normalization function
 * @param {Object} deps.env - Environment variables
 * @param {Function} deps.generateId - ID generation function
 */
function createPersonalRecommendationsService(deps = {}) {
  const pool = deps.pool;
  if (!pool) {
    throw new Error(
      'Database pool is required for PersonalRecommendationsService'
    );
  }

  const log = deps.logger || logger;
  const env = deps.env || process.env;
  const recommendationEngine = deps.recommendationEngine || null;
  const poolService = deps.poolService || null;
  const upsertAlbumRecord = deps.upsertAlbumRecord || null;
  const normalizeAlbumKey =
    deps.normalizeAlbumKey || require('../utils/fuzzy-match').normalizeAlbumKey;

  const RATE_LIMIT_DELAY_MS = parseInt(
    env.PERSONAL_RECS_RATE_LIMIT_MS || '2000',
    10
  );
  const MIN_ALBUMS = parseInt(env.PERSONAL_RECS_MIN_ALBUMS || '10', 10);
  const ACTIVE_DAYS = parseInt(env.PERSONAL_RECS_ACTIVE_DAYS || '30', 10);

  function generateId() {
    if (deps.generateId) return deps.generateId();
    return crypto.randomUUID();
  }

  function getModel() {
    return env.PERSONAL_RECS_MODEL || 'claude-sonnet-4-5';
  }

  async function checkUserEligibility(userId) {
    return checkEligibility(pool, userId, MIN_ALBUMS, ACTIVE_DAYS);
  }

  async function generateForUser(userId, weekStart) {
    const existing = await pool.query(
      'SELECT _id FROM personal_recommendation_lists WHERE user_id = $1 AND week_start = $2',
      [userId, weekStart]
    );
    if (existing.rows.length > 0) {
      log.info('Recommendations already exist for user+week, skipping', {
        userId,
        weekStart,
      });
      return existing.rows[0];
    }

    const { eligible, reason } = await checkUserEligibility(userId);
    if (!eligible) {
      log.info('User not eligible for recommendations', {
        userId,
        weekStart,
        reason,
      });
      return null;
    }

    if (!recommendationEngine) {
      log.error('Recommendation engine not available');
      return null;
    }

    const { affinity, userAlbumKeys, customPrompt } = await fetchUserContext(
      pool,
      userId,
      normalizeAlbumKey
    );
    const releasePool = poolService
      ? await poolService.getPoolForWeek(weekStart, false)
      : [];

    if (releasePool.length === 0) {
      log.warn('Empty release pool for user recommendation', {
        userId,
        weekStart,
      });
      return createFailedList(
        pool,
        generateId(),
        userId,
        weekStart,
        getModel(),
        'No new releases found this week'
      );
    }

    try {
      const result = await recommendationEngine.generateRecommendations({
        newReleases: releasePool,
        genreAffinity: affinity.genre_affinity || [],
        artistAffinity: affinity.artist_affinity || [],
        countryAffinity: affinity.country_affinity || [],
        userAlbumKeys,
        customPrompt,
      });

      if (!result || result.recommendations.length === 0) {
        return createFailedList(
          pool,
          generateId(),
          userId,
          weekStart,
          getModel(),
          'No suitable recommendations found'
        );
      }

      const listId = generateId();
      await pool.query(
        `INSERT INTO personal_recommendation_lists
         (_id, user_id, week_start, model, prompt_snapshot, input_tokens, output_tokens, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed')`,
        [
          listId,
          userId,
          weekStart,
          getModel(),
          result.promptSnapshot,
          result.inputTokens,
          result.outputTokens,
        ]
      );

      await insertRecommendationItems(
        { pool, log, upsertAlbumRecord, normalizeAlbumKey, generateId },
        listId,
        result.recommendations,
        releasePool
      );

      log.info('Generated recommendations for user', {
        userId,
        weekStart,
        listId,
        itemCount: result.recommendations.length,
      });
      return { _id: listId, status: 'completed' };
    } catch (err) {
      log.error('Failed to generate recommendations for user', {
        userId,
        weekStart,
        error: err.message,
        stack: err.stack,
      });
      return createFailedList(
        pool,
        generateId(),
        userId,
        weekStart,
        getModel(),
        err.message
      );
    }
  }

  async function generateForAllUsers(weekStart, options = {}) {
    return processAllUsers(
      {
        pool,
        log,
        poolService,
        activeDays: ACTIVE_DAYS,
        rateLimitMs: RATE_LIMIT_DELAY_MS,
        generateForUser,
      },
      weekStart,
      options
    );
  }

  async function rotateAndCleanup(weekStart) {
    return performRotateAndCleanup(pool, log, weekStart, poolService);
  }

  async function getListsForUser(userId) {
    return queryListsForUser(pool, userId);
  }

  async function getListById(listId, userId) {
    return queryListById(pool, listId, userId);
  }

  async function getUserPromptSettings(userId) {
    return queryUserPromptSettings(pool, userId);
  }

  async function updateUserPromptSettings(userId, settings) {
    return upsertUserPromptSettings(pool, log, userId, settings);
  }

  return {
    generateForUser,
    generateForAllUsers,
    rotateAndCleanup,
    getListsForUser,
    getListById,
    getUserPromptSettings,
    updateUserPromptSettings,
    checkUserEligibility,
  };
}

module.exports = { createPersonalRecommendationsService };
