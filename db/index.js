// @ts-check
const MigrationManager = require('./migrations');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const {
  PgDatastore,
  Pool,
  waitForPostgres,
  warmConnections,
} = require('./postgres');
const { drainPool } = require('./close-pool');
const { createEnsureAdminUser } = require('./bootstrap-admin');
const logger = require('../utils/logger');
const { setPoolReference } = require('../utils/metrics');

const dataDir = process.env.DATA_DIR || './data';
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
logger.info('Initializing database layer');

let db, pool;
let ready;

if (process.env.DATABASE_URL) {
  logger.info('Using PostgreSQL backend');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 30, // Maximum connections for burst capacity
    min: 2, // Keep fewer connections warm to reduce idle resource usage
    idleTimeoutMillis: 300000, // 5 minutes - release idle connections sooner
    connectionTimeoutMillis: 5000, // 5 seconds - more reasonable for production
    // Note: acquireTimeoutMillis was previously here but is not a valid pg
    // PoolConfig option — pg uses connectionTimeoutMillis for both connect
    // and acquire. Silently ignored by node-pg, removed for correctness.
    keepAlive: true, // Enable TCP keep-alive
    keepAliveInitialDelayMillis: 60000, // 60 seconds - less aggressive keep-alive probing
    statement_timeout: 60000, // 60 seconds for complex queries
    query_timeout: 60000, // 60 seconds query timeout
    allowExitOnIdle: false, // Don't exit when idle
    application_name: process.env.PG_APP_NAME || 'sushe-online',
  });
  // Canonical tableless datastore. Exposes only raw/withClient/withTransaction;
  // all services that don't need tabled helpers (findOne/insert/update/...)
  // should receive this via deps.db. Shares the pool with the tabled instances,
  // so logging, metrics, drain-check, and retry apply uniformly.
  db = new PgDatastore(pool);
  const ensureAdminUser = createEnsureAdminUser({ db, logger, bcrypt });

  ready = waitForPostgres(pool)
    .then(async () => {
      logger.info('Warming database connections...');
      await warmConnections(pool);
      logger.info('Running database migrations...');
      const migrationManager = new MigrationManager(pool);
      await migrationManager.runMigrations();
      return migrationManager;
    })
    .then(() => {
      logger.info('Ensuring admin user...');
      return ensureAdminUser();
    })
    .then(() => {
      logger.info('Database ready');
      // Register pool reference for pull-based metrics (collected on /metrics scrape)
      setPoolReference(pool);
    })
    .catch((err) => {
      logger.error('Database initialization error', {
        error: err.message,
        stack: err.stack,
      });
      throw err;
    });
} else {
  throw new Error('DATABASE_URL must be set');
}

/**
 * Drain and close the singleton database pool. Idempotent.
 * @param {Object} [opts] - Forwarded to drainPool (e.g. { timeoutMs }).
 * @returns {Promise<{ drained: boolean }>}
 */
let _closed = false;
async function closePool(opts = {}) {
  if (_closed) {
    return { drained: true };
  }
  _closed = true;
  return drainPool(pool, opts);
}

module.exports = {
  db,
  dataDir,
  ready,
  pool,
  closePool,
};
