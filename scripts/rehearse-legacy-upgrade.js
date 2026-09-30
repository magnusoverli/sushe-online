const { execFileSync } = require('node:child_process');

const compose = ['compose', '-f', 'docker-compose.upgrade-test.yml'];
// The old server is deliberate test input, not a deployment recommendation.
let databaseImage =
  'postgres:18.4@sha256:a02db8cac496f15b094798a38254f14d6e00741f709360e5e00bb6668ea31636';
function run(args, image) {
  execFileSync('docker', [...compose, ...args], {
    env: {
      ...process.env,
      UPGRADE_DATABASE_IMAGE: databaseImage,
      ...(image ? { UPGRADE_IMAGE: image } : {}),
    },
    stdio: 'inherit',
    timeout: 300000,
  });
}
function check(mode) {
  run([
    'run',
    '--rm',
    '--no-deps',
    'checks',
    'test/deployment/legacy-upgrade.js',
    mode,
  ]);
}

try {
  run([
    'run',
    '--rm',
    '--no-deps',
    'checks',
    '--test',
    'test/deployment/state-safety.js',
  ]);
  run(['up', '-d', '--wait', 'app']);
  check('seed');
  check('initial-damage');
  // Exercise the production Compose update of both the app and PostgreSQL.
  databaseImage = 'sushe-postgres:local';
  run(['up', '-d', 'app'], 'sushe-upgrade-candidate:local');
  check('initial-failed');
  check('initial-repair');
  run(['up', '-d', '--wait', 'app'], 'sushe-upgrade-candidate:local');
  check('verify');
  run([
    'exec',
    '--user',
    '1000:1000',
    'app',
    'node',
    '-e',
    "try { require('fs').accessSync('/app/scripts/container-entrypoint.js', require('fs').constants.W_OK); process.exit(1); } catch(e) { if(e.code!=='EACCES') throw e; }",
  ]);
  // Docker stops/recreates the app; the Compose configuration and .env are unchanged.
  run(['kill', '-s', 'SIGKILL', 'app']);
  run(['up', '-d', '--wait', 'app'], 'sushe-upgrade-candidate:local');
  check('restart');
  check('damage');
  run(['restart', 'app']);
  check('failed');
  check('repair');
  run(['up', '-d', '--wait', 'app'], 'sushe-upgrade-candidate:local');
  check('restart');
  check('restore');
  run(['kill', '-s', 'SIGKILL', 'app']);
  run(['up', '-d', '--wait', 'app'], 'sushe-upgrade-candidate:local');
  check('restart');
  console.log(
    'Published-image upgrade, initial adoption failure/retry, crash restart and automatic restore passed'
  );
} catch (_error) {
  // Application deployment logs contain no generated credentials.
  run(['logs', '--tail', '60', 'app', 'db']);
  process.exitCode = 1;
} finally {
  run(['down', '--volumes']);
}
