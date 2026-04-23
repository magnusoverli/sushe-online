/**
 * Admin Database Backup/Restore Routes
 */

const logger = require('../../utils/logger');
const {
  createAdminBackupService,
} = require('../../services/admin-backup-service');

module.exports = (app, deps) => {
  const { ensureAuth, ensureAdmin, upload, db } = deps;
  const backupService = createAdminBackupService({ db, logger });

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

  app.post(
    '/admin/restore',
    ensureAuth,
    ensureAdmin,
    upload.single('backup'),
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
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const tmpFile = req.file.path;

      try {
        const validDump = backupService.validateDumpFile(tmpFile);
        if (!validDump) {
          return res.status(400).json({
            error: 'Invalid backup file. Must be a PostgreSQL dump file.',
          });
        }

        const config = backupService.getRuntimeConfig();

        await backupService.dropPublicTablesForRestore(restoreId);

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
          duration: `${restoreResult.durationMs}ms`,
          durationSeconds: (restoreResult.durationMs / 1000).toFixed(2),
        });

        if (restoreResult.code !== 0) {
          logger.error(`[${restoreId}] pg_restore failed`, {
            exitCode: restoreResult.code,
            totalDuration: `${Date.now() - restoreStartTime}ms`,
            stderrSample: restoreResult.stderrData.slice(-500),
          });
          return res.status(500).json({ error: 'Error restoring database' });
        }

        try {
          await backupService.clearSessions(restoreId);
        } catch (clearError) {
          logger.error(`[${restoreId}] Error clearing sessions after restore`, {
            error: clearError.message,
          });
        }

        res.json({
          success: true,
          message:
            'Database restored successfully. Server will restart in 3 seconds...',
        });

        backupService.scheduleRestart(restoreId);

        logger.info(`[${restoreId}] === DATABASE RESTORE COMPLETED ===`, {
          totalDuration: `${Date.now() - restoreStartTime}ms`,
        });
      } catch (error) {
        logger.error(`[${restoreId}] Restore process error`, {
          error: error.message,
          totalDuration: `${Date.now() - restoreStartTime}ms`,
        });

        if (!res.headersSent) {
          res.status(500).json({ error: 'Error restoring database' });
        }
      } finally {
        backupService.cleanupTempFile(tmpFile);
      }
    }
  );
};
