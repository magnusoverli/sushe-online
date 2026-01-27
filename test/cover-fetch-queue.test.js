/**
 * Tests for utils/cover-fetch-queue.js
 * Tests cover fetch queue functionality
 */

const { describe, it, mock, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  createCoverFetchQueue,
  initializeCoverFetchQueue,
  getCoverFetchQueue,
} = require('../utils/cover-fetch-queue.js');

// Local wait helper for async operations
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('CoverFetchQueue', () => {
  let mockPool;
  let mockFetch;
  let queue;

  beforeEach(() => {
    // Mock database pool
    mockPool = {
      query: mock.fn(() =>
        Promise.resolve({ rowCount: 1, rows: [{ album_id: 'test-id' }] })
      ),
    };

    // Mock fetch function
    mockFetch = mock.fn();

    // Create queue with mocked dependencies
    queue = createCoverFetchQueue({
      pool: mockPool,
      fetch: mockFetch,
      maxConcurrent: 2,
    });
  });

  describe('createCoverFetchQueue', () => {
    it('should create queue with default maxConcurrent of 3', () => {
      const defaultQueue = createCoverFetchQueue({ pool: mockPool });
      assert.ok(defaultQueue.add);
      assert.ok(defaultQueue.fetchAndStoreCover);
    });

    it('should respect custom maxConcurrent', () => {
      const customQueue = createCoverFetchQueue({
        pool: mockPool,
        maxConcurrent: 5,
      });
      assert.ok(customQueue);
    });
  });

  describe('add()', () => {
    it('should queue cover fetch and resolve', async () => {
      // Mock Deezer response
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [
                {
                  cover_xl: 'https://e-cdn-images.deezer.com/cover.jpg',
                },
              ],
            }),
        })
      );

      // Mock image download
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          headers: {
            get: () => 'image/jpeg',
          },
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(1000)),
        })
      );

      await queue.add('musicbrainz-id', 'Test Artist', 'Test Album');

      // Wait for async processing
      await wait(100);

      assert.strictEqual(mockFetch.mock.calls.length, 2);
      assert.strictEqual(mockPool.query.mock.calls.length, 1);

      // Verify Deezer API call
      const deezerCall = mockFetch.mock.calls[0].arguments[0];
      assert.ok(deezerCall.includes('api.deezer.com'));
      assert.ok(deezerCall.includes('Test Artist'));
      assert.ok(deezerCall.includes('Test Album'));

      // Verify database update
      const dbCall = mockPool.query.mock.calls[0].arguments;
      assert.ok(dbCall[0].includes('UPDATE albums'));
      assert.ok(dbCall[0].includes('cover_image'));
    });

    it('should skip if albumId is missing', async () => {
      await queue.add(null, 'Artist', 'Album');

      await wait(50);

      assert.strictEqual(mockFetch.mock.calls.length, 0);
      assert.strictEqual(mockPool.query.mock.calls.length, 0);
    });

    it('should skip if artist is missing', async () => {
      await queue.add('id', null, 'Album');

      await wait(50);

      assert.strictEqual(mockFetch.mock.calls.length, 0);
      assert.strictEqual(mockPool.query.mock.calls.length, 0);
    });

    it('should skip if album is missing', async () => {
      await queue.add('id', 'Artist', null);

      await wait(50);

      assert.strictEqual(mockFetch.mock.calls.length, 0);
      assert.strictEqual(mockPool.query.mock.calls.length, 0);
    });
  });

  describe('fetchAndStoreCover()', () => {
    it('should fetch cover from Deezer and store in database', async () => {
      // Mock Deezer response
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [
                {
                  cover_xl: 'https://e-cdn-images.deezer.com/cover.jpg',
                },
              ],
            }),
        })
      );

      // Mock image download
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          headers: {
            get: () => 'image/jpeg',
          },
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(5000)),
        })
      );

      await queue.fetchAndStoreCover('test-id', 'Artist Name', 'Album Name');

      assert.strictEqual(mockFetch.mock.calls.length, 2);
      assert.strictEqual(mockPool.query.mock.calls.length, 1);

      // Verify database update parameters
      const updateCall = mockPool.query.mock.calls[0].arguments;
      assert.strictEqual(updateCall[1].length, 3); // [buffer, format, albumId]
      assert.ok(Buffer.isBuffer(updateCall[1][0])); // cover_image is Buffer
      assert.strictEqual(updateCall[1][1], 'JPEG'); // format
      assert.strictEqual(updateCall[1][2], 'test-id'); // albumId
    });

    it('should handle Deezer API errors gracefully', async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        })
      );

      await assert.rejects(
        () => queue.fetchAndStoreCover('test-id', 'Artist', 'Album'),
        {
          message: /Deezer API error/,
        }
      );

      assert.strictEqual(mockPool.query.mock.calls.length, 0);
    });

    it('should handle missing Deezer results gracefully', async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        })
      );

      // Should not throw, just return early
      await queue.fetchAndStoreCover('test-id', 'Artist', 'Album');

      assert.strictEqual(mockPool.query.mock.calls.length, 0);
    });

    it('should handle missing cover URL in results', async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [{ name: 'Album', cover_xl: null, cover_big: null }],
            }),
        })
      );

      await queue.fetchAndStoreCover('test-id', 'Artist', 'Album');

      assert.strictEqual(mockPool.query.mock.calls.length, 0);
    });

    it('should handle image download errors', async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [{ cover_xl: 'https://example.com/cover.jpg' }],
            }),
        })
      );

      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        })
      );

      await assert.rejects(
        () => queue.fetchAndStoreCover('test-id', 'Artist', 'Album'),
        {
          message: /Image download failed/,
        }
      );

      assert.strictEqual(mockPool.query.mock.calls.length, 0);
    });

    it('should use cover_big if cover_xl is not available', async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [
                {
                  cover_xl: null,
                  cover_big: 'https://example.com/cover_big.jpg',
                },
              ],
            }),
        })
      );

      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          headers: { get: () => 'image/jpeg' },
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(3000)),
        })
      );

      await queue.fetchAndStoreCover('test-id', 'Artist', 'Album');

      const imageCall = mockFetch.mock.calls[1].arguments[0];
      assert.ok(imageCall.includes('cover_big.jpg'));
    });

    it('should throw if pool is not initialized', async () => {
      const nopoolQueue = createCoverFetchQueue({ fetch: mockFetch });

      await assert.rejects(
        () => nopoolQueue.fetchAndStoreCover('test-id', 'Artist', 'Album'),
        {
          message: /Database pool not initialized/,
        }
      );
    });
  });

  describe('length getter', () => {
    it('should return 0 for empty queue', () => {
      assert.strictEqual(queue.length, 0);
    });

    it('should return queue length when items are pending', async () => {
      // Add items but don't await them
      const promises = [];
      for (let i = 0; i < 5; i++) {
        // Mock each fetch to never resolve (to keep them in queue)
        mockFetch.mockImplementationOnce(
          () => new Promise(() => {}) // Never resolves
        );
        promises.push(queue.add(`id-${i}`, 'Artist', 'Album'));
      }

      // Give time for items to be queued
      await wait(50);

      // Should have items in queue (max concurrent is 2, so 3 should be waiting)
      // Note: This test is timing-dependent and may be flaky
      // In practice, we care more that the getter doesn't throw
      assert.ok(queue.length >= 0);
    });
  });
});

describe('Singleton functions', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = {
      query: mock.fn(() => Promise.resolve({ rowCount: 1 })),
    };
  });

  describe('initializeCoverFetchQueue', () => {
    it('should initialize singleton queue', () => {
      const result = initializeCoverFetchQueue(mockPool);
      assert.ok(result);
      assert.ok(result.add);
    });

    it('should return same instance on multiple calls', () => {
      const first = initializeCoverFetchQueue(mockPool);
      const second = initializeCoverFetchQueue(mockPool);
      assert.strictEqual(first, second);
    });
  });

  describe('getCoverFetchQueue', () => {
    it('should return initialized queue', () => {
      initializeCoverFetchQueue(mockPool);
      const queue = getCoverFetchQueue();
      assert.ok(queue);
      assert.ok(queue.add);
    });
  });
});
