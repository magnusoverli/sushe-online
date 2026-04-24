// @ts-check
const { Pool } = require('pg');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');
const { withRetry } = require('./retry-wrapper');
const { withTransaction: baseWithTransaction } = require('./transaction');
const { classify } = require('./errors');

const observeDbQuery = metrics.observeDbQuery;

function callMetric(name, ...args) {
  if (!(name in metrics)) return;
  const fn = metrics[name];
  if (typeof fn === 'function') {
    fn(...args);
  }
}

// Whitelist of allowed SQL isolation levels. The literal is interpolated into
// the `SET TRANSACTION ISOLATION LEVEL ...` statement, so only exact matches
// from this set are accepted.
const VALID_ISOLATION_LEVELS = new Set([
  'READ UNCOMMITTED',
  'READ COMMITTED',
  'REPEATABLE READ',
  'SERIALIZABLE',
]);

const SLOW_QUERY_THRESHOLD_MS = Math.max(
  1,
  Number.parseInt(process.env.DB_SLOW_QUERY_MS || '250', 10) || 250
);

/**
 * Validate a caller-supplied `deps.db` against the canonical datastore shape.
 * Services/repositories are expected to receive a DbFacade with `.raw`
 * (and optionally `.withClient` / `.withTransaction`).
 *
 * Throws when `db` is missing entirely — callers use this to enforce the
 * "deps.db required" invariant at factory construction time.
 *
 * @param {*} db
 * @param {string} serviceName - used in the error message
 * @returns {{ raw: Function, withTransaction?: Function, withClient?: Function }}
 */
function ensureDb(db, serviceName) {
  if (db && typeof db.raw === 'function') return db;
  throw new Error(`${serviceName} requires deps.db`);
}

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
   */
  constructor(pool) {
    this.pool = pool;
    this.logQueries = process.env.LOG_SQL === 'true';
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
      const durationMs = Date.now() - startTime;
      observeDbQuery(operation, durationMs);
      this._logSlowQuery({ operation, durationMs, queryText: text });
      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      observeDbQuery(operation, durationMs);
      this._logSlowQuery({ operation, durationMs, queryText: text, error });
      const classification = classify(error);
      callMetric(
        'recordDbError',
        operation,
        classification.kind,
        classification.code
      );
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
      const durationMs = Date.now() - startTime;
      observeDbQuery(operation, durationMs);
      this._logSlowQuery({ operation, durationMs, queryText: text, name });
      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      observeDbQuery(operation, durationMs);
      this._logSlowQuery({
        operation,
        durationMs,
        queryText: text,
        name,
        error,
      });
      const classification = classify(error);
      callMetric(
        'recordDbError',
        operation,
        classification.kind,
        classification.code
      );
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

  _logSlowQuery({ operation, durationMs, queryText, name, error = null }) {
    if (durationMs < SLOW_QUERY_THRESHOLD_MS) {
      return;
    }

    callMetric('recordDbSlowQuery', operation);
    logger.warn('Slow database query', {
      operation,
      table: 'db',
      name: name || null,
      duration_ms: durationMs,
      threshold_ms: SLOW_QUERY_THRESHOLD_MS,
      error: error?.message,
      query: queryText,
    });
  }

  // ==========================================================================
  // Unified query interface
  //
  // These three methods are the canonical entry points for runtime code.
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
      label: name ? `raw:${name}` : 'raw:db',
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
          label: 'withClient:db:connect',
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

    const startTime = Date.now();
    const run = () =>
      baseWithTransaction(this.pool, async (client) => {
        if (isolation) {
          await client.query(`SET TRANSACTION ISOLATION LEVEL ${isolation}`);
        }
        return callback(client);
      });

    try {
      if (!retryable) {
        const result = await run();
        callMetric('observeDbTransaction', Date.now() - startTime, 'success');
        return result;
      }
      const result = await withRetry(run, {
        idempotent: true,
        label: 'tx:db',
      });
      callMetric('observeDbTransaction', Date.now() - startTime, 'success');
      return result;
    } catch (error) {
      callMetric('observeDbTransaction', Date.now() - startTime, 'error');
      throw error;
    }
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
  ensureDb,
};
