/**
 * Tests for utils/track-fetch-queue.js
 * Tests track fetch queue functionality
 */

const { describe, it, mock, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  createTrackFetchQueue,
  initializeTrackFetchQueue,
  getTrackFetchQueue,
} = require('../utils/track-fetch-queue.js');

// Local wait helper for async operations
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Creates a mock fetch function that returns different responses based on URL patterns
 * This approach works with Node.js test runner (no mockImplementationOnce needed)
 */
function createMockFetch(responses = {}) {
  return async (url) => {
    // Default response
    const defaultResponse = {
      ok: true,
      json: () => Promise.resolve({ data: [], results: [] }),
    };

    // Check for Deezer search
    if (url.includes('api.deezer.com/search/album')) {
      return responses.deezerSearch || defaultResponse;
    }

    // Check for Deezer album details
    if (url.includes('api.deezer.com/album/')) {
      return responses.deezerAlbum || defaultResponse;
    }

    // Check for iTunes search
    if (url.includes('itunes.apple.com/search')) {
      return responses.itunesSearch || defaultResponse;
    }

    // Check for iTunes lookup
    if (url.includes('itunes.apple.com/lookup')) {
      return responses.itunesLookup || defaultResponse;
    }

    return defaultResponse;
  };
}

describe('TrackFetchQueue', () => {
  let mockPool;
  let mockLogger;

  beforeEach(() => {
    // Mock database pool
    mockPool = {
      query: mock.fn(() =>
        Promise.resolve({ rowCount: 1, rows: [{ album_id: 'test-id' }] })
      ),
    };

    // Mock logger
    mockLogger = {
      debug: mock.fn(),
      info: mock.fn(),
      warn: mock.fn(),
      error: mock.fn(),
    };
  });

  describe('createTrackFetchQueue', () => {
    it('should create queue with default maxConcurrent of 2', () => {
      const defaultQueue = createTrackFetchQueue({ pool: mockPool });
      assert.ok(defaultQueue.add);
      assert.ok(defaultQueue.fetchAndStoreTracks);
    });

    it('should respect custom maxConcurrent', () => {
      const customQueue = createTrackFetchQueue({
        pool: mockPool,
        maxConcurrent: 5,
      });
      assert.ok(customQueue);
    });

    it('should expose internal fetch functions for testing', () => {
      const queue = createTrackFetchQueue({ pool: mockPool });
      assert.ok(queue.fetchItunesTracks);
      assert.ok(queue.fetchDeezerTracks);
    });
  });

  describe('add()', () => {
    it('should queue track fetch and resolve', async () => {
      const mockFetch = createMockFetch({
        deezerSearch: {
          ok: true,
          json: () => Promise.resolve({ data: [{ id: 12345 }] }),
        },
        deezerAlbum: {
          ok: true,
          json: () =>
            Promise.resolve({
              tracks: {
                data: [
                  { title: 'Track 1', duration: 180 },
                  { title: 'Track 2', duration: 240 },
                ],
              },
            }),
        },
      });

      const queue = createTrackFetchQueue({
        pool: mockPool,
        fetch: mockFetch,
        logger: mockLogger,
        maxConcurrent: 2,
      });

      await queue.add('musicbrainz-id', 'Test Artist', 'Test Album');

      // Wait for async processing
      await wait(100);

      assert.strictEqual(mockPool.query.mock.calls.length, 1);

      // Verify database update
      const dbCall = mockPool.query.mock.calls[0].arguments;
      assert.ok(dbCall[0].includes('UPDATE albums'));
      assert.ok(dbCall[0].includes('tracks'));
    });

    it('should skip if albumId is missing', async () => {
      const mockFetch = mock.fn();
      const queue = createTrackFetchQueue({
        pool: mockPool,
        fetch: mockFetch,
        logger: mockLogger,
      });

      await queue.add(null, 'Artist', 'Album');

      await wait(50);

      assert.strictEqual(mockFetch.mock.calls.length, 0);
      assert.strictEqual(mockPool.query.mock.calls.length, 0);
    });

    it('should skip if artist is missing', async () => {
      const mockFetch = mock.fn();
      const queue = createTrackFetchQueue({
        pool: mockPool,
        fetch: mockFetch,
        logger: mockLogger,
      });

      await queue.add('id', null, 'Album');

      await wait(50);

      assert.strictEqual(mockFetch.mock.calls.length, 0);
      assert.strictEqual(mockPool.query.mock.calls.length, 0);
    });

    it('should skip if album is missing', async () => {
      const mockFetch = mock.fn();
      const queue = createTrackFetchQueue({
        pool: mockPool,
        fetch: mockFetch,
        logger: mockLogger,
      });

      await queue.add('id', 'Artist', null);

      await wait(50);

      assert.strictEqual(mockFetch.mock.calls.length, 0);
      assert.strictEqual(mockPool.query.mock.calls.length, 0);
    });
  });

  describe('fetchDeezerTracks()', () => {
    it('should fetch tracks from Deezer and return result', async () => {
      const mockFetch = createMockFetch({
        deezerSearch: {
          ok: true,
          json: () => Promise.resolve({ data: [{ id: 12345 }] }),
        },
        deezerAlbum: {
          ok: true,
          json: () =>
            Promise.resolve({
              tracks: {
                data: [
                  { title: 'Song One', duration: 200 },
                  { title: 'Song Two', duration: 180 },
                  { title: 'Song Three', duration: 240 },
                ],
              },
            }),
        },
      });

      const queue = createTrackFetchQueue({
        pool: mockPool,
        fetch: mockFetch,
        logger: mockLogger,
      });

      const result = await queue.fetchDeezerTracks('Artist Name', 'Album Name');

      assert.ok(result);
      assert.strictEqual(result.source, 'deezer');
      assert.strictEqual(result.tracks.length, 3);
      assert.strictEqual(result.tracks[0].name, 'Song One');
      assert.strictEqual(result.tracks[0].length, 200000); // duration * 1000
    });

    it('should return null if Deezer search returns no results', async () => {
      const mockFetch = createMockFetch({
        deezerSearch: {
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        },
      });

      const queue = createTrackFetchQueue({
        pool: mockPool,
        fetch: mockFetch,
        logger: mockLogger,
      });

      const result = await queue.fetchDeezerTracks('Artist', 'Album');

      assert.strictEqual(result, null);
    });

    it('should return null if Deezer API fails', async () => {
      const mockFetch = createMockFetch({
        deezerSearch: {
          ok: false,
          status: 500,
        },
      });

      const queue = createTrackFetchQueue({
        pool: mockPool,
        fetch: mockFetch,
        logger: mockLogger,
      });

      const result = await queue.fetchDeezerTracks('Artist', 'Album');

      assert.strictEqual(result, null);
    });

    it('should return null if album has no tracks', async () => {
      const mockFetch = createMockFetch({
        deezerSearch: {
          ok: true,
          json: () => Promise.resolve({ data: [{ id: 12345 }] }),
        },
        deezerAlbum: {
          ok: true,
          json: () => Promise.resolve({ tracks: { data: [] } }),
        },
      });

      const queue = createTrackFetchQueue({
        pool: mockPool,
        fetch: mockFetch,
        logger: mockLogger,
      });

      const result = await queue.fetchDeezerTracks('Artist', 'Album');

      assert.strictEqual(result, null);
    });
  });

  describe('fetchItunesTracks()', () => {
    it('should fetch tracks from iTunes and return result', async () => {
      const mockFetch = createMockFetch({
        itunesSearch: {
          ok: true,
          json: () => Promise.resolve({ results: [{ collectionId: 999 }] }),
        },
        itunesLookup: {
          ok: true,
          json: () =>
            Promise.resolve({
              results: [
                { wrapperType: 'collection' },
                {
                  wrapperType: 'track',
                  trackName: 'Hit Song',
                  trackTimeMillis: 210000,
                },
                {
                  wrapperType: 'track',
                  trackName: 'B-Side',
                  trackTimeMillis: 180000,
                },
              ],
            }),
        },
      });

      const queue = createTrackFetchQueue({
        pool: mockPool,
        fetch: mockFetch,
        logger: mockLogger,
      });

      const result = await queue.fetchItunesTracks('Artist Name', 'Album Name');

      assert.ok(result);
      assert.strictEqual(result.source, 'itunes');
      assert.strictEqual(result.tracks.length, 2);
      assert.strictEqual(result.tracks[0].name, 'Hit Song');
      assert.strictEqual(result.tracks[0].length, 210000);
    });

    it('should return null if iTunes search returns no results', async () => {
      const mockFetch = createMockFetch({
        itunesSearch: {
          ok: true,
          json: () => Promise.resolve({ results: [] }),
        },
      });

      const queue = createTrackFetchQueue({
        pool: mockPool,
        fetch: mockFetch,
        logger: mockLogger,
      });

      const result = await queue.fetchItunesTracks('Artist', 'Album');

      assert.strictEqual(result, null);
    });

    it('should return null if iTunes API fails', async () => {
      const mockFetch = createMockFetch({
        itunesSearch: {
          ok: false,
          status: 503,
        },
      });

      const queue = createTrackFetchQueue({
        pool: mockPool,
        fetch: mockFetch,
        logger: mockLogger,
      });

      const result = await queue.fetchItunesTracks('Artist', 'Album');

      assert.strictEqual(result, null);
    });

    it('should return null if no collectionId in results', async () => {
      const mockFetch = createMockFetch({
        itunesSearch: {
          ok: true,
          json: () => Promise.resolve({ results: [{ artistName: 'Artist' }] }),
        },
      });

      const queue = createTrackFetchQueue({
        pool: mockPool,
        fetch: mockFetch,
        logger: mockLogger,
      });

      const result = await queue.fetchItunesTracks('Artist', 'Album');

      assert.strictEqual(result, null);
    });
  });

  describe('fetchAndStoreTracks()', () => {
    it('should fetch tracks and store in database', async () => {
      const mockFetch = createMockFetch({
        deezerSearch: {
          ok: true,
          json: () => Promise.resolve({ data: [{ id: 12345 }] }),
        },
        deezerAlbum: {
          ok: true,
          json: () =>
            Promise.resolve({
              tracks: {
                data: [
                  { title: 'Track A', duration: 200 },
                  { title: 'Track B', duration: 300 },
                ],
              },
            }),
        },
      });

      const queue = createTrackFetchQueue({
        pool: mockPool,
        fetch: mockFetch,
        logger: mockLogger,
      });

      await queue.fetchAndStoreTracks('test-id', 'Artist Name', 'Album Name');

      assert.strictEqual(mockPool.query.mock.calls.length, 1);

      // Verify database update parameters
      const updateCall = mockPool.query.mock.calls[0].arguments;
      assert.ok(updateCall[0].includes('UPDATE albums'));
      assert.ok(updateCall[0].includes('tracks'));
      assert.strictEqual(updateCall[1].length, 2); // [tracks JSON, albumId]
      assert.strictEqual(updateCall[1][1], 'test-id'); // albumId

      // Parse and verify tracks JSON
      const tracksJson = JSON.parse(updateCall[1][0]);
      assert.strictEqual(tracksJson.length, 2);
      assert.strictEqual(tracksJson[0].name, 'Track A');
      assert.strictEqual(tracksJson[0].length, 200000);
    });

    it('should handle no tracks found from any source', async () => {
      const mockFetch = createMockFetch({
        deezerSearch: {
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        },
        itunesSearch: {
          ok: true,
          json: () => Promise.resolve({ results: [] }),
        },
      });

      const queue = createTrackFetchQueue({
        pool: mockPool,
        fetch: mockFetch,
        logger: mockLogger,
      });

      await queue.fetchAndStoreTracks('test-id', 'Artist', 'Album');

      // Should not update database
      assert.strictEqual(mockPool.query.mock.calls.length, 0);
    });

    it('should throw if pool is not initialized', async () => {
      const mockFetch = mock.fn();
      const nopoolQueue = createTrackFetchQueue({ fetch: mockFetch });

      await assert.rejects(
        () => nopoolQueue.fetchAndStoreTracks('test-id', 'Artist', 'Album'),
        {
          message: /Database pool not initialized/,
        }
      );
    });

    it('should log warning if album not found in database', async () => {
      const mockFetch = createMockFetch({
        deezerSearch: {
          ok: true,
          json: () => Promise.resolve({ data: [{ id: 12345 }] }),
        },
        deezerAlbum: {
          ok: true,
          json: () =>
            Promise.resolve({
              tracks: { data: [{ title: 'Track', duration: 180 }] },
            }),
        },
      });

      // Mock database update returning 0 rows
      const mockPoolNoRows = {
        query: mock.fn(() => Promise.resolve({ rowCount: 0 })),
      };

      const queue = createTrackFetchQueue({
        pool: mockPoolNoRows,
        fetch: mockFetch,
        logger: mockLogger,
      });

      await queue.fetchAndStoreTracks('nonexistent-id', 'Artist', 'Album');

      // Should have called warn
      assert.ok(
        mockLogger.warn.mock.calls.some(
          (call) => call.arguments[0] === 'Album not found when updating tracks'
        )
      );
    });
  });

  describe('length getter', () => {
    it('should return 0 for empty queue', () => {
      const queue = createTrackFetchQueue({
        pool: mockPool,
        logger: mockLogger,
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

  describe('initializeTrackFetchQueue', () => {
    it('should initialize singleton queue', () => {
      const result = initializeTrackFetchQueue(mockPool);
      assert.ok(result);
      assert.ok(result.add);
    });

    it('should return same instance on multiple calls', () => {
      const first = initializeTrackFetchQueue(mockPool);
      const second = initializeTrackFetchQueue(mockPool);
      assert.strictEqual(first, second);
    });
  });

  describe('getTrackFetchQueue', () => {
    it('should return initialized queue', () => {
      initializeTrackFetchQueue(mockPool);
      const queue = getTrackFetchQueue();
      assert.ok(queue);
      assert.ok(queue.add);
    });
  });
});
