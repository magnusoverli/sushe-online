const { readdirSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const integrationTests = [
  'test/integration/oauth-refresh.test.js',
  'test/integration/password-reset-cooldowns.test.js',
  'test/integration/api-contracts.test.js',
  'test/integration/migration-policy.test.js',
  'test/integration/telegram-authorization.test.js',
  'test/list-presence.integration.test.js',
  'test/recommendations.test.js',
  'test/year-locking.test.js',
];

function run(args, env = process.env) {
  const child = spawnSync(process.execPath, args, {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  if (child.error) console.error(child.error.message);
  return child.status ?? 1;
}

async function databaseAvailable() {
  if (!process.env.DATABASE_URL) return false;
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 3000,
  });
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await pool.end();
  }
}

async function main(options = {}) {
  const env = options.env || process.env;
  const execute = options.run || run;
  const hasDatabase = options.databaseAvailable || databaseAvailable;
  const unitTests = readdirSync(path.join(root, 'test'))
    .filter((name) => name.endsWith('.test.js'))
    .map((name) => `test/${name}`)
    .filter((file) => !integrationTests.includes(file))
    .sort();
  console.log('=== Phase 1: Unit tests (parallel) ===');
  let exitCode = execute(['--test', ...unitTests], env);
  if (exitCode) return exitCode;

  console.log('=== Phase 2: Integration tests (serial) ===');
  if (await hasDatabase()) {
    for (const file of integrationTests) {
      console.log(`--- Running ${file} ---`);
      if (execute(['--test', file], env)) exitCode = 1;
    }
  } else if (env.CI !== 'true' && env.SKIP_DB_TESTS === 'true') {
    console.warn(
      'Explicit SKIP_DB_TESTS=true: PostgreSQL authorization, concurrency and HTTP persistence are UNVERIFIED'
    );
  } else {
    console.error(
      'Required integration database unavailable. Configure a disposable DATABASE_URL; CI never skips this gate.'
    );
    return 1;
  }

  if (env.CI !== 'true' && env.SKIP_E2E_TESTS !== 'true') {
    let cli;
    try {
      cli = require.resolve('@playwright/test/cli');
    } catch {
      console.error(
        'Playwright is required unless SKIP_E2E_TESTS=true is explicitly set locally'
      );
      return 1;
    }
    console.log('=== Phase 3: Playwright e2e tests ===');
    if (execute([cli, 'test'], { ...env, PLAYWRIGHT_SKIP_SERVER: '1' }))
      exitCode = 1;
  }
  return exitCode;
}

if (require.main === module)
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });

module.exports = { main, databaseAvailable };
