const { spawn } = require('node:child_process');
const { isLegacyDeployment } = require('../services/deployment/legacy-state');

async function main() {
  const args = process.argv.slice(2);
  if (isLegacyDeployment(process.env, args)) {
    await require('../services/deployment/legacy-runtime').runLegacy();
    return;
  }
  // Explicit split-service deployments and development/test commands retain
  // their previous unprivileged execution contract.
  if (process.getuid() === 0) {
    process.setgroups([]);
    process.setgid(1000);
    process.setuid(1000);
  }
  const child = spawn(args[0], args.slice(1), { stdio: 'inherit' });
  /** @type {NodeJS.Signals[]} */
  const signals = ['SIGINT', 'SIGTERM'];
  for (const name of signals) process.once(name, () => child.kill(name));
  child.once('error', () => {
    process.exitCode = 1;
  });
  child.once('close', (code) => {
    process.exitCode = code || 0;
  });
}

if (require.main === module)
  main().catch(() => {
    // Provider/database errors can embed connection strings; never print them.
    console.error(
      'Automatic deployment did not become healthy; protected state and original database retained. Restart retries the recorded phase.'
    );
    process.exitCode = 1;
  });
module.exports = { main };
