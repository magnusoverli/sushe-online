const logger = require('../../utils/logger');
const {
  createAdminBackupService,
} = require('../../services/admin-backup-service');
const {
  createControlStore,
  publicStatus,
} = require('../../services/recovery/control-store');
const {
  createRestoreUploadService,
} = require('../../services/recovery/upload-service');
const { consumeRestoreUpload } = require('../../middleware/restore-upload');

module.exports = (app, deps) => {
  const { ensureAuth, ensureAuthAPI, ensureAdmin } = deps;
  const backup = deps.backupService || createAdminBackupService();
  const control =
    deps.recoveryControl ||
    createControlStore(process.env.CONTROL_DATABASE_URL);
  const uploads = createRestoreUploadService({
    control,
    backup,
    sharedUploads: process.env.RECOVERY_SHARED_UPLOADS === 'true',
    uploadRoot:
      deps.recoveryUploadRoot ||
      process.env.RECOVERY_UPLOAD_DIR ||
      '/recovery/uploads',
  });
  app.get('/admin/backup', ensureAuth, ensureAdmin, async (req, res) => {
    const abort = new AbortController();
    const onClose = () => abort.abort();
    res.once('close', onClose);
    let artifact;
    try {
      artifact = await backup.createBackup(
        backup.getRuntimeConfig(),
        abort.signal
      );
      await new Promise((resolve, reject) =>
        res.download(artifact.filePath, 'sushe-db.dump', (error) =>
          error ? reject(error) : resolve(undefined)
        )
      );
    } catch (_error) {
      logger.error('Database backup failed');
      if (!res.headersSent && !res.destroyed)
        res.status(500).send('Error creating backup');
    } finally {
      res.removeListener('close', onClose);
      if (artifact) await artifact.cleanup();
    }
  });

  app.get(
    '/admin/restore/:restoreId/status',
    ensureAuthAPI || ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const job = control && (await control.get(req.params.restoreId));
        if (!job) {
          return res.status(404).json({
            error: 'Restore operation not found',
            code: 'RESTORE_OPERATION_NOT_FOUND',
          });
        }
        res.json(publicStatus(job));
      } catch {
        res.status(503).json({ error: 'Recovery control unavailable' });
      }
    }
  );

  app.post(
    '/admin/restore',
    ensureAuthAPI || ensureAuth,
    ensureAdmin,
    async (req, res) => {
      if (!control)
        return res.status(503).json({
          error: 'Automatic recovery service is not configured',
          code: 'RESTORE_UNAVAILABLE',
        });
      try {
        const { job, token } = await uploads.receive(
          req.user._id,
          (directory, limit) => consumeRestoreUpload(req, res, directory, limit)
        );
        // This job-scoped status capability survives restored-session invalidation.
        res.cookie(`restore_${job.id}`, token, {
          httpOnly: true,
          sameSite: 'strict',
          secure: req.secure,
          maxAge: 3600000,
          path: `/admin/restore/${job.id}/status`,
        });
        res.status(202).json({
          success: true,
          restoreId: job.id,
          message: 'Restore started. The app will restart automatically.',
        });
      } catch (error) {
        const conflict = error.code === 'RESTORE_IN_PROGRESS';
        if (!res.headersSent && !res.destroyed)
          res.status(conflict ? 409 : 400).json({
            error: conflict
              ? 'A restore is already in progress'
              : 'Backup upload or validation failed',
            code: conflict ? 'RESTORE_IN_PROGRESS' : 'RESTORE_UPLOAD_FAILED',
          });
      }
    }
  );
};
