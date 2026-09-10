const { readdirSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const integrationTests = [
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

async function main() {
  const unitTests = readdirSync(path.join(root, 'test'))
    .filter((name) => name.endsWith('.test.js'))
    .map((name) => `test/${name}`)
    .filter((file) => !integrationTests.includes(file))
    .sort();
  console.log('=== Phase 1: Unit tests (parallel) ===');
  let exitCode = run(['--test', ...unitTests]);
  if (exitCode) return exitCode;

  console.log('=== Phase 2: Integration tests (serial) ===');
  if (await databaseAvailable()) {
    for (const file of integrationTests) {
      console.log(`--- Running ${file} ---`);
      if (run(['--test', file])) exitCode = 1;
    }
  } else
    console.log(
      'Skipping integration tests (no database connection available)'
    );

  if (process.env.CI !== 'true') {
    let cli;
    try {
      cli = require.resolve('@playwright/test/cli');
    } catch {
      return exitCode;
    }
    console.log('=== Phase 3: Playwright e2e tests ===');
    if (run([cli, 'test'], { ...process.env, PLAYWRIGHT_SKIP_SERVER: '1' }))
      exitCode = 1;
  }
  return exitCode;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
