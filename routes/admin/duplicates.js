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

  function handleError(res, error, logContext, fallbackMessage) {
    if (error instanceof TransactionAbort) {
      return res.status(error.statusCode).json(error.body);
    }

    logger.error(fallbackMessage, {
      ...logContext,
      error: error.message,
    });
    return res.status(500).json({ error: error.message });
  }

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
          page: req.query.page,
          pageSize: req.query.pageSize,
        });

        const result = await duplicateService.scanDuplicates(
          req.query.threshold,
          {
            page: req.query.page,
            pageSize: req.query.pageSize,
          }
        );

        res.json(result);
      } catch (error) {
        return handleError(
          res,
          error,
          {
            adminId: req.user?._id,
            threshold: req.query.threshold,
          },
          'Error scanning for duplicates'
        );
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
        return handleError(
          res,
          error,
          {
            keepAlbumId: req.body?.keepAlbumId,
            deleteAlbumId: req.body?.deleteAlbumId,
            adminId: req.user?._id,
          },
          'Error merging albums'
        );
      }
    }
  );

  app.post(
    '/admin/api/merge-cluster/dry-run',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const { canonicalAlbumId, retireAlbumIds } = req.body || {};

        const result = await duplicateService.previewMergeCluster(
          canonicalAlbumId,
          retireAlbumIds
        );

        res.json(result);
      } catch (error) {
        return handleError(
          res,
          error,
          {
            canonicalAlbumId: req.body?.canonicalAlbumId,
            retireAlbumIdsCount: Array.isArray(req.body?.retireAlbumIds)
              ? req.body.retireAlbumIds.length
              : null,
            adminId: req.user?._id,
          },
          'Error running cluster merge dry-run'
        );
      }
    }
  );

  app.post(
    '/admin/api/merge-cluster',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const { canonicalAlbumId, retireAlbumIds } = req.body || {};

        logger.info('Merging duplicate cluster', {
          canonicalAlbumId,
          retireAlbumIdsCount: Array.isArray(retireAlbumIds)
            ? retireAlbumIds.length
            : 0,
          adminId: req.user?._id,
        });

        const result = await duplicateService.mergeCluster(
          canonicalAlbumId,
          retireAlbumIds
        );

        res.json({ success: true, ...result });
      } catch (error) {
        return handleError(
          res,
          error,
          {
            canonicalAlbumId: req.body?.canonicalAlbumId,
            retireAlbumIdsCount: Array.isArray(req.body?.retireAlbumIds)
              ? req.body.retireAlbumIds.length
              : null,
            adminId: req.user?._id,
          },
          'Error merging duplicate cluster'
        );
      }
    }
  );
};
