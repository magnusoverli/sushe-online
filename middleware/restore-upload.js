const multer = require('multer');

function consumeRestoreUpload(req, res, directory, maxFileBytes) {
  const storage = multer.diskStorage({
    destination: directory,
    filename: (_req, _file, cb) => cb(null, 'backup.dump'),
  });
  const upload = multer({
    storage,
    limits: { files: 1, fields: 0, parts: 1, fileSize: maxFileBytes },
  }).single('backup');
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      reject(new Error('Upload deadline exceeded'));
      req.destroy();
    }, 600000);
    const aborted = () => {
      clearTimeout(deadline);
      reject(new Error('Upload aborted'));
    };
    req.once('aborted', aborted);
    upload(req, res, (error) => {
      clearTimeout(deadline);
      req.removeListener('aborted', aborted);
      if (error) reject(error);
      else resolve(req.file);
    });
  });
}
module.exports = { consumeRestoreUpload };
