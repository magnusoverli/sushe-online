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
const { resolveCountryCode } = require('../utils/musicbrainz');
const { normalizeImageBuffer } = require('../utils/image-processing');
const {
  invalidateResponseCacheForAlbumUsers,
} = require('./album-cache-invalidation');
const { createAlbumCoverService } = require('./album-cover-service');
const {
  createAlbumTaxonomyService,
  projectTaxonomyForRead,
} = require('./album-taxonomy-service');

/**
 * Create album service with injected dependencies
 * @param {Object} [deps]
 * @param {import("../db/types").DbFacade} [deps.db] - Canonical datastore.
 *   Required at runtime: ensureDb() throws when it is absent.
 * @param {Object} [deps.logger] - Logger instance (defaults to utils/logger)
 * @param {Function} [deps.upsertAlbumRecord] - Helper from _helpers.js
 * @param {Object} [deps.responseCache] - Response cache for list invalidation
 * @param {Object} [deps.coverCache] - Cover cache passed through to the cover service
 * @param {ReturnType<typeof createAlbumTaxonomyService>} [deps.albumTaxonomyService]
 * @param {Object} [deps.broadcast] - WebSocket broadcast helpers
 */
// eslint-disable-next-line max-lines-per-function -- Cohesive service module with related album operations
function createAlbumService(deps = {}) {
  const logger = deps.logger || defaultLogger;
  const { upsertAlbumRecord } = deps;
  const responseCache = deps.responseCache;
  const coverCache = deps.coverCache;
  const db = ensureDb(deps.db, 'album-service');
  const albumCoverService = createAlbumCoverService({
    db,
    logger,
    coverCache,
  });
  const albumTaxonomyService =
    deps.albumTaxonomyService || createAlbumTaxonomyService({ db, logger });
  const broadcast = deps.broadcast || require('../utils/websocket').broadcast;

  async function invalidateCachesForAlbumUsers(albumId) {
    return invalidateResponseCacheForAlbumUsers({
      db,
      responseCache,
      logger,
      albumIds: albumId,
      operation: 'album-service',
    });
  }

  async function broadcastTaxonomyUpdate(albumId, taxonomyUpdatedAt) {
    if (typeof broadcast?.albumTaxonomyUpdated !== 'function') return;

    try {
      const result = await db.raw(
        `SELECT DISTINCT l.user_id
         FROM lists l
         JOIN list_items li ON li.list_id = l._id
         WHERE li.album_id = $1`,
        [albumId],
        {
          name: 'album-service-broadcast-taxonomy-update',
          retryable: true,
        }
      );
      for (const row of result.rows) {
        broadcast.albumTaxonomyUpdated(row.user_id, albumId, taxonomyUpdatedAt);
      }
    } catch (error) {
      logger.warn('Failed to broadcast album taxonomy update', {
        albumId,
        error: error.message,
      });
    }
  }

  async function notifyTaxonomyUpdated(albumId, taxonomyUpdatedAt) {
    await invalidateCachesForAlbumUsers(albumId);
    await broadcastTaxonomyUpdate(albumId, taxonomyUpdatedAt);
  }

  function validateOptionalTextField(value, errorMessage) {
    if (value !== null && value !== undefined && typeof value !== 'string') {
      throw new TransactionAbort(400, { error: errorMessage });
    }
  }

  function normalizeOptionalText(value) {
    return value ? value.trim() : null;
  }

  function normalizeCountryValue(country) {
    const normalized = normalizeOptionalText(country);
    if (!normalized || normalized.length !== 2) return normalized;
    return resolveCountryCode(normalized) || normalized;
  }

  /**
   * Build the column/value pairs for a partial album metadata update.
   * Each key is optional: an omitted key leaves that column untouched.
   *
   * @param {Object} input
   * @param {string|null} [input.country]
   * @param {string|null} [input.genre_1]
   * @param {string|null} [input.genre_2]
   * @returns {Array<{ column: string, value: string|null }>}
   */
  function buildAlbumMetadataFields({ country, genre_1, genre_2 }) {
    const fields = [];

    if (country !== undefined) {
      fields.push({ column: 'country', value: normalizeCountryValue(country) });
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

  // Trigger a background cover fetch for an album whose cover is missing.
  function triggerLazyCoverFetch(albumId, artist, album) {
    const { getCoverFetchQueue } = require('./cover-fetch-queue');
    try {
      getCoverFetchQueue().add(albumId, artist, album);
      logger.debug('Triggered lazy cover fetch', { albumId, artist, album });
    } catch (error) {
      logger.warn('Cover fetch queue not available for lazy fetch', {
        albumId,
        error: error.message,
      });
    }
  }

  function coverContentType(format) {
    return format ? `image/${format.toLowerCase()}` : 'image/jpeg';
  }

  /**
   * Get album cover metadata WITHOUT reading the image bytes.
   * Lets the route compute an ETag and answer conditional GETs (304) cheaply,
   * skipping the BYTEA read entirely on revalidations. Mirrors getCoverImage's
   * missing-cover handling (lazy background fetch + 404).
   * @param {string} albumId
   * @returns {Promise<Object>} { albumId, contentType, coverImageUpdatedAt, coverLength }
   */
  async function getCoverMeta(albumId, options = {}) {
    const thumbnail = options.size === 'thumb';
    const result = await db.raw(
      `SELECT cover_image_format,
              cover_image_updated_at,
              cover_thumbnail_format,
              cover_thumbnail_updated_at,
              updated_at,
              artist,
              album,
              octet_length(cover_image) AS cover_length,
              octet_length(cover_thumbnail) AS cover_thumbnail_length
       FROM albums WHERE album_id = $1`,
      [albumId]
    );

    if (!result.rows.length) {
      throw new TransactionAbort(404, { error: 'Album not found' });
    }

    const album = result.rows[0];
    const coverLength = album.cover_length || 0;
    const thumbnailLength = album.cover_thumbnail_length || 0;
    const selectedLength = thumbnail
      ? thumbnailLength || coverLength
      : coverLength;
    const selectedFormat = thumbnail
      ? album.cover_thumbnail_format || album.cover_image_format
      : album.cover_image_format;
    const selectedUpdatedAt = thumbnail
      ? album.cover_thumbnail_updated_at || album.cover_image_updated_at
      : album.cover_image_updated_at;

    if (!coverLength && album.artist && album.album) {
      triggerLazyCoverFetch(albumId, album.artist, album.album);
      throw new TransactionAbort(404, {
        error: 'Image not found (fetching in background)',
      });
    }

    if (!coverLength) {
      throw new TransactionAbort(404, { error: 'Image not found' });
    }

    return {
      albumId,
      contentType: coverContentType(selectedFormat),
      coverImageUpdatedAt: selectedUpdatedAt || album.updated_at,
      coverLength: selectedLength,
    };
  }

  /**
   * Get album cover image data.
   * If cover is missing, triggers an async background fetch.
   * @param {string} albumId
   * @returns {Promise<Object>} { imageBuffer, contentType } or throws
   */
  async function getCoverImage(albumId, options = {}) {
    const thumbnail = options.size === 'thumb';
    const result = await db.raw(
      `SELECT cover_image,
              cover_image_format,
              cover_image_updated_at,
              cover_thumbnail,
              cover_thumbnail_format,
              cover_thumbnail_updated_at,
              updated_at,
              artist,
              album
       FROM albums WHERE album_id = $1`,
      [albumId]
    );

    if (!result.rows.length) {
      throw new TransactionAbort(404, { error: 'Album not found' });
    }

    const album = result.rows[0];

    // If cover is missing, trigger async fetch
    if (!album.cover_image && album.artist && album.album) {
      triggerLazyCoverFetch(albumId, album.artist, album.album);
      throw new TransactionAbort(404, {
        error: 'Image not found (fetching in background)',
      });
    }

    if (!album.cover_image) {
      throw new TransactionAbort(404, { error: 'Image not found' });
    }

    const selectedImage =
      thumbnail && album.cover_thumbnail
        ? album.cover_thumbnail
        : album.cover_image;
    const selectedFormat =
      thumbnail && album.cover_thumbnail
        ? album.cover_thumbnail_format
        : album.cover_image_format;
    const selectedUpdatedAt =
      thumbnail && album.cover_thumbnail
        ? album.cover_thumbnail_updated_at
        : album.cover_image_updated_at;

    const imageBuffer = normalizeImageBuffer(selectedImage);

    return {
      imageBuffer,
      contentType: coverContentType(selectedFormat),
      albumId,
      coverImageUpdatedAt: selectedUpdatedAt || album.updated_at,
    };
  }

  function getCachedCover(albumId, options = {}) {
    if (!coverCache || typeof coverCache.get !== 'function') return null;
    return coverCache.get({
      albumId,
      size: options.size || 'full',
      version: options.version,
    });
  }

  function cacheCover(albumId, options = {}) {
    if (!coverCache || typeof coverCache.set !== 'function') return false;
    return coverCache.set({
      albumId,
      size: options.size || 'full',
      version: options.version,
      imageBuffer: options.imageBuffer,
      contentType: options.contentType,
      headers: options.headers,
    });
  }

  async function updateCoverImage(albumId, coverImagePayload, userId) {
    const result = await albumCoverService.updateCoverImage(
      albumId,
      coverImagePayload,
      userId
    );
    await invalidateCachesForAlbumUsers(albumId);
    return result;
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

    const trimmedCountry = normalizeCountryValue(country);

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

    if (genre_1 === undefined && genre_2 === undefined) {
      throw new TransactionAbort(400, {
        error: 'No genre updates provided',
      });
    }
    const taxonomyResult = await albumTaxonomyService.applyManualGenreOverrides(
      albumId,
      {
        ...(genre_1 !== undefined && { genre_1 }),
        ...(genre_2 !== undefined && { genre_2 }),
      },
      { updatedBy: userId == null ? null : String(userId) }
    );

    await notifyTaxonomyUpdated(
      albumId,
      taxonomyResult?.taxonomy_updated_at || null
    );

    logger.info('Album genres updated', { userId, albumId, genre_1, genre_2 });
  }

  async function resetGenres(albumId, userId) {
    const taxonomyResult = await albumTaxonomyService.resetManualGenreOverrides(
      albumId,
      {
        updatedBy: userId == null ? null : String(userId),
      }
    );
    await notifyTaxonomyUpdated(
      albumId,
      taxonomyResult?.taxonomy_updated_at || null
    );
    logger.info('Album genre overrides reset', { userId, albumId });
  }

  async function getTaxonomy(albumId) {
    const result = await db.raw(
      `SELECT album_taxonomy, taxonomy_updated_at, genre_1, genre_2
       FROM albums WHERE album_id = $1`,
      [albumId]
    );
    if (result.rows.length === 0) {
      throw new TransactionAbort(404, { error: 'Album not found' });
    }
    const row = result.rows[0];
    return {
      taxonomy: projectTaxonomyForRead(row.album_taxonomy),
      taxonomy_updated_at: row.taxonomy_updated_at || null,
      genre_1: row.genre_1 || '',
      genre_2: row.genre_2 || '',
    };
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
    const taxonomyUpdates = new Map();

    await db.withTransaction(async (client) => {
      for (const update of updates) {
        const { albumId, country, genre_1, genre_2 } = update;
        if (!albumId) continue;

        validateOptionalTextField(country, 'Invalid country value');
        validateOptionalTextField(genre_1, 'Invalid genre values');
        validateOptionalTextField(genre_2, 'Invalid genre values');

        let wasUpdated = false;
        const countryFields = buildAlbumMetadataFields({ country });
        const partialUpdate = buildPartialUpdate(
          'albums',
          'album_id',
          albumId,
          countryFields,
          { timestamp }
        );
        if (partialUpdate) {
          const result = await client.query(
            partialUpdate.query,
            partialUpdate.values
          );
          wasUpdated = result.rowCount > 0;
        }

        if (genre_1 !== undefined || genre_2 !== undefined) {
          try {
            const taxonomyResult =
              await albumTaxonomyService.applyManualGenreOverrides(
                albumId,
                {
                  ...(genre_1 !== undefined && { genre_1 }),
                  ...(genre_2 !== undefined && { genre_2 }),
                },
                {
                  client,
                  updatedBy: userId == null ? null : String(userId),
                }
              );
            wasUpdated = !!taxonomyResult || wasUpdated;
            if (taxonomyResult) {
              taxonomyUpdates.set(
                albumId,
                taxonomyResult.taxonomy_updated_at || null
              );
            }
          } catch (error) {
            if (
              !(error instanceof TransactionAbort) ||
              error.statusCode !== 404
            ) {
              throw error;
            }
          }
        }

        if (wasUpdated) {
          successCount++;
          albumIds.add(albumId);
        }
      }
    });

    for (const albumId of albumIds) {
      await invalidateCachesForAlbumUsers(albumId);
    }
    for (const [albumId, taxonomyUpdatedAt] of taxonomyUpdates) {
      await broadcastTaxonomyUpdate(albumId, taxonomyUpdatedAt);
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

    // Run the candidate scan and the excluded-pairs lookup concurrently
    // instead of serially. (A pg_trgm pre-filter on the candidate scan was
    // considered, but the fuzzy scorer uses Levenshtein/token similarity with
    // a low 0.35 per-field floor that trigram similarity cannot reproduce
    // exactly, so pre-filtering risks changing which review candidates surface.)
    const [albumsResult, excludedPairsResult] = await Promise.all([
      db.raw(`
        SELECT album_id, artist, album, cover_image IS NOT NULL as has_cover
        FROM albums
        WHERE artist IS NOT NULL AND artist != ''
          AND album IS NOT NULL AND album != ''
      `),
      db.raw(`
        SELECT album_id_1, album_id_2 FROM album_distinct_pairs
      `),
    ]);

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
    getCoverMeta,
    getCoverImage,
    getCachedCover,
    cacheCover,
    updateCoverImage,
    getSummary,
    updateSummary,
    updateCountry,
    updateGenres,
    resetGenres,
    getTaxonomy,
    notifyTaxonomyUpdated,
    batchUpdate,
    checkSimilar,
    markDistinct,
    mergeMetadata,
  };
}

module.exports = { createAlbumService };
