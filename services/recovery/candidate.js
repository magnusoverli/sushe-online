const { Pool } = require('pg');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomBytes } = require('node:crypto');
const { runProcess } = require('../../utils/subprocess');
const {
  databaseUrlFor,
  withDatabase,
  pgEnvironment,
  identifier,
} = require('../../config/database-connection');
const {
  grantApplicationAccess,
  deploymentRoles,
} = require('../../db/deployment-roles');
const { createAdminBackupService } = require('../admin-backup-service');
const {
  hashExtensionToken,
  extensionTokenLookup,
} = require('../auth-utils-service');
const { positiveInteger } = require('../../config/limits');
const { verifyExecutableSchema } = require('./schema-proof');
const { withStorageBudget } = require('./storage-budget');

function createCandidateManager(env = process.env) {
  const roles = deploymentRoles(env);
  const backup = createAdminBackupService({ env });
  const config = backup.getRuntimeConfig();
  const candidatePool = (name) =>
    new Pool({
      ...withDatabase(env.MIGRATION_DATABASE_URL, name),
      max: 2,
      connectionTimeoutMillis: 5000,
      query_timeout: 30000,
    });
  async function stage(client, job, signal, setStatus) {
    const file = path.join(
      env.RECOVERY_UPLOAD_DIR || '/recovery/uploads',
      job.id,
      'backup.dump'
    );
    const { fileSize } = backup.validateRestoreFile(file, null, config);
    const capacity = await fs.statfs(
      env.RECOVERY_CAPACITY_PATH || '/database-capacity'
    );
    if (
      capacity.bavail * capacity.bsize <
      Math.max(fileSize * 10, 1024 * 1024 * 1024)
    )
      throw new Error('Recovery storage reserve unavailable');
    await backup.runRestorePreflight({ tmpFile: file, config, signal });
    await setStatus('staging');
    const stagingRole = `stage_${job.id.replaceAll('-', '')}`;
    const stagingPassword = randomBytes(32).toString('hex');
    await client.query(
      `CREATE ROLE ${identifier(stagingRole)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${stagingPassword}'`
    );
    await client.query(
      `GRANT ${identifier(stagingRole)} TO ${identifier(roles.recovery)} WITH INHERIT TRUE, SET TRUE`
    );
    await client.query(
      `CREATE DATABASE ${identifier(job.candidate_db)} OWNER ${identifier(stagingRole)} TEMPLATE ${identifier(env.RECOVERY_TEMPLATE_DATABASE || 'sushe_recovery_template')}`
    );
    await client.query(
      `REVOKE ALL ON DATABASE ${identifier(job.candidate_db)} FROM PUBLIC`
    );
    const stagingUrl = new URL(
      databaseUrlFor(env.MIGRATION_DATABASE_URL, job.candidate_db)
    );
    stagingUrl.username = stagingRole;
    stagingUrl.password = stagingPassword;
    const url = stagingUrl.toString();
    await withStorageBudget(
      client,
      job.candidate_db,
      env,
      signal,
      (restoreSignal) =>
        runProcess(
          config.pgRestoreCmd,
          [
            '--dbname',
            job.candidate_db,
            '--no-owner',
            '--no-privileges',
            '--no-comments',
            '--single-transaction',
            '--exit-on-error',
            file,
          ],
          {
            env: pgEnvironment(url, env),
            signal: restoreSignal,
            timeoutMs: config.restoreTimeoutMs,
          }
        )
    );
    await setStatus('verifying');
    await runProcess(process.execPath, ['scripts/migrate.js', 'up'], {
      env: {
        PATH: env.PATH,
        NODE_ENV: 'production',
        MIGRATION_DATABASE_URL: url,
        MIGRATION_STATEMENT_TIMEOUT_MS: env.MIGRATION_STATEMENT_TIMEOUT_MS,
        MIGRATION_LOCK_TIMEOUT_MS: env.MIGRATION_LOCK_TIMEOUT_MS,
        MIGRATION_DEADLINE_MS: env.MIGRATION_DEADLINE_MS,
      },
      signal,
      timeoutMs: positiveInteger(
        env.MIGRATION_DEADLINE_MS,
        1800000,
        'MIGRATION_DEADLINE_MS'
      ),
    });
    const pool = new Pool({
      connectionString: url,
      max: 1,
      query_timeout: 30000,
    });
    const source = candidatePool(job.source_db);
    try {
      await verifyExecutableSchema(pool, source);
      const admin = await pool.query(
        "SELECT _id FROM users WHERE role='admin' AND approval_status='approved' LIMIT 1"
      );
      if (!admin.rows.length)
        throw new Error('Backup must contain an approved administrator');
      const invalid = await pool.query(
        "SELECT 1 FROM pg_constraint WHERE connamespace='public'::regnamespace AND NOT convalidated LIMIT 1"
      );
      if (invalid.rows.length)
        throw new Error('Backup contains unvalidated constraints');
      await pool.query(
        'SELECT COUNT(*) FROM list_items li JOIN lists l ON l._id=li.list_id JOIN users u ON u._id=l.user_id'
      );
      await pool.query('DELETE FROM session');
      await pool.query(
        'UPDATE users SET auth_version=auth_version+1, reset_token=NULL, reset_expires=NULL, spotify_auth=NULL, tidal_auth=NULL, lastfm_auth=NULL'
      );
      await pool.query('UPDATE extension_tokens SET is_revoked=true');
      await pool.query('UPDATE telegram_config SET enabled=false');
      // Archive SQL and candidate migrations ran only as a one-use identity
      // with no rights in the original/control databases. Transfer verified
      // objects only after executable-schema comparison and credential cleanup.
      const adoption = new Pool({
        ...withDatabase(env.RECOVERY_DATABASE_URL, job.candidate_db),
        max: 1,
      });
      try {
        await adoption.query(
          `REASSIGN OWNED BY ${identifier(stagingRole)} TO ${identifier(roles.migration)}`
        );
      } finally {
        await adoption.end();
      }
      const migration = candidatePool(job.candidate_db);
      try {
        await grantApplicationAccess(migration, roles);
      } finally {
        await migration.end();
      }
      await client.query(
        `GRANT CONNECT ON DATABASE ${identifier(job.candidate_db)} TO ${identifier(roles.runtime)}, ${identifier(roles.backup)}`
      );
    } finally {
      await pool.end();
      await source.end();
      await client.query(`ALTER ROLE ${identifier(stagingRole)} NOLOGIN`);
    }
  }

  async function authenticatedProbe(database) {
    const pool = candidatePool(database);
    const token = randomBytes(32).toString('base64url');
    const hash = hashExtensionToken(token);
    try {
      const admin = (
        await pool.query(
          "SELECT _id,auth_version FROM users WHERE role='admin' AND approval_status='approved' LIMIT 1"
        )
      ).rows[0];
      if (!admin)
        throw new Error('No administrator for recovery health verification');
      await pool.query(
        `INSERT INTO extension_tokens (user_id,token_hash,token_lookup,expires_at,user_agent,auth_version)
        VALUES ($1,$2,$3,NOW()+INTERVAL '1 minute','recovery-health-probe',$4)`,
        [admin._id, hash, extensionTokenLookup(token), admin.auth_version]
      );
      const response = await fetch(
        `${env.RECOVERY_APP_URL || 'http://app:3000'}/api/lists`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(5000),
        }
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error('Authenticated recovery health check failed');
      }
      await response.json();
    } finally {
      await pool
        .query('DELETE FROM extension_tokens WHERE token_hash=$1', [hash])
        .catch(() => {});
      await pool.end();
    }
  }
  return { stage, authenticatedProbe };
}
module.exports = { createCandidateManager };
