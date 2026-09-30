const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const {
  createRestoreError,
  RESTORE_ERROR_CODES,
} = require('../restore-errors');

function createRestoreUploadService({
  control,
  backup,
  uploadRoot,
  sharedUploads = false,
}) {
  async function receive(actor, consume) {
    const token = randomBytes(32).toString('base64url');
    const job = await control.begin(actor, token);
    if (!job)
      throw createRestoreError(
        RESTORE_ERROR_CODES.IN_PROGRESS,
        'A restore is already in progress',
        409
      );
    let directory;
    let queued = false;
    try {
      const config = backup.getRuntimeConfig();
      await fs.mkdir(uploadRoot, { recursive: true, mode: 0o700 });
      directory = path.join(uploadRoot, job.id);
      await fs.mkdir(directory, { mode: sharedUploads ? 0o770 : 0o700 });
      if (sharedUploads) await fs.chmod(directory, 0o770);
      const available = await fs.statfs(directory);
      if (
        available.bavail * available.bsize <
        config.restoreMaxFileBytes + 16 * 1024 * 1024
      )
        throw new Error('Insufficient recovery storage');
      const file = await consume(directory, config.restoreMaxFileBytes);
      if (!file) throw new Error('No backup uploaded');
      await fs.chmod(file.path, sharedUploads ? 0o660 : 0o600);
      const { fileSize } = backup.validateRestoreFile(file.path, null, config);
      queued = await control.uploaded(job.id, fileSize);
      if (!queued) throw new Error('Upload lease expired');
      return { job, token };
    } catch (error) {
      if (!queued) {
        await control.failUpload(job.id).catch(() => {});
        if (directory)
          await fs
            .rm(directory, { recursive: true, force: true })
            .catch(() => {});
      }
      throw error;
    }
  }
  return { receive };
}
module.exports = { createRestoreUploadService };
