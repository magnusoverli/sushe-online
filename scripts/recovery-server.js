const { setTimeout: delay } = require('node:timers/promises');
const { createControlStore } = require('../services/recovery/control-store');
const { createRecoveryGateway } = require('../services/recovery/gateway');
const { createRecoveryWorker } = require('../services/recovery/worker');
const logger = require('../utils/logger');

async function main(env = process.env) {
  process.on('message', (message) => {
    if (message === 'deployment-verified') env.DEPLOYMENT_VERIFY_ONLY = 'false';
  });
  const control = createControlStore(env.RECOVERY_DATABASE_URL);
  if (!control) throw new Error('RECOVERY_DATABASE_URL is required');
  const worker = createRecoveryWorker(control, env);
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
    server.close();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  try {
    while (!stopped) {
      try {
        await worker.processNext();
      } catch (_error) {
        logger.error('Recovery worker retrying after control failure');
      }
      await delay(500);
    }
  } finally {
    await control.close();
  }
}
if (require.main === module)
  main().catch(() => {
    logger.error('Recovery service configuration failed');
    process.exitCode = 1;
  });
module.exports = { main };
