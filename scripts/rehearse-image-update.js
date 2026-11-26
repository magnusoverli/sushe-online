const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const project = `sushe-update-${randomUUID()}`;
const candidate = { UPGRADE_IMAGE: 'sushe-recovery-test:local' };
function compose(args, env = {}) {
  execFileSync(
    'docker',
    [
      'compose',
      '-p',
      project,
      '-f',
      'docker-compose.upgrade-test.yml',
      ...args,
    ],
    { env: { ...process.env, ...env }, stdio: 'inherit', timeout: 300000 }
  );
}
const check = (mode) =>
  compose([
    'run',
    '--rm',
    '--no-deps',
    'checks',
    'test/deployment/image-update.js',
    mode,
  ]);
const start = (env = {}) => compose(['up', '-d', '--wait', 'app'], env);

try {
  compose([
    'run',
    '--rm',
    '--no-deps',
    'checks',
    '--test',
    'test/deployment/state-safety.js',
  ]);
  start();
  check('seed');
  start(candidate);
  check('verify');
  check('damage');
  compose(['restart', 'app'], candidate);
  check('failed');
  check('repair');
  start(candidate);
  check('verify');
  check('restore');
  compose(['restart', 'app'], candidate);
  start(candidate);
  check('restart');
  console.log('PG19 image update, restart and restore passed');
} finally {
  compose(['--profile', 'checks', 'down', '--volumes']);
}
