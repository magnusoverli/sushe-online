/**
 * Admin Duplicate Scanning Routes
 *
 * Handles duplicate album detection and merging:
 * - /admin/api/scan-duplicates - Scan for potential duplicates
 * - /admin/api/merge-albums - Merge two albums
 *
 * All business logic delegated to services/duplicate-service.js
 */

const logger = require('../../utils/logger');
const { TransactionAbort } = require('../../db/transaction');

module.exports = (app, deps) => {
  const { ensureAuth, ensureAdmin, duplicateService } = deps;

  // Admin: Scan for potential duplicate albums in the database
  app.get(
    '/admin/api/scan-duplicates',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        logger.info('Starting duplicate album scan', {
          adminId: req.user?._id,
          threshold: req.query.threshold,
        });

        const result = await duplicateService.scanDuplicates(
          req.query.threshold
        );

        res.json(result);
      } catch (error) {
        if (error instanceof TransactionAbort) {
          return res.status(error.status).json(error.body);
        }
        logger.error('Error scanning for duplicates', {
          error: error.message,
        });
        res.status(500).json({ error: error.message });
      }
    }
  );

  // Admin: Merge two albums (keep one, update references, delete other)
  app.post(
    '/admin/api/merge-albums',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const { keepAlbumId, deleteAlbumId } = req.body;

        logger.info('Merging albums', {
          keepAlbumId,
          deleteAlbumId,
          adminId: req.user?._id,
        });

        const result = await duplicateService.mergeAlbums(
          keepAlbumId,
          deleteAlbumId
        );

        res.json({ success: true, ...result });
      } catch (error) {
        if (error instanceof TransactionAbort) {
          return res.status(error.status).json(error.body);
        }
        logger.error('Error merging albums', {
          error: error.message,
          keepAlbumId: req.body?.keepAlbumId,
          deleteAlbumId: req.body?.deleteAlbumId,
        });
        res.status(500).json({ error: error.message });
      }
    }
  );
};
