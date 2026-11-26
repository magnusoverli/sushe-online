const { createWorkerWakeup } = require('../services/recovery/worker-wakeup');
const { createControlStore } = require('../services/recovery/control-store');
const { createRecoveryGateway } = require('../services/recovery/gateway');
const { createRecoveryWorker } = require('../services/recovery/worker');
const logger = require('../utils/logger');
const {
  requirePostgres19,
  UnsupportedPostgresError,
} = require('../db/server-version');

async function main(env = process.env) {
  process.on('message', (message) => {
    if (message === 'deployment-verified') env.DEPLOYMENT_VERIFY_ONLY = 'false';
  });
  const control = createControlStore(env.RECOVERY_DATABASE_URL);
  if (!control) throw new Error('RECOVERY_DATABASE_URL is required');
  try {
    await requirePostgres19(control.pool);
  } catch (error) {
    await control.close();
    throw error;
  }
  const worker = createRecoveryWorker(control, env);
  const wakeup = createWorkerWakeup(control.pool);
  const server = createRecoveryGateway(control, env).listen(
    Number(env.RECOVERY_PORT || 3000)
  );
  require('../services/recovery/websocket-proxy').attachWebsocketProxy(
    server,
    control,
    env
  );
  let stopped = false;
  const stop = () => {
    stopped = true;
    wakeup.wake();
    server.close();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  try {
    while (!stopped) {
      try {
        await wakeup.subscribe().catch(() => {});
        await worker.processNext();
      } catch (_error) {
        logger.error('Recovery worker retrying after control failure');
      }
      if (!stopped) await wakeup.wait();
    }
  } finally {
    wakeup.disconnect();
    await control.close();
  }
}
if (require.main === module)
  main().catch((error) => {
    logger.error(
      error instanceof UnsupportedPostgresError
        ? error.message
        : 'Recovery service configuration failed'
    );
    process.exitCode = 1;
  });
module.exports = { main };
