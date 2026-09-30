const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runProcess } = require('../utils/subprocess');
const { pgEnvironment } = require('../config/database-connection');
const { positiveInteger } = require('../config/limits');
const { createRestoreError, RESTORE_ERROR_CODES } = require('./restore-errors');

const MAX_FILE_BYTES = 256 * 1024 * 1024;

function createAdminBackupService(deps = {}) {
  const env = deps.env || process.env;
  const run = deps.runProcess || runProcess;
  let activeBackups = 0;
  function getRuntimeConfig() {
    const bin = env.PG_BIN || `/usr/lib/postgresql/${env.PG_MAJOR || '18'}/bin`;
    return {
      pgDumpCmd:
        env.PG_DUMP ||
        (fs.existsSync(path.join(bin, 'pg_dump'))
          ? path.join(bin, 'pg_dump')
          : 'pg_dump'),
      pgRestoreCmd:
        env.PG_RESTORE ||
        (fs.existsSync(path.join(bin, 'pg_restore'))
          ? path.join(bin, 'pg_restore')
          : 'pg_restore'),
      databaseUrl:
        env.BACKUP_DATABASE_URL ||
        (env.NODE_ENV !== 'production' ? env.DATABASE_URL : undefined),
      restoreMaxFileBytes: positiveInteger(
        env.RESTORE_MAX_FILE_BYTES,
        MAX_FILE_BYTES,
        'RESTORE_MAX_FILE_BYTES',
        MAX_FILE_BYTES
      ),
      restoreTimeoutMs: positiveInteger(
        env.RESTORE_TIMEOUT_MS,
        600000,
        'RESTORE_TIMEOUT_MS'
      ),
    };
  }
  function validateDumpFile(file) {
    const header = Buffer.alloc(5);
    const fd = fs.openSync(file, 'r');
    try {
      fs.readSync(fd, header, 0, 5, 0);
    } finally {
      fs.closeSync(fd);
    }
    return header.toString() === 'PGDMP';
  }
  function validateRestoreFile(
    file,
    _claimedSize,
    config = getRuntimeConfig()
  ) {
    if (!file)
      throw createRestoreError(
        RESTORE_ERROR_CODES.NO_FILE_UPLOADED,
        'No backup file uploaded',
        400
      );
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > config.restoreMaxFileBytes)
      throw createRestoreError(
        RESTORE_ERROR_CODES.FILE_TOO_LARGE,
        'Backup exceeds the supported size limit',
        413
      );
    if (!validateDumpFile(file))
      throw createRestoreError(
        RESTORE_ERROR_CODES.INVALID_DUMP,
        'Invalid PostgreSQL custom backup',
        400
      );
    return { fileSize: stat.size, format: 'custom' };
  }
  async function createBackup(config = getRuntimeConfig(), signal) {
    if (activeBackups >= 1) throw new Error('A backup is already running');
    if (!config.databaseUrl) throw new Error('BACKUP_DATABASE_URL is required');
    activeBackups++;
    let directory;
    try {
      directory = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'sushe-backup-')
      );
      const available = await fs.promises.statfs(directory);
      if (
        available.bavail * available.bsize <
        config.restoreMaxFileBytes + 16 * 1024 * 1024
      )
        throw new Error('Insufficient backup storage');
      const filePath = path.join(directory, 'database.dump');
      await run(config.pgDumpCmd, ['-Fc', '--no-owner', '--no-privileges'], {
        env: pgEnvironment(config.databaseUrl, env),
        signal,
        output: fs.createWriteStream(filePath, { flags: 'wx', mode: 0o600 }),
        maxOutputBytes: config.restoreMaxFileBytes,
        timeoutMs: config.restoreTimeoutMs,
      });
      const { fileSize } = validateRestoreFile(filePath, null, config);
      let released = false;
      return {
        filePath,
        size: fileSize,
        cleanup: async () => {
          if (released) return;
          await fs.promises.rm(directory, { recursive: true, force: true });
          released = true;
          activeBackups--;
        },
      };
    } catch (error) {
      activeBackups--;
      if (directory)
        await fs.promises.rm(directory, { recursive: true, force: true });
      throw error;
    }
  }
  async function runRestorePreflight({
    tmpFile,
    config = getRuntimeConfig(),
    signal,
  }) {
    validateRestoreFile(tmpFile, null, config);
    return run(config.pgRestoreCmd, ['--list', tmpFile], {
      signal,
      timeoutMs: config.restoreTimeoutMs,
    });
  }
  return {
    getRuntimeConfig,
    createBackup,
    validateDumpFile,
    validateRestoreFile,
    runRestorePreflight,
  };
}
module.exports = { createAdminBackupService, MAX_FILE_BYTES };
