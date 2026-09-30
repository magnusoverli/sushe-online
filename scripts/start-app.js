const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { createControlStore } = require('../services/recovery/control-store');
const { databaseUrlFor } = require('../config/database-connection');
const logger = require('../utils/logger');

async function supervise(env = process.env) {
  let deploymentReady = env.DEPLOYMENT_VERIFY_ONLY !== 'true';
  process.on('message', (message) => {
    if (message === 'deployment-verified') deploymentReady = true;
  });
  const control = createControlStore(env.CONTROL_DATABASE_URL);
  if (!control)
    throw new Error('CONTROL_DATABASE_URL is required by the managed app');
  const id = randomUUID();
  let child,
    database,
    epoch,
    stopping = false;
  const stopChild = async () => {
    const current = child;
    if (!current) return;
    current.kill('SIGTERM');
    await new Promise((resolve) => {
      const escalation = setTimeout(() => current.kill('SIGKILL'), 15000);
      current.once('close', () => {
        clearTimeout(escalation);
        resolve(undefined);
      });
      if (current.exitCode !== null || current.signalCode !== null) {
        clearTimeout(escalation);
        resolve(undefined);
      }
    });
    if (child === current) child = null;
  };
  const stop = () => {
    stopping = true;
    void stopChild();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  try {
    while (!stopping) {
      try {
        const state = await control.state();
        if (!state) throw new Error('Recovery control is not initialized');
        if (
          child &&
          (state.maintenance ||
            database !== state.database_name ||
            epoch !== state.epoch)
        )
          await stopChild();
        if (!child && !state.maintenance && !stopping) {
          database = state.database_name;
          epoch = state.epoch;
          const childEnv = {
            ...env,
            DATABASE_URL: databaseUrlFor(env.DATABASE_URL, database),
            BACKUP_DATABASE_URL: databaseUrlFor(
              env.BACKUP_DATABASE_URL,
              database
            ),
            ACTIVE_DATABASE_NAME: database,
            ACTIVE_DATABASE_EPOCH: String(epoch),
            RECOVERY_MANAGED: 'true',
          };
          for (const key of [
            'MIGRATION_DATABASE_URL',
            'RECOVERY_DATABASE_URL',
            'PROVISION_DATABASE_URL',
          ])
            delete childEnv[key];
          child = spawn(process.execPath, ['index.js'], {
            env: childEnv,
            stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
          });
          const current = child;
          current.on('error', () => {});
          current.once('close', () => {
            if (child === current) child = null;
          });
        }
        let healthy = false;
        if (child) {
          try {
            const response = await fetch(
              `http://127.0.0.1:${env.PORT || 3000}/ready`,
              { signal: AbortSignal.timeout(2000) }
            );
            healthy = response.ok;
            await response.body?.cancel();
          } catch {
            /* child is still starting */
          }
          if (
            deploymentReady &&
            healthy &&
            !state.operation_id &&
            child?.connected
          )
            child.send('activate-services');
        }
        await control.pool.query(
          `INSERT INTO recovery_instances (id, epoch, database_name, drained, ready, heartbeat)
          VALUES ($1,$2,$3,$4,$5,NOW()) ON CONFLICT (id) DO UPDATE SET epoch=$2, database_name=$3, drained=$4, ready=$5, heartbeat=NOW()`,
          [id, state.epoch, child ? database : null, !child, healthy]
        );
      } catch (_error) {
        // Losing the control plane must not leave an unfenced application alive.
        await stopChild();
        logger.error('App supervisor is waiting for recovery control');
      }
      await delay(500);
    }
  } finally {
    await stopChild();
    await control.close();
  }
}

if (require.main === module)
  supervise().catch(() => {
    logger.error('App supervisor failed');
    process.exitCode = 1;
  });
module.exports = { supervise };
