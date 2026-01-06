const crypto = require('crypto');

/**
 * Request ID middleware
 * Generates a unique request ID for each request and adds it to req.id
 * Also sets the X-Request-Id response header for client correlation
 *
 * Supports distributed tracing by accepting X-Request-Id from incoming headers
 */
function requestIdMiddleware() {
  return (req, res, next) => {
    // Use existing request ID from header (for distributed tracing) or generate new one
    const requestId = req.headers['x-request-id'] || crypto.randomUUID();

    // Attach to request object
    req.id = requestId;

    // Set response header for client correlation
    res.setHeader('X-Request-Id', requestId);

    next();
  };
}

module.exports = requestIdMiddleware;
module.exports.requestIdMiddleware = requestIdMiddleware;
