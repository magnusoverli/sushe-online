/**
 * Request Queue Utilities
 *
 * Provides rate-limited and concurrent request queue implementations.
 * Used for MusicBrainz API requests (rate limited) and image proxy requests (concurrent).
 *
 * Follows dependency injection pattern for testability.
 */

/**
 * Fetch/network error as produced by undici and Node's DNS/TCP layers, plus the
 * transport metadata this queue attaches before rejecting a queued request.
 * @typedef {Error & {
 *   code?: string,
 *   cause?: { code?: string },
 *   type?: string,
 *   status?: number,
 *   retries?: number
 * }} RequestError
 */

/**
 * Fetch Response with the retry counter this queue attaches for downstream logging.
 * @typedef {Response & { _retries?: number }} QueuedResponse
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
   * @param {Object} [deps] - Dependencies for testing
   * @param {Function} [deps.fetch] - Fetch implementation
   * @param {number} [deps.minInterval] - Minimum interval between requests (ms, default: 1000)
   * @param {number} [deps.timeout] - Override per-attempt timeout (including body)
   * @param {number} [deps.totalTimeout] - Override total lifetime, including queue wait
   * @param {number} [deps.maxRetries] - Maximum number of retries (default: 2)
   * @param {Function} [deps.now] - Clock in milliseconds
   * @param {Function} [deps.setTimeout] - Timer implementation
   * @param {Function} [deps.clearTimeout] - Timer cancellation implementation
   */
  constructor(deps = {}) {
    this.fetch = deps.fetch || globalThis.fetch;
    this.minInterval = deps.minInterval !== undefined ? deps.minInterval : 1000;
    this.timeout = deps.timeout !== undefined ? deps.timeout : 10000;
    this.lowTimeout = deps.timeout !== undefined ? deps.timeout : 5000;
    this.totalTimeout = deps.totalTimeout;
    this.maxRetries = deps.maxRetries !== undefined ? deps.maxRetries : 2;
    this.now = deps.now || Date.now;
    this.setTimeout = deps.setTimeout || setTimeout;
    this.clearTimeout = deps.clearTimeout || clearTimeout;
    this.queue = [];
    this.processing = false;
    this.lastRequestTime = 0;
    this.nextStartTime = 0;
    this.cooldownUntil = 0;
    this.wakeTimer = null;
  }

  /**
   * Determine if an error is retryable (transient network error)
   * @param {RequestError} error - The error to check
   * @param {Response|null} response - The response if available
   * @returns {boolean} - True if error is retryable
   */
  _isRetryableError(error, response) {
    if (response) {
      return [429, 503, 504].includes(response.status);
    }

    if (!error || error.name === 'AbortError') return false;

    // Retry on network errors
    const retryableCodes = [
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'ECONNREFUSED',
      'EAI_AGAIN',
    ];
    if (retryableCodes.includes(error.code || error.cause?.code)) {
      return true;
    }

    // Retry on timeout errors
    if (error.name === 'TimeoutError') {
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
  async add(url, options = {}, priority = 'normal') {
    return new Promise((resolve, reject) => {
      const signal = options.signal;
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      const lifetimes = { high: 10000, normal: 15000, low: 20000 };
      if (!Object.hasOwn(lifetimes, priority)) priority = 'normal';
      const lifetime = this.totalTimeout ?? lifetimes[priority];
      const item = {
        url,
        options,
        priority,
        resolve,
        reject,
        retries: 0,
        readyAt: this.now(),
        deadline: this.now() + lifetime,
        settled: false,
        controller: null,
      };
      item.onAbort = () => this._settle(item, signal.reason);
      signal?.addEventListener('abort', item.onAbort, { once: true });
      item.deadlineTimer = this.setTimeout(() => {
        const error = this._timeoutError(url, lifetime);
        error.retries = item.retries;
        this._settle(item, error);
      }, lifetime);
      this.queue.push(item);
      this.process();
    });
  }

  _timeoutError(url, duration) {
    /** @type {RequestError} */
    const error = new Error(`Request timeout after ${duration}ms: ${url}`);
    error.name = 'TimeoutError';
    error.code = 'ETIMEDOUT';
    return error;
  }

  _settle(item, error, response) {
    if (item.settled) return;
    item.settled = true;
    this.clearTimeout(item.deadlineTimer);
    item.options.signal?.removeEventListener('abort', item.onAbort);
    const index = this.queue.indexOf(item);
    if (index !== -1) this.queue.splice(index, 1);
    if (error !== undefined) {
      item.controller?.abort(error);
      item.reject(error);
    } else {
      item.resolve(response);
    }
    this.process();
  }

  async _executeFetch(item) {
    const controller = new AbortController();
    item.controller = controller;
    const duration = Math.min(
      item.priority === 'low' ? this.lowTimeout : this.timeout,
      item.deadline - this.now()
    );
    const timer = this.setTimeout(() => {
      controller.abort(this._timeoutError(item.url, duration));
    }, duration);
    let onAbort;
    let reader;
    const aborted = new Promise((_, reject) => {
      onAbort = () => {
        reader?.cancel(controller.signal.reason).catch(() => {});
        reject(controller.signal.reason);
      };
      controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      // Race also bounds injected transports that fail to reject on abort.
      return await Promise.race([
        (async () => {
          const response = await this.fetch(item.url, {
            ...item.options,
            signal: controller.signal,
          });
          if (controller.signal.aborted || !response.ok) {
            response.body?.cancel().catch(() => {});
            controller.signal.throwIfAborted();
            return response;
          }
          // All MB consumers use small JSON. Buffer before resolving so json(),
          // text() and clone() never perform an unbounded network body read.
          if (typeof response.arrayBuffer !== 'function') return response;
          let body = null;
          if (response.body) {
            reader = response.body.getReader();
            const chunks = [];
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
              }
              body = Buffer.concat(chunks);
            } finally {
              reader.releaseLock();
              reader = null;
            }
          }
          controller.signal.throwIfAborted();
          const headers = new Headers(response.headers);
          headers.delete('content-encoding');
          headers.delete('transfer-encoding');
          if (body !== null)
            headers.set('content-length', String(body.byteLength));
          return new globalThis.Response(body, {
            status: response.status,
            statusText: response.statusText,
            headers,
          });
        })(),
        aborted,
      ]);
    } finally {
      this.clearTimeout(timer);
      controller.signal.removeEventListener('abort', onAbort);
      item.controller = null;
    }
  }

  /**
   * Process queued requests respecting rate limits
   * @returns {Promise<void>}
   */
  async process() {
    this.clearTimeout(this.wakeTimer);
    this.wakeTimer = null;
    if (this.processing || this.queue.length === 0) return;
    const now = this.now();
    const readyAt = Math.max(
      this.nextStartTime,
      this.cooldownUntil,
      this.queue.reduce(
        (earliest, item) => Math.min(earliest, item.readyAt),
        Infinity
      )
    );
    if (readyAt > now) {
      // A new arrival/cancellation reschedules this single wake-up timer.
      // Never schedule beyond a request deadline, including enormous Retry-After
      // values that would overflow Node's timer range and cause a busy loop.
      const wakeAt = this.queue.reduce(
        (earliest, item) => Math.min(earliest, item.deadline),
        readyAt
      );
      this.wakeTimer = this.setTimeout(() => this.process(), wakeAt - now);
      return;
    }
    const ranks = { high: 3, normal: 2, low: 1 };
    const item = this.queue
      .filter((entry) => entry.readyAt <= now)
      .sort((a, b) => ranks[b.priority] - ranks[a.priority])[0];
    this.queue.splice(this.queue.indexOf(item), 1);
    if (item.deadline <= now) {
      this._settle(item, this._timeoutError(item.url, 0));
      return;
    }
    this.processing = true;
    this.lastRequestTime = now;
    this.nextStartTime = now + this.minInterval;
    let response;
    try {
      response = await this._executeFetch(item);
      if (item.settled) return;
      if (!response.ok) {
        if ([429, 503].includes(response.status)) {
          const value = response.headers?.get('retry-after');
          if (value) {
            const seconds = Number(value);
            const until = Number.isFinite(seconds)
              ? this.now() + Math.max(0, seconds) * 1000
              : Date.parse(value);
            if (Number.isFinite(until)) {
              this.cooldownUntil = Math.max(this.cooldownUntil, until);
            }
          }
        }
        /** @type {RequestError} */
        const error = new Error(
          `MusicBrainz API responded with status ${response.status}`
        );
        error.status = response.status;
        throw error;
      }
      if (item.retries) response._retries = item.retries;
      this._settle(item, undefined, response);
    } catch (error) {
      if (item.settled) return;
      if (
        item.retries < this.maxRetries &&
        this._isRetryableError(error, response)
      ) {
        item.readyAt = this.now() + 2 ** item.retries * 1000;
        item.retries++;
        this.queue.push(item);
      } else {
        error.retries = item.retries;
        this._settle(item, error);
      }
    } finally {
      this.processing = false;
      this.process();
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
  wait,
};
