const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { createMigrationPool } = require('../../db/migration-policy');
const MigrationManager = require('../../db/migrations');

test(
  'dedicated migration policy survives runtime deadlines, serializes and rejects drift',
  { timeout: 15000 },
  async () => {
    assert.ok(process.env.DATABASE_URL);
    const schema = `migration_${randomUUID().replaceAll('-', '')}`;
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'migration-policy-')
    );
    const admin = new Pool({ connectionString: process.env.DATABASE_URL });
    const url = new URL(process.env.DATABASE_URL);
    url.searchParams.set('options', `-c search_path=${schema}`);
    const env = {
      NODE_ENV: 'production',
      MIGRATION_DATABASE_URL: url.toString(),
      MIGRATION_STATEMENT_TIMEOUT_MS: '2000',
      MIGRATION_LOCK_TIMEOUT_MS: '2000',
    };
    const pools = [createMigrationPool(env), createMigrationPool(env)];
    const runtime = new Pool({
      connectionString: url.toString(),
      statement_timeout: 25,
      query_timeout: 100,
    });
    try {
      await admin.query(`CREATE SCHEMA ${schema}`);
      const file = path.join(directory, '001_fixture.js');
      await fs.writeFile(
        file,
        "module.exports={up:async c=>{await c.query('SELECT pg_sleep(0.15)');await c.query('CREATE TABLE proof(id int)')},down:async c=>{await c.query('DROP TABLE proof')}};"
      );
      const managers = pools.map((pool) => {
        const m = new MigrationManager(pool);
        m.migrationsDir = directory;
        return m;
      });
      await assert.rejects(runtime.query('SELECT pg_sleep(0.15)'), {
        code: '57014',
      });
      await Promise.all(managers.map((manager) => manager.runMigrations()));
      assert.equal(
        Number(
          (await pools[0].query('SELECT COUNT(*) FROM schema_migrations'))
            .rows[0].count
        ),
        1
      );
      await fs.appendFile(file, '\n// unapproved historical modification');
      await assert.rejects(managers[0].validateSchema(), /checksum mismatch/);
      await fs.writeFile(
        path.join(directory, '002_failure.js'),
        "module.exports={up:async c=>{await c.query('CREATE TABLE rolled_back(id int)');throw new Error('synthetic failure')}};"
      );
      // Restore the immutable fixture before testing transactional failure.
      await fs.writeFile(
        file,
        "module.exports={up:async c=>{await c.query('SELECT pg_sleep(0.15)');await c.query('CREATE TABLE proof(id int)')},down:async c=>{await c.query('DROP TABLE proof')}};"
      );
      await assert.rejects(managers[0].runMigrations(), /synthetic failure/);
      assert.equal(
        (await pools[0].query("SELECT to_regclass('rolled_back') AS name"))
          .rows[0].name,
        null
      );
      await managers[1].rollbackLastMigration();
      assert.equal(
        (await pools[0].query("SELECT to_regclass('proof') AS name")).rows[0]
          .name,
        null
      );
    } finally {
      await Promise.all([...pools, runtime].map((pool) => pool.end()));
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
);
