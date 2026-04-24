const { spawn } = require('child_process');
const { ensureDb } = require('../db/postgres');
const fs = require('fs');
const path = require('path');
const { RESTORE_ERROR_CODES, createRestoreError } = require('./restore-errors');

const DEFAULT_RESTORE_MAX_FILE_BYTES = 1024 * 1024 * 1024;
const DEFAULT_RESTORE_TIMEOUT_MS = 10 * 60 * 1000;

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function getStderrSample(stderrData, maxLength = 500) {
  if (typeof stderrData !== 'string') return '';
  if (stderrData.length <= maxLength) return stderrData;
  return stderrData.slice(-maxLength);
}

function toToolNotFoundError(toolName, originalError) {
  return createRestoreError(
    RESTORE_ERROR_CODES.TOOL_NOT_FOUND,
    `${toolName} is not available in this environment`,
    500,
    { tool: toolName, reason: originalError?.message }
  );
}

function getRuntimeConfig(processRef, fsDep, pathDep) {
  const pgMajor = processRef.env.PG_MAJOR || '18';
  const binDir = processRef.env.PG_BIN || `/usr/lib/postgresql/${pgMajor}/bin`;

  const pgDumpCmd = fsDep.existsSync(pathDep.join(binDir, 'pg_dump'))
    ? pathDep.join(binDir, 'pg_dump')
    : processRef.env.PG_DUMP || 'pg_dump';

  const pgRestoreCmd = fsDep.existsSync(pathDep.join(binDir, 'pg_restore'))
    ? pathDep.join(binDir, 'pg_restore')
    : processRef.env.PG_RESTORE || 'pg_restore';

  const databaseUrl = processRef.env.DATABASE_URL || '';
  const isDocker = databaseUrl.includes('host=/var/run/postgresql');
  const restoreMaxFileBytes = parsePositiveInt(
    processRef.env.RESTORE_MAX_FILE_BYTES,
    DEFAULT_RESTORE_MAX_FILE_BYTES
  );
  const restoreTimeoutMs = parsePositiveInt(
    processRef.env.RESTORE_TIMEOUT_MS,
    DEFAULT_RESTORE_TIMEOUT_MS
  );
  const restorePreflightEnabled =
    processRef.env.RESTORE_PREFLIGHT_ENABLED !== 'false';

  return {
    pgDumpCmd,
    pgRestoreCmd,
    isDocker,
    databaseUrl,
    restoreMaxFileBytes,
    restoreTimeoutMs,
    restorePreflightEnabled,
  };
}

function createDockerPgEnv(processRef) {
  return {
    ...processRef.env,
    PGHOST: 'db',
    PGPORT: '5432',
    PGDATABASE: 'sushe',
    PGUSER: 'postgres',
    PGPASSWORD: 'example',
  };
}

async function createBackup({ config, spawnDep, logger, processRef }) {
  const { pgDumpCmd, isDocker, databaseUrl } = config;
  let backupProcess;
  try {
    backupProcess = isDocker
      ? spawnDep(pgDumpCmd, ['-Fc'], { env: createDockerPgEnv(processRef) })
      : spawnDep(pgDumpCmd, ['-Fc', '-d', databaseUrl]);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw toToolNotFoundError('pg_dump', error);
    }
    throw error;
  }

  logger.info(
    isDocker
      ? 'Using pg_dump with TCP connection to database service'
      : 'Using pg_dump with DATABASE_URL connection'
  );

  const chunks = [];
  const stderrChunks = [];

  return new Promise((resolve, reject) => {
    backupProcess.stdout.on('data', (chunk) => chunks.push(chunk));
    backupProcess.stderr.on('data', (chunk) =>
      stderrChunks.push(chunk.toString())
    );
    backupProcess.on('error', (error) => {
      if (error?.code === 'ENOENT') {
        reject(toToolNotFoundError('pg_dump', error));
        return;
      }
      reject(error);
    });

    backupProcess.on('close', (code) => {
      const stderrOutput = stderrChunks.join('');
      if (stderrOutput) {
        if (code !== 0) logger.error('pg_dump error output:', stderrOutput);
        else logger.warn('pg_dump warnings:', stderrOutput);
      }

      if (code !== 0) {
        return reject(new Error(`pg_dump exited with code ${code}`));
      }

      const backup = Buffer.concat(chunks);
      if (backup.length < 5 || backup.slice(0, 5).toString() !== 'PGDMP') {
        return reject(new Error('Backup verification failed: invalid format'));
      }

      resolve(backup);
    });
  });
}

function validateDumpFile(fsDep, tmpFile) {
  const header = Buffer.alloc(5);
  const fd = fsDep.openSync(tmpFile, 'r');
  try {
    fsDep.readSync(fd, header, 0, 5, 0);
  } finally {
    fsDep.closeSync(fd);
  }

  return header.toString() === 'PGDMP';
}

function validateRestoreFile({ fsDep, tmpFile, fileSize, config }) {
  if (!tmpFile) {
    throw createRestoreError(
      RESTORE_ERROR_CODES.NO_FILE_UPLOADED,
      'No backup file was uploaded',
      400
    );
  }

  const maxFileBytes =
    config?.restoreMaxFileBytes || DEFAULT_RESTORE_MAX_FILE_BYTES;
  let detectedFileSize;
  try {
    detectedFileSize =
      typeof fileSize === 'number' && fileSize > 0
        ? fileSize
        : fsDep.statSync(tmpFile).size;
  } catch (error) {
    throw createRestoreError(
      RESTORE_ERROR_CODES.INVALID_DUMP,
      'Unable to read uploaded backup file',
      400,
      { reason: error.message }
    );
  }

  if (detectedFileSize > maxFileBytes) {
    throw createRestoreError(
      RESTORE_ERROR_CODES.FILE_TOO_LARGE,
      `Backup file exceeds maximum size of ${maxFileBytes} bytes`,
      413,
      {
        maxFileBytes,
        fileSize: detectedFileSize,
      }
    );
  }

  const validDump = validateDumpFile(fsDep, tmpFile);
  if (!validDump) {
    throw createRestoreError(
      RESTORE_ERROR_CODES.INVALID_DUMP,
      'Invalid backup file. Must be a PostgreSQL custom dump file.',
      400
    );
  }

  return {
    fileSize: detectedFileSize,
    format: 'custom',
  };
}

async function runRestorePreflight({
  tmpFile,
  restoreId,
  config,
  spawnDep,
  logger,
  processRef,
}) {
  if (config?.restorePreflightEnabled === false) {
    logger.info(`[${restoreId}] Restore preflight check is disabled`);
    return { skipped: true };
  }

  const args = ['--list', tmpFile];
  const preflightOptions = config?.isDocker
    ? { env: createDockerPgEnv(processRef) }
    : {};

  let preflightProcess;
  try {
    preflightProcess = spawnDep(config.pgRestoreCmd, args, preflightOptions);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw toToolNotFoundError('pg_restore', error);
    }
    throw error;
  }

  const startedAt = Date.now();
  let stderrData = '';

  return new Promise((resolve, reject) => {
    preflightProcess.stderr.on('data', (data) => {
      stderrData += data.toString();
    });

    preflightProcess.on('error', (error) => {
      if (error?.code === 'ENOENT') {
        reject(toToolNotFoundError('pg_restore', error));
        return;
      }

      reject(
        createRestoreError(
          RESTORE_ERROR_CODES.PRECHECK_FAILED,
          'Backup preflight validation failed',
          400,
          { reason: error.message }
        )
      );
    });

    preflightProcess.on('exit', (code) => {
      if (code !== 0) {
        reject(
          createRestoreError(
            RESTORE_ERROR_CODES.PRECHECK_FAILED,
            'Backup preflight validation failed',
            400,
            {
              exitCode: code,
              durationMs: Date.now() - startedAt,
              stderrSample: getStderrSample(stderrData),
            }
          )
        );
        return;
      }

      resolve({
        code,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

async function dropPublicTablesForRestore({ db, logger, restoreId }) {
  try {
    logger.info(
      `[${restoreId}] Dropping all tables before restore to avoid FK conflicts`
    );

    const tablesResult = await db.raw(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
      [],
      { name: 'backup-list-public-tables', retryable: true }
    );

    if (tablesResult.rows.length > 0) {
      const tableNames = tablesResult.rows
        .map((row) => `"${row.tablename}"`)
        .join(', ');
      await db.raw(`DROP TABLE IF EXISTS ${tableNames} CASCADE`);
      logger.info(`[${restoreId}] Dropped ${tablesResult.rows.length} tables`);
    }

    await db.raw('DROP TABLE IF EXISTS schema_migrations CASCADE');
    logger.info(`[${restoreId}] Dropped schema_migrations table`);
  } catch (error) {
    logger.warn(`[${restoreId}] Pre-restore table drop failed (non-fatal)`, {
      error: error.message,
    });
  }
}

async function runRestoreProcess({
  tmpFile,
  restoreId,
  config,
  onStderr,
  spawnDep,
  fsDep,
  logger,
  processRef,
}) {
  const { pgRestoreCmd, isDocker, databaseUrl } = config;
  const args = ['--clean', '--if-exists', '--single-transaction'];
  const restoreOptions = {};

  if (isDocker) {
    args.push('-d', 'sushe');
    restoreOptions.env = createDockerPgEnv(processRef);
    logger.info(`[${restoreId}] Starting pg_restore process via TCP`, {
      command: pgRestoreCmd,
      args,
    });
  } else {
    args.push('-d', databaseUrl, tmpFile);
    logger.info(`[${restoreId}] Starting pg_restore process`, {
      command: pgRestoreCmd,
      args: ['--clean', '--if-exists', '--single-transaction', '-d', '***'],
    });
  }

  let restoreProcess;
  try {
    restoreProcess = spawnDep(pgRestoreCmd, args, restoreOptions);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw toToolNotFoundError('pg_restore', error);
    }
    throw error;
  }

  if (isDocker) {
    const fileStream = fsDep.createReadStream(tmpFile);
    fileStream.pipe(restoreProcess.stdin);
    fileStream.on('error', (error) => {
      logger.error(`[${restoreId}] Error reading backup file:`, error);
    });
  }

  const startedAt = Date.now();
  let stderrData = '';
  let timedOut = false;
  let timeoutHandle = null;

  if (config.restoreTimeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      stderrData += `\nRestore timed out after ${config.restoreTimeoutMs}ms`;
      try {
        restoreProcess.kill('SIGTERM');
      } catch (_error) {
        // Ignore kill errors and let process handlers settle.
      }
    }, config.restoreTimeoutMs);
  }

  function clearRestoreTimeout() {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
  }

  return new Promise((resolve, reject) => {
    restoreProcess.stderr.on('data', (data) => {
      const output = data.toString();
      stderrData += output;
      if (typeof onStderr === 'function') onStderr(output);
    });

    restoreProcess.on('error', (error) => {
      clearRestoreTimeout();
      if (error?.code === 'ENOENT') {
        reject(toToolNotFoundError('pg_restore', error));
        return;
      }
      reject(error);
    });
    restoreProcess.on('exit', (code, signal) => {
      clearRestoreTimeout();
      resolve({
        code,
        signal,
        stderrData,
        durationMs: Date.now() - startedAt,
        timedOut,
      });
    });
  });
}

async function clearSessions({ db, logger, restoreId }) {
  const startedAt = Date.now();
  await db.raw('DELETE FROM session', [], { name: 'backup-clear-sessions' });
  logger.info(`[${restoreId}] All sessions cleared`, {
    duration: `${Date.now() - startedAt}ms`,
  });
}

function cleanupTempFile(fsDep, tmpFile) {
  if (!tmpFile) return;
  fsDep.unlink(tmpFile, () => {});
}

function scheduleRestart({
  restoreId,
  delayMs,
  logger,
  processRef,
  fsDep,
  pathDep,
}) {
  logger.info(`[${restoreId}] Scheduling server restart in ${delayMs}ms...`);

  setTimeout(() => {
    logger.info(`[${restoreId}] Restarting server now...`);

    if (processRef.env.NODE_ENV === 'development') {
      const triggerFile = pathDep.join(__dirname, '../.restart-trigger');
      let restartTriggered = false;

      try {
        const now = new Date();
        fsDep.utimesSync(triggerFile, now, now);
        logger.info(`[${restoreId}] Triggered nodemon restart via file touch`);
        restartTriggered = true;
      } catch (_error) {
        try {
          fsDep.writeFileSync(triggerFile, String(Date.now()));
          logger.info(
            `[${restoreId}] Created restart trigger file for nodemon`
          );
          restartTriggered = true;
        } catch (createError) {
          logger.warn(`[${restoreId}] Could not create restart trigger file`, {
            error: createError.message,
          });
        }
      }

      if (restartTriggered) {
        logger.info(
          `[${restoreId}] Nodemon will restart gracefully via file change detection`
        );
        return;
      }
    }

    logger.info(`[${restoreId}] Triggering hard restart via process.exit()`);
    processRef.exit(1);
  }, delayMs);
}

function createAdminBackupService(deps = {}) {
  const logger = deps.logger || require('../utils/logger');
  const db = ensureDb(deps.db, 'admin-backup-service');
  const fsDep = deps.fs || fs;
  const pathDep = deps.path || path;
  const spawnDep = deps.spawn || spawn;
  const processRef = deps.process || process;

  return {
    getRuntimeConfig: () => getRuntimeConfig(processRef, fsDep, pathDep),
    createBackup: (config) =>
      createBackup({ config, spawnDep, logger, processRef }),
    validateDumpFile: (tmpFile) => validateDumpFile(fsDep, tmpFile),
    validateRestoreFile: (tmpFile, fileSize, config) =>
      validateRestoreFile({ fsDep, tmpFile, fileSize, config }),
    runRestorePreflight: (input) =>
      runRestorePreflight({
        ...input,
        spawnDep,
        logger,
        processRef,
      }),
    dropPublicTablesForRestore: (restoreId) =>
      dropPublicTablesForRestore({ db, logger, restoreId }),
    runRestoreProcess: (input) =>
      runRestoreProcess({
        ...input,
        spawnDep,
        fsDep,
        logger,
        processRef,
      }),
    clearSessions: (restoreId) => clearSessions({ db, logger, restoreId }),
    cleanupTempFile: (tmpFile) => cleanupTempFile(fsDep, tmpFile),
    scheduleRestart: (restoreId, delayMs = 3000) =>
      scheduleRestart({
        restoreId,
        delayMs,
        logger,
        processRef,
        fsDep,
        pathDep,
      }),
  };
}

module.exports = { createAdminBackupService };
