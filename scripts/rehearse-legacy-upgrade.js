const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const compose = [
  'compose',
  '-p',
  `sushe-upgrade-${randomUUID()}`,
  '-f',
  'docker-compose.upgrade-test.yml',
];
const majorOverlay = [
  '-f',
  'docker-compose.upgrade-19-test.yml',
  '-f',
  'docker-compose.upgrade-startup-test.yml',
];
let testing19 = false;
// The old server is deliberate test input, not a deployment recommendation.
let databaseImage =
  'postgres:18.4@sha256:a02db8cac496f15b094798a38254f14d6e00741f709360e5e00bb6668ea31636';
function run(args, image) {
  execFileSync(
    'docker',
    [...compose, ...(testing19 ? majorOverlay : []), ...args],
    {
      env: {
        ...process.env,
        UPGRADE_DATABASE_IMAGE: databaseImage,
        ...(image ? { UPGRADE_IMAGE: image } : {}),
      },
      stdio: 'inherit',
      timeout: 300000,
    }
  );
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
  check('capture-session');
  testing19 = true;
  // Model a pulled image: build it while 18 is still serving, then exercise
  // normal Compose recreation, without a manual stop or migration command.
  run(['build', 'db']);
  run(
    ['up', '--no-build', '-d', '--wait', 'app'],
    'sushe-upgrade-candidate:local'
  );
  check('verify19');
  run(['stop', 'app', 'db']);
  run(['up', '-d', '--wait', 'app'], 'sushe-upgrade-candidate:local');
  check('verify19');
  // Take a backup through the running PG19 app, restore it on the candidate
  // only, and verify a new session before returning to the original volumes.
  check('restore');
  run(['restart', 'app']);
  run(['up', '-d', '--wait', 'app'], 'sushe-upgrade-candidate:local');
  check('capture-session');
  check('verify19');
  run(['stop', 'app', 'db']);
  testing19 = false;
  run(['up', '-d', '--wait', 'app'], 'sushe-upgrade-candidate:local');
  check('verify');
  console.log(
    'Published-image adoption, recovery, physical 18->19 cutover and rollback passed'
  );
} catch (_error) {
  // Application deployment logs contain no generated credentials.
  run(['logs', '--tail', '60', 'app', 'db']);
  process.exitCode = 1;
} finally {
  testing19 = true;
  run(['--profile', 'checks', 'down', '--volumes']);
}
