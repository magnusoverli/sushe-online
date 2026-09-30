const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { provision } = require('../../scripts/provision-database');
const { databaseUrlFor } = require('../../config/database-connection');

test('existing-volume adoption is explicit and preserves data while transferring legacy ownership', async () => {
  assert.equal(process.env.RECOVERY_REHEARSAL, 'disposable');
  const admin = new Pool({
    connectionString: databaseUrlFor(
      process.env.PROVISION_DATABASE_URL,
      'sushe'
    ),
  });
  try {
    const before = (await admin.query('SELECT _id FROM users ORDER BY _id'))
      .rows;
    await assert.rejects(provision(), /ADOPT_EXISTING_DATABASE/);
    await admin.query('ALTER TABLE users OWNER TO postgres');
    await provision({ ...process.env, ADOPT_EXISTING_DATABASE: 'true' });
    await require('../../utils/subprocess').runProcess(
      process.execPath,
      ['scripts/deploy-migrate.js', 'up'],
      { timeoutMs: 30000 }
    );
    assert.deepEqual(
      (await admin.query('SELECT _id FROM users ORDER BY _id')).rows,
      before
    );
    const owner = (
      await admin.query(
        "SELECT tableowner FROM pg_tables WHERE schemaname='public' AND tablename='users'"
      )
    ).rows[0].tableowner;
    assert.equal(owner, 'sushe_migration');
    const wrongPassword = new URL(process.env.DATABASE_URL);
    wrongPassword.password = 'incorrect-fixture-password';
    const denied = new Pool({ connectionString: wrongPassword.toString() });
    try {
      await assert.rejects(denied.query('SELECT 1'), { code: '28P01' });
    } finally {
      await denied.end();
    }
  } finally {
    await admin.end();
  }
});
