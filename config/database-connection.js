const { parseIntoClientConfig } = require('pg-connection-string');

/** @param {string} value */
function databaseConfig(value) {
  if (!value) throw new Error('A database connection URL is required');
  try {
    return parseIntoClientConfig(value);
  } catch {
    throw new Error('Invalid database connection configuration');
  }
}

/** @param {string} value @param {NodeJS.ProcessEnv} [base] */
function pgEnvironment(value, base = process.env) {
  const config = databaseConfig(value);
  const params = new URL(value.replace('@/', '@localhost/')).searchParams;
  return {
    PATH: base.PATH,
    PGHOST: config.host || 'localhost',
    PGPORT: String(config.port || 5432),
    PGDATABASE: config.database,
    PGUSER: config.user,
    PGPASSWORD:
      typeof config.password === 'string' ? config.password : undefined,
    PGSSLMODE: params.get('sslmode') || (config.ssl ? 'verify-full' : 'prefer'),
    PGSSLROOTCERT: params.get('sslrootcert') || undefined,
    PGSSLCERT: params.get('sslcert') || undefined,
    PGSSLKEY: params.get('sslkey') || undefined,
    PGCONNECT_TIMEOUT: '10',
  };
}

/** @param {string} value @param {string} database */
function withDatabase(value, database) {
  const config = databaseConfig(value);
  return { ...config, database };
}

/** @param {string} value @param {string} database */
function databaseUrlFor(value, database) {
  identifier(database);
  const url = new URL(value.replace('@/', '@localhost/'));
  url.pathname = `/${database}`;
  return url.toString();
}

/** @param {string} value */
function identifier(value) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,62}$/.test(value))
    throw new Error(
      'Database and role identifiers must use lowercase letters, numbers and underscores'
    );
  return `"${value}"`;
}

module.exports = {
  databaseConfig,
  pgEnvironment,
  withDatabase,
  databaseUrlFor,
  identifier,
};
