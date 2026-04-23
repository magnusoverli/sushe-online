const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createAdminBackupService,
} = require('../services/admin-backup-service');

function createLogger() {
  return {
    info() {},
    warn() {},
    error() {},
    debug() {},
  };
}

describe('admin-backup-service', () => {
  it('validateDumpFile returns true for PostgreSQL dump header', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sushe-backup-test-'));
    const filePath = path.join(tmpDir, 'valid.dump');
    fs.writeFileSync(filePath, Buffer.from('PGDMP test backup bytes'));

    const service = createAdminBackupService({
      db: { raw: async () => ({ rows: [] }) },
      logger: createLogger(),
    });

    assert.strictEqual(service.validateDumpFile(filePath), true);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('validateDumpFile returns false for invalid file header', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sushe-backup-test-'));
    const filePath = path.join(tmpDir, 'invalid.dump');
    fs.writeFileSync(filePath, Buffer.from('NOTPG backup bytes'));

    const service = createAdminBackupService({
      db: { raw: async () => ({ rows: [] }) },
      logger: createLogger(),
    });

    assert.strictEqual(service.validateDumpFile(filePath), false);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('getRuntimeConfig falls back to default pg binaries when custom bin is absent', () => {
    const service = createAdminBackupService({
      db: { raw: async () => ({ rows: [] }) },
      logger: createLogger(),
      process: {
        env: {
          PG_MAJOR: '99',
          PG_BIN: '/does/not/exist',
          DATABASE_URL: 'postgres://localhost:5432/sushe',
        },
        exit() {},
      },
      fs: {
        ...fs,
        existsSync() {
          return false;
        },
      },
    });

    const config = service.getRuntimeConfig();

    assert.strictEqual(config.pgDumpCmd, 'pg_dump');
    assert.strictEqual(config.pgRestoreCmd, 'pg_restore');
    assert.strictEqual(config.isDocker, false);
  });
});
