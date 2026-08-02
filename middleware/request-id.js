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

// Dual export: the module itself is the factory, and the same factory is also
// reachable as a named property for `{ requestIdMiddleware }` destructuring.
// Attaching the property to the function before the export assignment keeps a
// single `module.exports = ...` statement (identical shape at runtime).
requestIdMiddleware.requestIdMiddleware = requestIdMiddleware;

module.exports = requestIdMiddleware;
