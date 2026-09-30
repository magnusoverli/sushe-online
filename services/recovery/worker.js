const { setTimeout: delay } = require('node:timers/promises');
const fs = require('node:fs/promises');
const path = require('node:path');
const { identifier } = require('../../config/database-connection');
const { createCandidateManager } = require('./candidate');
const logger = require('../../utils/logger');
const { RECOVERY_LOCK } = require('./constants');

async function until(check, signal, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    if (await check()) return;
    await delay(250, undefined, { signal });
  }
  throw new Error('Recovery phase deadline exceeded');
}

function createRecoveryWorker(
  control,
  env = process.env,
  candidate = createCandidateManager(env)
) {
  async function processNext() {
    const client = await control.pool.connect();
    const abort = new AbortController();
    // Every database-level operation uses this SAME session as the lease. Losing
    // it aborts subprocesses; no reconnect can continue an old worker's cutover.
    const onLost = () => abort.abort();
    client.on('error', onLost);
    let locked = false;
    try {
      locked = (
        await client.query('SELECT pg_try_advisory_lock($1) AS locked', [
          RECOVERY_LOCK,
        ])
      ).rows[0].locked;
      if (!locked) return;
      const job = await control.active();
      if (!job) return;
      if (job.status === 'uploading') {
        if (Date.now() - new Date(job.updated_at).getTime() > 660000) {
          await client.query(
            "UPDATE recovery_jobs SET status='failed',error_code='RESTORE_UPLOAD_FAILED',updated_at=NOW() WHERE id=$1 AND status='uploading'",
            [job.id]
          );
          await cleanup(job);
        }
        return;
      }
      const signal = AbortSignal.any([
        abort.signal,
        AbortSignal.timeout(2400000),
      ]);
      const status = async (value) => {
        signal.throwIfAborted();
        await client.query(
          'UPDATE recovery_jobs SET status=$2,updated_at=NOW() WHERE id=$1',
          [job.id, value]
        );
      };
      const healthy = async (database) => {
        const result = await client.query(
          "SELECT * FROM recovery_instances WHERE heartbeat > NOW()-INTERVAL '10 seconds'"
        );
        if (
          !result.rows.length ||
          result.rows.some(
            (row) => !row.ready || row.database_name !== database
          )
        )
          return false;
        try {
          const response = await fetch(
            `${env.RECOVERY_APP_URL || 'http://app:3000'}/ready`,
            { signal: AbortSignal.timeout(3000) }
          );
          const body = await response.json();
          return response.ok && body.activeDatabase === database;
        } catch {
          return false;
        }
      };
      const quiesce = async (phaseSignal = signal) => {
        await client.query(
          'UPDATE recovery_state SET maintenance=true, operation_id=$1, epoch=epoch+1 WHERE id=1',
          [job.id]
        );
        await until(async () => {
          const rows = await client.query(
            "SELECT 1 FROM recovery_instances WHERE heartbeat > NOW()-INTERVAL '10 seconds' AND NOT drained"
          );
          return rows.rows.length === 0;
        }, phaseSignal);
      };
      const fence = async (database) => {
        const role = `stage_${job.id.replaceAll('-', '')}`;
        if (
          (
            await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [
              role,
            ])
          ).rows.length
        )
          await client.query(`ALTER ROLE ${identifier(role)} NOLOGIN`);
        const exists = await client.query(
          'SELECT 1 FROM pg_database WHERE datname=$1',
          [database]
        );
        if (!exists.rows.length) return;
        await client.query(
          `ALTER DATABASE ${identifier(database)} ALLOW_CONNECTIONS false`
        );
        await client.query(
          'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
          [database]
        );
      };
      const selectDatabase = async (database) => {
        await client.query(
          `ALTER DATABASE ${identifier(database)} ALLOW_CONNECTIONS true`
        );
        await client.query(
          'UPDATE recovery_state SET database_name=$1, maintenance=false, epoch=epoch+1 WHERE id=1',
          [database]
        );
      };
      const finish = async (value, code = null) => {
        await client.query('BEGIN');
        try {
          await client.query(
            'UPDATE recovery_jobs SET status=$2,error_code=$3,updated_at=NOW() WHERE id=$1',
            [job.id, value, code]
          );
          await client.query(
            'UPDATE recovery_state SET operation_id=NULL, maintenance=false WHERE id=1'
          );
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
        // Committed completion must never turn into a rollback because artifact
        // deletion failed. Retained databases are never deleted automatically.
        await cleanup(job).catch(() =>
          logger.warn('Recovery upload cleanup deferred', { restoreId: job.id })
        );
      };
      try {
        // A crash anywhere after receipt is conservatively rolled back. Both
        // databases and the control record survive; the upload is never replayed.
        if (job.status !== 'received')
          throw new Error('Interrupted recovery operation');
        if (!(await healthy(job.source_db)))
          throw new Error('Managed application must be healthy before restore');
        await status('validating');
        await candidate.stage(client, job, signal, status);
        await status('quiescing');
        await quiesce();
        await fence(job.source_db);
        await status('switching');
        await selectDatabase(job.candidate_db);
        await status('verifying-live');
        await until(() => healthy(job.candidate_db), signal);
        await candidate.authenticatedProbe(job.candidate_db);
        await finish('completed');
        logger.info('Automatic database recovery completed', {
          restoreId: job.id,
        });
      } catch (_error) {
        if (abort.signal.aborted) return; // The next lease owner handles recovery.
        logger.error(
          'Recovery failed; restoring original database connection',
          { restoreId: job.id }
        );
        try {
          const state = (
            await client.query('SELECT * FROM recovery_state WHERE id=1')
          ).rows[0];
          if (!state.operation_id && state.database_name === job.source_db) {
            await fence(job.candidate_db);
            await finish('failed', 'RESTORE_PRECHECK_FAILED');
            return;
          }
          await quiesce(abort.signal);
          await fence(job.candidate_db);
          await selectDatabase(job.source_db);
          await until(() => healthy(job.source_db), abort.signal);
          await finish('rolled-back', 'RESTORE_PROCESS_FAILED');
        } catch (_rollbackError) {
          // Keep the traffic gate closed and the durable job active. A later
          // worker retries recovery instead of declaring an unhealthy app done.
          await client.query(
            "UPDATE recovery_jobs SET status='recovery-required',error_code='RESTORE_PROCESS_FAILED',updated_at=NOW() WHERE id=$1",
            [job.id]
          );
          logger.error('Recovery requires retry; original database retained', {
            restoreId: job.id,
          });
        }
      }
    } finally {
      client.removeListener('error', onLost);
      if (locked && !abort.signal.aborted)
        await client
          .query('SELECT pg_advisory_unlock($1)', [RECOVERY_LOCK])
          .catch(() => abort.abort());
      client.release(
        abort.signal.aborted ? new Error('Recovery lease lost') : undefined
      );
    }
  }
  async function cleanup(job) {
    await fs.rm(
      path.join(env.RECOVERY_UPLOAD_DIR || '/recovery/uploads', job.id),
      { recursive: true, force: true }
    );
  }
  return { processNext };
}
module.exports = { createRecoveryWorker, until };
