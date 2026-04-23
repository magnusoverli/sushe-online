/**
 * Album Service
 *
 * Business logic for album metadata operations:
 * - Cover image retrieval and lazy fetching
 * - Summary get/update
 * - Country and genre updates (single + batch)
 * - Fuzzy duplicate detection
 * - Distinct pair management
 * - Metadata merging
 *
 * Follows dependency injection pattern for testability.
 */

const defaultLogger = require('../utils/logger');
const { ensureDb } = require('../db/postgres');
const { TransactionAbort } = require('../db/transaction');
// withTransaction is provided via db.withTransaction now.
const { buildPartialUpdate } = require('../utils/query-builder');
const { findPotentialDuplicates } = require('../utils/fuzzy-match');
const { normalizeImageBuffer } = require('../utils/image-processing');

/**
 * Create album service with injected dependencies
 * @param {Object} deps
 * @param {import("../db/types").DbFacade} deps.db - Canonical datastore
 * @param {Object} deps.logger - Logger instance
 * @param {Function} deps.upsertAlbumRecord - Helper from _helpers.js
 * @param {Function} deps.invalidateCachesForAlbumUsers - Helper from _helpers.js
 */
// eslint-disable-next-line max-lines-per-function -- Cohesive service module with related album operations
function createAlbumService(deps = {}) {
  const logger = deps.logger || defaultLogger;
  const { upsertAlbumRecord, invalidateCachesForAlbumUsers } = deps;
  const db = ensureDb(deps.db, 'album-service');

  function validateOptionalTextField(value, errorMessage) {
    if (value !== null && value !== undefined && typeof value !== 'string') {
      throw new TransactionAbort(400, { error: errorMessage });
    }
  }

  function normalizeOptionalText(value) {
    return value ? value.trim() : null;
  }

  function buildAlbumMetadataFields({ country, genre_1, genre_2 }) {
    const fields = [];

    if (country !== undefined) {
      fields.push({ column: 'country', value: normalizeOptionalText(country) });
    }

    if (genre_1 !== undefined) {
      fields.push({ column: 'genre_1', value: normalizeOptionalText(genre_1) });
    }

    if (genre_2 !== undefined) {
      fields.push({ column: 'genre_2', value: normalizeOptionalText(genre_2) });
    }

    return fields;
  }

  async function resolveAuditUserId(userId) {
    if (userId === null || userId === undefined) {
      return null;
    }

    if (typeof userId === 'number' && Number.isSafeInteger(userId)) {
      return userId;
    }

    const normalizedUserId = String(userId).trim();
    if (!normalizedUserId) {
      return null;
    }

    if (/^\d+$/.test(normalizedUserId)) {
      const parsed = Number.parseInt(normalizedUserId, 10);
      if (Number.isSafeInteger(parsed)) {
        return parsed;
      }
    }

    const lookupResult = await db.raw(
      'SELECT id FROM users WHERE _id = $1 LIMIT 1',
      [normalizedUserId]
    );

    return lookupResult.rows[0]?.id || null;
  }

  /**
   * Get album cover image data.
   * If cover is missing, triggers an async background fetch.
   * @param {string} albumId
   * @returns {Promise<Object>} { imageBuffer, contentType } or throws
   */
  async function getCoverImage(albumId) {
    const result = await db.raw(
      'SELECT cover_image, cover_image_format, artist, album FROM albums WHERE album_id = $1',
      [albumId]
    );

    if (!result.rows.length) {
      throw new TransactionAbort(404, { error: 'Album not found' });
    }

    const album = result.rows[0];

    // If cover is missing, trigger async fetch
    if (!album.cover_image && album.artist && album.album) {
      const { getCoverFetchQueue } = require('./cover-fetch-queue');
      try {
        const coverQueue = getCoverFetchQueue();
        coverQueue.add(albumId, album.artist, album.album);
        logger.debug('Triggered lazy cover fetch', {
          albumId,
          artist: album.artist,
          album: album.album,
        });
      } catch (error) {
        logger.warn('Cover fetch queue not available for lazy fetch', {
          albumId,
          error: error.message,
        });
      }
      throw new TransactionAbort(404, {
        error: 'Image not found (fetching in background)',
      });
    }

    if (!album.cover_image) {
      throw new TransactionAbort(404, { error: 'Image not found' });
    }

    const imageBuffer = normalizeImageBuffer(album.cover_image);
    const contentType = album.cover_image_format
      ? `image/${album.cover_image_format.toLowerCase()}`
      : 'image/jpeg';

    return { imageBuffer, contentType, albumId };
  }

  /**
   * Get album summary.
   * @param {string} albumId
   * @returns {Promise<Object>} { summary, summarySource }
   */
  async function getSummary(albumId) {
    const result = await db.raw(
      `SELECT summary, summary_source FROM albums WHERE album_id = $1`,
      [albumId]
    );

    if (result.rows.length === 0) {
      throw new TransactionAbort(404, { error: 'Album not found' });
    }

    return {
      summary: result.rows[0].summary || '',
      summarySource: result.rows[0].summary_source || '',
    };
  }

  /**
   * Update album summary.
   * @param {string} albumId
   * @param {string} summary
   * @param {string} summarySource
   */
  async function updateSummary(albumId, summary, summarySource) {
    const result = await db.raw(
      `UPDATE albums 
       SET summary = COALESCE($1, summary),
           summary_source = COALESCE($2, summary_source),
           updated_at = NOW()
       WHERE album_id = $3
       RETURNING album_id`,
      [summary || null, summarySource || null, albumId]
    );

    if (result.rows.length === 0) {
      throw new TransactionAbort(404, { error: 'Album not found' });
    }
  }

  /**
   * Update album country.
   * @param {string} albumId
   * @param {string|null} country
   * @param {string} userId - For logging
   */
  async function updateCountry(albumId, country, userId) {
    validateOptionalTextField(country, 'Invalid country value');

    const trimmedCountry = normalizeOptionalText(country);

    const result = await db.raw(
      'UPDATE albums SET country = $1, updated_at = $2 WHERE album_id = $3 RETURNING album_id',
      [trimmedCountry, new Date(), albumId]
    );

    if (result.rows.length === 0) {
      throw new TransactionAbort(404, { error: 'Album not found' });
    }

    await invalidateCachesForAlbumUsers(albumId);

    logger.info('Album country updated', {
      userId,
      albumId,
      country: trimmedCountry,
    });
  }

  /**
   * Update album genres.
   * @param {string} albumId
   * @param {Object} genres - { genre_1?, genre_2? }
   * @param {string} userId - For logging
   */
  async function updateGenres(albumId, genres, userId) {
    const { genre_1, genre_2 } = genres;

    validateOptionalTextField(genre_1, 'Invalid genre values');
    validateOptionalTextField(genre_2, 'Invalid genre values');

    const fields = buildAlbumMetadataFields({ genre_1, genre_2 });

    if (fields.length === 0) {
      throw new TransactionAbort(400, {
        error: 'No genre updates provided',
      });
    }

    const update = buildPartialUpdate('albums', 'album_id', albumId, fields);
    const result = await db.raw(
      `${update.query} RETURNING album_id`,
      update.values
    );

    if (result.rows.length === 0) {
      throw new TransactionAbort(404, { error: 'Album not found' });
    }

    await invalidateCachesForAlbumUsers(albumId);

    logger.info('Album genres updated', { userId, albumId, genre_1, genre_2 });
  }

  /**
   * Batch update album metadata (country, genres).
   * @param {Array} updates - Array of { albumId, country?, genre_1?, genre_2? }
   * @param {string} userId - For logging
   * @returns {Promise<number>} Number of albums updated
   */
  async function batchUpdate(updates, userId) {
    if (!updates || !Array.isArray(updates) || updates.length === 0) {
      throw new TransactionAbort(400, { error: 'Updates array is required' });
    }

    if (updates.length > 50) {
      throw new TransactionAbort(400, {
        error: 'Maximum 50 updates per batch',
      });
    }

    const timestamp = new Date();
    let successCount = 0;
    const albumIds = new Set();

    await db.withTransaction(async (client) => {
      for (const update of updates) {
        const { albumId, country, genre_1, genre_2 } = update;
        if (!albumId) continue;

        validateOptionalTextField(country, 'Invalid country value');
        validateOptionalTextField(genre_1, 'Invalid genre values');
        validateOptionalTextField(genre_2, 'Invalid genre values');

        const fields = buildAlbumMetadataFields({ country, genre_1, genre_2 });

        const partialUpdate = buildPartialUpdate(
          'albums',
          'album_id',
          albumId,
          fields,
          { timestamp }
        );
        if (!partialUpdate) continue;

        const result = await client.query(
          partialUpdate.query,
          partialUpdate.values
        );

        if (result.rowCount > 0) {
          successCount++;
          albumIds.add(albumId);
        }
      }
    });

    for (const albumId of albumIds) {
      await invalidateCachesForAlbumUsers(albumId);
    }

    logger.info('Batch album update completed', {
      userId,
      requestedCount: updates.length,
      successCount,
    });

    return successCount;
  }

  /**
   * Check for similar albums (fuzzy duplicate detection).
   * @param {Object} newAlbum - { artist, album, album_id? }
   * @returns {Promise<Object>} { hasSimilar, shouldAutoMerge, matches }
   */
  async function checkSimilar(newAlbum) {
    const { artist, album, album_id } = newAlbum;

    if (!artist || !album) {
      throw new TransactionAbort(400, {
        error: 'artist and album are required',
      });
    }

    const albumsResult = await db.raw(`
      SELECT album_id, artist, album, cover_image IS NOT NULL as has_cover
      FROM albums
      WHERE artist IS NOT NULL AND artist != ''
        AND album IS NOT NULL AND album != ''
    `);

    const excludedPairsResult = await db.raw(`
      SELECT album_id_1, album_id_2 FROM album_distinct_pairs
    `);

    const excludePairs = new Set();
    for (const row of excludedPairsResult.rows) {
      excludePairs.add(`${row.album_id_1}::${row.album_id_2}`);
      excludePairs.add(`${row.album_id_2}::${row.album_id_1}`);
    }

    const candidates = albumsResult.rows.map((row) => ({
      album_id: row.album_id,
      artist: row.artist,
      album: row.album,
      hasCover: row.has_cover,
    }));

    const matches = findPotentialDuplicates(
      { artist, album, album_id },
      candidates,
      {
        threshold: 0.1,
        autoMergeThreshold: 0.98,
        maxResults: 3,
        excludePairs,
      }
    );

    const bestMatch = matches[0];
    const shouldAutoMerge = bestMatch?.shouldAutoMerge || false;

    return {
      hasSimilar: matches.length > 0,
      shouldAutoMerge,
      matches: matches.map((m) => ({
        album_id: m.candidate.album_id,
        artist: m.candidate.artist,
        album: m.candidate.album,
        hasCover: m.candidate.hasCover,
        confidence: Math.round(m.confidence * 100),
        shouldAutoMerge: m.shouldAutoMerge,
      })),
    };
  }

  /**
   * Mark two albums as distinct (not the same album).
   * @param {string} albumId1
   * @param {string} albumId2
   * @param {string} userId - For logging/audit
   */
  async function markDistinct(albumId1, albumId2, userId) {
    if (!albumId1 || !albumId2) {
      throw new TransactionAbort(400, {
        error: 'album_id_1 and album_id_2 are required',
      });
    }

    if (albumId1 === albumId2) {
      throw new TransactionAbort(400, {
        error: 'Cannot mark album as distinct from itself',
      });
    }

    const [id1, id2] =
      albumId1 < albumId2 ? [albumId1, albumId2] : [albumId2, albumId1];

    const createdBy = await resolveAuditUserId(userId);

    await db.raw(
      `INSERT INTO album_distinct_pairs (album_id_1, album_id_2, created_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (album_id_1, album_id_2) DO NOTHING`,
      [id1, id2, createdBy]
    );

    logger.info('Albums marked as distinct', {
      album_id_1: id1,
      album_id_2: id2,
      userId,
      createdBy,
    });
  }

  /**
   * Merge metadata into an existing canonical album.
   * @param {Object} albumData - { album_id, artist, album, cover_image, cover_image_format, tracks }
   * @param {string} userId - For logging
   * @returns {Promise<string>} The canonical album_id
   */
  async function mergeMetadata(albumData, userId) {
    if (!albumData.album_id) {
      throw new TransactionAbort(400, { error: 'album_id is required' });
    }

    const timestamp = new Date();
    const canonicalId = await upsertAlbumRecord(albumData, timestamp);

    logger.info('Album metadata merged', {
      album_id: canonicalId,
      userId,
    });

    return canonicalId;
  }

  return {
    getCoverImage,
    getSummary,
    updateSummary,
    updateCountry,
    updateGenres,
    batchUpdate,
    checkSimilar,
    markDistinct,
    mergeMetadata,
  };
}

module.exports = { createAlbumService };
