/**
 * Request Queue Utilities
 *
 * Provides rate-limited and concurrent request queue implementations.
 * Used for MusicBrainz API requests (rate limited) and image proxy requests (concurrent).
 *
 * Follows dependency injection pattern for testability.
 */

/**
 * Simple promise-based wait utility
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Rate-limited request queue for MusicBrainz API
 * Enforces 1 request per second as per MusicBrainz API policy.
 * Supports priority-based request ordering.
 */
class MusicBrainzQueue {
  /**
   * @param {Object} deps - Dependencies for testing
   * @param {Function} deps.fetch - Fetch implementation
   * @param {number} deps.minInterval - Minimum interval between requests (ms)
   * @param {number} deps.timeout - Request timeout in milliseconds (default: 30000)
   * @param {number} deps.maxRetries - Maximum number of retries (default: 2)
   */
  constructor(deps = {}) {
    this.fetch = deps.fetch || globalThis.fetch;
    this.minInterval = deps.minInterval !== undefined ? deps.minInterval : 1000;
    this.timeout = deps.timeout !== undefined ? deps.timeout : 30000;
    this.maxRetries = deps.maxRetries !== undefined ? deps.maxRetries : 2;
    this.queue = [];
    this.processing = false;
    this.lastRequestTime = 0;
  }

  /**
   * Determine if an error is retryable (transient network error)
   * @param {Error} error - The error to check
   * @param {Response|null} response - The response if available
   * @returns {boolean} - True if error is retryable
   */
  _isRetryableError(error, response) {
    // Don't retry on HTTP errors (4xx, 5xx) unless specifically transient
    if (response) {
      // Don't retry on client errors (4xx)
      if (response.status >= 400 && response.status < 500) {
        return false;
      }
      // Don't retry on server errors (5xx) unless specifically transient
      // 503 Service Unavailable and 504 Gateway Timeout are transient
      if (response.status >= 500) {
        return response.status === 503 || response.status === 504;
      }
    }

    // Retry on network errors
    const retryableCodes = [
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'ECONNREFUSED',
      'EAI_AGAIN',
    ];
    if (error.code && retryableCodes.includes(error.code)) {
      return true;
    }

    // Retry on timeout errors
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return true;
    }

    // Retry on network error types
    if (error.type === 'network' || error.type === 'system') {
      return true;
    }

    return false;
  }

  /**
   * Add a request to the queue
   * @param {string} url - URL to fetch
   * @param {Object} options - Fetch options
   * @param {string} priority - Priority level: 'high', 'normal', or 'low'
   * @returns {Promise<Response>} - Fetch response
   */
  async add(url, options, priority = 'normal') {
    return new Promise((resolve, reject) => {
      this.queue.push({ url, options, priority, resolve, reject });
      // Sort by priority: high > normal > low
      this.queue.sort((a, b) => {
        const priorityMap = { high: 3, normal: 2, low: 1 };
        return priorityMap[b.priority] - priorityMap[a.priority];
      });
      this.process();
    });
  }

  /**
   * Execute a single fetch with timeout handling
   * @param {string} url - URL to fetch
   * @param {Object} options - Fetch options
   * @returns {Promise<{response?: Response, error?: Error}>}
   * @private
   */
  async _executeFetch(url, options) {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, this.timeout);

    const fetchOptions = {
      ...options,
      signal: abortController.signal,
    };

    try {
      const response = await this.fetch(url, fetchOptions);
      clearTimeout(timeoutId);
      return { response };
    } catch (fetchError) {
      clearTimeout(timeoutId);
      // Handle timeout specifically
      if (fetchError.name === 'AbortError' && abortController.signal.aborted) {
        const timeoutError = new Error(
          `Request timeout after ${this.timeout}ms: ${url}`
        );
        timeoutError.name = 'TimeoutError';
        timeoutError.code = 'ETIMEDOUT';
        return { error: timeoutError };
      }
      return { error: fetchError };
    }
  }

  /**
   * Process a single request with retry logic
   * @param {string} url - URL to fetch
   * @param {Object} options - Fetch options
   * @returns {Promise<Response>}
   * @private
   */
  async _processRequest(url, options) {
    let retryCount = 0;
    let lastError = null;
    let lastResponse = null;

    while (retryCount <= this.maxRetries) {
      const { response, error } = await this._executeFetch(url, options);

      if (response) {
        if (response.ok) {
          // Success - attach retry count for logging
          if (retryCount > 0) {
            response._retries = retryCount;
          }
          return response;
        }

        // Non-OK response
        lastResponse = response;
        const httpError = new Error(`HTTP ${response.status}`);
        if (
          retryCount < this.maxRetries &&
          this._isRetryableError(httpError, response)
        ) {
          retryCount++;
          const backoffDelay = Math.pow(2, retryCount - 1) * 1000;
          await wait(backoffDelay);
          continue;
        }

        // Not retryable or max retries reached
        const finalError = new Error(
          `MusicBrainz API responded with status ${response.status}`
        );
        finalError.status = response.status;
        finalError.retries = retryCount;
        throw finalError;
      }

      // Fetch error occurred
      lastError = error;
      if (
        retryCount < this.maxRetries &&
        this._isRetryableError(lastError, lastResponse)
      ) {
        retryCount++;
        const backoffDelay = Math.pow(2, retryCount - 1) * 1000;
        await wait(backoffDelay);
        continue;
      }

      // Not retryable or max retries reached
      lastError.retries = retryCount;
      throw lastError;
    }

    // Should not reach here, but handle it
    throw lastError || new Error('Unknown error occurred');
  }

  /**
   * Process queued requests respecting rate limits
   * @returns {Promise<void>}
   */
  async process() {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;

    try {
      while (this.queue.length > 0) {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;

        // Wait if we need to respect rate limit
        if (timeSinceLastRequest < this.minInterval) {
          await wait(this.minInterval - timeSinceLastRequest);
        }

        const { url, options, resolve, reject } = this.queue.shift();
        this.lastRequestTime = Date.now();

        try {
          const response = await this._processRequest(url, options);
          resolve(response);
        } catch (error) {
          reject(error);
        }
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * Get current queue length (for testing/monitoring)
   * @returns {number}
   */
  get length() {
    return this.queue.length;
  }

  /**
   * Check if currently processing (for testing/monitoring)
   * @returns {boolean}
   */
  get isProcessing() {
    return this.processing;
  }
}

/**
 * Concurrent request queue with configurable concurrency limit.
 * Used for image proxy requests to prevent overwhelming external servers.
 */
class RequestQueue {
  /**
   * @param {number} maxConcurrent - Maximum concurrent requests (default: 10)
   */
  constructor(maxConcurrent = 10) {
    this.maxConcurrent = maxConcurrent;
    this.running = 0;
    this.queue = [];
  }

  /**
   * Add a function to the queue for execution
   * @param {Function} fn - Async function to execute
   * @returns {Promise<*>} - Result of the function
   */
  async add(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.process();
    });
  }

  /**
   * Process queued functions respecting concurrency limit
   */
  process() {
    while (this.running < this.maxConcurrent && this.queue.length > 0) {
      const { fn, resolve, reject } = this.queue.shift();
      this.running++;

      fn()
        .then(resolve)
        .catch(reject)
        .finally(() => {
          this.running--;
          this.process();
        });
    }
  }

  /**
   * Get current queue length (for testing/monitoring)
   * @returns {number}
   */
  get length() {
    return this.queue.length;
  }

  /**
   * Get current running count (for testing/monitoring)
   * @returns {number}
   */
  get runningCount() {
    return this.running;
  }
}

/**
 * Factory function to create a MusicBrainz fetch wrapper
 * @param {MusicBrainzQueue} queue - Queue instance to use
 * @returns {Function} - Fetch function that uses the queue
 */
function createMbFetch(queue) {
  return function mbFetch(url, options, priority = 'normal') {
    return queue.add(url, options, priority);
  };
}

module.exports = {
  MusicBrainzQueue,
  RequestQueue,
  createMbFetch,
};
