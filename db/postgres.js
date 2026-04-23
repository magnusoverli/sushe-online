const { Pool } = require('pg');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { observeDbQuery } = require('../utils/metrics');
const { withRetry } = require('./retry-wrapper');
const { withTransaction: baseWithTransaction } = require('./transaction');

// Whitelist of allowed SQL isolation levels. The literal is interpolated into
// the `SET TRANSACTION ISOLATION LEVEL ...` statement, so only exact matches
// from this set are accepted.
const VALID_ISOLATION_LEVELS = new Set([
  'READ UNCOMMITTED',
  'READ COMMITTED',
  'REPEATABLE READ',
  'SERIALIZABLE',
]);

// Set of pools marked as draining. Once a pool is in this set, any new
// PgDatastore query attempt rejects immediately with a SHUTTING_DOWN error
// instead of waiting on pool.connect() — which could otherwise block for
// the full acquire timeout during shutdown.
const _drainingPools = new WeakSet();

function markPoolDraining(pool) {
  _drainingPools.add(pool);
}

function isPoolDraining(pool) {
  return _drainingPools.has(pool);
}

class ShuttingDownError extends Error {
  constructor(message = 'Database pool is shutting down') {
    super(message);
    this.name = 'ShuttingDownError';
    this.code = 'SHUTTING_DOWN';
  }
}

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
  /**
   * @param {import('pg').Pool} pool
   * @param {string|null} [table]    - Pass null for a tableless datastore that
   *   exposes only raw/withClient/withTransaction; tabled methods will throw.
   * @param {Object|null} [fieldMap] - camelCase→snake_case map; required iff
   *   table is non-null.
   */
  constructor(pool, table = null, fieldMap = null) {
    this.pool = pool;
    this.table = table;
    this.fieldMap = fieldMap || {};
    this.logQueries = process.env.LOG_SQL === 'true';
    this.inverseMap = fieldMap
      ? Object.fromEntries(Object.entries(fieldMap).map(([k, v]) => [v, k]))
      : {};
    this.cache = new Map();
    this.cacheTimeout = 60000; // 1 minute cache for static data
    this.maxCacheSize = 500; // Maximum cache entries to prevent unbounded growth
  }

  /** @private Throws when a tabled method is called on a tableless datastore. */
  _requireTable(method) {
    if (!this.table) {
      throw new Error(
        `${method}() requires a tabled PgDatastore; ` +
          `this instance was constructed without a table.`
      );
    }
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
    if (isPoolDraining(this.pool)) {
      throw new ShuttingDownError();
    }
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
    if (isPoolDraining(this.pool)) {
      throw new ShuttingDownError();
    }
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

  /**
   * Build a parameterized WHERE clause from a MongoDB-style query object.
   *
   * Supported per-field operators:
   *   $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $exists
   * Supported top-level combiners:
   *   $and: [ ... ], $or: [ ... ]  — each element is a sub-query object
   * Supported pseudo-keys (extracted before WHERE — consumed by `find` via suffix):
   *   $orderBy: 'col ASC' | string[] | { col: 'ASC' | 'DESC' }
   *   $limit: number, $offset: number
   *
   * Backward-compatible shape: returns { text, values } as before, plus a
   * new `suffix` string ('' | ' ORDER BY ... LIMIT ... OFFSET ...'). Existing
   * callers that ignore `suffix` keep working.
   *
   * @param {Object} query
   * @param {number} [startIndex=1]
   * @returns {{ text: string, suffix: string, values: Array }}
   */
  _buildWhere(query, startIndex = 1) {
    const state = { values: [], idx: startIndex };
    const suffixParts = {
      orderBy: query.$orderBy,
      limit: query.$limit,
      offset: query.$offset,
    };
    // Clone without pseudo-keys so they don't become WHERE conditions.
    const filter = {};
    for (const [k, v] of Object.entries(query)) {
      if (k === '$orderBy' || k === '$limit' || k === '$offset') continue;
      filter[k] = v;
    }

    const text = this._buildWhereExpr(filter, state);
    const suffix = this._buildSuffix(suffixParts);
    return {
      text: text ? 'WHERE ' + text : '',
      suffix,
      values: state.values,
    };
  }

  /**
   * @private Build a WHERE expression (no WHERE keyword) from a filter object.
   * Mutates `state.values` and `state.idx`. Returns '' when filter is empty.
   */
  _buildWhereExpr(filter, state) {
    const clauses = [];
    for (const [field, val] of Object.entries(filter)) {
      if (field === '$and' || field === '$or') {
        if (!Array.isArray(val) || val.length === 0) continue;
        const joined = val
          .map((sub) => this._buildWhereExpr(sub, state))
          .filter(Boolean)
          .map((c) => `(${c})`)
          .join(field === '$and' ? ' AND ' : ' OR ');
        if (joined) clauses.push(joined);
        continue;
      }
      const col = this._mapField(field);
      clauses.push(this._buildFieldClause(col, val, state));
    }
    return clauses.filter(Boolean).join(' AND ');
  }

  /**
   * @private Build a single-field clause. Returns a string like `col = $3` or
   * `col IN ($4,$5)`. Mutates state.
   */
  _buildFieldClause(col, val, state) {
    // Operator object
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      if ('$eq' in val) {
        if (val.$eq === null) return `${col} IS NULL`;
        return this._opEq(col, val.$eq, state);
      }
      if ('$ne' in val) {
        if (val.$ne === null) return `${col} IS NOT NULL`;
        state.values.push(this._prepareValue(val.$ne));
        return `${col} <> $${state.idx++}`;
      }
      if ('$gt' in val) {
        state.values.push(this._prepareValue(val.$gt));
        return `${col} > $${state.idx++}`;
      }
      if ('$gte' in val) {
        state.values.push(this._prepareValue(val.$gte));
        return `${col} >= $${state.idx++}`;
      }
      if ('$lt' in val) {
        state.values.push(this._prepareValue(val.$lt));
        return `${col} < $${state.idx++}`;
      }
      if ('$lte' in val) {
        state.values.push(this._prepareValue(val.$lte));
        return `${col} <= $${state.idx++}`;
      }
      if ('$in' in val) {
        if (!Array.isArray(val.$in) || val.$in.length === 0) return 'FALSE';
        const placeholders = val.$in.map((item) => {
          state.values.push(this._prepareValue(item));
          return `$${state.idx++}`;
        });
        return `${col} IN (${placeholders.join(',')})`;
      }
      if ('$nin' in val) {
        if (!Array.isArray(val.$nin) || val.$nin.length === 0) return 'TRUE';
        const placeholders = val.$nin.map((item) => {
          state.values.push(this._prepareValue(item));
          return `$${state.idx++}`;
        });
        return `${col} NOT IN (${placeholders.join(',')})`;
      }
      if ('$exists' in val) {
        return val.$exists ? `${col} IS NOT NULL` : `${col} IS NULL`;
      }
      // Unknown operator object — fall through to equality with the object
      return this._opEq(col, val, state);
    }
    // Scalar / null / array → equality (legacy behavior preserved)
    return this._opEq(col, val, state);
  }

  /**
   * @private Equality clause. Plain `field: null` keeps the legacy
   * `col = $N` emission for backward compatibility; callers wanting
   * SQL NULL semantics should use `$exists: false` or `$eq: null`.
   */
  _opEq(col, v, state) {
    state.values.push(this._prepareValue(v));
    return `${col} = $${state.idx++}`;
  }

  /**
   * @private Build an ORDER BY / LIMIT / OFFSET suffix.
   * orderBy accepts:
   *   'col ASC'
   *   ['col1 ASC', 'col2 DESC']
   *   { col1: 'ASC', col2: 'DESC' }
   * Direction is validated (ASC|DESC); column names pass through _mapField.
   */
  _buildSuffix({ orderBy, limit, offset }) {
    const parts = [];
    if (orderBy !== undefined) {
      const clauses = this._normalizeOrderBy(orderBy);
      if (clauses.length) parts.push('ORDER BY ' + clauses.join(', '));
    }
    if (limit !== undefined) {
      const n = Number(limit);
      if (!Number.isInteger(n) || n < 0) {
        throw new Error(`Invalid $limit: ${limit}`);
      }
      parts.push(`LIMIT ${n}`);
    }
    if (offset !== undefined) {
      const n = Number(offset);
      if (!Number.isInteger(n) || n < 0) {
        throw new Error(`Invalid $offset: ${offset}`);
      }
      parts.push(`OFFSET ${n}`);
    }
    return parts.length ? ' ' + parts.join(' ') : '';
  }

  /** @private */
  _normalizeOrderBy(orderBy) {
    const toClause = (spec) => {
      // Accept 'col' or 'col ASC' / 'col DESC'. Split on whitespace instead of
      // a regex to avoid any backtracking/catastrophic-match risk.
      const parts = String(spec).trim().split(/\s+/);
      if (parts.length === 0 || parts.length > 2) {
        throw new Error(`Invalid $orderBy spec: ${spec}`);
      }
      const col = parts[0];
      const rawDir = parts[1] ? parts[1].toUpperCase() : 'ASC';
      if (rawDir !== 'ASC' && rawDir !== 'DESC') {
        throw new Error(`Invalid $orderBy direction: ${parts[1]}`);
      }
      return `${this._mapField(col)} ${rawDir}`;
    };
    if (typeof orderBy === 'string') return [toClause(orderBy)];
    if (Array.isArray(orderBy)) return orderBy.map(toClause);
    if (orderBy && typeof orderBy === 'object') {
      return Object.entries(orderBy).map(([col, dir]) => {
        const d = String(dir).toUpperCase();
        if (d !== 'ASC' && d !== 'DESC') {
          throw new Error(`Invalid $orderBy direction for ${col}: ${dir}`);
        }
        return `${this._mapField(col)} ${d}`;
      });
    }
    return [];
  }

  _mapRow(row) {
    const mapped = {};
    for (const [col, val] of Object.entries(row)) {
      mapped[this.inverseMap[col] || col] = val;
    }
    return mapped;
  }

  findOne(query, cb) {
    this._requireTable('findOne');
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
    this._requireTable('find');
    const promise = (async () => {
      const { text, suffix, values } = this._buildWhere(query);
      const queryText = `SELECT * FROM ${this.table} ${text}${suffix}`;
      // Exclude pseudo-keys from the prepared-statement name — their SQL text
      // is part of the query, but they shouldn't balloon the name cache.
      const filterKeys = Object.keys(query).filter(
        (k) => k !== '$orderBy' && k !== '$limit' && k !== '$offset'
      );
      const queryName = `find_${this.table}_${filterKeys.join('_')}`;
      const res = await this._preparedQuery(queryName, queryText, values);
      return res.rows.map((r) => this._mapRow(r));
    })();
    return this._callbackify(promise, cb);
  }

  count(query, cb) {
    this._requireTable('count');
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
    this._requireTable('insert');
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
    this._requireTable('update');
    if (typeof options === 'function') {
      cb = options;
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
    this._requireTable('remove');
    if (typeof options === 'function') {
      cb = options;
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
    this._requireTable('updateFieldById');
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
   * @param {string} _userId - Deprecated: was used for track picks, now stored on list_items
   * @returns {Promise<Array>} Array of list items with merged album data
   */
  async findWithAlbumData(listId, _userId = null) {
    if (this.table !== 'list_items') {
      throw new Error('findWithAlbumData only available for list_items table');
    }

    // Use prepared statement with consistent naming
    // V6: Track picks now stored directly on list_items (no JOIN needed)
    // userId parameter kept for API compatibility but no longer used for track picks
    const queryName = 'findListItemsWithAlbumsV7';
    const queryText = `
      SELECT 
        li._id,
        li.list_id,
        li.position,
        li.comments,
        li.comments_2,
        li.album_id,
        li.primary_track,
        li.secondary_track,
        -- All album metadata from canonical albums table
        a.artist,
        a.album,
        a.release_date,
        a.country,
        a.genre_1,
        a.genre_2,
        a.tracks,
        a.cover_image,
        a.cover_image_format,
        a.summary,
        a.summary_source
      FROM list_items li
      LEFT JOIN albums a ON li.album_id = a.album_id
      WHERE li.list_id = $1
      ORDER BY li.position
    `;

    const res = await this._preparedQuery(queryName, queryText, [listId]);

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
      // Track picks from normalized table
      primaryTrack: row.primary_track || null,
      secondaryTrack: row.secondary_track || null,
      comments: row.comments || '',
      comments2: row.comments_2 || '',
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

    // V6: Track picks now stored directly on list_items (no JOIN needed)
    const queryName = 'findAllUserListsWithItemsV7';
    const queryText = `
      SELECT 
        l._id as list_id,
        l.name as list_name,
        l.year,
        l.is_main,
        li._id as item_id,
        li.position,
        li.album_id,
        li.comments,
        li.comments_2,
        li.primary_track,
        li.secondary_track,
        -- All album metadata from canonical albums table
        a.artist,
        a.album,
        a.release_date,
        a.country,
        a.genre_1,
        a.genre_2,
        a.tracks,
        a.cover_image,
        a.cover_image_format,
        a.summary,
        a.summary_source
      FROM lists l
      LEFT JOIN list_items li ON li.list_id = l._id
      LEFT JOIN albums a ON li.album_id = a.album_id
      WHERE l.user_id = $1
      ORDER BY l.sort_order, l.name, li.position
    `;

    const res = await this._preparedQuery(queryName, queryText, [userId]);
    return res.rows;
  }

  /**
   * Set track pick for a list item
   * Handles the click logic: first click = secondary, second click = promote to primary
   * @param {string} listItemId - The list item ID
   * @param {string} trackIdentifier - The track to set
   * @param {number} targetPriority - The target priority (1=primary, 2=secondary)
   * @returns {Promise<Object>} Updated track picks for this list item
   */
  async setTrackPick(listItemId, trackIdentifier, targetPriority) {
    if (this.table !== 'list_items') {
      throw new Error('setTrackPick only available for list_items table');
    }

    // Get current picks for this list item
    const current = await this._query(
      `SELECT primary_track, secondary_track FROM list_items WHERE _id = $1`,
      [listItemId]
    );

    if (current.rows.length === 0) {
      throw new Error('List item not found');
    }

    const { primary_track, secondary_track } = current.rows[0];
    let newPrimary = primary_track;
    let newSecondary = secondary_track;

    // Determine the action based on current state and target
    if (targetPriority === 1) {
      // Setting as primary
      if (primary_track === trackIdentifier) {
        // Clicking same track at primary = deselect primary
        newPrimary = null;
      } else if (secondary_track === trackIdentifier) {
        // Promoting from secondary to primary - swap them
        newPrimary = trackIdentifier;
        newSecondary = primary_track; // Demote old primary to secondary
      } else {
        // New track as primary - demote old primary to secondary
        newSecondary = primary_track;
        newPrimary = trackIdentifier;
      }
    } else {
      // Setting as secondary (targetPriority === 2)
      if (secondary_track === trackIdentifier) {
        // Clicking same track at secondary = deselect secondary
        newSecondary = null;
      } else if (primary_track === trackIdentifier) {
        // Demoting from primary to secondary - swap them
        newSecondary = trackIdentifier;
        newPrimary = secondary_track; // Promote old secondary to primary
      } else {
        // New track as secondary - replace existing secondary
        newSecondary = trackIdentifier;
      }
    }

    // Update the list item
    await this._query(
      `UPDATE list_items 
       SET primary_track = $1, secondary_track = $2, updated_at = NOW() 
       WHERE _id = $3`,
      [newPrimary, newSecondary, listItemId]
    );

    return {
      primary: newPrimary,
      secondary: newSecondary,
    };
  }

  /**
   * Remove a track pick from a list item
   * @param {string} listItemId - The list item ID
   * @param {string} trackIdentifier - The track to remove (optional, removes all if not specified)
   * @returns {Promise<Object>} Updated track picks for this list item
   */
  async removeTrackPick(listItemId, trackIdentifier = null) {
    if (this.table !== 'list_items') {
      throw new Error('removeTrackPick only available for list_items table');
    }

    if (trackIdentifier) {
      // Remove specific track
      const current = await this._query(
        `SELECT primary_track, secondary_track FROM list_items WHERE _id = $1`,
        [listItemId]
      );

      if (current.rows.length === 0) {
        throw new Error('List item not found');
      }

      const { primary_track, secondary_track } = current.rows[0];
      let newPrimary = primary_track;
      let newSecondary = secondary_track;

      if (primary_track === trackIdentifier) {
        newPrimary = null;
      }
      if (secondary_track === trackIdentifier) {
        newSecondary = null;
      }

      await this._query(
        `UPDATE list_items 
         SET primary_track = $1, secondary_track = $2, updated_at = NOW() 
         WHERE _id = $3`,
        [newPrimary, newSecondary, listItemId]
      );

      return { primary: newPrimary, secondary: newSecondary };
    } else {
      // Remove all track picks
      await this._query(
        `UPDATE list_items 
         SET primary_track = NULL, secondary_track = NULL, updated_at = NOW() 
         WHERE _id = $1`,
        [listItemId]
      );

      return { primary: null, secondary: null };
    }
  }

  // ==========================================================================
  // Unified query interface
  //
  // These three methods are the canonical entry points for code that needs
  // more expressive queries than find/findOne/insert/update/remove cover.
  // They share logging, metrics, and optional classifier-aware retry with
  // the rest of the datastore — so callers no longer need to reach into the
  // raw pool.
  // ==========================================================================

  /**
   * Execute an arbitrary SQL statement with the datastore's logging, metrics,
   * and optional retry semantics.
   *
   * Rows are returned verbatim (not field-mapped) — callers of raw() are
   * working at the SQL level and usually alias columns explicitly.
   *
   * @param {string} sql - SQL text with $1, $2 placeholders.
   * @param {Array} [params] - Bound parameter values.
   * @param {Object} [opts]
   * @param {string} [opts.name] - Prepared-statement name (enables pg's plan cache).
   * @param {boolean} [opts.retryable=false] - If true, retry on transient errors
   *   (serialization failure, deadlock, connection loss) with exponential backoff.
   *   Only set to true when the statement is idempotent — a pure SELECT, or an
   *   INSERT ... ON CONFLICT / UPDATE that can safely be replayed.
   * @returns {Promise<import('pg').QueryResult>}
   */
  async raw(sql, params, opts = {}) {
    const { name, retryable = false } = opts;
    const run = name
      ? () => this._preparedQuery(name, sql, params)
      : () => this._query(sql, params);

    if (!retryable) {
      return run();
    }
    return withRetry(run, {
      idempotent: true,
      label: name ? `raw:${name}` : `raw:${this.table || 'db'}`,
    });
  }

  /**
   * Run `callback` with a single dedicated client checked out from the pool.
   * Useful for multi-statement work that must share a connection (advisory
   * locks, SET LOCAL, temp tables) without wrapping the whole thing in a
   * transaction.
   *
   * The client is ALWAYS released. If the callback throws, the client is
   * released with the error as argument so pg discards it rather than
   * returning a potentially poisoned connection to the pool.
   *
   * @param {(client: import('pg').PoolClient) => Promise<*>} callback
   * @param {Object} [opts]
   * @param {boolean} [opts.retryable=false] - Retry connection-level failures
   *   that occur before the callback has observed any query result. Does NOT
   *   retry errors thrown from inside the callback after queries have run.
   * @returns {Promise<*>}
   */
  async withClient(callback, opts = {}) {
    const { retryable = false } = opts;

    if (isPoolDraining(this.pool)) {
      throw new ShuttingDownError();
    }

    // When retryable is true we only retry pool.connect() — once the callback
    // has a client in hand, we run it exactly once. This prevents a transient
    // socket failure during connection from taking down the whole call, while
    // never replaying user side effects.
    const client = retryable
      ? await withRetry(() => this.pool.connect(), {
          idempotent: true,
          label: `withClient:${this.table || 'db'}:connect`,
        })
      : await this.pool.connect();

    let releaseError;
    try {
      return await callback(client);
    } catch (err) {
      releaseError = err;
      throw err;
    } finally {
      client.release(releaseError);
    }
  }

  /**
   * Run `callback` inside a database transaction. Thin wrapper over the
   * standalone withTransaction() in db/transaction.js that adds optional
   * classifier-aware retry on serialization failures and deadlocks, plus
   * optional isolation-level override.
   *
   * @param {(client: import('pg').PoolClient) => Promise<*>} callback
   * @param {Object} [opts]
   * @param {boolean} [opts.retryable=false] - Retry on 40001/40P01 (only
   *   meaningful when the transaction body is safe to re-execute from scratch).
   * @param {string} [opts.isolation] - Override isolation level, e.g.
   *   'SERIALIZABLE' or 'REPEATABLE READ'. Emitted as `SET TRANSACTION
   *   ISOLATION LEVEL ...` immediately after BEGIN.
   * @returns {Promise<*>}
   */
  async withTransaction(callback, opts = {}) {
    const { retryable = false, isolation } = opts;

    if (isolation !== undefined && !VALID_ISOLATION_LEVELS.has(isolation)) {
      throw new Error(
        `Invalid isolation level: ${isolation}. Allowed: ${Array.from(
          VALID_ISOLATION_LEVELS
        ).join(', ')}`
      );
    }

    if (isPoolDraining(this.pool)) {
      throw new ShuttingDownError();
    }

    const run = () =>
      baseWithTransaction(this.pool, async (client) => {
        if (isolation) {
          await client.query(`SET TRANSACTION ISOLATION LEVEL ${isolation}`);
        }
        return callback(client);
      });

    if (!retryable) {
      return run();
    }
    return withRetry(run, {
      idempotent: true,
      label: `tx:${this.table || 'db'}`,
    });
  }
}

module.exports = {
  PgDatastore,
  Pool,
  waitForPostgres,
  warmConnections,
  markPoolDraining,
  isPoolDraining,
  ShuttingDownError,
};
