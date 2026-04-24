/**
 * Admin Database Backup/Restore Routes
 */

const logger = require('../../utils/logger');
const {
  createAdminBackupService,
} = require('../../services/admin-backup-service');
const {
  createRestoreOperationService,
} = require('../../services/restore-operation-service');
const {
  RESTORE_ERROR_CODES,
  createRestoreError,
  toRestoreHttpError,
} = require('../../services/restore-errors');

module.exports = (app, deps) => {
  const { ensureAuth, ensureAdmin, upload, db, broadcast } = deps;
  const backupService = createAdminBackupService({ db, logger });
  const restoreOperationService =
    deps.restoreOperationService || createRestoreOperationService();
  const RESTORE_SUCCESS_NOTICE_DELAY_MS = 2200;
  const LOGOUT_NOTICE_DELAY_MS = 1800;
  const RESTART_NOTICE_DELAY_MS = 1800;

  function rejectIfRestoreInProgress(req, res, next) {
    if (!restoreOperationService.hasActiveRestore()) {
      next();
      return;
    }

    const { statusCode, body } = toRestoreHttpError(
      createRestoreError(
        RESTORE_ERROR_CODES.IN_PROGRESS,
        'A database restore is already in progress',
        409
      )
    );
    res.status(statusCode).json(body);
  }

  function restoreUploadMiddleware(req, res, next) {
    upload.single('backup')(req, res, (error) => {
      if (!error) {
        next();
        return;
      }

      if (error.code === 'LIMIT_FILE_SIZE') {
        const { statusCode, body } = toRestoreHttpError(
          createRestoreError(
            RESTORE_ERROR_CODES.FILE_TOO_LARGE,
            'Backup file is too large to upload',
            413
          )
        );
        res.status(statusCode).json(body);
        return;
      }

      logger.error('Restore upload middleware failed', {
        error: error.message,
      });

      const { statusCode, body } = toRestoreHttpError(
        createRestoreError(
          RESTORE_ERROR_CODES.UPLOAD_FAILED,
          'Failed to upload backup file',
          400,
          { reason: error.message }
        )
      );
      res.status(statusCode).json(body);
    });
  }

  app.get('/admin/backup', ensureAuth, ensureAdmin, async (req, res) => {
    const config = backupService.getRuntimeConfig();

    try {
      const backup = await backupService.createBackup(config);
      logger.info(
        `Backup created successfully (${(backup.length / 1024 / 1024).toFixed(2)} MB)`
      );

      res.setHeader(
        'Content-Disposition',
        'attachment; filename="sushe-db.dump"'
      );
      res.setHeader('Content-Type', 'application/octet-stream');
      res.send(backup);
    } catch (error) {
      logger.error('Backup error', { error: error.message });
      if (!res.headersSent) {
        res.status(500).send('Error creating backup');
      }
    }
  });

  app.get(
    '/admin/restore/:restoreId/status',
    ensureAuth,
    ensureAdmin,
    (req, res) => {
      const operation = restoreOperationService.getOperation(
        req.params.restoreId
      );
      if (!operation) {
        const { statusCode, body } = toRestoreHttpError(
          createRestoreError(
            RESTORE_ERROR_CODES.OPERATION_NOT_FOUND,
            'Restore operation not found',
            404
          )
        );
        return res.status(statusCode).json(body);
      }

      return res.json({
        restoreId: operation.restoreId,
        status: operation.status,
        createdAt: operation.createdAt,
        updatedAt: operation.updatedAt,
        completedAt: operation.completedAt,
        errorCode: operation.errorCode,
        errorMessage: operation.errorMessage,
      });
    }
  );

  app.post(
    '/admin/restore',
    ensureAuth,
    ensureAdmin,
    rejectIfRestoreInProgress,
    restoreUploadMiddleware,
    async (req, res) => {
      const restoreStartTime = Date.now();
      const restoreId = `restore_${restoreStartTime}`;

      logger.info(`[${restoreId}] === DATABASE RESTORE STARTED ===`, {
        user: req.user.username,
        fileSize: req.file?.size,
        clientIp: req.ip,
        timestamp: new Date().toISOString(),
      });

      if (!req.file) {
        logger.error(`[${restoreId}] No file uploaded`);
        const { statusCode, body } = toRestoreHttpError(
          createRestoreError(
            RESTORE_ERROR_CODES.NO_FILE_UPLOADED,
            'No file uploaded',
            400
          )
        );
        return res.status(statusCode).json(body);
      }

      const tmpFile = req.file.path;
      const config = backupService.getRuntimeConfig();

      restoreOperationService.begin({
        restoreId,
        actor: req.user.username,
        clientIp: req.ip,
        fileSize: req.file.size,
      });

      try {
        restoreOperationService.setStatus(restoreId, 'validating');
        backupService.validateRestoreFile(tmpFile, req.file.size, config);

        res.status(202).json({
          success: true,
          restoreId,
          message: 'Restore started. This may take a while.',
        });

        const runRestoreJob = async () => {
          try {
            restoreOperationService.setStatus(restoreId, 'preflight');
            await backupService.runRestorePreflight({
              tmpFile,
              restoreId,
              config,
            });

            logger.info(`[${restoreId}] Preflight validation completed`);

            restoreOperationService.setStatus(restoreId, 'dropping');
            await backupService.dropPublicTablesForRestore(restoreId);

            restoreOperationService.setStatus(restoreId, 'restoring');
            const restoreResult = await backupService.runRestoreProcess({
              tmpFile,
              restoreId,
              config,
              onStderr: (output) => {
                logger.error(`[${restoreId}] pg_restore stderr:`, output);
              },
            });

            logger.info(`[${restoreId}] pg_restore process exited`, {
              exitCode: restoreResult.code,
              signal: restoreResult.signal,
              timedOut: restoreResult.timedOut,
              duration: `${restoreResult.durationMs}ms`,
              durationSeconds: (restoreResult.durationMs / 1000).toFixed(2),
            });

            if (restoreResult.timedOut) {
              throw createRestoreError(
                RESTORE_ERROR_CODES.TIMEOUT,
                'Database restore timed out',
                504,
                {
                  timeoutMs: config.restoreTimeoutMs,
                }
              );
            }

            if (restoreResult.code !== 0) {
              logger.error(`[${restoreId}] pg_restore failed`, {
                exitCode: restoreResult.code,
                totalDuration: `${Date.now() - restoreStartTime}ms`,
                stderrSample: restoreResult.stderrData.slice(-500),
              });
              throw createRestoreError(
                RESTORE_ERROR_CODES.PROCESS_FAILED,
                'Error restoring database',
                500,
                {
                  exitCode: restoreResult.code,
                  stderrSample: restoreResult.stderrData.slice(-500),
                }
              );
            }

            restoreOperationService.setStatus(restoreId, 'finalizing');
            await new Promise((resolve) =>
              setTimeout(resolve, RESTORE_SUCCESS_NOTICE_DELAY_MS)
            );

            restoreOperationService.setStatus(restoreId, 'logout_pending');
            await new Promise((resolve) =>
              setTimeout(resolve, LOGOUT_NOTICE_DELAY_MS)
            );

            restoreOperationService.setStatus(restoreId, 'restarting');
            await new Promise((resolve) =>
              setTimeout(resolve, RESTART_NOTICE_DELAY_MS)
            );

            try {
              await backupService.clearSessions(restoreId);
            } catch (clearError) {
              logger.error(
                `[${restoreId}] Error clearing sessions after restore`,
                {
                  error: clearError.message,
                }
              );
            }

            if (broadcast && typeof broadcast.forceLogoutAll === 'function') {
              broadcast.forceLogoutAll({
                reason: 'database_restore',
                message:
                  'Restore complete. You will be signed out while the server restarts.',
              });
            }

            backupService.scheduleRestart(restoreId);

            logger.info(`[${restoreId}] === DATABASE RESTORE COMPLETED ===`, {
              totalDuration: `${Date.now() - restoreStartTime}ms`,
            });
          } catch (error) {
            restoreOperationService.fail(
              restoreId,
              error.code || RESTORE_ERROR_CODES.INTERNAL_ERROR,
              error.message || 'Error restoring database'
            );

            logger.error(`[${restoreId}] Restore process error`, {
              error: error.message,
              code: error.code,
              totalDuration: `${Date.now() - restoreStartTime}ms`,
            });
          } finally {
            backupService.cleanupTempFile(tmpFile);
          }
        };

        void runRestoreJob();
        return;
      } catch (error) {
        restoreOperationService.fail(
          restoreId,
          error.code || RESTORE_ERROR_CODES.INTERNAL_ERROR,
          error.message || 'Error restoring database'
        );

        logger.error(`[${restoreId}] Restore process error`, {
          error: error.message,
          code: error.code,
          totalDuration: `${Date.now() - restoreStartTime}ms`,
        });

        backupService.cleanupTempFile(tmpFile);

        const { statusCode, body } = toRestoreHttpError(error);
        return res.status(statusCode).json(body);
      }
    }
  );
};
