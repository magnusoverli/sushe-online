/**
 * Availability Resolution Job
 *
 * Admin-triggered bulk resolution of streaming-platform availability across the
 * album catalog. Mirrors the image-refetch job: in-memory state, a stoppable
 * loop, and a polled progress snapshot. Shares the exact resolution graph the
 * live fetch queue and the backfill CLI use (Odesli + MusicBrainz + UPC-exact
 * Deezer/iTunes sources), so a manual run and the automatic queue stay in sync.
 *
 * Resolution is serialized and Odesli-paced, so a full run is long; progress is
 * exposed for 1.5 s polling and the loop checks the stop flag every album.
 */

const { ensureDb } = require('../db/postgres');
const logger = require('../utils/logger');
const { wait } = require('../utils/request-queue');
const { ODESLI_RATE_LIMIT_MS } = require('./availability/platforms');
const {
  buildAvailabilityResolution,
} = require('./availability/build-resolution');

function createAvailabilityResolutionJob(deps = {}) {
  const db = ensureDb(deps.db, 'availability-resolution-job');
  const log = deps.logger || logger;
  const paceMs =
    deps.rateLimitMs === undefined ? ODESLI_RATE_LIMIT_MS : deps.rateLimitMs;
  const resolution =
    deps.resolution ||
    buildAvailabilityResolution({ db, logger: log }).resolution;

  // Job state
  let isRunning = false;
  let shouldStop = false;
  let currentProgress = null;

  /**
   * Catalog-wide availability coverage.
   * @returns {Promise<{totalAlbums:number, resolved:number, unresolved:number}>}
   */
  async function getStats() {
    const result = await db.raw(`
      SELECT
        (SELECT COUNT(*) FROM albums
          WHERE artist IS NOT NULL AND album IS NOT NULL) AS total,
        (SELECT COUNT(DISTINCT m.album_id) FROM album_service_mappings m
          WHERE m.strategy LIKE 'availability:%') AS resolved
    `);
    const row = result.rows[0] || {};
    const totalAlbums = parseInt(row.total, 10) || 0;
    const resolved = parseInt(row.resolved, 10) || 0;
    return {
      totalAlbums,
      resolved,
      unresolved: Math.max(0, totalAlbums - resolved),
    };
  }

  function isJobRunning() {
    return isRunning;
  }

  function stopJob() {
    if (isRunning) {
      shouldStop = true;
      return true;
    }
    return false;
  }

  function getProgress() {
    if (!isRunning || !currentProgress) {
      return null;
    }
    return { ...currentProgress };
  }

  /**
   * Candidate albums to resolve. By default only those not yet
   * availability-resolved; `all` reconsiders every album (non-destructive
   * re-resolution, matching the backfill CLI).
   */
  async function selectCandidates(all) {
    const { rows } = await db.raw(
      `SELECT a.album_id, a.artist, a.album
         FROM albums a
        WHERE a.artist IS NOT NULL AND a.album IS NOT NULL
          ${
            all
              ? ''
              : `AND NOT EXISTS (
            SELECT 1 FROM album_service_mappings m
             WHERE m.album_id = a.album_id
               AND m.strategy LIKE 'availability:%'
          )`
          }
        ORDER BY a.artist, a.album`
    );
    return rows;
  }

  /**
   * Resolve availability across the candidate set.
   * @param {{all?:boolean}} [options]
   * @returns {Promise<Object>} summary
   */
  async function resolveAll(options = {}) {
    if (isRunning) {
      throw new Error('Availability resolution job is already running');
    }

    const all = options.all === true;
    isRunning = true;
    shouldStop = false;

    const summary = {
      total: 0,
      resolved: 0,
      skipped: 0,
      failed: 0,
      startedAt: new Date().toISOString(),
      completedAt: null,
      durationSeconds: 0,
      stoppedEarly: false,
    };

    currentProgress = {
      total: 0,
      processed: 0,
      resolved: 0,
      skipped: 0,
      failed: 0,
      percentComplete: 0,
      startedAt: summary.startedAt,
    };

    try {
      log.info('Starting availability resolution job', { all });

      const candidates = await selectCandidates(all);
      summary.total = candidates.length;
      currentProgress.total = candidates.length;

      for (let i = 0; i < candidates.length; i++) {
        if (shouldStop) {
          summary.stoppedEarly = true;
          break;
        }

        const row = candidates[i];
        try {
          const result = await resolution.resolveAvailability({
            albumId: row.album_id,
            artist: row.artist,
            album: row.album,
          });
          if (result.action === 'resolved') {
            summary.resolved++;
            currentProgress.resolved++;
          } else {
            summary.skipped++;
            currentProgress.skipped++;
          }
        } catch (err) {
          summary.failed++;
          currentProgress.failed++;
          log.warn('Availability resolution failed for album', {
            albumId: row.album_id,
            error: err.message,
          });
        }

        const processed = summary.resolved + summary.skipped + summary.failed;
        currentProgress.processed = processed;
        currentProgress.percentComplete =
          summary.total > 0 ? Math.round((processed / summary.total) * 100) : 0;

        // Pace by the Odesli rate limit, but not after the final album.
        if (i < candidates.length - 1) {
          await wait(paceMs);
        }
      }

      summary.completedAt = new Date().toISOString();
      summary.durationSeconds = Math.round(
        (new Date(summary.completedAt) - new Date(summary.startedAt)) / 1000
      );

      log.info('Availability resolution job completed', summary);
      return summary;
    } finally {
      isRunning = false;
      shouldStop = false;
      currentProgress = null;
    }
  }

  return {
    getStats,
    isJobRunning,
    stopJob,
    getProgress,
    resolveAll,
  };
}

module.exports = { createAvailabilityResolutionJob };
