const { test } = require('node:test');
const assert = require('node:assert/strict');
const { main } = require('../scripts/run-tests');

test('CI refuses to skip required database tests even when an opt-out is supplied', async () => {
  const result = await main({
    env: { CI: 'true', SKIP_DB_TESTS: 'true' },
    run: () => 0,
    databaseAvailable: async () => false,
  });
  assert.equal(result, 1);
});
test('local database skipping is opt-in and backend failures propagate', async () => {
  const base = { run: () => 0, databaseAvailable: async () => false };
  assert.equal(await main({ ...base, env: { SKIP_E2E_TESTS: 'true' } }), 1);
  assert.equal(
    await main({
      ...base,
      env: { SKIP_E2E_TESTS: 'true', SKIP_DB_TESTS: 'true' },
    }),
    0
  );
  assert.equal(
    await main({
      env: { CI: 'true' },
      run: () => 1,
      databaseAvailable: async () => true,
    }),
    1
  );
});
