const { databaseConfig, identifier } = require('../config/database-connection');

function deploymentRoles(env = process.env) {
  const keys = {
    runtime: 'DATABASE_URL',
    migration: 'MIGRATION_DATABASE_URL',
    backup: 'BACKUP_DATABASE_URL',
    recovery: 'RECOVERY_DATABASE_URL',
    control: 'CONTROL_DATABASE_URL',
  };
  /** @type {Record<string, string>} */
  const roles = {};
  for (const [name, key] of Object.entries(keys)) {
    const config = databaseConfig(env[key]);
    identifier(config.user);
    if (config.user === 'postgres' || config.user.startsWith('pg_'))
      throw new Error(
        'Application identities must not use PostgreSQL administrator or reserved roles'
      );
    roles[name] = config.user;
  }
  if (new Set(Object.values(roles)).size !== 5)
    throw new Error(
      'Runtime, migration, backup, recovery and control identities must be distinct'
    );
  return {
    runtime: roles.runtime,
    migration: roles.migration,
    backup: roles.backup,
    recovery: roles.recovery,
    control: roles.control,
  };
}

/** @param {import('pg').Pool | import('pg').PoolClient} pool @param {{runtime:string,migration:string,backup:string}} roles */
async function grantApplicationAccess(pool, roles) {
  const runtime = identifier(roles.runtime),
    backup = identifier(roles.backup),
    owner = identifier(roles.migration);
  await pool.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
  await pool.query(`GRANT USAGE ON SCHEMA public TO ${runtime}, ${backup}`);
  await pool.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${runtime}`
  );
  await pool.query(
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${runtime}`
  );
  await pool.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${backup}`);
  await pool.query(
    `GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO ${backup}`
  );
  await pool.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${runtime}`
  );
  await pool.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${runtime}`
  );
  await pool.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public GRANT SELECT ON TABLES TO ${backup}`
  );
  await pool.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public GRANT SELECT ON SEQUENCES TO ${backup}`
  );
  await pool.query(
    `REVOKE INSERT, UPDATE, DELETE ON schema_migrations FROM ${runtime}`
  );
}

module.exports = { deploymentRoles, grantApplicationAccess };
