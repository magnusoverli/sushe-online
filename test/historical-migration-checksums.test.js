const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const MigrationManager = require('../db/migrations');
const legacy = require('./fixtures/historical-migrations');

async function fixture({ extension = true } = {}) {
  const rows = legacy.map(([version, checksum]) => ({ version, checksum }));
  const queries = [];
  const manager = new MigrationManager({
    query: async (sql) => {
      queries.push(sql);
      return {
        rows: sql.includes('pg_extension') ? [{ present: extension }] : rows,
      };
    },
  });
  const version = '047_fix_conflicting_album_index';
  rows.push({
    version,
    checksum: await manager.calculateChecksum(
      path.join(manager.migrationsDir, `${version}.js`)
    ),
  });
  return { manager, rows, queries };
}

test('reviewed historical releases validate without rewriting migration records', async () => {
  const { manager, rows, queries } = await fixture();
  const before = rows.map((row) => ({ ...row }));
  await manager.verifyChecksums();
  assert.deepEqual(rows, before);
  assert.ok(queries.every((sql) => sql.trim().startsWith('SELECT')));
});

test('unknown recorded checksum still fails for a recognized historical migration', async () => {
  const { manager, rows } = await fixture();
  rows[0].checksum = '0'.repeat(64);
  await assert.rejects(manager.verifyChecksums(), /checksum mismatch: 005/);
});

test('historical compatibility does not excuse a subsequent on-disk edit', async () => {
  const { manager, rows } = await fixture();
  rows.splice(1);
  const name = `${rows[0].version}.js`;
  const original = await fs.readFile(path.join(manager.migrationsDir, name));
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'checksum-history-')
  );
  try {
    await fs.writeFile(
      path.join(directory, name),
      Buffer.concat([original, Buffer.from('\n// unapproved edit\n')])
    );
    manager.migrationsDir = directory;
    await assert.rejects(manager.verifyChecksums(), /checksum mismatch: 005/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('historical album index migration requires the compensating migration', async () => {
  const { manager, rows } = await fixture();
  rows.pop();
  await assert.rejects(
    manager.verifyChecksums(),
    /requires applied migration 047/
  );
});

test('historical group migration requires its existing pgcrypto prerequisite', async () => {
  const { manager } = await fixture({ extension: false });
  await assert.rejects(
    manager.verifyChecksums(),
    /requires extension pgcrypto/
  );
});

test('missing files cannot pass checksum validation with an empty recorded value', async () => {
  const { manager, rows } = await fixture();
  rows.splice(0, rows.length, { version: '999_unknown', checksum: null });
  await assert.rejects(manager.verifyChecksums(), /checksum mismatch: 999/);
});
