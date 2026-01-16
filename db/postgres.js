const { Pool } = require('pg');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { observeDbQuery, updateDbPoolMetrics } = require('../utils/metrics');

async function waitForPostgres(pool, retries = 10, interval = 3000) {
  logger.info('Checking PostgreSQL connection...');
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query('SELECT 1');
      logger.info('PostgreSQL is reachable');
      return;
    } catch {
      logger.info(`Waiting for PostgreSQL... (${i + 1}/${retries})`);
      await new Promise((res) => setTimeout(res, interval));
    }
  }
  throw new Error('PostgreSQL not reachable');
}

async function warmConnections(pool) {
  logger.info('Warming database connections...');
  const warmupPromises = [];

  // Create minimum number of connections by running simple queries
  for (let i = 0; i < (pool.options.min || 5); i++) {
    warmupPromises.push(
      pool.query('SELECT 1 as warmup').catch((err) => {
        logger.warn('Connection warmup failed', {
          attempt: i + 1,
          error: err.message,
        });
      })
    );
  }

  await Promise.all(warmupPromises);
  logger.info(`Warmed ${warmupPromises.length} database connections`);
}

class PgDatastore {
  constructor(pool, table, fieldMap) {
    this.pool = pool;
    this.table = table;
    this.fieldMap = fieldMap;
    this.logQueries = process.env.LOG_SQL === 'true';
    this.inverseMap = Object.fromEntries(
      Object.entries(fieldMap).map(([k, v]) => [v, k])
    );
    this.cache = new Map();
    this.cacheTimeout = 60000; // 1 minute cache for static data
    this.maxCacheSize = 500; // Maximum cache entries to prevent unbounded growth
  }

  _prepareValue(val) {
    if (val instanceof Date || Buffer.isBuffer(val) || val === null) {
      return val;
    }
    const type = typeof val;
    if (type === 'object') {
      return JSON.stringify(val);
    }
    return val;
  }

  _callbackify(promise, cb) {
    if (typeof cb === 'function') {
      promise.then((r) => cb(null, r)).catch((err) => cb(err));
      return;
    }
    return promise;
  }

  _sanitizeParams(params) {
    if (!params || !Array.isArray(params)) return params;
    return params.map((param) => {
      // Handle Buffer (BYTEA) - show size instead of binary content
      if (Buffer.isBuffer(param)) {
        return `[BYTEA: ${param.length} bytes]`;
      }
      if (
        typeof param === 'string' &&
        param.length > 100 &&
        /^[A-Za-z0-9+/=]+$/.test(param)
      ) {
        return `[base64 data: ${param.length} chars]`;
      }
      if (typeof param === 'string' && param.startsWith('data:image/')) {
        return `[data URI: ${param.length} chars]`;
      }
      return param;
    });
  }

  async _query(text, params) {
    if (this.logQueries) {
      logger.debug('SQL', {
        query: text,
        params: this._sanitizeParams(params),
      });
    }
    // Extract operation type from query for metrics
    const operation = this._extractOperation(text);
    const startTime = Date.now();
    try {
      const result = await this.pool.query(text, params);
      observeDbQuery(operation, Date.now() - startTime);
      return result;
    } catch (error) {
      observeDbQuery(operation, Date.now() - startTime);
      throw error;
    }
  }

  async _preparedQuery(name, text, params) {
    if (this.logQueries) {
      logger.debug('Prepared SQL', {
        name,
        query: text,
        params: this._sanitizeParams(params),
      });
    }
    // Extract operation type from query for metrics
    const operation = this._extractOperation(text);
    const startTime = Date.now();
    try {
      const result = await this.pool.query({ name, text }, params);
      observeDbQuery(operation, Date.now() - startTime);
      return result;
    } catch (error) {
      observeDbQuery(operation, Date.now() - startTime);
      throw error;
    }
  }

  /**
   * Extract SQL operation type from query text
   * @param {string} text - SQL query text
   * @returns {string} Operation type (select, insert, update, delete, other)
   */
  _extractOperation(text) {
    if (!text) return 'other';
    const trimmed = text.trim().toLowerCase();
    if (trimmed.startsWith('select')) return 'select';
    if (trimmed.startsWith('insert')) return 'insert';
    if (trimmed.startsWith('update')) return 'update';
    if (trimmed.startsWith('delete')) return 'delete';
    return 'other';
  }

  _mapField(field) {
    return this.fieldMap[field] || field;
  }

  _buildWhere(query, startIndex = 1) {
    const conditions = [];
    const values = [];
    let idx = startIndex;
    for (const [field, val] of Object.entries(query)) {
      const col = this._mapField(field);
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        if ('$gt' in val) {
          conditions.push(`${col} > $${idx}`);
          values.push(this._prepareValue(val['$gt']));
          idx++;
        } else if ('$exists' in val) {
          if (val['$exists']) {
            conditions.push(`${col} IS NOT NULL`);
          } else {
            conditions.push(`${col} IS NULL`);
          }
        } else {
          conditions.push(`${col} = $${idx}`);
          values.push(this._prepareValue(val));
          idx++;
        }
      } else {
        conditions.push(`${col} = $${idx}`);
        values.push(this._prepareValue(val));
        idx++;
      }
    }
    return {
      text: conditions.length ? 'WHERE ' + conditions.join(' AND ') : '',
      values,
    };
  }

  _mapRow(row) {
    const mapped = {};
    for (const [col, val] of Object.entries(row)) {
      mapped[this.inverseMap[col] || col] = val;
    }
    return mapped;
  }

  findOne(query, cb) {
    const promise = (async () => {
      const { text, values } = this._buildWhere(query);
      const queryText = `SELECT * FROM ${this.table} ${text} LIMIT 1`;
      const queryName = `findOne_${this.table}_${Object.keys(query).join('_')}`;
      const res = await this._preparedQuery(queryName, queryText, values);
      return res.rows[0] ? this._mapRow(res.rows[0]) : null;
    })();
    return this._callbackify(promise, cb);
  }

  find(query, cb) {
    const promise = (async () => {
      const { text, values } = this._buildWhere(query);
      const queryText = `SELECT * FROM ${this.table} ${text}`;
      const queryName = `find_${this.table}_${Object.keys(query).join('_')}`;
      const res = await this._preparedQuery(queryName, queryText, values);
      return res.rows.map((r) => this._mapRow(r));
    })();
    return this._callbackify(promise, cb);
  }

  count(query, cb) {
    const promise = (async () => {
      const { text, values } = this._buildWhere(query);
      const res = await this._query(
        `SELECT COUNT(*) AS cnt FROM ${this.table} ${text}`,
        values
      );
      return parseInt(res.rows[0].cnt, 10);
    })();
    return this._callbackify(promise, cb);
  }

  insert(doc, cb) {
    const promise = (async () => {
      if (!('_id' in doc)) {
        doc._id = crypto.randomBytes(12).toString('hex');
      }
      const cols = [];
      const placeholders = [];
      const values = [];
      let idx = 1;
      for (const [field, val] of Object.entries(doc)) {
        const col = this._mapField(field);
        cols.push(col);
        placeholders.push(`$${idx}`);
        values.push(this._prepareValue(val));
        idx++;
      }
      const res = await this._query(
        `INSERT INTO ${this.table} (${cols.join(',')}) VALUES (${placeholders.join(',')}) RETURNING *`,
        values
      );
      return this._mapRow(res.rows[0]);
    })();
    return this._callbackify(promise, cb);
  }

  update(query, update, options = {}, cb) {
    if (typeof options === 'function') {
      cb = options;
      options = {};
    }
    const promise = (async () => {
      const { $set = {}, $unset = {} } = update;
      const setClauses = [];
      const values = [];
      let idx = 1;
      for (const [field, val] of Object.entries($set)) {
        setClauses.push(`${this._mapField(field)} = $${idx}`);
        values.push(this._prepareValue(val));
        idx++;
      }
      for (const field of Object.keys($unset)) {
        setClauses.push(`${this._mapField(field)} = NULL`);
      }
      if (setClauses.length === 0) return 0;
      const where = this._buildWhere(query, idx);
      const res = await this._query(
        `UPDATE ${this.table} SET ${setClauses.join(', ')} ${where.text}`,
        values.concat(where.values)
      );
      return res.rowCount;
    })();
    return this._callbackify(promise, cb);
  }

  remove(query, options = {}, cb) {
    if (typeof options === 'function') {
      cb = options;
      options = {};
    }
    const promise = (async () => {
      const { text, values } = this._buildWhere(query);
      const res = await this._query(
        `DELETE FROM ${this.table} ${text}`,
        values
      );
      return res.rowCount;
    })();
    return this._callbackify(promise, cb);
  }

  /**
   * Update a single field by _id using a prepared statement
   * Optimized for frequent updates like last_activity where query plan caching helps
   *
   * @param {string} id - The _id value to match
   * @param {string} field - The field name to update (in app naming, e.g., 'lastActivity')
   * @param {*} value - The new value
   * @param {Function} cb - Optional callback
   * @returns {Promise<number>} - Number of rows updated
   */
  updateFieldById(id, field, value, cb) {
    const promise = (async () => {
      const col = this._mapField(field);
      const queryName = `updateField_${this.table}_${col}`;
      const queryText = `UPDATE ${this.table} SET ${col} = $1 WHERE _id = $2`;
      const res = await this._preparedQuery(queryName, queryText, [
        this._prepareValue(value),
        id,
      ]);
      return res.rowCount;
    })();
    return this._callbackify(promise, cb);
  }

  /**
   * Find lists with item counts in a single query
   * Replaces N+1 pattern of find() + N count() calls
   * Only available for lists table
   *
   * @param {Object} query - Query filter (e.g., { userId: 'xxx' })
   * @returns {Promise<Array>} - Lists with itemCount property
   */
  async findWithCounts(query) {
    if (this.table !== 'lists') {
      throw new Error('findWithCounts only available for lists table');
    }

    const { text, values } = this._buildWhere(query);
    // Prefix column references with 'l.' to disambiguate from joined tables
    const prefixedText = text.replace(/WHERE /i, 'WHERE l.');
    const queryName = `findWithCounts_lists_v3_${Object.keys(query).join('_')}`;
    const queryText = `
      SELECT l.*, COUNT(li._id) as item_count,
             g._id as group_external_id, g.name as group_name, g.year as group_year, g.sort_order as group_sort_order
      FROM lists l
      LEFT JOIN list_items li ON li.list_id = l._id
      LEFT JOIN list_groups g ON l.group_id = g.id
      ${prefixedText}
      GROUP BY l.id, g.id
      ORDER BY l.sort_order, l.name
    `;

    const res = await this._preparedQuery(queryName, queryText, values);
    return res.rows.map((row) => {
      const mapped = this._mapRow(row);
      // Add itemCount as a number (COUNT returns string in some drivers)
      mapped.itemCount = parseInt(row.item_count, 10) || 0;
      // Add group info if available
      if (row.group_external_id) {
        mapped.group = {
          _id: row.group_external_id,
          name: row.group_name,
          year: row.group_year,
          sortOrder: row.group_sort_order,
          isYearGroup: row.group_year !== null,
        };
      } else {
        mapped.group = null;
      }
      return mapped;
    });
  }

  // Find albums by album_id (MusicBrainz IDs)
  async findByAlbumIds(albumIds, cb) {
    const promise = (async () => {
      if (!albumIds || albumIds.length === 0) return [];

      // Check cache
      const cacheKey = `findByAlbumIds_${albumIds.sort().join(',')}`;
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
        return cached.data;
      }

      const placeholders = albumIds.map((_, i) => `$${i + 1}`).join(',');
      const queryText = `SELECT * FROM ${this.table} WHERE ${this._mapField('albumId')} IN (${placeholders})`;
      const queryName = `findByAlbumIds_${this.table}_${albumIds.length}`;
      const res = await this._preparedQuery(queryName, queryText, albumIds);
      const result = res.rows.map((r) => this._mapRow(r));

      // Cache result with size limit (evict oldest entries if needed)
      if (this.cache.size >= this.maxCacheSize) {
        // Remove oldest entry (first key in Map iteration order)
        const firstKey = this.cache.keys().next().value;
        this.cache.delete(firstKey);
      }
      this.cache.set(cacheKey, { data: result, timestamp: Date.now() });

      return result;
    })();
    return this._callbackify(promise, cb);
  }

  /**
   * Find list items with album data in a single JOIN query
   * Optimized for performance - reduces 3 queries to 1
   * @param {string} listId - The list ID to fetch items for
   * @param {string} userId - Optional user ID to fetch track picks (required for track picks)
   * @returns {Promise<Array>} Array of list items with merged album data
   */
  async findWithAlbumData(listId, userId = null) {
    if (this.table !== 'list_items') {
      throw new Error('findWithAlbumData only available for list_items table');
    }

    // Use prepared statement with consistent naming
    // V4 includes track_picks joins when userId is provided
    const queryName = userId
      ? 'findListItemsWithAlbumsV4_withPicks'
      : 'findListItemsWithAlbumsV4';
    const queryText = userId
      ? `
      SELECT 
        li._id,
        li.list_id,
        li.position,
        li.track_pick,
        li.comments,
        li.album_id,
        -- Prefer list_items data, fallback to albums table using COALESCE
        COALESCE(NULLIF(li.artist, ''), a.artist) as artist,
        COALESCE(NULLIF(li.album, ''), a.album) as album,
        COALESCE(NULLIF(li.release_date, ''), a.release_date) as release_date,
        COALESCE(NULLIF(li.country, ''), a.country) as country,
        COALESCE(NULLIF(li.genre_1, ''), a.genre_1) as genre_1,
        COALESCE(NULLIF(li.genre_2, ''), a.genre_2) as genre_2,
        COALESCE(li.tracks, a.tracks) as tracks,
        -- For cover_image: if list_item has a custom cover (NOT NULL), use it
        -- Otherwise fall back to album's cover. BYTEA can't be empty string.
        COALESCE(li.cover_image, a.cover_image) as cover_image,
        COALESCE(NULLIF(li.cover_image_format, ''), a.cover_image_format) as cover_image_format,
        -- Album summary (stored on canonical albums table only)
        a.summary as summary,
        a.summary_source as summary_source,
        -- Track picks from normalized table
        tp_primary.track_identifier as primary_track,
        tp_secondary.track_identifier as secondary_track
      FROM list_items li
      LEFT JOIN albums a ON li.album_id = a.album_id
      LEFT JOIN track_picks tp_primary ON tp_primary.user_id = $2 
        AND tp_primary.album_id = li.album_id AND tp_primary.priority = 1
      LEFT JOIN track_picks tp_secondary ON tp_secondary.user_id = $2 
        AND tp_secondary.album_id = li.album_id AND tp_secondary.priority = 2
      WHERE li.list_id = $1
      ORDER BY li.position
    `
      : `
      SELECT 
        li._id,
        li.list_id,
        li.position,
        li.track_pick,
        li.comments,
        li.album_id,
        -- Prefer list_items data, fallback to albums table using COALESCE
        COALESCE(NULLIF(li.artist, ''), a.artist) as artist,
        COALESCE(NULLIF(li.album, ''), a.album) as album,
        COALESCE(NULLIF(li.release_date, ''), a.release_date) as release_date,
        COALESCE(NULLIF(li.country, ''), a.country) as country,
        COALESCE(NULLIF(li.genre_1, ''), a.genre_1) as genre_1,
        COALESCE(NULLIF(li.genre_2, ''), a.genre_2) as genre_2,
        COALESCE(li.tracks, a.tracks) as tracks,
        -- For cover_image: if list_item has a custom cover (NOT NULL), use it
        -- Otherwise fall back to album's cover. BYTEA can't be empty string.
        COALESCE(li.cover_image, a.cover_image) as cover_image,
        COALESCE(NULLIF(li.cover_image_format, ''), a.cover_image_format) as cover_image_format,
        -- Album summary (stored on canonical albums table only)
        a.summary as summary,
        a.summary_source as summary_source
      FROM list_items li
      LEFT JOIN albums a ON li.album_id = a.album_id
      WHERE li.list_id = $1
      ORDER BY li.position
    `;

    const params = userId ? [listId, userId] : [listId];
    const res = await this._preparedQuery(queryName, queryText, params);

    // Map result rows to expected format
    return res.rows.map((row) => ({
      _id: row._id,
      listId: row.list_id,
      position: row.position,
      artist: row.artist || '',
      album: row.album || '',
      albumId: row.album_id || '',
      releaseDate: row.release_date || '',
      country: row.country || '',
      genre1: row.genre_1 || '',
      genre2: row.genre_2 || '',
      // Legacy field - keep for backward compatibility during transition
      trackPick: row.track_pick || '',
      // New normalized track picks
      primaryTrack: row.primary_track || null,
      secondaryTrack: row.secondary_track || null,
      comments: row.comments || '',
      tracks: row.tracks || null,
      coverImage: row.cover_image || '',
      coverImageFormat: row.cover_image_format || '',
      summary: row.summary || '',
      summarySource: row.summary_source || '',
    }));
  }

  /**
   * Find all lists with items for a user in a single JOIN query
   * OPTIMIZATION: Replaces N+1 pattern when fetching all lists in full mode
   * @param {string} userId - The user ID to fetch lists for
   * @returns {Promise<Array>} Array of rows with list and item data
   */
  async findAllUserListsWithItems(userId) {
    if (this.table !== 'lists') {
      throw new Error(
        'findAllUserListsWithItems only available for lists table'
      );
    }

    const queryName = 'findAllUserListsWithItemsV4';
    const queryText = `
      SELECT 
        l._id as list_id,
        l.name as list_name,
        l.year,
        l.is_main,
        li._id as item_id,
        li.position,
        li.album_id,
        li.track_pick,
        li.comments,
        COALESCE(NULLIF(li.artist, ''), a.artist) as artist,
        COALESCE(NULLIF(li.album, ''), a.album) as album,
        COALESCE(NULLIF(li.release_date, ''), a.release_date) as release_date,
        COALESCE(NULLIF(li.country, ''), a.country) as country,
        COALESCE(NULLIF(li.genre_1, ''), a.genre_1) as genre_1,
        COALESCE(NULLIF(li.genre_2, ''), a.genre_2) as genre_2,
        COALESCE(li.tracks, a.tracks) as tracks,
        COALESCE(NULLIF(li.cover_image, ''), a.cover_image) as cover_image,
        COALESCE(NULLIF(li.cover_image_format, ''), a.cover_image_format) as cover_image_format,
        a.summary as summary,
        a.summary_source as summary_source,
        tp_primary.track_identifier as primary_track,
        tp_secondary.track_identifier as secondary_track
      FROM lists l
      LEFT JOIN list_items li ON li.list_id = l._id
      LEFT JOIN albums a ON li.album_id = a.album_id
      LEFT JOIN track_picks tp_primary ON tp_primary.user_id = l.user_id 
        AND tp_primary.album_id = li.album_id AND tp_primary.priority = 1
      LEFT JOIN track_picks tp_secondary ON tp_secondary.user_id = l.user_id 
        AND tp_secondary.album_id = li.album_id AND tp_secondary.priority = 2
      WHERE l.user_id = $1
      ORDER BY l.sort_order, l.name, li.position
    `;

    const res = await this._preparedQuery(queryName, queryText, [userId]);
    return res.rows;
  }

  /**
   * Find track picks for a user and specific album IDs
   * @param {string} userId - The user ID
   * @param {string[]} albumIds - Array of album IDs to fetch picks for
   * @returns {Promise<Object>} Map of albumId -> { primary, secondary }
   */
  async findTrackPicksForAlbums(userId, albumIds) {
    if (this.table !== 'track_picks') {
      throw new Error(
        'findTrackPicksForAlbums only available for track_picks table'
      );
    }

    if (!albumIds || albumIds.length === 0) {
      return {};
    }

    const placeholders = albumIds.map((_, i) => `$${i + 2}`).join(',');
    const queryName = `findTrackPicksForAlbums_${albumIds.length}`;
    const queryText = `
      SELECT album_id, track_identifier, priority
      FROM track_picks
      WHERE user_id = $1 AND album_id IN (${placeholders})
      ORDER BY album_id, priority
    `;

    const res = await this._preparedQuery(queryName, queryText, [
      userId,
      ...albumIds,
    ]);

    // Group by album_id
    const result = {};
    for (const row of res.rows) {
      if (!result[row.album_id]) {
        result[row.album_id] = { primary: null, secondary: null };
      }
      if (row.priority === 1) {
        result[row.album_id].primary = row.track_identifier;
      } else if (row.priority === 2) {
        result[row.album_id].secondary = row.track_identifier;
      }
    }

    return result;
  }

  /**
   * Set track pick for a user's album
   * Handles the click logic: first click = secondary, second click = promote to primary
   * @param {string} userId - The user ID
   * @param {string} albumId - The album ID
   * @param {string} trackIdentifier - The track to set
   * @param {number} targetPriority - The target priority (1=primary, 2=secondary)
   * @returns {Promise<Object>} Updated track picks for this album
   */
  async setTrackPick(userId, albumId, trackIdentifier, targetPriority) {
    if (this.table !== 'track_picks') {
      throw new Error('setTrackPick only available for track_picks table');
    }

    const crypto = require('crypto');

    // Use a transaction to prevent race conditions with concurrent calls
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Get current picks for this album (with FOR UPDATE lock)
      const current = await client.query(
        `SELECT _id, track_identifier, priority FROM track_picks 
         WHERE user_id = $1 AND album_id = $2 FOR UPDATE`,
        [userId, albumId]
      );

      const currentPicks = current.rows;
      const existingTrack = currentPicks.find(
        (p) => p.track_identifier === trackIdentifier
      );
      const existingAtPriority = currentPicks.find(
        (p) => p.priority === targetPriority
      );

      if (existingTrack) {
        if (existingTrack.priority === targetPriority) {
          // Clicking same track at same priority = deselect
          await client.query(`DELETE FROM track_picks WHERE _id = $1`, [
            existingTrack._id,
          ]);
        } else {
          // Promoting: track exists at different priority (e.g., secondary → primary)
          // Store the old priority before we modify anything
          const oldPriority = existingTrack.priority;

          // If there's already something at target priority, we need to swap
          if (existingAtPriority) {
            // Use a temporary priority (0) to avoid unique constraint violation
            // Step 1: Move existing target to temporary priority
            await client.query(
              `UPDATE track_picks SET priority = 0, updated_at = NOW() WHERE _id = $1`,
              [existingAtPriority._id]
            );
            // Step 2: Move our track to target priority
            await client.query(
              `UPDATE track_picks SET priority = $1, updated_at = NOW() WHERE _id = $2`,
              [targetPriority, existingTrack._id]
            );
            // Step 3: Move the old target to our old priority (demote it)
            await client.query(
              `UPDATE track_picks SET priority = $1, updated_at = NOW() WHERE _id = $2`,
              [oldPriority, existingAtPriority._id]
            );
          } else {
            // No conflict, just update priority directly
            await client.query(
              `UPDATE track_picks SET priority = $1, updated_at = NOW() WHERE _id = $2`,
              [targetPriority, existingTrack._id]
            );
          }
        }
      } else {
        // New track selection
        if (existingAtPriority) {
          // Replace existing at this priority
          await client.query(
            `UPDATE track_picks SET track_identifier = $1, updated_at = NOW() WHERE _id = $2`,
            [trackIdentifier, existingAtPriority._id]
          );
        } else {
          // Insert new
          const _id = crypto.randomBytes(12).toString('hex');
          await client.query(
            `INSERT INTO track_picks (_id, user_id, album_id, track_identifier, priority, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
            [_id, userId, albumId, trackIdentifier, targetPriority]
          );
        }
      }

      // Return updated state
      const updated = await client.query(
        `SELECT track_identifier, priority FROM track_picks 
         WHERE user_id = $1 AND album_id = $2 ORDER BY priority`,
        [userId, albumId]
      );

      await client.query('COMMIT');

      return {
        primary:
          updated.rows.find((r) => r.priority === 1)?.track_identifier || null,
        secondary:
          updated.rows.find((r) => r.priority === 2)?.track_identifier || null,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Remove a track pick
   * @param {string} userId - The user ID
   * @param {string} albumId - The album ID
   * @param {string} trackIdentifier - The track to remove (optional, removes all if not specified)
   * @returns {Promise<Object>} Updated track picks for this album
   */
  async removeTrackPick(userId, albumId, trackIdentifier = null) {
    if (this.table !== 'track_picks') {
      throw new Error('removeTrackPick only available for track_picks table');
    }

    if (trackIdentifier) {
      await this._query(
        `DELETE FROM track_picks WHERE user_id = $1 AND album_id = $2 AND track_identifier = $3`,
        [userId, albumId, trackIdentifier]
      );
    } else {
      await this._query(
        `DELETE FROM track_picks WHERE user_id = $1 AND album_id = $2`,
        [userId, albumId]
      );
    }

    // Return updated state
    const updated = await this._query(
      `SELECT track_identifier, priority FROM track_picks 
       WHERE user_id = $1 AND album_id = $2 ORDER BY priority`,
      [userId, albumId]
    );

    return {
      primary:
        updated.rows.find((r) => r.priority === 1)?.track_identifier || null,
      secondary:
        updated.rows.find((r) => r.priority === 2)?.track_identifier || null,
    };
  }
}

/**
 * Get pool statistics for metrics
 * @param {Pool} pool - pg Pool instance
 * @returns {Object} Pool statistics
 */
function getPoolStats(pool) {
  if (!pool) return { total: 0, idle: 0, waiting: 0 };
  return {
    total: pool.totalCount || 0,
    idle: pool.idleCount || 0,
    waiting: pool.waitingCount || 0,
  };
}

/**
 * Update pool metrics from a pool instance
 * @param {Pool} pool - pg Pool instance
 */
function reportPoolMetrics(pool) {
  const stats = getPoolStats(pool);
  updateDbPoolMetrics(stats);
}

module.exports = {
  PgDatastore,
  Pool,
  waitForPostgres,
  warmConnections,
  reportPoolMetrics,
};
