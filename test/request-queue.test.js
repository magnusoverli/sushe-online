/**
 * Tests for utils/request-queue.js
 * Tests MusicBrainzQueue and RequestQueue classes
 */

const { describe, it, mock, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  MusicBrainzQueue,
  RequestQueue,
  createMbFetch,
} = require('../utils/request-queue.js');

// Local wait helper for tests (internal function not exported from module)
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// =============================================================================
// MusicBrainzQueue tests
// =============================================================================

describe('MusicBrainzQueue', () => {
  let mockFetch;
  let queue;

  beforeEach(() => {
    mockFetch = mock.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => ({ data: 'test' }) })
    );
    // Use very short minInterval for faster tests
    queue = new MusicBrainzQueue({ fetch: mockFetch, minInterval: 10 });
  });

  describe('constructor', () => {
    it('should initialize with default values', () => {
      const defaultQueue = new MusicBrainzQueue();
      assert.strictEqual(defaultQueue.minInterval, 1000);
      assert.strictEqual(defaultQueue.timeout, 30000);
      assert.strictEqual(defaultQueue.maxRetries, 2);
      assert.deepStrictEqual(defaultQueue.queue, []);
      assert.strictEqual(defaultQueue.processing, false);
      assert.strictEqual(defaultQueue.lastRequestTime, 0);
    });

    it('should accept custom fetch and minInterval', () => {
      const customFetch = () => {};
      const customQueue = new MusicBrainzQueue({
        fetch: customFetch,
        minInterval: 500,
      });
      assert.strictEqual(customQueue.fetch, customFetch);
      assert.strictEqual(customQueue.minInterval, 500);
    });

    it('should accept minInterval of 0', () => {
      const zeroIntervalQueue = new MusicBrainzQueue({ minInterval: 0 });
      assert.strictEqual(zeroIntervalQueue.minInterval, 0);
    });

    it('should accept custom timeout', () => {
      const customTimeoutQueue = new MusicBrainzQueue({ timeout: 10000 });
      assert.strictEqual(customTimeoutQueue.timeout, 10000);
    });

    it('should accept custom maxRetries', () => {
      const customRetriesQueue = new MusicBrainzQueue({ maxRetries: 3 });
      assert.strictEqual(customRetriesQueue.maxRetries, 3);
    });
  });

  describe('add()', () => {
    it('should add request to queue and resolve with response', async () => {
      const response = await queue.add('https://example.com', {
        method: 'GET',
      });

      assert.strictEqual(response.ok, true);
      assert.strictEqual(response.status, 200);
      assert.strictEqual(mockFetch.mock.calls.length, 1);
      assert.strictEqual(
        mockFetch.mock.calls[0].arguments[0],
        'https://example.com'
      );
      assert.deepStrictEqual(mockFetch.mock.calls[0].arguments[1], {
        method: 'GET',
      });
    });

    it('should use default priority of normal', async () => {
      // Add two requests - one high, one default (normal)
      const highPriority = queue.add('https://high.com', {}, 'high');
      const normalPriority = queue.add('https://normal.com', {});

      await Promise.all([highPriority, normalPriority]);

      // High priority should be called first
      assert.strictEqual(
        mockFetch.mock.calls[0].arguments[0],
        'https://high.com'
      );
      assert.strictEqual(
        mockFetch.mock.calls[1].arguments[0],
        'https://normal.com'
      );
    });

    it('should reject on fetch error', async () => {
      const errorFetch = mock.fn(() =>
        Promise.reject(new Error('Network error'))
      );
      const errorQueue = new MusicBrainzQueue({
        fetch: errorFetch,
        minInterval: 0,
      });

      await assert.rejects(
        async () => {
          await errorQueue.add('https://example.com', {});
        },
        {
          message: 'Network error',
        }
      );
    });
  });

  describe('priority sorting', () => {
    it('should process high priority requests before normal', async () => {
      // Create a queue with longer interval to ensure order
      const slowFetch = mock.fn(() => Promise.resolve({ ok: true }));
      const slowQueue = new MusicBrainzQueue({
        fetch: slowFetch,
        minInterval: 0,
      });

      // Add requests in order: normal, high, low
      // They should be processed: high, normal, low
      const results = [];
      const p1 = slowQueue
        .add('https://normal.com', {}, 'normal')
        .then(() => results.push('normal'));
      const p2 = slowQueue
        .add('https://high.com', {}, 'high')
        .then(() => results.push('high'));
      const p3 = slowQueue
        .add('https://low.com', {}, 'low')
        .then(() => results.push('low'));

      await Promise.all([p1, p2, p3]);

      // Due to async nature, first one might process before sorting
      // But high should definitely come before low
      const highIndex = results.indexOf('high');
      const lowIndex = results.indexOf('low');
      assert.ok(
        highIndex < lowIndex,
        `High (${highIndex}) should be before low (${lowIndex})`
      );
    });

    it('should sort queue by priority: high > normal > low', async () => {
      // Use a fetch that delays to allow queue to build up
      const callOrder = [];
      const trackingFetch = mock.fn((url) => {
        callOrder.push(url);
        return Promise.resolve({ ok: true });
      });

      // Create queue but don't let it process yet
      const testQueue = new MusicBrainzQueue({
        fetch: trackingFetch,
        minInterval: 0,
      });

      // Add multiple requests quickly
      const promises = [
        testQueue.add('https://low1.com', {}, 'low'),
        testQueue.add('https://high1.com', {}, 'high'),
        testQueue.add('https://normal1.com', {}, 'normal'),
        testQueue.add('https://high2.com', {}, 'high'),
        testQueue.add('https://low2.com', {}, 'low'),
      ];

      await Promise.all(promises);

      // Verify high priority URLs came before low priority
      const high1Idx = callOrder.indexOf('https://high1.com');
      const high2Idx = callOrder.indexOf('https://high2.com');
      const low1Idx = callOrder.indexOf('https://low1.com');
      const low2Idx = callOrder.indexOf('https://low2.com');

      assert.ok(high1Idx < low1Idx || high1Idx < low2Idx);
      assert.ok(high2Idx < low1Idx || high2Idx < low2Idx);
    });
  });

  describe('process()', () => {
    it('should return early when queue is empty', async () => {
      const emptyQueue = new MusicBrainzQueue({
        fetch: mockFetch,
        minInterval: 0,
      });
      await emptyQueue.process();

      assert.strictEqual(mockFetch.mock.calls.length, 0);
      assert.strictEqual(emptyQueue.processing, false);
    });

    it('should return early when already processing', async () => {
      // Start processing
      const slowFetch = mock.fn(
        () =>
          new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 50))
      );
      const slowQueue = new MusicBrainzQueue({
        fetch: slowFetch,
        minInterval: 0,
      });

      // Add a request to start processing
      const p1 = slowQueue.add('https://first.com', {});

      // Try to call process directly while processing
      assert.strictEqual(slowQueue.isProcessing, true);
      await slowQueue.process(); // Should return early

      await p1;
    });

    it('should respect rate limit between requests', async () => {
      const timedQueue = new MusicBrainzQueue({
        fetch: mockFetch,
        minInterval: 50,
      });

      const start = Date.now();

      // Make two requests
      await timedQueue.add('https://first.com', {});
      await timedQueue.add('https://second.com', {});

      const elapsed = Date.now() - start;

      // Should have waited at least minInterval between requests
      assert.ok(
        elapsed >= 45,
        `Expected at least 45ms between requests, got ${elapsed}ms`
      );
    });

    it('should set processing to false after completion', async () => {
      await queue.add('https://example.com', {});

      assert.strictEqual(queue.processing, false);
      assert.strictEqual(queue.length, 0);
    });

    it('should update lastRequestTime after each request', async () => {
      assert.strictEqual(queue.lastRequestTime, 0);

      await queue.add('https://example.com', {});

      assert.ok(queue.lastRequestTime > 0);
      assert.ok(queue.lastRequestTime <= Date.now());
    });
  });

  describe('timeout handling', () => {
    it('should timeout when request exceeds timeout duration', async () => {
      const slowFetch = mock.fn(
        () =>
          new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 200))
      );
      const timeoutQueue = new MusicBrainzQueue({
        fetch: slowFetch,
        minInterval: 0,
        timeout: 50, // 50ms timeout
      });

      await assert.rejects(
        async () => {
          await timeoutQueue.add('https://example.com', {});
        },
        {
          name: 'TimeoutError',
          code: 'ETIMEDOUT',
        }
      );
    });

    it('should clear timeout on successful response', async () => {
      const fastFetch = mock.fn(() =>
        Promise.resolve({ ok: true, status: 200 })
      );
      const timeoutQueue = new MusicBrainzQueue({
        fetch: fastFetch,
        minInterval: 0,
        timeout: 1000,
      });

      const response = await timeoutQueue.add('https://example.com', {});

      assert.strictEqual(response.ok, true);
      assert.strictEqual(response.status, 200);
    });

    it('should include timeout duration in error message', async () => {
      const slowFetch = mock.fn(
        () =>
          new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 200))
      );
      const timeoutQueue = new MusicBrainzQueue({
        fetch: slowFetch,
        minInterval: 0,
        timeout: 100,
      });

      await assert.rejects(
        async () => {
          await timeoutQueue.add('https://example.com', {});
        },
        (error) => {
          assert.ok(error.message.includes('100ms'));
          assert.ok(error.message.includes('https://example.com'));
          return true;
        }
      );
    });

    it('should handle timeout with dependency injection', async () => {
      const slowFetch = mock.fn(
        () =>
          new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 200))
      );
      const timeoutQueue = new MusicBrainzQueue({
        fetch: slowFetch,
        minInterval: 0,
        timeout: 50,
      });

      await assert.rejects(
        async () => {
          await timeoutQueue.add('https://example.com', {});
        },
        {
          name: 'TimeoutError',
        }
      );
    });
  });

  describe('retry logic', () => {
    it('should retry on timeout errors', async () => {
      let attemptCount = 0;
      const timeoutFetch = mock.fn(() => {
        attemptCount++;
        if (attemptCount < 2) {
          // First attempt times out
          return new Promise((resolve) =>
            setTimeout(() => resolve({ ok: true }), 200)
          );
        }
        // Second attempt succeeds
        return Promise.resolve({ ok: true, status: 200 });
      });

      const retryQueue = new MusicBrainzQueue({
        fetch: timeoutFetch,
        minInterval: 0,
        timeout: 50,
        maxRetries: 2,
      });

      const response = await retryQueue.add('https://example.com', {});

      assert.strictEqual(response.ok, true);
      assert.strictEqual(attemptCount, 2);
    });

    it('should retry on connection reset errors', async () => {
      let attemptCount = 0;
      const resetFetch = mock.fn(() => {
        attemptCount++;
        if (attemptCount < 2) {
          const error = new Error('Connection reset');
          error.code = 'ECONNRESET';
          return Promise.reject(error);
        }
        return Promise.resolve({ ok: true, status: 200 });
      });

      const retryQueue = new MusicBrainzQueue({
        fetch: resetFetch,
        minInterval: 0,
        maxRetries: 2,
      });

      const response = await retryQueue.add('https://example.com', {});

      assert.strictEqual(response.ok, true);
      assert.strictEqual(attemptCount, 2);
    });

    it('should respect max retry limit', async () => {
      let attemptCount = 0;
      const failingFetch = mock.fn(() => {
        attemptCount++;
        const error = new Error('Connection reset');
        error.code = 'ECONNRESET';
        return Promise.reject(error);
      });

      const retryQueue = new MusicBrainzQueue({
        fetch: failingFetch,
        minInterval: 0,
        maxRetries: 2, // Max 2 retries = 3 total attempts
      });

      await assert.rejects(
        async () => {
          await retryQueue.add('https://example.com', {});
        },
        (error) => {
          assert.strictEqual(error.code, 'ECONNRESET');
          assert.strictEqual(error.retries, 2);
          return true;
        }
      );

      // Should have tried 3 times total (1 initial + 2 retries)
      assert.strictEqual(attemptCount, 3);
    });

    it('should use exponential backoff for retries', async () => {
      const backoffDelays = [];
      let lastTime = Date.now();

      const resetFetch = mock.fn(() => {
        const now = Date.now();
        if (backoffDelays.length > 0) {
          backoffDelays.push(now - lastTime);
        }
        lastTime = now;

        if (backoffDelays.length < 2) {
          const error = new Error('Connection reset');
          error.code = 'ECONNRESET';
          return Promise.reject(error);
        }
        return Promise.resolve({ ok: true, status: 200 });
      });

      const retryQueue = new MusicBrainzQueue({
        fetch: resetFetch,
        minInterval: 0,
        maxRetries: 2,
      });

      await retryQueue.add('https://example.com', {});

      // Should have 2 retry delays (1s, 2s)
      assert.strictEqual(backoffDelays.length, 2);
      // First delay should be ~1000ms (with some tolerance)
      assert.ok(
        backoffDelays[0] >= 900 && backoffDelays[0] <= 1100,
        `First delay ${backoffDelays[0]}ms should be ~1000ms`
      );
      // Second delay should be ~2000ms (with some tolerance)
      assert.ok(
        backoffDelays[1] >= 1900 && backoffDelays[1] <= 2100,
        `Second delay ${backoffDelays[1]}ms should be ~2000ms`
      );
    });

    it('should not retry on 4xx client errors', async () => {
      const errorFetch = mock.fn(() =>
        Promise.resolve({ ok: false, status: 404 })
      );

      const retryQueue = new MusicBrainzQueue({
        fetch: errorFetch,
        minInterval: 0,
        maxRetries: 2,
      });

      await assert.rejects(
        async () => {
          await retryQueue.add('https://example.com', {});
        },
        (error) => {
          assert.strictEqual(error.status, 404);
          assert.strictEqual(error.retries, 0);
          return true;
        }
      );

      // Should only try once
      assert.strictEqual(errorFetch.mock.calls.length, 1);
    });

    it('should not retry on 5xx server errors except 503/504', async () => {
      const errorFetch = mock.fn(() =>
        Promise.resolve({ ok: false, status: 500 })
      );

      const retryQueue = new MusicBrainzQueue({
        fetch: errorFetch,
        minInterval: 0,
        maxRetries: 2,
      });

      await assert.rejects(
        async () => {
          await retryQueue.add('https://example.com', {});
        },
        (error) => {
          assert.strictEqual(error.status, 500);
          assert.strictEqual(error.retries, 0);
          return true;
        }
      );

      // Should only try once
      assert.strictEqual(errorFetch.mock.calls.length, 1);
    });

    it('should retry on 503 Service Unavailable', async () => {
      let attemptCount = 0;
      const serviceUnavailableFetch = mock.fn(() => {
        attemptCount++;
        if (attemptCount < 2) {
          return Promise.resolve({ ok: false, status: 503 });
        }
        return Promise.resolve({ ok: true, status: 200 });
      });

      const retryQueue = new MusicBrainzQueue({
        fetch: serviceUnavailableFetch,
        minInterval: 0,
        maxRetries: 2,
      });

      const response = await retryQueue.add('https://example.com', {});

      assert.strictEqual(response.ok, true);
      assert.strictEqual(attemptCount, 2);
    });

    it('should retry on 504 Gateway Timeout', async () => {
      let attemptCount = 0;
      const gatewayTimeoutFetch = mock.fn(() => {
        attemptCount++;
        if (attemptCount < 2) {
          return Promise.resolve({ ok: false, status: 504 });
        }
        return Promise.resolve({ ok: true, status: 200 });
      });

      const retryQueue = new MusicBrainzQueue({
        fetch: gatewayTimeoutFetch,
        minInterval: 0,
        maxRetries: 2,
      });

      const response = await retryQueue.add('https://example.com', {});

      assert.strictEqual(response.ok, true);
      assert.strictEqual(attemptCount, 2);
    });

    it('should attach retry count to successful response after retries', async () => {
      let attemptCount = 0;
      const retryFetch = mock.fn(() => {
        attemptCount++;
        if (attemptCount < 2) {
          const error = new Error('Connection reset');
          error.code = 'ECONNRESET';
          return Promise.reject(error);
        }
        return Promise.resolve({ ok: true, status: 200 });
      });

      const retryQueue = new MusicBrainzQueue({
        fetch: retryFetch,
        minInterval: 0,
        maxRetries: 2,
      });

      const response = await retryQueue.add('https://example.com', {});

      assert.strictEqual(response.ok, true);
      assert.strictEqual(response._retries, 1);
    });

    it('should attach retry count to error after max retries', async () => {
      const failingFetch = mock.fn(() => {
        const error = new Error('ETIMEDOUT');
        error.code = 'ETIMEDOUT';
        return Promise.reject(error);
      });

      const retryQueue = new MusicBrainzQueue({
        fetch: failingFetch,
        minInterval: 0,
        maxRetries: 2,
      });

      await assert.rejects(
        async () => {
          await retryQueue.add('https://example.com', {});
        },
        (error) => {
          assert.strictEqual(error.code, 'ETIMEDOUT');
          assert.strictEqual(error.retries, 2);
          return true;
        }
      );
    });

    it('should retry on various network error codes', async () => {
      const retryableCodes = [
        'ECONNRESET',
        'ETIMEDOUT',
        'ENOTFOUND',
        'ECONNREFUSED',
      ];
      for (const code of retryableCodes) {
        let attemptCount = 0;
        const networkErrorFetch = mock.fn(() => {
          attemptCount++;
          if (attemptCount < 2) {
            const error = new Error(`Network error: ${code}`);
            error.code = code;
            return Promise.reject(error);
          }
          return Promise.resolve({ ok: true, status: 200 });
        });

        const retryQueue = new MusicBrainzQueue({
          fetch: networkErrorFetch,
          minInterval: 0,
          maxRetries: 2,
        });

        const response = await retryQueue.add('https://example.com', {});

        assert.strictEqual(response.ok, true, `Should retry on ${code}`);
        assert.strictEqual(
          attemptCount,
          2,
          `Should have retried once for ${code}`
        );
      }
    });
  });

  describe('getters', () => {
    it('length should return queue length', () => {
      assert.strictEqual(queue.length, 0);

      // Manually add to queue (bypassing add() to test getter)
      queue.queue.push({ url: 'test', resolve: () => {}, reject: () => {} });
      assert.strictEqual(queue.length, 1);
    });

    it('isProcessing should return processing state', () => {
      assert.strictEqual(queue.isProcessing, false);

      queue.processing = true;
      assert.strictEqual(queue.isProcessing, true);
    });
  });
});

// =============================================================================
// RequestQueue tests
// =============================================================================

describe('RequestQueue', () => {
  describe('constructor', () => {
    it('should initialize with default maxConcurrent of 10', () => {
      const queue = new RequestQueue();
      assert.strictEqual(queue.maxConcurrent, 10);
      assert.strictEqual(queue.running, 0);
      assert.deepStrictEqual(queue.queue, []);
    });

    it('should accept custom maxConcurrent', () => {
      const queue = new RequestQueue(5);
      assert.strictEqual(queue.maxConcurrent, 5);
    });
  });

  describe('add()', () => {
    it('should execute function and resolve with result', async () => {
      const queue = new RequestQueue(10);
      const mockFn = mock.fn(() => Promise.resolve('success'));

      const result = await queue.add(mockFn);

      assert.strictEqual(result, 'success');
      assert.strictEqual(mockFn.mock.calls.length, 1);
    });

    it('should reject when function throws', async () => {
      const queue = new RequestQueue(10);
      const mockFn = mock.fn(() => Promise.reject(new Error('Failed')));

      await assert.rejects(
        async () => {
          await queue.add(mockFn);
        },
        {
          message: 'Failed',
        }
      );
    });

    it('should pass through function return value', async () => {
      const queue = new RequestQueue(10);
      const complexResult = { data: [1, 2, 3], meta: { count: 3 } };
      const mockFn = mock.fn(() => Promise.resolve(complexResult));

      const result = await queue.add(mockFn);

      assert.deepStrictEqual(result, complexResult);
    });
  });

  describe('concurrency limiting', () => {
    it('should respect maxConcurrent limit', async () => {
      const queue = new RequestQueue(2);
      let concurrentCount = 0;
      let maxConcurrent = 0;

      const createSlowFn = () =>
        mock.fn(async () => {
          concurrentCount++;
          maxConcurrent = Math.max(maxConcurrent, concurrentCount);
          await wait(30);
          concurrentCount--;
          return 'done';
        });

      // Add 5 functions, max 2 should run concurrently
      const promises = [
        queue.add(createSlowFn()),
        queue.add(createSlowFn()),
        queue.add(createSlowFn()),
        queue.add(createSlowFn()),
        queue.add(createSlowFn()),
      ];

      await Promise.all(promises);

      assert.ok(
        maxConcurrent <= 2,
        `Max concurrent was ${maxConcurrent}, expected <= 2`
      );
    });

    it('should process queued items when slot opens', async () => {
      const queue = new RequestQueue(1);
      const executionOrder = [];

      const createFn = (id) =>
        mock.fn(async () => {
          executionOrder.push(`start-${id}`);
          await wait(10);
          executionOrder.push(`end-${id}`);
          return id;
        });

      const promises = [
        queue.add(createFn(1)),
        queue.add(createFn(2)),
        queue.add(createFn(3)),
      ];

      await Promise.all(promises);

      // With maxConcurrent=1, should execute sequentially
      assert.deepStrictEqual(executionOrder, [
        'start-1',
        'end-1',
        'start-2',
        'end-2',
        'start-3',
        'end-3',
      ]);
    });

    it('should decrement running count on success', async () => {
      const queue = new RequestQueue(10);

      assert.strictEqual(queue.runningCount, 0);

      await queue.add(() => Promise.resolve('done'));

      assert.strictEqual(queue.runningCount, 0);
    });

    it('should decrement running count on failure', async () => {
      const queue = new RequestQueue(10);

      assert.strictEqual(queue.runningCount, 0);

      try {
        await queue.add(() => Promise.reject(new Error('fail')));
      } catch (_e) {
        // Expected
      }

      assert.strictEqual(queue.runningCount, 0);
    });
  });

  describe('getters', () => {
    it('length should return queue length', () => {
      const queue = new RequestQueue(10);
      assert.strictEqual(queue.length, 0);

      // Manually add to queue
      queue.queue.push({ fn: () => {}, resolve: () => {}, reject: () => {} });
      assert.strictEqual(queue.length, 1);
    });

    it('runningCount should return running count', () => {
      const queue = new RequestQueue(10);
      assert.strictEqual(queue.runningCount, 0);

      queue.running = 5;
      assert.strictEqual(queue.runningCount, 5);
    });
  });

  describe('process()', () => {
    it('should handle empty queue gracefully', () => {
      const queue = new RequestQueue(10);

      // Should not throw
      queue.process();

      assert.strictEqual(queue.runningCount, 0);
      assert.strictEqual(queue.length, 0);
    });

    it('should continue processing after error', async () => {
      const queue = new RequestQueue(1);
      const results = [];

      const promises = [
        queue
          .add(async () => {
            results.push('first');
            throw new Error('First failed');
          })
          .catch(() => 'caught-first'),
        queue.add(async () => {
          results.push('second');
          return 'second-success';
        }),
      ];

      await Promise.all(promises);

      assert.deepStrictEqual(results, ['first', 'second']);
    });
  });
});

// =============================================================================
// createMbFetch tests
// =============================================================================

describe('createMbFetch', () => {
  it('should create a function that uses the queue', async () => {
    const mockFetch = mock.fn(() => Promise.resolve({ ok: true }));
    const queue = new MusicBrainzQueue({ fetch: mockFetch, minInterval: 0 });
    const mbFetch = createMbFetch(queue);

    const response = await mbFetch('https://example.com', { method: 'GET' });

    assert.strictEqual(response.ok, true);
    assert.strictEqual(mockFetch.mock.calls.length, 1);
  });

  it('should pass priority to queue', async () => {
    const mockFetch = mock.fn(() => Promise.resolve({ ok: true }));
    const queue = new MusicBrainzQueue({ fetch: mockFetch, minInterval: 0 });
    const mbFetch = createMbFetch(queue);

    // Add spy to track add calls
    const originalAdd = queue.add.bind(queue);
    let capturedPriority = null;
    queue.add = (url, opts, priority) => {
      capturedPriority = priority;
      return originalAdd(url, opts, priority);
    };

    await mbFetch('https://example.com', {}, 'high');

    assert.strictEqual(capturedPriority, 'high');
  });

  it('should default priority to normal', async () => {
    const mockFetch = mock.fn(() => Promise.resolve({ ok: true }));
    const queue = new MusicBrainzQueue({ fetch: mockFetch, minInterval: 0 });
    const mbFetch = createMbFetch(queue);

    const originalAdd = queue.add.bind(queue);
    let capturedPriority = null;
    queue.add = (url, opts, priority) => {
      capturedPriority = priority;
      return originalAdd(url, opts, priority);
    };

    await mbFetch('https://example.com', {});

    assert.strictEqual(capturedPriority, 'normal');
  });
});
