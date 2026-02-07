/**
 * Standardized API response helpers
 *
 * Ensures consistent response format across all endpoints.
 * Eliminates duplicated res.json() and res.status().json() patterns.
 *
 * @module utils/response-helpers
 */

/**
 * Send success response
 * @param {Object} res - Express response
 * @param {Object} data - Response data (merged with { success: true })
 */
function success(res, data = {}) {
  return res.json({ success: true, ...data });
}

/**
 * Send error response with appropriate status code
 * @param {Object} res - Express response
 * @param {string} message - Error message
 * @param {number} statusCode - HTTP status code (default 400)
 * @param {Object} extra - Additional error context
 */
function error(res, message, statusCode = 400, extra = {}) {
  return res.status(statusCode).json({ error: message, ...extra });
}

/**
 * Send 404 Not Found response
 * @param {Object} res - Express response
 * @param {string} resource - Resource name (e.g., 'List', 'Album')
 */
function notFound(res, resource = 'Resource') {
  return res.status(404).json({ error: `${resource} not found` });
}

/**
 * Send 400 Bad Request with validation errors
 * @param {Object} res - Express response
 * @param {string|Array<string>} errors - Validation error(s)
 */
function validationError(res, errors) {
  const errorArray = Array.isArray(errors) ? errors : [errors];
  return res.status(400).json({
    error: errorArray.join(', '),
    validation_errors: errorArray,
  });
}

module.exports = { success, error, notFound, validationError };
