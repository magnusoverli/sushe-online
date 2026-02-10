// services/new-release-pool-service.js
// Business logic for the weekly new release pool

const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * Create the new release pool service
 * @param {Object} deps - Dependencies
 * @param {Object} deps.pool - PostgreSQL connection pool (required)
 * @param {Object} deps.logger - Logger instance
 * @param {Function} deps.gatherWeeklyNewReleases - New release source gatherer
 * @param {Function} deps.callClaude - Claude API call function
 * @param {Function} deps.extractTextFromContent - Claude text extraction function
 * @param {Function} deps.fetchAndProcessImage - Image download + processing function
 * @param {Function} deps.fetchDeezerTracks - Deezer track fetch function
 * @param {Function} deps.fetchItunesTracks - iTunes track fetch function
 * @param {Object} deps.env - Environment variables
 */
// eslint-disable-next-line max-lines-per-function -- Cohesive service factory with related pool management functions
function createNewReleasePoolService(deps = {}) {
  const pool = deps.pool;
  if (!pool) {
    throw new Error('Database pool is required for NewReleasePoolService');
  }

  const log = deps.logger || logger;
  const gatherWeeklyNewReleases =
    deps.gatherWeeklyNewReleases ||
    require('../utils/new-release-sources').gatherWeeklyNewReleases;
  const callClaude = deps.callClaude || null;
  const extractTextFromContent = deps.extractTextFromContent || null;
  const fetchAndProcessImage = deps.fetchAndProcessImage || null;
  const fetchDeezerTracks = deps.fetchDeezerTracks || null;
  const fetchItunesTracks = deps.fetchItunesTracks || null;

  /**
   * Generate a unique _id for pool entries
   */
  function generateId() {
    if (deps.generateId) return deps.generateId();
    return crypto.randomUUID();
  }

  /**
   * Calculate the Monday (week start) and Sunday (week end) for a given date
   * @param {Date|string} date - Input date
   * @returns {{weekStart: string, weekEnd: string}} YYYY-MM-DD formatted dates
   */
  function getWeekBoundaries(date) {
    const d = new Date(date);
    const day = d.getDay();
    // Adjust to Monday (day 1). If Sunday (0), go back 6 days
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(d);
    monday.setDate(d.getDate() + mondayOffset);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    return {
      weekStart: monday.toISOString().split('T')[0],
      weekEnd: sunday.toISOString().split('T')[0],
    };
  }

  /**
   * Download a cover image from a URL and return as processed Buffer
   * @param {string} imageUrl - URL to download from
   * @returns {Promise<{buffer: Buffer, format: string}|null>}
   */
  async function downloadCoverImage(imageUrl) {
    if (!imageUrl) return null;

    // Use injected fetchAndProcessImage if available (same as cover-fetch-queue)
    if (fetchAndProcessImage) {
      try {
        const result = await fetchAndProcessImage(imageUrl);
        return result ? { buffer: result, format: 'JPEG' } : null;
      } catch (err) {
        log.debug('Failed to download cover image via fetchAndProcessImage', {
          url: imageUrl,
          error: err.message,
        });
        return null;
      }
    }

    // Fallback: basic fetch without image processing
    try {
      const response = await (deps.fetch || global.fetch)(imageUrl);
      if (!response.ok) return null;
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      if (buffer.length < 100) return null; // Too small, likely an error
      return { buffer, format: 'JPEG' };
    } catch (err) {
      log.debug('Failed to download cover image', {
        url: imageUrl,
        error: err.message,
      });
      return null;
    }
  }

  /**
   * Fetch tracks for a release using Deezer/iTunes fallback
   * @param {string} artist - Artist name
   * @param {string} album - Album name
   * @returns {Promise<Array<{name: string, length: number}>|null>}
   */
  async function fetchTracksForRelease(artist, album) {
    if (!fetchDeezerTracks && !fetchItunesTracks) return null;

    const fetchers = [];
    if (fetchDeezerTracks) fetchers.push(fetchDeezerTracks(artist, album));
    if (fetchItunesTracks) fetchers.push(fetchItunesTracks(artist, album));

    try {
      const result = await Promise.any(fetchers);
      return result?.tracks || null;
    } catch {
      // All fetchers failed
      return null;
    }
  }

  /**
   * Build the weekly new release pool
   * @param {string} weekStart - Monday date (YYYY-MM-DD)
   * @returns {Promise<number>} Number of albums gathered
   */
  async function buildWeeklyPool(weekStart) {
    // Check if pool already exists for this week (idempotent)
    const existing = await pool.query(
      'SELECT COUNT(*) as count FROM weekly_new_releases WHERE week_start = $1',
      [weekStart]
    );

    if (parseInt(existing.rows[0].count, 10) > 0) {
      log.info('Weekly pool already exists, skipping build', {
        weekStart,
        existingCount: existing.rows[0].count,
      });
      return parseInt(existing.rows[0].count, 10);
    }

    const { weekEnd } = getWeekBoundaries(weekStart);

    // Gather from all sources
    const releases = await gatherWeeklyNewReleases(weekStart, weekEnd, {
      callClaude,
      extractTextFromContent,
    });

    if (releases.length === 0) {
      log.warn('No new releases gathered for week', { weekStart });
      return 0;
    }

    let insertedCount = 0;
    for (const release of releases) {
      try {
        // Use spotify_id or musicbrainz_id if available, otherwise generate synthetic key
        const albumId =
          release.spotify_id ||
          release.musicbrainz_id ||
          `${release.artist}::${release.album}`
            .toLowerCase()
            .replace(/[^a-z0-9:]/g, '_')
            .substring(0, 200);

        // Download cover image if URL is available
        let coverImage = null;
        let coverImageFormat = null;
        if (release.cover_image_url) {
          const imageResult = await downloadCoverImage(release.cover_image_url);
          if (imageResult) {
            coverImage = imageResult.buffer;
            coverImageFormat = imageResult.format;
          }
        }

        // Use tracks from source fetch, or try Deezer/iTunes fallback
        let tracks = release.tracks || null;
        if (!tracks || tracks.length === 0) {
          tracks = await fetchTracksForRelease(release.artist, release.album);
        }

        const releaseId = generateId();

        await pool.query(
          `INSERT INTO weekly_new_releases
            (_id, week_start, album_id, source, release_date, artist, album,
             genre_1, genre_2, country, tracks, cover_image, cover_image_format, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
           ON CONFLICT (week_start, album_id) DO NOTHING`,
          [
            releaseId,
            weekStart,
            albumId,
            release.source,
            release.release_date || null,
            release.artist,
            release.album,
            release.genre_1 || null,
            release.genre_2 || null,
            release.country || null,
            tracks ? JSON.stringify(tracks) : null,
            coverImage,
            coverImageFormat,
          ]
        );
        insertedCount++;
      } catch (err) {
        log.warn('Failed to insert new release into pool', {
          artist: release.artist,
          album: release.album,
          error: err.message,
        });
      }
    }

    log.info('Weekly pool built', {
      weekStart,
      gathered: releases.length,
      inserted: insertedCount,
    });

    return insertedCount;
  }

  /**
   * Verify pool entries via MusicBrainz
   * @param {string} weekStart - Monday date (YYYY-MM-DD)
   * @param {Function} mbVerify - MusicBrainz verification function
   */
  async function verifyPoolViaMusicBrainz(weekStart, mbVerify) {
    if (!mbVerify) {
      log.warn('MusicBrainz verification function not provided');
      return;
    }

    const unverified = await pool.query(
      'SELECT id, artist, album, release_date FROM weekly_new_releases WHERE week_start = $1 AND verified = FALSE',
      [weekStart]
    );

    let verified = 0;
    let failed = 0;

    for (const row of unverified.rows) {
      try {
        const result = await mbVerify(row.artist, row.album);
        if (result && result.verified) {
          await pool.query(
            'UPDATE weekly_new_releases SET verified = TRUE WHERE id = $1',
            [row.id]
          );
          verified++;
        } else {
          failed++;
        }
      } catch (err) {
        log.warn('MusicBrainz verification failed for album', {
          artist: row.artist,
          album: row.album,
          error: err.message,
        });
        failed++;
      }
    }

    log.info('Pool verification complete', {
      weekStart,
      total: unverified.rows.length,
      verified,
      failed,
    });
  }

  /**
   * Clean up old weekly pools (keep current + last + one buffer)
   */
  async function cleanupOldPools() {
    const threeWeeksAgo = new Date();
    threeWeeksAgo.setDate(threeWeeksAgo.getDate() - 21);
    const cutoffDate = threeWeeksAgo.toISOString().split('T')[0];

    const result = await pool.query(
      'DELETE FROM weekly_new_releases WHERE week_start < $1',
      [cutoffDate]
    );

    log.info('Cleaned up old pools', {
      cutoffDate,
      deletedRows: result.rowCount,
    });
  }

  /**
   * Get pool for a specific week
   * @param {string} weekStart - Monday date (YYYY-MM-DD)
   * @param {boolean} verifiedOnly - Only return verified albums
   * @returns {Promise<Array>} Pool entries
   */
  async function getPoolForWeek(weekStart, verifiedOnly = false) {
    let query =
      'SELECT _id, week_start, album_id, source, release_date, artist, album, genre_1, genre_2, country, tracks, cover_image, cover_image_format, verified, created_at, updated_at FROM weekly_new_releases WHERE week_start = $1';
    if (verifiedOnly) {
      query += ' AND verified = TRUE';
    }
    query += ' ORDER BY id';

    const result = await pool.query(query, [weekStart]);
    return result.rows;
  }

  return {
    buildWeeklyPool,
    verifyPoolViaMusicBrainz,
    cleanupOldPools,
    getPoolForWeek,
    getWeekBoundaries,
  };
}

module.exports = { createNewReleasePoolService };
