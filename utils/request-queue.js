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
   */
  constructor(deps = {}) {
    this.fetch = deps.fetch || globalThis.fetch;
    this.minInterval = deps.minInterval !== undefined ? deps.minInterval : 1000;
    this.queue = [];
    this.processing = false;
    this.lastRequestTime = 0;
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
   * Process queued requests respecting rate limits
   * @returns {Promise<void>}
   */
  async process() {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;

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
        const response = await this.fetch(url, options);
        resolve(response);
      } catch (error) {
        reject(error);
      }
    }

    this.processing = false;
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
  wait,
  MusicBrainzQueue,
  RequestQueue,
  createMbFetch,
};
