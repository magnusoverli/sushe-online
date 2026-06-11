const client = require('prom-client');

// Create a Registry to register metrics
const register = new client.Registry();

// Add default metrics (CPU, memory, event loop, etc.)
// eventLoopMonitoringPrecision: 500ms (default 10ms) to reduce idle CPU wake-ups
client.collectDefaultMetrics({
  register,
  prefix: 'sushe_',
  eventLoopMonitoringPrecision: 500,
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

const dbErrorsTotal = new client.Counter({
  name: 'sushe_db_errors_total',
  help: 'Total number of database errors by classification and operation',
  labelNames: ['operation', 'kind', 'code'],
  registers: [register],
});

const dbRetriesTotal = new client.Counter({
  name: 'sushe_db_retries_total',
  help: 'Total number of retried database operations',
  labelNames: ['label'],
  registers: [register],
});

const dbRetriesExhaustedTotal = new client.Counter({
  name: 'sushe_db_retries_exhausted_total',
  help: 'Total number of database operations that exhausted retries',
  labelNames: ['label', 'code'],
  registers: [register],
});

const dbTransactionDuration = new client.Histogram({
  name: 'sushe_db_transaction_duration_seconds',
  help: 'Duration of database transactions in seconds',
  labelNames: ['outcome'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10],
  registers: [register],
});

const dbSlowQueriesTotal = new client.Counter({
  name: 'sushe_db_slow_queries_total',
  help: 'Total number of database queries exceeding the slow-query threshold',
  labelNames: ['operation'],
  registers: [register],
});

/**
 * Database connection pool reference for pull-based metrics collection.
 * Set via setPoolReference() after pool initialization.
 */
let _pool = null;

/**
 * Database connection pool size gauge
 * Uses a collect callback to read pool stats on-demand when /metrics is scraped,
 * instead of pushing values on a 15-second setInterval.
 */
const dbPoolSize = new client.Gauge({
  name: 'sushe_db_pool_size',
  help: 'Number of connections in the database pool',
  labelNames: ['state'], // 'total', 'idle', 'waiting'
  registers: [register],
  collect() {
    if (_pool) {
      this.labels('total').set(_pool.totalCount || 0);
      this.labels('idle').set(_pool.idleCount || 0);
      this.labels('waiting').set(_pool.waitingCount || 0);
    }
  },
});

// ============================================
// Session/User Metrics
// ============================================

/**
 * Active user sessions gauge - pull-based via collect callback querying the DB
 */
const userSessionsActive = new client.Gauge({
  name: 'sushe_user_sessions_active',
  help: 'Number of active user sessions',
  registers: [register],
  async collect() {
    if (_pool) {
      try {
        const result = await _pool.query('SELECT COUNT(*) AS cnt FROM session');
        this.set(parseInt(result.rows[0].cnt, 10) || 0);
      } catch {
        // Table may not exist or pool not ready - silently skip
      }
    }
  },
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
// Background Queue Metrics
// ============================================

/**
 * Cover/track fetch queue: items added
 */
const queueItemsTotal = new client.Counter({
  name: 'sushe_queue_items_total',
  help: 'Total items added to background fetch queues',
  labelNames: ['queue'], // 'cover', 'track'
  registers: [register],
});

/**
 * Cover/track fetch queue: items completed successfully
 */
const queueItemsProcessedTotal = new client.Counter({
  name: 'sushe_queue_items_processed_total',
  help: 'Total items successfully processed by background fetch queues',
  labelNames: ['queue'],
  registers: [register],
});

/**
 * Cover/track fetch queue: items failed
 */
const queueItemsFailedTotal = new client.Counter({
  name: 'sushe_queue_items_failed_total',
  help: 'Total items that failed in background fetch queues',
  labelNames: ['queue'],
  registers: [register],
});

// ============================================
// Response Cache Metrics
// ============================================

/**
 * Response cache hits
 */
const cacheHitsTotal = new client.Counter({
  name: 'sushe_cache_hits_total',
  help: 'Total response cache hits',
  registers: [register],
});

/**
 * Response cache misses
 */
const cacheMissesTotal = new client.Counter({
  name: 'sushe_cache_misses_total',
  help: 'Total response cache misses',
  registers: [register],
});

const responseCacheBytes = new client.Gauge({
  name: 'sushe_response_cache_bytes',
  help: 'Total bytes held in the in-process response cache',
  registers: [register],
});

const responseCacheItems = new client.Gauge({
  name: 'sushe_response_cache_items',
  help: 'Total items held in the in-process response cache',
  registers: [register],
});

const responseCacheEvictionsTotal = new client.Counter({
  name: 'sushe_response_cache_evictions_total',
  help: 'Total response cache entries evicted for capacity or expiry',
  registers: [register],
});

const coverCacheHitsTotal = new client.Counter({
  name: 'sushe_cover_cache_hits_total',
  help: 'Total album cover cache hits',
  registers: [register],
});

const coverCacheMissesTotal = new client.Counter({
  name: 'sushe_cover_cache_misses_total',
  help: 'Total album cover cache misses',
  registers: [register],
});

const coverCacheBytes = new client.Gauge({
  name: 'sushe_cover_cache_bytes',
  help: 'Total bytes held in the in-process album cover cache',
  registers: [register],
});

const coverCacheItems = new client.Gauge({
  name: 'sushe_cover_cache_items',
  help: 'Total items held in the in-process album cover cache',
  registers: [register],
});

const coverCacheEvictionsTotal = new client.Counter({
  name: 'sushe_cover_cache_evictions_total',
  help: 'Total album cover cache entries evicted for capacity or expiry',
  registers: [register],
});

const startupPrewarmDuration = new client.Histogram({
  name: 'sushe_startup_prewarm_duration_seconds',
  help: 'Duration of startup prewarm phases in seconds',
  labelNames: ['phase', 'result'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 15, 30, 60, 120],
  registers: [register],
});

// ============================================
// Rate Limit Metrics
// ============================================

/**
 * Rate limit hits counter
 */
const rateLimitHitsTotal = new client.Counter({
  name: 'sushe_rate_limit_hits_total',
  help: 'Total number of requests blocked by rate limiting',
  labelNames: ['endpoint'],
  registers: [register],
});

// ============================================
// WebSocket Event Metrics
// ============================================

/**
 * WebSocket events emitted counter
 */
const websocketEventsTotal = new client.Counter({
  name: 'sushe_websocket_events_total',
  help: 'Total WebSocket events broadcast to clients',
  labelNames: ['event'],
  registers: [register],
});

// ============================================
// Playcount Sync Metrics
// ============================================

/**
 * Playcount sync runs counter
 */
const playcountSyncRunsTotal = new client.Counter({
  name: 'sushe_playcount_sync_runs_total',
  help: 'Total playcount sync job runs',
  labelNames: ['result'], // 'success', 'error'
  registers: [register],
});

/**
 * Albums synced per playcount run
 */
const playcountSyncAlbumsTotal = new client.Counter({
  name: 'sushe_playcount_sync_albums_total',
  help: 'Total albums synced by the playcount sync job',
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
      // Only label by a matched route pattern; collapse unmatched paths
      // (scanners, typos, 404s) to a single label so prom-client time-series
      // cardinality cannot grow unbounded from arbitrary request paths.
      const route = req.route?.path
        ? normalizeRoute(req.route.path)
        : 'unmatched';
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

function recordDbError(operation, kind, code = 'unknown') {
  dbErrorsTotal.labels(operation, kind || 'unknown', code || 'unknown').inc();
}

function recordDbRetry(label) {
  dbRetriesTotal.labels(label || 'unknown').inc();
}

function recordDbRetryExhausted(label, code = 'unknown') {
  dbRetriesExhaustedTotal.labels(label || 'unknown', code || 'unknown').inc();
}

function observeDbTransaction(durationMs, outcome) {
  dbTransactionDuration.labels(outcome || 'unknown').observe(durationMs / 1000);
}

function recordDbSlowQuery(operation) {
  dbSlowQueriesTotal.labels(operation || 'other').inc();
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
 * Increment background queue items added
 * @param {'cover'|'track'} queue
 */
function incQueueItems(queue) {
  queueItemsTotal.labels(queue).inc();
}

/**
 * Increment background queue items processed
 * @param {'cover'|'track'} queue
 */
function incQueueItemsProcessed(queue) {
  queueItemsProcessedTotal.labels(queue).inc();
}

/**
 * Increment background queue items failed
 * @param {'cover'|'track'} queue
 */
function incQueueItemsFailed(queue) {
  queueItemsFailedTotal.labels(queue).inc();
}

/**
 * Increment cache hit counter
 */
function incCacheHit() {
  cacheHitsTotal.inc();
}

/**
 * Increment cache miss counter
 */
function incCacheMiss() {
  cacheMissesTotal.inc();
}

function updateResponseCacheMetrics(bytes, items) {
  responseCacheBytes.set(bytes || 0);
  responseCacheItems.set(items || 0);
}

function incResponseCacheEvictions(count = 1) {
  if (count > 0) responseCacheEvictionsTotal.inc(count);
}

function incCoverCacheHit() {
  coverCacheHitsTotal.inc();
}

function incCoverCacheMiss() {
  coverCacheMissesTotal.inc();
}

function updateCoverCacheMetrics(bytes, items) {
  coverCacheBytes.set(bytes || 0);
  coverCacheItems.set(items || 0);
}

function incCoverCacheEvictions(count = 1) {
  if (count > 0) coverCacheEvictionsTotal.inc(count);
}

function observeStartupPrewarm(phase, durationMs, result = 'success') {
  startupPrewarmDuration
    .labels(phase || 'unknown', result || 'unknown')
    .observe(durationMs / 1000);
}

/**
 * Increment rate limit hit counter
 * @param {string} endpoint
 */
function incRateLimitHit(endpoint) {
  rateLimitHitsTotal.labels(endpoint || 'unknown').inc();
}

/**
 * Increment WebSocket event counter
 * @param {string} event
 */
function incWebsocketEvent(event) {
  websocketEventsTotal.labels(event).inc();
}

/**
 * Record a playcount sync run result
 * @param {'success'|'error'} result
 * @param {number} albumsProcessed
 */
function recordPlaycountSync(result, albumsProcessed = 0) {
  playcountSyncRunsTotal.labels(result).inc();
  if (albumsProcessed > 0) {
    playcountSyncAlbumsTotal.inc(albumsProcessed);
  }
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
 * Store a reference to the database pool for pull-based metrics collection.
 * Call this once after pool initialization instead of using a setInterval.
 * @param {Object} pool - pg Pool instance
 */
function setPoolReference(pool) {
  _pool = pool;
}

/**
 * Update database pool metrics (no-op, kept for backward compatibility).
 * Pool metrics are now collected on-demand via the dbPoolSize gauge's collect callback.
 */
function updateDbPoolMetrics() {
  // No-op: pool metrics are now collected pull-based via setPoolReference + collect callback
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
  queueItemsTotal,
  queueItemsProcessedTotal,
  queueItemsFailedTotal,
  cacheHitsTotal,
  cacheMissesTotal,
  responseCacheBytes,
  responseCacheItems,
  responseCacheEvictionsTotal,
  coverCacheHitsTotal,
  coverCacheMissesTotal,
  coverCacheBytes,
  coverCacheItems,
  coverCacheEvictionsTotal,
  startupPrewarmDuration,
  rateLimitHitsTotal,
  websocketEventsTotal,
  playcountSyncRunsTotal,
  playcountSyncAlbumsTotal,

  // Middleware
  metricsMiddleware,

  // Helper functions
  normalizeRoute,
  observeExternalApiCall,
  recordExternalApiError,
  observeDbQuery,
  recordDbError,
  recordDbRetry,
  recordDbRetryExhausted,
  observeDbTransaction,
  recordDbSlowQuery,
  recordAuthAttempt,
  recordClaudeUsage,
  incWebsocketConnections,
  decWebsocketConnections,
  incQueueItems,
  incQueueItemsProcessed,
  incQueueItemsFailed,
  incCacheHit,
  incCacheMiss,
  updateResponseCacheMetrics,
  incResponseCacheEvictions,
  incCoverCacheHit,
  incCoverCacheMiss,
  updateCoverCacheMetrics,
  incCoverCacheEvictions,
  observeStartupPrewarm,
  incRateLimitHit,
  incWebsocketEvent,
  recordPlaycountSync,
  setPoolReference,
  updateDbPoolMetrics,
  updateUptime,
  getMetrics,
  getContentType,
};
