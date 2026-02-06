/**
 * Async Route Handler Wrapper
 *
 * Eliminates repeated try/catch boilerplate in async route handlers.
 * Handles both TransactionAbort (expected validation failures) and
 * unexpected errors with consistent logging and response formatting.
 *
 * Usage:
 *   const { createAsyncHandler } = require('../../middleware/async-handler');
 *   const asyncHandler = createAsyncHandler(logger);
 *
 *   app.get('/api/things', ensureAuthAPI, asyncHandler(async (req, res) => {
 *     // ... business logic, no try/catch needed ...
 *   }, 'fetch things'));
 *
 * @module middleware/async-handler
 */

const { TransactionAbort } = require('../db/transaction');

/**
 * Factory that creates an asyncHandler bound to a specific logger.
 *
 * @param {Object} log - Logger instance (must have .error method)
 * @returns {Function} asyncHandler function
 */
function createAsyncHandler(log) {
  /**
   * Wraps an async route handler with standardized error handling.
   *
   * @param {Function} fn - Async route handler (req, res) => Promise<void>
   * @param {string} actionName - Human-readable action name for error messages
   *   (e.g., 'fetch lists', 'create list', 'update album')
   * @param {Object} [options] - Options
   * @param {string} [options.errorMessage] - Custom error message for 500 responses.
   *   Defaults to 'Error <actionName>' for action names starting with a verb,
   *   or 'Database error' otherwise.
   * @returns {Function} Express route handler
   */
  function asyncHandler(fn, actionName, options = {}) {
    const defaultErrorMessage = actionName
      ? `Error ${actionName}`
      : 'Internal server error';
    const errorMessage = options.errorMessage || defaultErrorMessage;

    return async (req, res, next) => {
      try {
        await fn(req, res, next);
      } catch (err) {
        // TransactionAbort is an expected control-flow exit (validation error,
        // not-found, etc.) — pass its status and body directly to the client.
        if (err instanceof TransactionAbort) {
          return res.status(err.statusCode).json(err.body);
        }

        // Build structured log context
        const logContext = {
          error: err.message,
          userId: req.user?._id,
        };

        // Include stack for unexpected errors
        if (err.stack) {
          logContext.stack = err.stack;
        }

        // Include route params if present
        if (req.params?.id) {
          logContext.listId = req.params.id;
        } else if (req.params?.albumId) {
          logContext.albumId = req.params.albumId;
        } else if (req.params?.year) {
          logContext.year = req.params.year;
        }

        log.error(
          actionName ? `Error ${actionName}` : 'Unhandled route error',
          logContext
        );

        // Don't send response if headers already sent (e.g., streaming)
        if (!res.headersSent) {
          res.status(500).json({ error: errorMessage });
        }
      }
    };
  }

  return asyncHandler;
}

module.exports = { createAsyncHandler };
