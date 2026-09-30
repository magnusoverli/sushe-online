const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { loadState, saveState } = require('./legacy-state');
const { prepareLegacyUpgrade } = require('./legacy-upgrade');
const { createControlStore } = require('../recovery/control-store');
const { createCandidateManager } = require('../recovery/candidate');
const { runProcess } = require('../../utils/subprocess');
const logger = require('../../utils/logger');

async function runLegacy(env = process.env) {
  const abort = new AbortController();
  const children = [];
  const stop = () => {
    abort.abort();
    for (const child of children) child.kill('SIGTERM');
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  let lease, control;
  try {
    const deployment = await loadState(env);
    lease = await prepareLegacyUpgrade(deployment, env, abort);
    const effective = {
      ...env,
      ...deployment.state.env,
      DATA_DIR: deployment.appData,
      RECOVERY_UPLOAD_DIR: deployment.uploads,
      RECOVERY_CAPACITY_PATH: deployment.root,
      RECOVERY_SHARED_UPLOADS: 'true',
      RECOVERY_APP_URL: 'http://127.0.0.1:3001',
      DEPLOYMENT_VERIFY_ONLY: 'true',
    };
    control = createControlStore(effective.RECOVERY_DATABASE_URL);
    const state = await control.state();
    // A same-image restart must let the worker resume its durable restore.
    // Never run a deployment migration concurrently with that recovery.
    if (
      !state.operation_id &&
      !state.maintenance &&
      !(await control.active())
    ) {
      await runProcess(process.execPath, ['scripts/deploy-migrate.js', 'up'], {
        env: effective,
        signal: abort.signal,
        timeoutMs: 1800000,
      });
    }
    const start = (script, childEnv, uid) => {
      const child = spawn(process.execPath, [script], {
        uid,
        gid: 1000,
        env: childEnv,
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      });
      children.push(child);
      child.once('error', stop);
      child.once('close', stop);
      return child;
    };
    const appEnv = {
      ...effective,
      PORT: '3001',
      APP_LISTEN_HOST: '127.0.0.1',
      TRUST_PROXY: '127.0.0.1,::1',
    };
    for (const key of [
      'PROVISION_DATABASE_URL',
      'MIGRATION_DATABASE_URL',
      'RECOVERY_DATABASE_URL',
    ])
      delete appEnv[key];
    const supervisor = start('scripts/start-app.js', appEnv, 1000);
    const recoveryEnv = {
      ...effective,
      TRUST_PROXY: env.TRUST_PROXY ?? '',
      RECOVERY_PORT: env.PORT || '3000',
    };
    delete recoveryEnv.PROVISION_DATABASE_URL;
    const recovery = start('scripts/recovery-server.js', recoveryEnv, 1001);
    const deadline = Date.now() + 1800000;
    const candidate = createCandidateManager(effective);
    while (true) {
      abort.signal.throwIfAborted();
      if (Date.now() > deadline)
        throw new Error(
          'Managed application failed deployment health verification'
        );
      const state = await control.state();
      if (
        !state.operation_id &&
        !state.maintenance &&
        !(await control.active())
      ) {
        try {
          const response = await fetch('http://127.0.0.1:3001/ready', {
            signal: AbortSignal.timeout(2000),
          });
          const body = await response.json();
          if (response.ok && body.activeDatabase === state.database_name) {
            await candidate.authenticatedProbe(state.database_name);
            break;
          }
        } catch {
          /* startup is not healthy yet */
        }
      }
      await delay(500, undefined, { signal: abort.signal });
    }
    deployment.state.verified = true;
    await saveState(deployment.directory, deployment.state);
    supervisor.send('deployment-verified');
    recovery.send('deployment-verified');
    logger.info(
      'Automatic deployment verified; original database and pre-upgrade backup retained'
    );
    await new Promise((resolve) => {
      if (abort.signal.aborted) resolve(undefined);
      else
        abort.signal.addEventListener('abort', () => resolve(undefined), {
          once: true,
        });
    });
  } finally {
    stop();
    const force = setTimeout(() => {
      for (const child of children) child.kill('SIGKILL');
    }, 7000);
    await Promise.all(
      children.map(
        (child) =>
          new Promise((resolve) => {
            if (child.exitCode !== null || child.signalCode !== null)
              resolve(undefined);
            else child.once('close', () => resolve(undefined));
          })
      )
    );
    clearTimeout(force);
    await control?.close();
    await lease?.close();
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
  }
}

module.exports = { runLegacy };
