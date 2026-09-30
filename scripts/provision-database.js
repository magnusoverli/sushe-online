const { Pool, escapeLiteral } = require('pg');
const { databaseConfig, identifier } = require('../config/database-connection');
const {
  deploymentRoles,
  grantApplicationAccess,
} = require('../db/deployment-roles');
const { initializeControl } = require('../services/recovery/control-store');
const MigrationManager = require('../db/migrations');
const { createMigrationPool } = require('../db/migration-policy');

async function adoptSchema(pool, owner) {
  // Targeted adoption only: never REASSIGN everything owned by postgres.
  const relations = await pool.query(
    "SELECT relname, relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND relkind IN ('r','p','S','v','m') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e') ORDER BY (relkind = 'S'), relname"
  );
  for (const row of relations.rows) {
    const kind =
      row.relkind === 'S'
        ? 'SEQUENCE'
        : row.relkind === 'v'
          ? 'VIEW'
          : row.relkind === 'm'
            ? 'MATERIALIZED VIEW'
            : 'TABLE';
    await pool.query(
      `ALTER ${kind} public."${row.relname.replaceAll('"', '""')}" OWNER TO ${identifier(owner)}`
    );
  }
  const functions = await pool.query(
    "SELECT p.oid::regprocedure::text AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.deptype='e')"
  );
  for (const row of functions.rows)
    await pool.query(
      `ALTER FUNCTION ${row.signature} OWNER TO ${identifier(owner)}`
    );
  await pool.query(`ALTER SCHEMA public OWNER TO ${identifier(owner)}`);
}

async function provision(env = process.env) {
  const roles = deploymentRoles(env);
  const configs = [
    'DATABASE_URL',
    'MIGRATION_DATABASE_URL',
    'BACKUP_DATABASE_URL',
    'RECOVERY_DATABASE_URL',
    'CONTROL_DATABASE_URL',
  ].map((key) => {
    const config = databaseConfig(env[key]);
    if (typeof config.password !== 'string' || config.password.length < 24)
      throw new Error(
        'Provisioning requires non-default passwords of at least 24 characters'
      );
    return { ...config, password: config.password };
  });
  const source = configs[0].database,
    control = configs[3].database;
  if (
    configs.some(
      (config) =>
        config.host !== configs[0].host || config.port !== configs[0].port
    ) ||
    configs.slice(0, 3).some((config) => config.database !== source)
  )
    throw new Error(
      'Application roles must target one database cluster and one source database'
    );
  if (source === control || configs[4].database !== control)
    throw new Error('Recovery control must use a separate database');
  const template = env.RECOVERY_TEMPLATE_DATABASE || 'sushe_recovery_template';
  if (new Set([source, control, template]).size !== 3)
    throw new Error(
      'Source, control and recovery template databases must be distinct'
    );
  for (const name of [source, control, template]) identifier(name);
  const adminConfig = databaseConfig(env.PROVISION_DATABASE_URL);
  if (Object.values(roles).includes(adminConfig.user))
    throw new Error('Provisioning must use a separate administrator identity');
  const admin = new Pool({ ...adminConfig, max: 1 });
  try {
    // Existing clusters may still default to MD5; every generated identity
    // must authenticate under the managed SCRAM socket policy.
    await admin.query("SET password_encryption='scram-sha-256'");
    const exists = await admin.query(
      'SELECT datname FROM pg_database WHERE datname = $1',
      [source]
    );
    if (exists.rows.length && env.ADOPT_EXISTING_DATABASE !== 'true') {
      const inspection = new Pool({ ...adminConfig, database: source, max: 1 });
      try {
        const objects = await inspection.query(
          "SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public') OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public') AS populated"
        );
        if (objects.rows[0].populated)
          throw new Error(
            'Existing database requires ADOPT_EXISTING_DATABASE=true after a protected backup'
          );
      } finally {
        await inspection.end();
      }
    }
    for (const config of configs) {
      const role = identifier(config.user);
      const found = await admin.query(
        'SELECT 1 FROM pg_roles WHERE rolname = $1',
        [config.user]
      );
      if (!found.rows.length) await admin.query(`CREATE ROLE ${role} LOGIN`);
      // DDL cannot bind passwords. Escape explicitly; never log this SQL.
      await admin.query(
        `ALTER ROLE ${role} NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS PASSWORD ${escapeLiteral(config.password)}`
      );
    }
    // Recovery creates a fresh unprivileged staging identity for every upload;
    // archive SQL never receives the shared migration-owner credential.
    await admin.query(
      `ALTER ROLE ${identifier(roles.recovery)} CREATEDB CREATEROLE`
    );
    await admin.query(
      `ALTER ROLE ${identifier(roles.recovery)} SET password_encryption='scram-sha-256'`
    );
    await admin.query(
      `GRANT ${identifier(roles.migration)}, pg_signal_backend TO ${identifier(roles.recovery)}`
    );
    for (const [database, owner] of [
      [source, roles.migration],
      [control, roles.recovery],
      [template, roles.recovery],
    ]) {
      const found = await admin.query(
        'SELECT 1 FROM pg_database WHERE datname = $1',
        [database]
      );
      if (!found.rows.length)
        await admin.query(
          `CREATE DATABASE ${identifier(database)} OWNER ${identifier(owner)}`
        );
      await admin.query(
        `ALTER DATABASE ${identifier(database)} OWNER TO ${identifier(owner)}`
      );
      await admin.query(
        `REVOKE ALL ON DATABASE ${identifier(database)} FROM PUBLIC`
      );
    }
    await admin.query(
      `GRANT CONNECT ON DATABASE ${identifier(source)} TO ${identifier(roles.runtime)}, ${identifier(roles.backup)}`
    );
    await admin.query(
      `GRANT CONNECT ON DATABASE ${identifier(control)} TO ${identifier(roles.control)}`
    );
    const sourceAdmin = new Pool({ ...adminConfig, database: source, max: 1 });
    try {
      await adoptSchema(sourceAdmin, roles.migration);
    } finally {
      await sourceAdmin.end();
    }
    const templatePool = new Pool({
      ...adminConfig,
      database: template,
      max: 1,
    });
    try {
      for (const extension of ['pgcrypto', 'uuid-ossp', 'pg_prewarm'])
        await templatePool.query(
          `CREATE EXTENSION IF NOT EXISTS "${extension}"`
        );
    } finally {
      await templatePool.end();
    }
    const migration = createMigrationPool(env);
    try {
      await new MigrationManager(migration).runMigrations();
      const admins = await migration.query(
        "SELECT 1 FROM users WHERE role='admin' AND approval_status='approved' LIMIT 1"
      );
      if (!admins.rows.length) {
        if (
          !env.BOOTSTRAP_ADMIN_EMAIL ||
          !env.BOOTSTRAP_ADMIN_PASSWORD ||
          env.BOOTSTRAP_ADMIN_PASSWORD.length < 16
        )
          throw new Error(
            'Fresh installation requires BOOTSTRAP_ADMIN_EMAIL and a strong BOOTSTRAP_ADMIN_PASSWORD'
          );
        await migration.query(
          `INSERT INTO users (_id,email,username,hash,role,approval_status)
          VALUES ($1,$2,'bootstrap-admin',$3,'admin','approved')`,
          [
            require('node:crypto').randomUUID(),
            env.BOOTSTRAP_ADMIN_EMAIL,
            await require('bcryptjs').hash(env.BOOTSTRAP_ADMIN_PASSWORD, 12),
          ]
        );
      }
      await grantApplicationAccess(migration, roles);
    } finally {
      await migration.end();
    }
    const controlPool = new Pool({ ...configs[3], max: 1 });
    try {
      await initializeControl(controlPool, source);
      const role = identifier(roles.control);
      await controlPool.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
      await controlPool.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
      await controlPool.query(
        `GRANT SELECT ON recovery_state, recovery_jobs, recovery_instances TO ${role}`
      );
      await controlPool.query(
        `GRANT INSERT ON recovery_jobs, recovery_instances TO ${role}`
      );
      await controlPool.query(
        `GRANT UPDATE (status, file_bytes, updated_at, error_code) ON recovery_jobs TO ${role}`
      );
      await controlPool.query(`GRANT UPDATE ON recovery_instances TO ${role}`);
    } finally {
      await controlPool.end();
    }
  } finally {
    await admin.end();
  }
}

if (require.main === module)
  provision()
    .then(() =>
      console.log('Database roles, migrations and recovery control are ready')
    )
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
module.exports = { provision };
