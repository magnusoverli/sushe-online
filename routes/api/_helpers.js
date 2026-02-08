/**
 * Shared Helper Functions for API Routes
 *
 * These helpers are used across multiple route modules.
 */

// Import shared utilities
const { createAggregateList } = require('../../services/aggregate-list');
const { createAlbumCanonical } = require('../../utils/album-canonical');
const { validateYear } = require('../../utils/validators');
const { TransactionAbort } = require('../../db/transaction');

/**
 * Create helper functions with injected dependencies
 * @param {Object} deps - Dependencies
 * @param {Object} deps.pool - Database connection pool
 * @param {Object} deps.logger - Logger instance
 * @param {Object} deps.responseCache - Response cache instance
 * @param {Object} deps.app - Express app instance
 * @param {Object} deps.crypto - Node.js crypto module
 * @returns {Object} - Helper functions
 */
function createHelpers(deps) {
  const { pool, logger, responseCache, app, crypto } = deps;

  // Create aggregate list instance for recomputation triggers
  const aggregateList = createAggregateList({ pool, logger });

  // Create album canonical instance for deduplication
  const albumCanonical = createAlbumCanonical({ pool, logger });

  /**
   * Helper to trigger aggregate list recomputation for a year (non-blocking)
   * @param {number} year - The year to recompute
   */
  function triggerAggregateListRecompute(year) {
    if (!year) return;
    // Fire and forget - don't block the response
    aggregateList.recompute(year).catch((err) => {
      logger.error(`Failed to recompute aggregate list for year ${year}:`, err);
    });
  }

  /**
   * Helper to trigger album summary fetch for a new album (non-blocking)
   * @param {string} albumId - The album_id
   * @param {string} artist - The artist name
   * @param {string} albumName - The album name
   */
  function triggerAlbumSummaryFetch(albumId, artist, albumName) {
    // Get the album summary service from app.locals (set by admin.js)
    const albumSummaryService = app.locals?.albumSummaryService;
    if (albumSummaryService) {
      albumSummaryService.fetchSummaryAsync(albumId, artist, albumName);
    }
  }

  /**
   * Upsert an album record with canonical deduplication.
   *
   * This ensures only ONE entry per unique artist/album name exists in the
   * albums table, regardless of source (Spotify, MusicBrainz, Tidal, manual).
   *
   * @param {Object} album - Album data to upsert
   * @param {Date} timestamp - Timestamp for created_at/updated_at
   * @param {Object} client - Database client (optional, for transactions)
   * @returns {Promise<string>} - The canonical album_id to use
   */
  async function upsertAlbumRecord(album, timestamp, client = null) {
    // Remove cover_image for backward compatibility (extension may still send it)
    // Cover images are now fetched asynchronously in the background
    const albumDataWithoutCover = { ...album };
    delete albumDataWithoutCover.cover_image;
    delete albumDataWithoutCover.cover_image_format;

    const result = await albumCanonical.upsertCanonical(
      albumDataWithoutCover,
      timestamp,
      client
    );

    // Trigger async summary fetch if needed
    if (result.needsSummaryFetch) {
      triggerAlbumSummaryFetch(result.albumId, album.artist, album.album);
    }

    // Trigger async cover fetch if needed
    if (result.needsCoverFetch && album.artist && album.album) {
      const { getCoverFetchQueue } = require('../../utils/cover-fetch-queue');
      try {
        const coverQueue = getCoverFetchQueue();
        coverQueue.add(result.albumId, album.artist, album.album);
      } catch (error) {
        // Queue not initialized yet - log but don't fail
        logger.warn('Cover fetch queue not available', {
          albumId: result.albumId,
          error: error.message,
        });
      }
    }

    // Trigger async track fetch if needed
    if (result.needsTracksFetch && album.artist && album.album) {
      const { getTrackFetchQueue } = require('../../utils/track-fetch-queue');
      try {
        const trackQueue = getTrackFetchQueue();
        trackQueue.add(result.albumId, album.artist, album.album);
      } catch (error) {
        // Queue not initialized yet - log but don't fail
        logger.warn('Track fetch queue not available', {
          albumId: result.albumId,
          error: error.message,
        });
      }
    }

    return result.albumId;
  }

  /**
   * Batch upsert multiple albums with canonical deduplication.
   * Much faster than individual upserts for bulk operations.
   *
   * @param {Array<Object>} albums - Array of album data objects
   * @param {Date} timestamp - Timestamp for created_at/updated_at
   * @param {Object} client - Database client (for transactions)
   * @returns {Promise<Map>} - Map of artist|album -> { albumId, wasInserted, wasMerged, ... }
   */
  async function batchUpsertAlbumRecords(albums, timestamp, client = null) {
    if (!albums || albums.length === 0) return new Map();

    // Remove cover_image from all albums (backward compatibility)
    const albumsWithoutCovers = albums.map((album) => {
      const cleaned = { ...album };
      delete cleaned.cover_image;
      delete cleaned.cover_image_format;
      return cleaned;
    });

    const results = await albumCanonical.batchUpsertCanonical(
      albumsWithoutCovers,
      timestamp,
      client
    );

    // Trigger async operations for all albums
    const { getCoverFetchQueue } = require('../../utils/cover-fetch-queue');
    const { getTrackFetchQueue } = require('../../utils/track-fetch-queue');
    let coverQueue;
    let trackQueue;
    try {
      coverQueue = getCoverFetchQueue();
    } catch (error) {
      logger.warn('Cover fetch queue not available for batch', {
        error: error.message,
      });
    }
    try {
      trackQueue = getTrackFetchQueue();
    } catch (error) {
      logger.warn('Track fetch queue not available for batch', {
        error: error.message,
      });
    }

    results.forEach((result, key) => {
      const [artist, album] = key.split('|');

      // Trigger summary fetch if needed
      if (result.needsSummaryFetch) {
        triggerAlbumSummaryFetch(result.albumId, artist, album);
      }

      // Trigger cover fetch if needed
      if (result.needsCoverFetch && artist && album && coverQueue) {
        coverQueue.add(result.albumId, artist, album);
      }

      // Trigger track fetch if needed
      if (result.needsTracksFetch && artist && album && trackQueue) {
        trackQueue.add(result.albumId, artist, album);
      }
    });

    return results;
  }

  /**
   * Invalidate list caches for all users who have a specific album in their lists.
   * This ensures that when canonical album data (e.g., genres) is updated,
   * all users who rely on the canonical data (stored NULL in list_items) see the update.
   *
   * @param {string} albumId - The album_id to find affected users for
   */
  async function invalidateCachesForAlbumUsers(albumId) {
    if (!albumId) return;

    try {
      // Find all users who have this album in any of their lists
      const result = await pool.query(
        `SELECT DISTINCT l.user_id 
         FROM lists l 
         JOIN list_items li ON li.list_id = l._id 
         WHERE li.album_id = $1`,
        [albumId]
      );

      // Invalidate list caches for each affected user
      for (const row of result.rows) {
        // Invalidate all list-related caches for this user
        // Need to invalidate BOTH patterns:
        // 1. Metadata endpoint: GET:/api/lists:userId
        // 2. Specific list endpoints: GET:/api/lists/*:userId
        // Using just the userId pattern will match both since they all end with :userId
        responseCache.invalidate(`:${row.user_id}`);
      }

      if (result.rows.length > 0) {
        logger.debug(
          `Invalidated caches for ${result.rows.length} users with album ${albumId}`
        );
      }
    } catch (error) {
      // Log but don't fail the request - cache invalidation is not critical
      logger.warn(`Failed to invalidate caches for album ${albumId}:`, error);
    }
  }

  /**
   * Invalidate list-related caches for a specific user.
   * Consolidates the repeated cache invalidation pattern used across list route handlers.
   *
   * @param {string} userId - The user ID whose caches to invalidate
   * @param {string|null} [listId=null] - Optional specific list ID to invalidate
   * @param {Object} [options] - Additional options
   * @param {boolean} [options.full=true] - Also invalidate the ?full=true variant
   * @param {boolean} [options.groups=false] - Also invalidate groups cache
   */
  function invalidateListCaches(userId, listId = null, options = {}) {
    const { full = true, groups = false } = options;
    if (listId) {
      responseCache.invalidate(`GET:/api/lists/${listId}:${userId}`);
    }
    responseCache.invalidate(`GET:/api/lists:${userId}`);
    if (full) {
      responseCache.invalidate(`GET:/api/lists?full=true:${userId}`);
    }
    if (groups) {
      responseCache.invalidate(`GET:/api/groups:${userId}`);
    }
  }

  /**
   * Find or create a year-group for a user.
   * Validates the year, looks up an existing group, or creates one.
   *
   * @param {Object} queryable - Database client (transaction) or pool
   * @param {string} userId - The user's _id
   * @param {number|string} year - The year value to find/create a group for
   * @returns {Promise<{groupId: number, year: number}>} The serial group id and validated year
   * @throws {TransactionAbort} If year validation fails
   */
  async function findOrCreateYearGroup(queryable, userId, year) {
    const yearValidation = validateYear(year);
    if (!yearValidation.valid) {
      throw new TransactionAbort(400, { error: yearValidation.error });
    }
    const validYear = yearValidation.value;

    let result = await queryable.query(
      `SELECT id FROM list_groups WHERE user_id = $1 AND year = $2`,
      [userId, validYear]
    );

    if (result.rows.length === 0) {
      const newGroupId = crypto.randomBytes(12).toString('hex');
      const maxOrder = await queryable.query(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM list_groups WHERE user_id = $1`,
        [userId]
      );

      result = await queryable.query(
        `INSERT INTO list_groups (_id, user_id, name, year, sort_order, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         RETURNING id`,
        [
          newGroupId,
          userId,
          String(validYear),
          validYear,
          maxOrder.rows[0].next_order,
        ]
      );
    }

    return { groupId: result.rows[0].id, year: validYear };
  }

  /**
   * Find or create an "Uncategorized" group for a user.
   *
   * @param {Object} queryable - Database client (transaction) or pool
   * @param {string} userId - The user's _id
   * @returns {Promise<number>} The serial group id
   */
  async function findOrCreateUncategorizedGroup(queryable, userId) {
    let result = await queryable.query(
      `SELECT id FROM list_groups WHERE user_id = $1 AND name = 'Uncategorized' AND year IS NULL`,
      [userId]
    );

    if (result.rows.length === 0) {
      const newGroupId = crypto.randomBytes(12).toString('hex');
      const maxOrder = await queryable.query(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM list_groups WHERE user_id = $1`,
        [userId]
      );

      result = await queryable.query(
        `INSERT INTO list_groups (_id, user_id, name, year, sort_order, created_at, updated_at)
         VALUES ($1, $2, 'Uncategorized', NULL, $3, NOW(), NOW())
         RETURNING id`,
        [newGroupId, userId, maxOrder.rows[0].next_order]
      );
    }

    return result.rows[0].id;
  }

  /**
   * Delete an auto-managed group (year-group or "Uncategorized") if it has no lists.
   * Custom (user-created) groups are left untouched.
   *
   * @param {Object} queryable - Database client (transaction) or pool
   * @param {number} groupId - The serial group id to check
   */
  async function deleteGroupIfEmptyAutoGroup(queryable, groupId) {
    if (!groupId) return;

    const groupCount = await queryable.query(
      `SELECT COUNT(*) as count FROM lists WHERE group_id = $1`,
      [groupId]
    );

    if (parseInt(groupCount.rows[0].count, 10) === 0) {
      const groupResult = await queryable.query(
        `SELECT year, name FROM list_groups WHERE id = $1`,
        [groupId]
      );

      if (groupResult.rows.length > 0) {
        const isYearGroup = groupResult.rows[0].year !== null;
        const isUncategorized =
          groupResult.rows[0].name === 'Uncategorized' &&
          groupResult.rows[0].year === null;

        if (isYearGroup || isUncategorized) {
          await queryable.query(`DELETE FROM list_groups WHERE id = $1`, [
            groupId,
          ]);
        }
      }
    }
  }

  return {
    triggerAggregateListRecompute,
    triggerAlbumSummaryFetch,
    upsertAlbumRecord,
    batchUpsertAlbumRecords,
    invalidateCachesForAlbumUsers,
    invalidateListCaches,
    findOrCreateYearGroup,
    findOrCreateUncategorizedGroup,
    deleteGroupIfEmptyAutoGroup,
    aggregateList,
    albumCanonical,
  };
}

/**
 * Build a dynamic partial UPDATE query from an array of field/value pairs.
 * Pure function — no database calls or side effects.
 *
 * @param {string} table - Table name (e.g. 'albums', 'lists', 'list_groups')
 * @param {string} idColumn - WHERE clause column name (e.g. 'album_id', 'id')
 * @param {*} idValue - The value to match in the WHERE clause
 * @param {Array<{column: string, value: *}>} fields - Column/value pairs to SET
 * @param {Object} [options] - Optional settings
 * @param {Date|*} [options.timestamp] - Value for updated_at (default: new Date())
 * @returns {{query: string, values: Array}|null} The query and params, or null if fields is empty
 */
function buildPartialUpdate(table, idColumn, idValue, fields, options = {}) {
  if (!fields || fields.length === 0) return null;

  const timestamp =
    options.timestamp !== undefined ? options.timestamp : new Date();
  const setClauses = [];
  const values = [];
  let paramIndex = 1;

  for (const { column, value } of fields) {
    setClauses.push(`${column} = $${paramIndex++}`);
    values.push(value);
  }

  setClauses.push(`updated_at = $${paramIndex++}`);
  values.push(timestamp);

  values.push(idValue);

  return {
    query: `UPDATE ${table} SET ${setClauses.join(', ')} WHERE ${idColumn} = $${paramIndex}`,
    values,
  };
}

module.exports = { createHelpers, buildPartialUpdate };
