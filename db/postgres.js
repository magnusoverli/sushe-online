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
    this.preparedStatements = new Map();
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

  _query(text, params) {
    if (this.logQueries) {
      logger.debug('SQL', { query: text, params });
    }
    return this.pool.query(text, params);
  }

  async _preparedQuery(name, text, params) {
    if (this.logQueries) {
      logger.debug('Prepared SQL', { name, query: text, params });
    }

    if (!this.preparedStatements.has(name)) {
      this.preparedStatements.set(name, { text, name });
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

  // Batch find by IDs for efficient loading
  async findByIds(ids, cb) {
    const promise = (async () => {
      if (!ids || ids.length === 0) return [];

      // Check cache for static data (albums table)
      if (this.table === 'albums') {
        const cacheKey = `findByIds_${ids.sort().join(',')}`;
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
          return cached.data;
        }
      }

      const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
      const queryText = `SELECT * FROM ${this.table} WHERE ${this._mapField('_id')} IN (${placeholders})`;
      const queryName = `findByIds_${this.table}`;
      const res = await this._preparedQuery(queryName, queryText, ids);
      const result = res.rows.map((r) => this._mapRow(r));

      // Cache result for albums (static data)
      if (this.table === 'albums') {
        const cacheKey = `findByIds_${ids.sort().join(',')}`;
        this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
      }

      return result;
    })();
    return this._callbackify(promise, cb);
  }
  // Placeholder for API compatibility
  ensureIndex() {}
}

module.exports = { PgDatastore, Pool, waitForPostgres, warmConnections };
