const { describe, it } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createAdminBackupService,
} = require('../services/admin-backup-service');
const { RESTORE_ERROR_CODES } = require('../services/restore-errors');

function createLogger() {
  return {
    info() {},
    warn() {},
    error() {},
    debug() {},
  };
}

function createSpawnWithExit(exitCode, stderrText = '') {
  return () => {
    const processEmitter = new EventEmitter();
    processEmitter.stdout = new EventEmitter();
    processEmitter.stderr = new EventEmitter();
    processEmitter.stdin = { on() {}, end() {} };
    processEmitter.kill = () => {};

    process.nextTick(() => {
      if (stderrText) {
        processEmitter.stderr.emit('data', Buffer.from(stderrText));
      }
      processEmitter.emit('exit', exitCode);
    });

    return processEmitter;
  };
}

function createNeverEndingSpawn() {
  return () => {
    const processEmitter = new EventEmitter();
    processEmitter.stdout = new EventEmitter();
    processEmitter.stderr = new EventEmitter();
    processEmitter.stdin = {
      on() {},
      pipe() {},
      end() {},
    };
    processEmitter.kill = () => {
      process.nextTick(() => {
        processEmitter.emit('exit', 143, 'SIGTERM');
      });
    };
    return processEmitter;
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

  it('validateRestoreFile throws FILE_TOO_LARGE when file exceeds configured limit', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sushe-backup-test-'));
    const filePath = path.join(tmpDir, 'large.dump');
    fs.writeFileSync(filePath, Buffer.from('PGDMP test backup bytes'));

    const service = createAdminBackupService({
      db: { raw: async () => ({ rows: [] }) },
      logger: createLogger(),
    });

    assert.throws(
      () =>
        service.validateRestoreFile(filePath, 4096, {
          restoreMaxFileBytes: 1024,
        }),
      (error) => error.code === RESTORE_ERROR_CODES.FILE_TOO_LARGE
    );

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runRestorePreflight succeeds for valid pg_restore --list execution', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sushe-backup-test-'));
    const filePath = path.join(tmpDir, 'valid.dump');
    fs.writeFileSync(filePath, Buffer.from('PGDMP test backup bytes'));

    const service = createAdminBackupService({
      db: { raw: async () => ({ rows: [] }) },
      logger: createLogger(),
      spawn: createSpawnWithExit(0),
    });

    const result = await service.runRestorePreflight({
      tmpFile: filePath,
      restoreId: 'restore_test',
      config: {
        pgRestoreCmd: 'pg_restore',
        isDocker: false,
        restorePreflightEnabled: true,
      },
    });

    assert.strictEqual(result.code, 0);
    assert.ok(result.durationMs >= 0);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runRestorePreflight throws PRECHECK_FAILED for invalid dumps', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sushe-backup-test-'));
    const filePath = path.join(tmpDir, 'invalid.dump');
    fs.writeFileSync(filePath, Buffer.from('PGDMP test backup bytes'));

    const service = createAdminBackupService({
      db: { raw: async () => ({ rows: [] }) },
      logger: createLogger(),
      spawn: createSpawnWithExit(
        1,
        'input file does not appear to be a valid archive'
      ),
    });

    await assert.rejects(
      () =>
        service.runRestorePreflight({
          tmpFile: filePath,
          restoreId: 'restore_test',
          config: {
            pgRestoreCmd: 'pg_restore',
            isDocker: false,
            restorePreflightEnabled: true,
          },
        }),
      (error) => error.code === RESTORE_ERROR_CODES.PRECHECK_FAILED
    );

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runRestoreProcess reports timeout when process hangs', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sushe-backup-test-'));
    const filePath = path.join(tmpDir, 'valid.dump');
    fs.writeFileSync(filePath, Buffer.from('PGDMP test backup bytes'));

    const service = createAdminBackupService({
      db: { raw: async () => ({ rows: [] }) },
      logger: createLogger(),
      spawn: createNeverEndingSpawn(),
      fs,
    });

    const result = await service.runRestoreProcess({
      tmpFile: filePath,
      restoreId: 'restore_timeout',
      config: {
        pgRestoreCmd: 'pg_restore',
        isDocker: false,
        databaseUrl: 'postgres://localhost:5432/sushe',
        restoreTimeoutMs: 20,
      },
    });

    assert.strictEqual(result.timedOut, true);
    assert.ok(result.stderrData.includes('Restore timed out'));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
