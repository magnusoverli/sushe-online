const { Pool } = require('pg');
const { positiveInteger } = require('../config/limits');

function createMigrationPool(env = process.env) {
  const connectionString =
    env.MIGRATION_DATABASE_URL ||
    (env.NODE_ENV !== 'production' ? env.DATABASE_URL : null);
  if (!connectionString)
    throw new Error('MIGRATION_DATABASE_URL is required for migrations');
  return new Pool({
    connectionString,
    max: 3,
    connectionTimeoutMillis: 5000,
    // A runtime query_timeout cannot be overridden with SET LOCAL.
    query_timeout: 0,
    statement_timeout: positiveInteger(
      env.MIGRATION_STATEMENT_TIMEOUT_MS,
      900000,
      'MIGRATION_STATEMENT_TIMEOUT_MS'
    ),
    lock_timeout: positiveInteger(
      env.MIGRATION_LOCK_TIMEOUT_MS,
      60000,
      'MIGRATION_LOCK_TIMEOUT_MS'
    ),
    application_name: 'sushe-migrator',
  });
}

module.exports = { createMigrationPool };
