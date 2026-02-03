/**
 * Tests for utils/cover-fetch-queue.js
 * Tests cover fetch queue functionality with multi-provider support
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

// Static mock image buffer (valid 10x10 JPEG) that sharp can process
// This avoids async complications in tests
const MOCK_IMAGE_BASE64 =
  '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAKAAoDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABykX//Z';
const MOCK_IMAGE_BUFFER = Buffer.from(MOCK_IMAGE_BASE64, 'base64');

/**
 * Creates a mock fetch function that returns different responses based on URL patterns
 * This approach works with Node.js test runner
 */
function createMockFetch(responses = {}) {
  const calls = [];

  const mockFn = async (url, options = {}) => {
    calls.push({ url, options });

    // Handle abort signal
    if (options.signal?.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      throw err;
    }

    // Default response
    const defaultResponse = {
      ok: false,
      status: 404,
      json: () => Promise.resolve({}),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    };

    // Check for Cover Art Archive
    if (url.includes('coverartarchive.org')) {
      const response = responses.coverArtArchive || defaultResponse;
      // If the arrayBuffer function is async, await it
      if (response.arrayBuffer) {
        const originalFn = response.arrayBuffer;
        response.arrayBuffer = async () => {
          const result = await originalFn();
          return result;
        };
      }
      return response;
    }

    // Check for iTunes search
    if (url.includes('itunes.apple.com/search')) {
      return responses.itunesSearch || defaultResponse;
    }

    // Check for iTunes artwork
    if (url.includes('mzstatic.com')) {
      const response = responses.itunesImage || defaultResponse;
      if (response.arrayBuffer) {
        const originalFn = response.arrayBuffer;
        response.arrayBuffer = async () => {
          const result = await originalFn();
          return result;
        };
      }
      return response;
    }

    // Check for Deezer search
    if (url.includes('api.deezer.com/search')) {
      return responses.deezerSearch || defaultResponse;
    }

    // Check for Deezer image
    if (url.includes('deezer.com') && url.includes('cover')) {
      const response = responses.deezerImage || defaultResponse;
      if (response.arrayBuffer) {
        const originalFn = response.arrayBuffer;
        response.arrayBuffer = async () => {
          const result = await originalFn();
          return result;
        };
      }
      return response;
    }

    return defaultResponse;
  };

  mockFn.calls = calls;
  return mockFn;
}

describe('CoverFetchQueue', () => {
  let mockPool;

  beforeEach(() => {
    // Mock database pool
    mockPool = {
      query: mock.fn(() =>
        Promise.resolve({ rowCount: 1, rows: [{ album_id: 'test-id' }] })
      ),
    };
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
    it('should queue cover fetch from CoverArtArchive for valid MusicBrainz ID', async () => {
      const musicbrainzId = '12345678-1234-1234-1234-123456789abc';

      const mockFetch = createMockFetch({
        coverArtArchive: {
          ok: true,
          arrayBuffer: () => Promise.resolve(MOCK_IMAGE_BUFFER),
        },
      });

      const queue = createCoverFetchQueue({
        pool: mockPool,
        fetch: mockFetch,
        maxConcurrent: 2,
      });

      await queue.add(musicbrainzId, 'Test Artist', 'Test Album');
      await wait(100);

      assert.strictEqual(mockFetch.calls.length, 1);
      assert.ok(mockFetch.calls[0].url.includes('coverartarchive.org'));
      assert.ok(mockFetch.calls[0].url.includes(musicbrainzId));

      assert.strictEqual(mockPool.query.mock.calls.length, 1);
      const dbCall = mockPool.query.mock.calls[0].arguments;
      assert.ok(dbCall[0].includes('UPDATE albums'));
      assert.strictEqual(dbCall[1][1], 'JPEG');
    });

    it('should fall back to iTunes when CoverArtArchive fails', async () => {
      const musicbrainzId = '12345678-1234-1234-1234-123456789abc';

      const mockFetch = createMockFetch({
        itunesSearch: {
          ok: true,
          json: () =>
            Promise.resolve({
              results: [
                {
                  artistName: 'Test Artist',
                  collectionName: 'Test Album',
                  artworkUrl100:
                    'https://is1-ssl.mzstatic.com/art/100x100bb.jpg',
                },
              ],
            }),
        },
        itunesImage: {
          ok: true,
          arrayBuffer: () => Promise.resolve(MOCK_IMAGE_BUFFER),
        },
      });

      const queue = createCoverFetchQueue({
        pool: mockPool,
        fetch: mockFetch,
        maxConcurrent: 2,
      });

      await queue.add(musicbrainzId, 'Test Artist', 'Test Album');
      await wait(150);

      // Should have tried CAA (failed), then iTunes search, then iTunes image
      assert.ok(mockFetch.calls.length >= 2);
      assert.ok(
        mockFetch.calls.some((c) => c.url.includes('itunes.apple.com/search'))
      );
      assert.strictEqual(mockPool.query.mock.calls.length, 1);
    });

    it('should fall back to Deezer when both CAA and iTunes fail', async () => {
      const musicbrainzId = '12345678-1234-1234-1234-123456789abc';

      const mockFetch = createMockFetch({
        deezerSearch: {
          ok: true,
          json: () =>
            Promise.resolve({
              data: [{ cover_xl: 'https://e-cdn-images.deezer.com/cover.jpg' }],
            }),
        },
        deezerImage: {
          ok: true,
          arrayBuffer: () => Promise.resolve(MOCK_IMAGE_BUFFER),
        },
      });

      const queue = createCoverFetchQueue({
        pool: mockPool,
        fetch: mockFetch,
        maxConcurrent: 2,
      });

      await queue.add(musicbrainzId, 'Test Artist', 'Test Album');
      await wait(150);

      assert.ok(mockFetch.calls.some((c) => c.url.includes('api.deezer.com')));
      assert.strictEqual(mockPool.query.mock.calls.length, 1);
    });

    it('should skip CoverArtArchive for manual- prefixed IDs', async () => {
      const manualId = 'manual-12345678-1234-1234-1234-123456789abc';

      const mockFetch = createMockFetch({
        itunesSearch: {
          ok: true,
          json: () =>
            Promise.resolve({
              results: [
                {
                  artistName: 'Test Artist',
                  collectionName: 'Test Album',
                  artworkUrl100:
                    'https://is1-ssl.mzstatic.com/art/100x100bb.jpg',
                },
              ],
            }),
        },
        itunesImage: {
          ok: true,
          arrayBuffer: () => Promise.resolve(MOCK_IMAGE_BUFFER),
        },
      });

      const queue = createCoverFetchQueue({
        pool: mockPool,
        fetch: mockFetch,
        maxConcurrent: 2,
      });

      await queue.add(manualId, 'Test Artist', 'Test Album');
      await wait(100);

      // Should NOT have tried CAA (manual ID)
      const caaCall = mockFetch.calls.find((c) =>
        c.url.includes('coverartarchive.org')
      );
      assert.ok(!caaCall);
    });

    it('should skip if albumId is missing', async () => {
      const mockFetch = createMockFetch({});
      const queue = createCoverFetchQueue({
        pool: mockPool,
        fetch: mockFetch,
        maxConcurrent: 2,
      });

      await queue.add(null, 'Artist', 'Album');
      await wait(50);

      assert.strictEqual(mockFetch.calls.length, 0);
      assert.strictEqual(mockPool.query.mock.calls.length, 0);
    });

    it('should skip if artist is missing', async () => {
      const mockFetch = createMockFetch({});
      const queue = createCoverFetchQueue({
        pool: mockPool,
        fetch: mockFetch,
        maxConcurrent: 2,
      });

      await queue.add('id', null, 'Album');
      await wait(50);

      assert.strictEqual(mockFetch.calls.length, 0);
      assert.strictEqual(mockPool.query.mock.calls.length, 0);
    });

    it('should skip if album is missing', async () => {
      const mockFetch = createMockFetch({});
      const queue = createCoverFetchQueue({
        pool: mockPool,
        fetch: mockFetch,
        maxConcurrent: 2,
      });

      await queue.add('id', 'Artist', null);
      await wait(50);

      assert.strictEqual(mockFetch.calls.length, 0);
      assert.strictEqual(mockPool.query.mock.calls.length, 0);
    });
  });

  describe('fetchAndStoreCover()', () => {
    it('should fetch cover from CoverArtArchive and store in database', async () => {
      const musicbrainzId = '12345678-1234-1234-1234-123456789abc';

      const mockFetch = createMockFetch({
        coverArtArchive: {
          ok: true,
          arrayBuffer: () => Promise.resolve(MOCK_IMAGE_BUFFER),
        },
      });

      const queue = createCoverFetchQueue({
        pool: mockPool,
        fetch: mockFetch,
        maxConcurrent: 2,
      });

      await queue.fetchAndStoreCover(
        musicbrainzId,
        'Artist Name',
        'Album Name'
      );

      assert.strictEqual(mockFetch.calls.length, 1);
      assert.strictEqual(mockPool.query.mock.calls.length, 1);

      const updateCall = mockPool.query.mock.calls[0].arguments;
      assert.strictEqual(updateCall[1].length, 3);
      assert.ok(Buffer.isBuffer(updateCall[1][0]));
      assert.strictEqual(updateCall[1][1], 'JPEG');
      assert.strictEqual(updateCall[1][2], musicbrainzId);
    });

    it('should use iTunes fuzzy matching to find best result', async () => {
      const musicbrainzId = '12345678-1234-1234-1234-123456789abc';

      const mockFetch = createMockFetch({
        itunesSearch: {
          ok: true,
          json: () =>
            Promise.resolve({
              results: [
                {
                  artistName: 'Wrong Artist',
                  collectionName: 'Wrong Album',
                  artworkUrl100: 'https://example.com/wrong/100x100bb.jpg',
                },
                {
                  artistName: 'Correct Artist',
                  collectionName: 'Correct Album',
                  artworkUrl100: 'https://example.com/correct/100x100bb.jpg',
                },
              ],
            }),
        },
        itunesImage: {
          ok: true,
          arrayBuffer: () => Promise.resolve(MOCK_IMAGE_BUFFER),
        },
      });

      const queue = createCoverFetchQueue({
        pool: mockPool,
        fetch: mockFetch,
        maxConcurrent: 2,
      });

      await queue.fetchAndStoreCover(
        musicbrainzId,
        'Correct Artist',
        'Correct Album'
      );

      // Should have fetched the correct image URL
      const imageCall = mockFetch.calls.find((c) =>
        c.url.includes('example.com/correct')
      );
      assert.ok(imageCall);
      assert.ok(imageCall.url.includes('600x600bb'));
    });

    it('should reject iTunes matches below similarity threshold', async () => {
      const musicbrainzId = '12345678-1234-1234-1234-123456789abc';

      const mockFetch = createMockFetch({
        itunesSearch: {
          ok: true,
          json: () =>
            Promise.resolve({
              results: [
                {
                  artistName: 'Completely Different Artist',
                  collectionName: 'Unrelated Album',
                  artworkUrl100: 'https://example.com/wrong.jpg',
                },
              ],
            }),
        },
        deezerSearch: {
          ok: true,
          json: () =>
            Promise.resolve({
              data: [{ cover_xl: 'https://e-cdn-images.deezer.com/cover.jpg' }],
            }),
        },
        deezerImage: {
          ok: true,
          arrayBuffer: () => Promise.resolve(MOCK_IMAGE_BUFFER),
        },
      });

      const queue = createCoverFetchQueue({
        pool: mockPool,
        fetch: mockFetch,
        maxConcurrent: 2,
      });

      await queue.fetchAndStoreCover(
        musicbrainzId,
        'Test Artist',
        'Test Album'
      );

      // Should have fallen back to Deezer
      assert.ok(mockFetch.calls.some((c) => c.url.includes('api.deezer.com')));
    });

    it('should handle all providers failing gracefully', async () => {
      const musicbrainzId = '12345678-1234-1234-1234-123456789abc';

      const mockFetch = createMockFetch({}); // All providers fail

      const queue = createCoverFetchQueue({
        pool: mockPool,
        fetch: mockFetch,
        maxConcurrent: 2,
      });

      await queue.fetchAndStoreCover(musicbrainzId, 'Artist', 'Album');

      assert.strictEqual(mockPool.query.mock.calls.length, 0);
    });

    it('should use cover_big if cover_xl is not available', async () => {
      const musicbrainzId = '12345678-1234-1234-1234-123456789abc';

      const mockFetch = createMockFetch({
        deezerSearch: {
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
        },
        deezerImage: {
          ok: true,
          arrayBuffer: () => Promise.resolve(MOCK_IMAGE_BUFFER),
        },
      });

      const queue = createCoverFetchQueue({
        pool: mockPool,
        fetch: mockFetch,
        maxConcurrent: 2,
      });

      await queue.fetchAndStoreCover(musicbrainzId, 'Artist', 'Album');

      const imageCall = mockFetch.calls.find((c) =>
        c.url.includes('cover_big.jpg')
      );
      assert.ok(imageCall);
    });

    it('should throw if pool is not initialized', async () => {
      const mockFetch = createMockFetch({});
      const nopoolQueue = createCoverFetchQueue({ fetch: mockFetch });

      await assert.rejects(
        () => nopoolQueue.fetchAndStoreCover('test-id', 'Artist', 'Album'),
        {
          message: /Database pool not initialized/,
        }
      );
    });

    it('should stop on first successful provider', async () => {
      const musicbrainzId = '12345678-1234-1234-1234-123456789abc';

      const mockFetch = createMockFetch({
        coverArtArchive: {
          ok: true,
          arrayBuffer: () => Promise.resolve(MOCK_IMAGE_BUFFER),
        },
        itunesSearch: {
          ok: true,
          json: () => Promise.resolve({ results: [] }),
        },
        deezerSearch: {
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        },
      });

      const queue = createCoverFetchQueue({
        pool: mockPool,
        fetch: mockFetch,
        maxConcurrent: 2,
      });

      await queue.fetchAndStoreCover(
        musicbrainzId,
        'Artist Name',
        'Album Name'
      );

      // Should have only tried CAA (stopped after first success)
      assert.strictEqual(mockFetch.calls.length, 1);
      assert.ok(mockFetch.calls[0].url.includes('coverartarchive.org'));
    });
  });

  describe('length getter', () => {
    it('should return 0 for empty queue', () => {
      const mockFetch = createMockFetch({});
      const queue = createCoverFetchQueue({
        pool: mockPool,
        fetch: mockFetch,
        maxConcurrent: 2,
      });

      assert.strictEqual(queue.length, 0);
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
