const { Pool } = require('pg');
const crypto = require('crypto');
const logger = require('../utils/logger');

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
        logger.warn(`Connection warmup ${i + 1} failed:`, err.message);
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

  _query(text, params) {
    if (this.logQueries) {
      logger.debug('SQL', {
        query: text,
        params: this._sanitizeParams(params),
      });
    }
    return this.pool.query(text, params);
  }

  async _preparedQuery(name, text, params) {
    if (this.logQueries) {
      logger.debug('Prepared SQL', {
        name,
        query: text,
        params: this._sanitizeParams(params),
      });
    }

    return this.pool.query({ name, text }, params);
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
    const queryName = `findWithCounts_lists_${Object.keys(query).join('_')}`;
    const queryText = `
      SELECT l.*, COUNT(li._id) as item_count
      FROM lists l
      LEFT JOIN list_items li ON li.list_id = l._id
      ${text}
      GROUP BY l.id
      ORDER BY l.name
    `;

    const res = await this._preparedQuery(queryName, queryText, values);
    return res.rows.map((row) => {
      const mapped = this._mapRow(row);
      // Add itemCount as a number (COUNT returns string in some drivers)
      mapped.itemCount = parseInt(row.item_count, 10) || 0;
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

      // Cache result
      this.cache.set(cacheKey, { data: result, timestamp: Date.now() });

      return result;
    })();
    return this._callbackify(promise, cb);
  }

  /**
   * Find list items with album data in a single JOIN query
   * Optimized for performance - reduces 3 queries to 1
   * @param {string} listId - The list ID to fetch items for
   * @returns {Promise<Array>} Array of list items with merged album data
   */
  async findWithAlbumData(listId) {
    if (this.table !== 'list_items') {
      throw new Error('findWithAlbumData only available for list_items table');
    }

    // Use prepared statement with consistent naming
    const queryName = 'findListItemsWithAlbums';
    const queryText = `
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
        COALESCE(NULLIF(li.cover_image, ''), a.cover_image) as cover_image,
        COALESCE(NULLIF(li.cover_image_format, ''), a.cover_image_format) as cover_image_format
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
      trackPick: row.track_pick || '',
      comments: row.comments || '',
      tracks: row.tracks || null,
      coverImage: row.cover_image || '',
      coverImageFormat: row.cover_image_format || '',
    }));
  }
}

module.exports = { PgDatastore, Pool, waitForPostgres, warmConnections };
