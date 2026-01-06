const client = require('prom-client');

// Create a Registry to register metrics
const register = new client.Registry();

// Add default metrics (CPU, memory, event loop, etc.)
client.collectDefaultMetrics({
  register,
  prefix: 'sushe_',
});

// ============================================
// Application Info Metrics
// ============================================

// Read package.json for version info
let appVersion = '0.0.0';
try {
  const pkg = require('../package.json');
  appVersion = pkg.version || '0.0.0';
} catch {
  // Ignore if package.json can't be read
}

/**
 * Application info gauge (set to 1, labels contain metadata)
 */
const appInfo = new client.Gauge({
  name: 'sushe_app_info',
  help: 'Application version and environment info',
  labelNames: ['version', 'node_version', 'environment'],
  registers: [register],
});

// Set app info once at module load
appInfo
  .labels(appVersion, process.version, process.env.NODE_ENV || 'development')
  .set(1);

/**
 * Application uptime in seconds
 */
const appUptime = new client.Gauge({
  name: 'sushe_app_uptime_seconds',
  help: 'Application uptime in seconds',
  registers: [register],
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

/**
 * HTTP response size histogram
 * Tracks the size of HTTP responses in bytes
 */
const httpResponseSize = new client.Histogram({
  name: 'sushe_http_response_size_bytes',
  help: 'Size of HTTP responses in bytes',
  labelNames: ['method', 'route'],
  buckets: [100, 1000, 10000, 100000, 1000000, 10000000], // 100B to 10MB
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

/**
 * Database connection pool size gauge
 */
const dbPoolSize = new client.Gauge({
  name: 'sushe_db_pool_size',
  help: 'Number of connections in the database pool',
  labelNames: ['state'], // 'total', 'idle', 'waiting'
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
// Claude API Metrics
// ============================================

/**
 * Claude API token usage counter
 * Tracks input and output tokens consumed by Claude API
 */
const claudeTokensTotal = new client.Counter({
  name: 'sushe_claude_tokens_total',
  help: 'Total Claude API tokens used',
  labelNames: ['type', 'model'], // type: 'input' or 'output', model: 'claude-haiku-4-5', etc.
  registers: [register],
});

/**
 * Claude API estimated cost counter
 * Tracks estimated cost in USD for Claude API usage
 */
const claudeEstimatedCostTotal = new client.Counter({
  name: 'sushe_claude_estimated_cost_dollars',
  help: 'Estimated Claude API cost in USD',
  labelNames: ['model'],
  registers: [register],
});

/**
 * Claude API requests counter
 * Tracks number of requests to Claude API
 */
const claudeRequestsTotal = new client.Counter({
  name: 'sushe_claude_requests_total',
  help: 'Total number of Claude API requests',
  labelNames: ['model', 'status'], // status: 'success', 'error', 'rate_limited'
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

      // Record response size if available
      const contentLength = res.get('Content-Length');
      if (contentLength) {
        httpResponseSize
          .labels(method, route)
          .observe(parseInt(contentLength, 10));
      }
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
 * Update database pool metrics
 * @param {Object} poolStats - Pool statistics
 * @param {number} poolStats.total - Total connections
 * @param {number} poolStats.idle - Idle connections
 * @param {number} poolStats.waiting - Waiting clients
 */
function updateDbPoolMetrics(poolStats) {
  if (poolStats) {
    dbPoolSize.labels('total').set(poolStats.total || 0);
    dbPoolSize.labels('idle').set(poolStats.idle || 0);
    dbPoolSize.labels('waiting').set(poolStats.waiting || 0);
  }
}

/**
 * Update application uptime metric
 */
function updateUptime() {
  appUptime.set(process.uptime());
}

/**
 * Record Claude API token usage and estimate cost
 * @param {string} model - The Claude model used (e.g., 'claude-haiku-4-5')
 * @param {number} inputTokens - Number of input tokens used
 * @param {number} outputTokens - Number of output tokens used
 * @param {string} status - Request status ('success', 'error', 'rate_limited')
 */
function recordClaudeUsage(
  model,
  inputTokens,
  outputTokens,
  status = 'success'
) {
  // Record token usage
  claudeTokensTotal.labels('input', model).inc(inputTokens);
  claudeTokensTotal.labels('output', model).inc(outputTokens);

  // Record request count
  claudeRequestsTotal.labels(model, status).inc();

  // Calculate and record estimated cost based on model pricing
  // Prices per million tokens (as of January 2025)
  const costs = {
    'claude-sonnet-4-5': { input: 3.0 / 1_000_000, output: 15.0 / 1_000_000 },
    'claude-sonnet-4': { input: 3.0 / 1_000_000, output: 15.0 / 1_000_000 },
    'claude-haiku-4-5': { input: 0.25 / 1_000_000, output: 1.25 / 1_000_000 },
    'claude-haiku-4': { input: 0.25 / 1_000_000, output: 1.25 / 1_000_000 },
    'claude-opus-4': { input: 15.0 / 1_000_000, output: 75.0 / 1_000_000 },
  };

  // Default to Haiku pricing if model not recognized
  const modelCosts = costs[model] || costs['claude-haiku-4-5'];
  const cost =
    inputTokens * modelCosts.input + outputTokens * modelCosts.output;

  claudeEstimatedCostTotal.labels(model).inc(cost);
}

/**
 * Get metrics in Prometheus format
 * @returns {Promise<string>} Metrics in Prometheus text format
 */
async function getMetrics() {
  // Update uptime before returning metrics
  updateUptime();
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
  httpResponseSize,
  websocketConnectionsActive,
  externalApiDuration,
  externalApiErrorsTotal,
  dbQueryDuration,
  dbPoolSize,
  userSessionsActive,
  authAttemptsTotal,
  claudeTokensTotal,
  claudeEstimatedCostTotal,
  claudeRequestsTotal,
  appInfo,
  appUptime,

  // Middleware
  metricsMiddleware,

  // Helper functions
  normalizeRoute,
  observeExternalApiCall,
  recordExternalApiError,
  observeDbQuery,
  recordAuthAttempt,
  recordClaudeUsage,
  setWebsocketConnections,
  incWebsocketConnections,
  decWebsocketConnections,
  setActiveSessions,
  updateDbPoolMetrics,
  updateUptime,
  getMetrics,
  getContentType,
};
