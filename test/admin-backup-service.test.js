const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  createAdminBackupService,
} = require('../services/admin-backup-service');
const { pgEnvironment } = require('../config/database-connection');

test('backup credentials honor URL/socket configuration and never enter arguments', async () => {
  const env = {
    DATABASE_URL:
      'postgres://reader:private-password@/fixture?host=/var/run/postgresql',
    NODE_ENV: 'test',
  };
  const service = createAdminBackupService({
    env,
    runProcess: async (_cmd, args, options) => {
      assert.ok(!args.join(' ').includes('private-password'));
      assert.equal(options.env.PGUSER, 'reader');
      assert.equal(options.env.PGHOST, '/var/run/postgresql');
      await new Promise((resolve) =>
        options.output.end('PGDMPsynthetic', resolve)
      );
    },
  });
  const backup = await service.createBackup();
  try {
    assert.equal((await fs.stat(backup.filePath)).mode & 0o777, 0o600);
    assert.equal(backup.size, 14);
  } finally {
    await backup.cleanup();
  }
  await assert.rejects(fs.stat(backup.filePath), { code: 'ENOENT' });
  assert.equal(
    pgEnvironment('postgres://user:pass@db:5433/fixture').PGPORT,
    '5433'
  );
});

test('preflight validates actual bytes and always applies a process deadline', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-test-'));
  const file = path.join(dir, 'backup.dump');
  try {
    await fs.writeFile(file, 'PGDMPsynthetic');
    let ran = false;
    const service = createAdminBackupService({
      runProcess: async (_cmd, args, opts) => {
        ran = true;
        assert.ok(opts.timeoutMs > 0);
        assert.deepEqual(args, ['--list', file]);
      },
    });
    await service.runRestorePreflight({ tmpFile: file });
    assert.ok(ran);
    await fs.writeFile(file, 'not a dump');
    assert.throws(() => service.validateRestoreFile(file), {
      code: 'RESTORE_INVALID_DUMP',
    });
    await fs.writeFile(file, 'PGDMP' + 'a'.repeat(100));
    assert.throws(
      () => service.validateRestoreFile(file, 1, { restoreMaxFileBytes: 16 }),
      { code: 'RESTORE_FILE_TOO_LARGE' }
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('production backups require the explicit backup-reader credential', async () => {
  const service = createAdminBackupService({
    env: {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://runtime@db/source',
    },
  });
  await assert.rejects(service.createBackup(), /BACKUP_DATABASE_URL/);
  assert.equal(service.dropPublicTablesForRestore, undefined);
  assert.equal(service.runRestoreProcess, undefined);
});
