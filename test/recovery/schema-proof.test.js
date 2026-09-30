const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const {
  databaseUrlFor,
  identifier,
} = require('../../config/database-connection');
const {
  verifyExecutableSchema,
} = require('../../services/recovery/schema-proof');

test('candidate catalog verification rejects injected executable objects and privileges', async () => {
  assert.equal(process.env.RECOVERY_REHEARSAL, 'disposable');
  const name = `proof_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({
    connectionString: process.env.PROVISION_DATABASE_URL,
  });
  let candidate;
  try {
    await admin.query(`CREATE DATABASE ${identifier(name)}`);
    await admin.query(`REVOKE ALL ON DATABASE ${identifier(name)} FROM PUBLIC`);
    candidate = new Pool({
      connectionString: databaseUrlFor(
        process.env.PROVISION_DATABASE_URL,
        name
      ),
    });
    await candidate.query('CREATE TABLE proof(id int)');
    await verifyExecutableSchema(candidate, admin);
    await candidate.query(
      "CREATE FUNCTION injected() RETURNS int LANGUAGE SQL AS 'SELECT 1'"
    );
    await assert.rejects(
      verifyExecutableSchema(candidate, admin),
      /executable schema differs/
    );
    await candidate.query('DROP FUNCTION injected()');
    await candidate.query('GRANT SELECT ON proof TO PUBLIC');
    await assert.rejects(
      verifyExecutableSchema(candidate, admin),
      /object privileges/
    );
    await candidate.query('DROP TABLE proof');
    await candidate.query(
      `GRANT CONNECT ON DATABASE ${identifier(name)} TO PUBLIC`
    );
    await assert.rejects(
      verifyExecutableSchema(candidate, admin),
      /database privileges/
    );
    await candidate.query(
      `REVOKE ALL ON DATABASE ${identifier(name)} FROM PUBLIC`
    );
    await candidate.query('GRANT CREATE ON SCHEMA public TO PUBLIC');
    await assert.rejects(
      verifyExecutableSchema(candidate, admin),
      /schema privileges/
    );
  } finally {
    if (candidate) await candidate.end();
    await admin.query(`DROP DATABASE IF EXISTS ${identifier(name)}`);
    await admin.end();
  }
});
