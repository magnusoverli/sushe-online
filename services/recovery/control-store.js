const { Pool } = require('pg');
const { randomUUID, createHash } = require('node:crypto');

const TERMINAL = ['completed', 'failed', 'rolled-back'];
function createControlStore(connectionString) {
  if (!connectionString) return null;
  const pool = new Pool({
    connectionString,
    max: 4,
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
    statement_timeout: 9000,
    lock_timeout: 5000,
    application_name: 'sushe-recovery-control',
  });
  pool.on('error', () => {});
  const state = async () =>
    (await pool.query('SELECT * FROM recovery_state WHERE id = 1')).rows[0];
  return {
    pool,
    state,
    async begin(actor, statusToken) {
      const current = await state();
      const id = randomUUID();
      const result = await pool.query(
        `INSERT INTO recovery_jobs (id, actor, status, source_db, candidate_db, status_key)
         SELECT $1, $2, 'uploading', $3, $4, $5 WHERE NOT EXISTS
         (SELECT 1 FROM recovery_jobs WHERE status NOT IN ('completed','failed','rolled-back'))
         ON CONFLICT DO NOTHING RETURNING *`,
        [
          id,
          actor,
          current.database_name,
          `restore_${id.replaceAll('-', '')}`,
          createHash('sha256').update(statusToken).digest('hex'),
        ]
      );
      return result.rows[0] || null;
    },
    async uploaded(id, size) {
      const result = await pool.query(
        "UPDATE recovery_jobs SET status = 'received', file_bytes = $2, updated_at = NOW() WHERE id = $1 AND status = 'uploading' RETURNING id",
        [id, size]
      );
      return result.rows.length === 1;
    },
    async failUpload(id) {
      await pool.query(
        "UPDATE recovery_jobs SET status = 'failed', error_code = 'RESTORE_UPLOAD_FAILED', updated_at = NOW() WHERE id = $1 AND status = 'uploading'",
        [id]
      );
    },
    async get(id) {
      if (!/^[a-f0-9-]{36}$/.test(id)) return null;
      return (
        (await pool.query('SELECT * FROM recovery_jobs WHERE id = $1', [id]))
          .rows[0] || null
      );
    },
    async active() {
      return (
        (
          await pool.query(
            "SELECT * FROM recovery_jobs WHERE status NOT IN ('completed','failed','rolled-back') ORDER BY created_at LIMIT 1"
          )
        ).rows[0] || null
      );
    },
    close: () => pool.end(),
  };
}

async function initializeControl(pool, sourceDatabase) {
  await pool.query(`CREATE TABLE IF NOT EXISTS recovery_state (
    id INT PRIMARY KEY CHECK (id = 1), database_name TEXT NOT NULL,
    maintenance BOOLEAN NOT NULL DEFAULT false, epoch BIGINT NOT NULL DEFAULT 0,
    operation_id UUID
  )`);
  await pool.query(
    `INSERT INTO recovery_state (id, database_name) VALUES (1, $1) ON CONFLICT DO NOTHING`,
    [sourceDatabase]
  );
  await pool.query(`CREATE TABLE IF NOT EXISTS recovery_jobs (
    id UUID PRIMARY KEY, actor TEXT NOT NULL, status TEXT NOT NULL,
    source_db TEXT NOT NULL, candidate_db TEXT NOT NULL, status_key TEXT NOT NULL,
    file_bytes BIGINT, error_code TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS recovery_one_active ON recovery_jobs ((true))
    WHERE status NOT IN ('completed','failed','rolled-back')`);
  await pool.query(`CREATE TABLE IF NOT EXISTS recovery_instances (
    id TEXT PRIMARY KEY, epoch BIGINT NOT NULL, database_name TEXT, drained BOOLEAN NOT NULL,
    ready BOOLEAN NOT NULL, heartbeat TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}

function publicStatus(job) {
  return {
    restoreId: job.id,
    status: job.status === 'rolled-back' ? 'failed' : job.status,
    phase: job.status,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    completedAt: TERMINAL.includes(job.status) ? job.updated_at : null,
    errorCode:
      job.status === 'rolled-back' ? 'RESTORE_ROLLED_BACK' : job.error_code,
    errorMessage: job.error_code
      ? job.status === 'rolled-back'
        ? 'Restore failed. The original database is back online.'
        : 'Restore did not complete; see the recovery operation log'
      : null,
  };
}

module.exports = {
  createControlStore,
  initializeControl,
  publicStatus,
  TERMINAL,
};
