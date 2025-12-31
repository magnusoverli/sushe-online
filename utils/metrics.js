const client = require('prom-client');

// Create a Registry to register metrics
const register = new client.Registry();

// Add default metrics (CPU, memory, event loop, etc.)
client.collectDefaultMetrics({
  register,
  prefix: 'sushe_',
});

// ============================================
// HTTP Metrics
// ============================================

/**
 * HTTP request duration histogram
 * Tracks the duration of HTTP requests in seconds
 */
const httpRequestDuration = new client.Histogram({
  name: 'sushe_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

/**
 * HTTP requests counter
 * Counts total number of HTTP requests
 */
const httpRequestsTotal = new client.Counter({
  name: 'sushe_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

// ============================================
// WebSocket Metrics
// ============================================

/**
 * Active WebSocket connections gauge
 */
const websocketConnectionsActive = new client.Gauge({
  name: 'sushe_websocket_connections_active',
  help: 'Number of active WebSocket connections',
  registers: [register],
});

// ============================================
// External API Metrics
// ============================================

/**
 * External API call duration histogram
 * Tracks the duration of calls to external APIs (Spotify, Last.fm, etc.)
 */
const externalApiDuration = new client.Histogram({
  name: 'sushe_external_api_duration_seconds',
  help: 'Duration of external API calls in seconds',
  labelNames: ['service', 'endpoint', 'status_code'],
  buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
  registers: [register],
});

/**
 * External API errors counter
 */
const externalApiErrorsTotal = new client.Counter({
  name: 'sushe_external_api_errors_total',
  help: 'Total number of external API errors',
  labelNames: ['service', 'error_type'],
  registers: [register],
});

// ============================================
// Database Metrics
// ============================================

/**
 * Database query duration histogram
 */
const dbQueryDuration = new client.Histogram({
  name: 'sushe_db_query_duration_seconds',
  help: 'Duration of database queries in seconds',
  labelNames: ['operation'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [register],
});

// ============================================
// Session/User Metrics
// ============================================

/**
 * Active user sessions gauge
 */
const userSessionsActive = new client.Gauge({
  name: 'sushe_user_sessions_active',
  help: 'Number of active user sessions',
  registers: [register],
});

/**
 * Authentication attempts counter
 */
const authAttemptsTotal = new client.Counter({
  name: 'sushe_auth_attempts_total',
  help: 'Total number of authentication attempts',
  labelNames: ['type', 'result'],
  registers: [register],
});

// ============================================
// Helper Functions
// ============================================

/**
 * Normalize route for metrics (replace dynamic segments with placeholders)
 * @param {string} route - The route path
 * @returns {string} Normalized route
 */
function normalizeRoute(route) {
  if (!route) return 'unknown';

  // Replace common dynamic segments
  return route
    .replace(/\/[0-9a-f]{24}\b/gi, '/:id') // MongoDB ObjectIds
    .replace(
      /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      '/:uuid'
    ) // UUIDs
    .replace(/\/\d+\b/g, '/:num') // Numeric IDs
    .replace(/\?.*$/, ''); // Remove query strings
}

/**
 * Create metrics middleware for Express
 * @returns {Function} Express middleware
 */
function metricsMiddleware() {
  return (req, res, next) => {
    const start = process.hrtime.bigint();

    res.on('finish', () => {
      const duration = Number(process.hrtime.bigint() - start) / 1e9; // Convert to seconds
      const route = normalizeRoute(req.route?.path || req.path);
      const method = req.method;
      const statusCode = res.statusCode.toString();

      // Record metrics
      httpRequestDuration.labels(method, route, statusCode).observe(duration);
      httpRequestsTotal.labels(method, route, statusCode).inc();
    });

    next();
  };
}

/**
 * Observe external API call timing
 * @param {string} service - The external service name (e.g., 'spotify', 'lastfm')
 * @param {string} endpoint - The API endpoint
 * @param {number} durationMs - Duration in milliseconds
 * @param {number} statusCode - HTTP status code
 */
function observeExternalApiCall(service, endpoint, durationMs, statusCode) {
  const durationSeconds = durationMs / 1000;
  externalApiDuration
    .labels(service, endpoint, statusCode.toString())
    .observe(durationSeconds);
}

/**
 * Record external API error
 * @param {string} service - The external service name
 * @param {string} errorType - The type of error
 */
function recordExternalApiError(service, errorType) {
  externalApiErrorsTotal.labels(service, errorType).inc();
}

/**
 * Observe database query timing
 * @param {string} operation - The operation type (e.g., 'select', 'insert', 'update')
 * @param {number} durationMs - Duration in milliseconds
 */
function observeDbQuery(operation, durationMs) {
  const durationSeconds = durationMs / 1000;
  dbQueryDuration.labels(operation).observe(durationSeconds);
}

/**
 * Record authentication attempt
 * @param {string} type - The auth type (e.g., 'login', 'register', 'logout')
 * @param {string} result - The result (e.g., 'success', 'failure')
 */
function recordAuthAttempt(type, result) {
  authAttemptsTotal.labels(type, result).inc();
}

/**
 * Update WebSocket connection count
 * @param {number} count - The current connection count
 */
function setWebsocketConnections(count) {
  websocketConnectionsActive.set(count);
}

/**
 * Increment WebSocket connection count
 */
function incWebsocketConnections() {
  websocketConnectionsActive.inc();
}

/**
 * Decrement WebSocket connection count
 */
function decWebsocketConnections() {
  websocketConnectionsActive.dec();
}

/**
 * Update active session count
 * @param {number} count - The current session count
 */
function setActiveSessions(count) {
  userSessionsActive.set(count);
}

/**
 * Get metrics in Prometheus format
 * @returns {Promise<string>} Metrics in Prometheus text format
 */
async function getMetrics() {
  return register.metrics();
}

/**
 * Get the content type for metrics endpoint
 * @returns {string} Content type header value
 */
function getContentType() {
  return register.contentType;
}

module.exports = {
  // Registry
  register,

  // Metrics
  httpRequestDuration,
  httpRequestsTotal,
  websocketConnectionsActive,
  externalApiDuration,
  externalApiErrorsTotal,
  dbQueryDuration,
  userSessionsActive,
  authAttemptsTotal,

  // Middleware
  metricsMiddleware,

  // Helper functions
  normalizeRoute,
  observeExternalApiCall,
  recordExternalApiError,
  observeDbQuery,
  recordAuthAttempt,
  setWebsocketConnections,
  incWebsocketConnections,
  decWebsocketConnections,
  setActiveSessions,
  getMetrics,
  getContentType,
};
