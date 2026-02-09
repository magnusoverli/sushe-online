// services/personal-recommendations-scheduler.js
// Background job for weekly personal recommendation generation

const logger = require('../utils/logger');

const ONE_HOUR_MS = 60 * 60 * 1000;
const STARTUP_DELAY_MS = 30 * 1000; // 30 seconds after app start

/**
 * Create the personal recommendations scheduler
 * @param {Object} deps - Dependencies
 * @param {Object} deps.pool - PostgreSQL connection pool (required)
 * @param {Object} deps.logger - Logger instance
 * @param {Object} deps.personalRecsService - Personal recommendations service instance
 * @param {Object} deps.env - Environment variables
 */
function createPersonalRecommendationsScheduler(deps = {}) {
  const pool = deps.pool;
  if (!pool) {
    throw new Error(
      'Database pool is required for PersonalRecommendationsScheduler'
    );
  }

  const log = deps.logger || logger;
  const env = deps.env || process.env;
  const personalRecsService = deps.personalRecsService;

  let checkInterval = null;
  let retryTimeouts = [];
  let isRunning = false;
  let lastRunWeek = null;

  /**
   * Get the Monday of the current week as YYYY-MM-DD
   */
  function getCurrentWeekStart() {
    const now = new Date();
    const day = now.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + mondayOffset);
    return monday.toISOString().split('T')[0];
  }

  /**
   * Check if it's the right time and day to run generation
   */
  function shouldRunGeneration() {
    const now = new Date();
    const currentWeekStart = getCurrentWeekStart();

    // Already ran this week
    if (lastRunWeek === currentWeekStart) {
      return false;
    }

    // Only run on Monday (day 1)
    if (now.getDay() !== 1) {
      return false;
    }

    // Default: run after 6 AM
    const targetHour = parseInt(env.PERSONAL_RECS_RUN_HOUR || '6', 10);
    if (now.getHours() < targetHour) {
      return false;
    }

    return true;
  }

  /**
   * Run the weekly generation cycle
   */
  async function runWeeklyGeneration() {
    if (isRunning) {
      log.warn('Personal recommendations generation already running, skipping');
      return;
    }

    if (!personalRecsService) {
      log.error('Personal recommendations service not available for scheduler');
      return;
    }

    isRunning = true;
    const weekStart = getCurrentWeekStart();

    try {
      log.info('Starting weekly personal recommendations generation', {
        weekStart,
      });

      // Rotate old data first
      await personalRecsService.rotateAndCleanup(weekStart);

      // Generate for all eligible users
      const stats = await personalRecsService.generateForAllUsers(weekStart);

      lastRunWeek = weekStart;

      log.info('Completed weekly personal recommendations generation', {
        weekStart,
        ...stats,
      });

      // Schedule retries for failed users
      if (stats.failed > 0) {
        scheduleRetries(weekStart);
      }
    } catch (err) {
      log.error('Failed to run weekly personal recommendations generation', {
        weekStart,
        error: err.message,
        stack: err.stack,
      });
    } finally {
      isRunning = false;
    }
  }

  /**
   * Schedule retries for failed generations
   * @param {string} weekStart - Monday date
   */
  function scheduleRetries(weekStart) {
    const retryDelaysStr =
      env.PERSONAL_RECS_RETRY_DELAYS || '1800000,7200000,18000000';
    const retryDelays = retryDelaysStr.split(',').map(Number);

    for (const delay of retryDelays) {
      const timeout = setTimeout(async () => {
        try {
          log.info('Running personal recommendations retry', {
            weekStart,
            delay,
          });

          // Query failed users with retry_count < 3
          const failedUsers = await pool.query(
            `SELECT user_id FROM personal_recommendation_lists
             WHERE week_start = $1 AND status = 'failed' AND retry_count < 3`,
            [weekStart]
          );

          for (const row of failedUsers.rows) {
            // Delete the failed entry so generateForUser can create a new one
            await pool.query(
              `DELETE FROM personal_recommendation_lists
               WHERE user_id = $1 AND week_start = $2 AND status = 'failed'`,
              [row.user_id, weekStart]
            );

            await personalRecsService.generateForUser(row.user_id, weekStart);
          }
        } catch (err) {
          log.error('Retry cycle failed', {
            weekStart,
            error: err.message,
          });
        }
      }, delay);

      retryTimeouts.push(timeout);
    }
  }

  /**
   * Start the scheduler
   * @param {Object} options - Start options
   * @param {boolean} options.immediate - Run immediately instead of waiting
   */
  function start(options = {}) {
    if (checkInterval) {
      log.warn('Personal recommendations scheduler already started');
      return;
    }

    log.info('Starting personal recommendations scheduler');

    // Initial check after startup delay
    const initialDelay = options.immediate ? 0 : STARTUP_DELAY_MS;
    const initialTimeout = setTimeout(async () => {
      if (shouldRunGeneration()) {
        await runWeeklyGeneration();
      }
    }, initialDelay);
    retryTimeouts.push(initialTimeout);

    // Check every hour if it's time to run
    checkInterval = setInterval(async () => {
      if (shouldRunGeneration()) {
        await runWeeklyGeneration();
      }
    }, ONE_HOUR_MS);
  }

  /**
   * Stop the scheduler and clear all timers
   */
  function stop() {
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }

    for (const timeout of retryTimeouts) {
      clearTimeout(timeout);
    }
    retryTimeouts = [];

    log.info('Personal recommendations scheduler stopped');
  }

  /**
   * Check if the scheduler has been started
   */
  function isStarted() {
    return checkInterval !== null;
  }

  return {
    start,
    stop,
    isStarted,
    isRunning: () => isRunning,
    runWeeklyGeneration,
    getCurrentWeekStart,
    shouldRunGeneration,
  };
}

module.exports = { createPersonalRecommendationsScheduler };
