// utils/claude-client.js
// Shared Anthropic SDK client with rate limiting, retry logic, and metrics

const Anthropic = require('@anthropic-ai/sdk');
const logger = require('./logger');
const {
  observeExternalApiCall,
  recordExternalApiError,
  recordClaudeUsage,
} = require('./metrics');

// Default rate limit: 2 requests per second (500ms = 120 RPM, safe for all tiers)
const DEFAULT_RATE_LIMIT_MS = 500;

/**
 * Extract text content from Claude's response content blocks
 * Filters for type === 'text' blocks and joins them
 * @param {Array} contentBlocks - Claude response content array
 * @returns {string|null} Joined text content or null if no text blocks
 */
function extractTextFromContent(contentBlocks) {
  if (!contentBlocks || !Array.isArray(contentBlocks)) {
    return null;
  }

  const textBlocks = contentBlocks.filter((block) => block.type === 'text');
  if (textBlocks.length === 0) {
    return null;
  }

  return textBlocks
    .map((block) => block.text)
    .join(' ')
    .trim();
}

/**
 * Create a shared Claude client with rate limiting, retry, and metrics
 * @param {Object} deps - Dependencies
 * @param {Object} deps.logger - Logger instance
 * @param {Object} deps.anthropicClient - Pre-initialized Anthropic client (for testing)
 * @param {Object} deps.env - Environment variables object (defaults to process.env)
 * @param {Object} deps.metrics - Metrics functions (for testing)
 */
function createClaudeClient(deps = {}) {
  const log = deps.logger || logger;
  const env = deps.env || process.env;
  const metrics = deps.metrics || {
    observeExternalApiCall,
    recordExternalApiError,
    recordClaudeUsage,
  };

  const rateLimitMs = parseInt(
    env.CLAUDE_RATE_LIMIT_MS || String(DEFAULT_RATE_LIMIT_MS),
    10
  );
  let lastRequestTime = 0;

  // Lazy-initialized client - created on first use, not at module load time
  // This ensures environment variables are available in Docker containers
  let anthropicClient = deps.anthropicClient || null;

  /**
   * Get or create the Anthropic SDK client (lazy singleton)
   * @returns {Object|null} Anthropic client or null if no API key
   */
  function getClient() {
    if (anthropicClient) return anthropicClient;

    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return null;
    }

    anthropicClient = new Anthropic({ apiKey });
    return anthropicClient;
  }

  /**
   * Wait for rate limit before making a request
   * Enforces a minimum delay between consecutive API calls
   */
  async function waitForRateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    if (timeSinceLastRequest < rateLimitMs) {
      await new Promise((r) =>
        setTimeout(r, rateLimitMs - timeSinceLastRequest)
      );
    }
    lastRequestTime = Date.now();
  }

  /**
   * Retry an async function with exponential backoff
   * Respects Retry-After headers for 429 responses
   * @param {Function} fn - Async function to retry
   * @param {number} maxRetries - Maximum number of attempts (default 3)
   * @param {Object} retryLog - Logger to use for retry messages (defaults to log)
   * @returns {Promise<*>} Result of the function call
   */
  async function retryWithBackoff(fn, maxRetries = 3, retryLog) {
    const retryLogger = retryLog || log;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;

        // Don't retry client errors (except 429)
        if (
          err.status &&
          err.status >= 400 &&
          err.status < 500 &&
          err.status !== 429
        ) {
          throw err;
        }

        // Last attempt - give up
        if (attempt === maxRetries) {
          break;
        }

        // Calculate backoff
        let backoffMs;
        if (err.status === 429 && err.headers?.['retry-after']) {
          // Respect Retry-After header (seconds)
          backoffMs = parseInt(err.headers['retry-after'], 10) * 1000;
        } else if (err.status === 429) {
          // Rate limit without Retry-After: use longer backoff (15s, 30s, 60s)
          // Per-minute token limits need longer waits
          backoffMs = Math.pow(2, attempt - 1) * 15000;
        } else {
          // Server errors: standard exponential backoff (1s, 2s, 4s)
          backoffMs = Math.pow(2, attempt - 1) * 1000;
        }

        retryLogger.info('Retrying Claude API call', {
          attempt,
          maxRetries,
          backoffMs,
          status: err.status,
          isRateLimit: err.status === 429,
        });

        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }

    throw lastError;
  }

  /**
   * Handle Claude API errors with appropriate logging and metrics
   * @param {Error} err - The error object
   * @param {number} duration - Duration of the failed call in ms
   * @param {Object} errorLog - Logger to use (defaults to log)
   * @param {string} model - The Claude model used
   * @param {Object} context - Additional context for logging (e.g., { artist, album })
   */
  function handleApiError(
    err,
    duration,
    errorLog,
    model = 'claude-sonnet-4-5',
    context = {}
  ) {
    const errorLogger = errorLog || log;
    metrics.recordExternalApiError('claude', 'api_error');

    // Record request failure metrics
    const status = err.status === 429 ? 'rate_limited' : 'error';
    metrics.recordClaudeUsage(model, 0, 0, status);

    if (err.status === 429) {
      errorLogger.warn('Claude API rate limit exceeded', {
        ...context,
        error: err.message,
        status: err.status,
        retryAfter: err.headers?.['retry-after'] || err.retryAfter,
      });
      metrics.observeExternalApiCall(
        'claude',
        'messages.create',
        duration,
        429
      );
    } else if (err.status >= 500) {
      errorLogger.error('Claude API server error', {
        ...context,
        status: err.status,
        error: err.message,
        stack: err.stack,
        type: err.type,
      });
      metrics.observeExternalApiCall(
        'claude',
        'messages.create',
        duration,
        err.status || 500
      );
    } else if (err.status === 401 || err.status === 403) {
      errorLogger.error('Claude API authentication error', {
        ...context,
        status: err.status,
        error: err.message,
        type: err.type,
      });
      metrics.observeExternalApiCall(
        'claude',
        'messages.create',
        duration,
        err.status || 401
      );
    } else {
      errorLogger.error('Claude API error', {
        ...context,
        status: err.status,
        error: err.message,
        stack: err.stack,
        type: err.type,
        cause: err.cause?.message,
      });
      metrics.observeExternalApiCall(
        'claude',
        'messages.create',
        duration,
        err.status || 400
      );
    }
  }

  /**
   * Make a Claude API call with rate limiting, retry, and metrics
   * Composes waitForRateLimit + messages.create + retryWithBackoff + metrics recording
   * @param {Object} options - Call options
   * @param {string} options.model - Claude model to use
   * @param {number} options.maxTokens - Maximum tokens in response
   * @param {number} options.temperature - Temperature for response generation
   * @param {string} options.system - System prompt
   * @param {Array} options.tools - Tools array (e.g., web search)
   * @param {Array} options.messages - Messages array
   * @param {string} options.metricsLabel - Label for metrics tracking (default: 'messages.create')
   * @param {number} options.maxRetries - Maximum retry attempts (default: 3)
   * @returns {Promise<Object|null>} Claude API response or null if client unavailable
   */
  async function callClaude({
    model,
    maxTokens,
    temperature,
    system,
    tools,
    messages,
    metricsLabel = 'messages.create',
    maxRetries = 3,
  }) {
    const client = getClient();
    if (!client) {
      log.error('Claude API client not available (missing API key)');
      return null;
    }

    const startTime = Date.now();

    try {
      const response = await retryWithBackoff(
        async () => {
          await waitForRateLimit();

          // Build the request params, omitting undefined fields
          const params = {
            model,
            max_tokens: maxTokens,
            messages,
          };

          if (temperature !== undefined) {
            params.temperature = temperature;
          }
          if (system) {
            params.system = system;
          }
          if (tools && tools.length > 0) {
            params.tools = tools;
          }

          return await client.messages.create(params);
        },
        maxRetries,
        log
      );

      const duration = Date.now() - startTime;

      // Record token usage and metrics
      if (response.usage) {
        metrics.recordClaudeUsage(
          model,
          response.usage.input_tokens || 0,
          response.usage.output_tokens || 0,
          'success'
        );
      }

      metrics.observeExternalApiCall('claude', metricsLabel, duration, 200);

      return response;
    } catch (err) {
      const duration = Date.now() - startTime;
      handleApiError(err, duration, log, model);
      throw err;
    }
  }

  return {
    getClient,
    callClaude,
    extractTextFromContent,
    waitForRateLimit,
    retryWithBackoff,
    handleApiError,
  };
}

// Default instance
const defaultInstance = createClaudeClient();

module.exports = {
  createClaudeClient,
  getClient: defaultInstance.getClient,
  callClaude: defaultInstance.callClaude,
  extractTextFromContent: defaultInstance.extractTextFromContent,
  waitForRateLimit: defaultInstance.waitForRateLimit,
  retryWithBackoff: defaultInstance.retryWithBackoff,
  handleApiError: defaultInstance.handleApiError,
};
