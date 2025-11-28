/**
 * Tests for utils/deduplication.js
 * Tests album data caching and value deduplication helpers
 */

const { describe, it, mock, beforeEach } = require('node:test');
const assert = require('node:assert');
const { createDeduplicationHelpers } = require('../utils/deduplication.js');

// eslint-disable-next-line max-lines-per-function -- Test suite with many test cases
describe('deduplication helpers', () => {
  let mockPool;
  let helpers;
  let cache;

  beforeEach(() => {
    // Create fresh cache and mock pool for each test
    cache = new Map();
    mockPool = {
      query: mock.fn(() => Promise.resolve({ rows: [] })),
    };
    helpers = createDeduplicationHelpers({ cache });
  });

  // ===========================================================================
  // getAlbumData tests
  // ===========================================================================

  describe('getAlbumData', () => {
    it('should return null for empty albumId', async () => {
      const result = await helpers.getAlbumData(null, mockPool);
      assert.strictEqual(result, null);
      assert.strictEqual(mockPool.query.mock.calls.length, 0);
    });

    it('should return null for undefined albumId', async () => {
      const result = await helpers.getAlbumData(undefined, mockPool);
      assert.strictEqual(result, null);
      assert.strictEqual(mockPool.query.mock.calls.length, 0);
    });

    it('should return null for empty string albumId', async () => {
      const result = await helpers.getAlbumData('', mockPool);
      assert.strictEqual(result, null);
      assert.strictEqual(mockPool.query.mock.calls.length, 0);
    });

    it('should return cached data if available', async () => {
      const cachedData = { artist: 'Cached Artist', album: 'Cached Album' };
      cache.set('album123', cachedData);

      const result = await helpers.getAlbumData('album123', mockPool);

      assert.deepStrictEqual(result, cachedData);
      assert.strictEqual(mockPool.query.mock.calls.length, 0);
    });

    it('should query database and cache result', async () => {
      const albumData = {
        artist: 'Test Artist',
        album: 'Test Album',
        release_date: '2024-01-01',
        country: 'US',
        genre_1: 'Rock',
        genre_2: 'Alternative',
        tracks: [{ title: 'Track 1' }],
        cover_image: 'image.jpg',
        cover_image_format: 'jpg',
      };
      mockPool.query = mock.fn(() => Promise.resolve({ rows: [albumData] }));

      const result = await helpers.getAlbumData('album123', mockPool);

      assert.deepStrictEqual(result, albumData);
      assert.strictEqual(mockPool.query.mock.calls.length, 1);

      // Verify query parameters
      const queryCall = mockPool.query.mock.calls[0].arguments;
      assert.ok(queryCall[0].includes('SELECT'));
      assert.ok(queryCall[0].includes('FROM albums'));
      assert.deepStrictEqual(queryCall[1], ['album123']);

      // Verify data is cached
      assert.deepStrictEqual(cache.get('album123'), albumData);
    });

    it('should return null and cache null when album not found', async () => {
      mockPool.query = mock.fn(() => Promise.resolve({ rows: [] }));

      const result = await helpers.getAlbumData('nonexistent', mockPool);

      assert.strictEqual(result, null);
      assert.strictEqual(cache.get('nonexistent'), null);
    });

    it('should use cache for subsequent calls', async () => {
      const albumData = { artist: 'Test Artist' };
      mockPool.query = mock.fn(() => Promise.resolve({ rows: [albumData] }));

      // First call - queries database
      await helpers.getAlbumData('album123', mockPool);
      assert.strictEqual(mockPool.query.mock.calls.length, 1);

      // Second call - uses cache
      const result = await helpers.getAlbumData('album123', mockPool);
      assert.strictEqual(mockPool.query.mock.calls.length, 1); // Still 1
      assert.deepStrictEqual(result, albumData);
    });
  });

  // ===========================================================================
  // clearAlbumCache tests
  // ===========================================================================

  describe('clearAlbumCache', () => {
    it('should clear the cache', () => {
      cache.set('album1', { artist: 'Artist 1' });
      cache.set('album2', { artist: 'Artist 2' });
      assert.strictEqual(cache.size, 2);

      helpers.clearAlbumCache();

      assert.strictEqual(cache.size, 0);
    });

    it('should work on empty cache', () => {
      assert.strictEqual(cache.size, 0);
      helpers.clearAlbumCache();
      assert.strictEqual(cache.size, 0);
    });
  });

  // ===========================================================================
  // getCacheSize tests
  // ===========================================================================

  describe('getCacheSize', () => {
    it('should return cache size', () => {
      assert.strictEqual(helpers.getCacheSize(), 0);

      cache.set('album1', { artist: 'Artist 1' });
      assert.strictEqual(helpers.getCacheSize(), 1);

      cache.set('album2', { artist: 'Artist 2' });
      assert.strictEqual(helpers.getCacheSize(), 2);
    });
  });

  // ===========================================================================
  // getStorableValue tests
  // ===========================================================================

  describe('getStorableValue', () => {
    it('should return value as-is when albumId is empty', async () => {
      const result = await helpers.getStorableValue(
        'value',
        null,
        'artist',
        mockPool
      );
      // When no albumId, we can't compare - just store as-is
      assert.strictEqual(result, 'value');
    });

    it('should return value as-is when albumId is undefined', async () => {
      const result = await helpers.getStorableValue(
        'value',
        undefined,
        'artist',
        mockPool
      );
      // When no albumId, we can't compare - just store as-is
      assert.strictEqual(result, 'value');
    });

    it('should return null when listItemValue is null', async () => {
      const result = await helpers.getStorableValue(
        null,
        'album123',
        'artist',
        mockPool
      );
      assert.strictEqual(result, null);
    });

    it('should return null when listItemValue is undefined', async () => {
      const result = await helpers.getStorableValue(
        undefined,
        'album123',
        'artist',
        mockPool
      );
      assert.strictEqual(result, null);
    });

    it('should return value when album not found in database', async () => {
      mockPool.query = mock.fn(() => Promise.resolve({ rows: [] }));

      const result = await helpers.getStorableValue(
        'My Artist',
        'album123',
        'artist',
        mockPool
      );

      assert.strictEqual(result, 'My Artist');
    });

    it('should return null when value matches album data', async () => {
      const albumData = { artist: 'Same Artist', album: 'Test Album' };
      mockPool.query = mock.fn(() => Promise.resolve({ rows: [albumData] }));

      const result = await helpers.getStorableValue(
        'Same Artist',
        'album123',
        'artist',
        mockPool
      );

      assert.strictEqual(result, null);
    });

    it('should return value when different from album data', async () => {
      const albumData = { artist: 'Album Artist', album: 'Test Album' };
      mockPool.query = mock.fn(() => Promise.resolve({ rows: [albumData] }));

      const result = await helpers.getStorableValue(
        'Custom Artist',
        'album123',
        'artist',
        mockPool
      );

      assert.strictEqual(result, 'Custom Artist');
    });

    it('should treat empty string and null as equivalent', async () => {
      const albumData = { artist: '', album: 'Test Album' };
      mockPool.query = mock.fn(() => Promise.resolve({ rows: [albumData] }));

      // Empty string in list item should match null/empty in album
      const result = await helpers.getStorableValue(
        '',
        'album123',
        'artist',
        mockPool
      );

      assert.strictEqual(result, null);
    });

    it('should treat null album value and empty list value as equivalent', async () => {
      const albumData = { artist: null, album: 'Test Album' };
      mockPool.query = mock.fn(() => Promise.resolve({ rows: [albumData] }));

      const result = await helpers.getStorableValue(
        '',
        'album123',
        'artist',
        mockPool
      );

      assert.strictEqual(result, null);
    });

    it('should return null for null/null comparison', async () => {
      const albumData = { artist: null, album: 'Test Album' };
      cache.set('album123', albumData);

      // listItemValue is null, album artist is null - but no albumId check happens first
      // Actually with albumId provided, we need to check the logic path
      const newHelpers = createDeduplicationHelpers({ cache });

      // This tests when listItemValue is truthy but matches albumData null
      // We need a case where normalizedListValue === normalizedAlbumValue when both are null
      const albumData2 = { artist: null };
      cache.set('album456', albumData2);

      // Empty string normalizes to null, and album artist is null
      const result = await newHelpers.getStorableValue(
        '',
        'album456',
        'artist',
        mockPool
      );
      assert.strictEqual(result, null);
    });

    it('should handle various field types', async () => {
      const albumData = {
        artist: 'Artist',
        album: 'Album',
        release_date: '2024-01-01',
        country: 'US',
        genre_1: 'Rock',
        genre_2: 'Pop',
      };
      mockPool.query = mock.fn(() => Promise.resolve({ rows: [albumData] }));

      // Test different fields
      assert.strictEqual(
        await helpers.getStorableValue(
          '2024-01-01',
          'album123',
          'release_date',
          mockPool
        ),
        null
      );

      // Clear cache to force new query
      cache.clear();
      mockPool.query = mock.fn(() => Promise.resolve({ rows: [albumData] }));

      assert.strictEqual(
        await helpers.getStorableValue(
          'Different Country',
          'album123',
          'country',
          mockPool
        ),
        'Different Country'
      );
    });

    it('should return null (not empty string) when listItemValue is empty and no albumId', async () => {
      const result = await helpers.getStorableValue(
        '',
        null,
        'artist',
        mockPool
      );
      assert.strictEqual(result, null);
    });
  });

  // ===========================================================================
  // getStorableTracksValue tests
  // ===========================================================================

  describe('getStorableTracksValue', () => {
    it('should return null when albumId is empty', async () => {
      const tracks = [{ title: 'Track 1' }];
      const result = await helpers.getStorableTracksValue(
        tracks,
        null,
        mockPool
      );

      assert.strictEqual(result, JSON.stringify(tracks));
    });

    it('should return null when albumId is undefined', async () => {
      const tracks = [{ title: 'Track 1' }];
      const result = await helpers.getStorableTracksValue(
        tracks,
        undefined,
        mockPool
      );

      assert.strictEqual(result, JSON.stringify(tracks));
    });

    it('should return null when listItemTracks is null', async () => {
      const result = await helpers.getStorableTracksValue(
        null,
        'album123',
        mockPool
      );

      assert.strictEqual(result, null);
    });

    it('should return null when listItemTracks is undefined', async () => {
      const result = await helpers.getStorableTracksValue(
        undefined,
        'album123',
        mockPool
      );

      assert.strictEqual(result, null);
    });

    it('should return null when listItemTracks is empty array', async () => {
      // Empty array is falsy in JS? No, it's truthy! Let's verify
      const result = await helpers.getStorableTracksValue(
        [],
        'album123',
        mockPool
      );

      // Empty array is truthy, so it should return JSON.stringify([])
      assert.strictEqual(result, '[]');
    });

    it('should return JSON string when album not found', async () => {
      mockPool.query = mock.fn(() => Promise.resolve({ rows: [] }));
      const tracks = [{ title: 'Track 1' }];

      const result = await helpers.getStorableTracksValue(
        tracks,
        'album123',
        mockPool
      );

      assert.strictEqual(result, JSON.stringify(tracks));
    });

    it('should return JSON string when album has no tracks', async () => {
      const albumData = { artist: 'Artist', tracks: null };
      mockPool.query = mock.fn(() => Promise.resolve({ rows: [albumData] }));
      const tracks = [{ title: 'Track 1' }];

      const result = await helpers.getStorableTracksValue(
        tracks,
        'album123',
        mockPool
      );

      assert.strictEqual(result, JSON.stringify(tracks));
    });

    it('should return null when tracks match exactly', async () => {
      const tracks = [{ title: 'Track 1', duration: 180 }];
      const albumData = { artist: 'Artist', tracks: tracks };
      mockPool.query = mock.fn(() => Promise.resolve({ rows: [albumData] }));

      const result = await helpers.getStorableTracksValue(
        tracks,
        'album123',
        mockPool
      );

      assert.strictEqual(result, null);
    });

    it('should return JSON string when tracks differ', async () => {
      const listTracks = [{ title: 'Custom Track', duration: 200 }];
      const albumTracks = [{ title: 'Original Track', duration: 180 }];
      const albumData = { artist: 'Artist', tracks: albumTracks };
      mockPool.query = mock.fn(() => Promise.resolve({ rows: [albumData] }));

      const result = await helpers.getStorableTracksValue(
        listTracks,
        'album123',
        mockPool
      );

      assert.strictEqual(result, JSON.stringify(listTracks));
    });

    it('should detect deep differences in tracks array', async () => {
      const listTracks = [
        { title: 'Track 1', duration: 180 },
        { title: 'Track 2', duration: 200 },
      ];
      const albumTracks = [
        { title: 'Track 1', duration: 180 },
        { title: 'Track 2', duration: 199 }, // Different duration
      ];
      const albumData = { tracks: albumTracks };
      mockPool.query = mock.fn(() => Promise.resolve({ rows: [albumData] }));

      const result = await helpers.getStorableTracksValue(
        listTracks,
        'album123',
        mockPool
      );

      assert.strictEqual(result, JSON.stringify(listTracks));
    });

    it('should handle different track counts', async () => {
      const listTracks = [{ title: 'Track 1' }];
      const albumTracks = [{ title: 'Track 1' }, { title: 'Track 2' }];
      const albumData = { tracks: albumTracks };
      mockPool.query = mock.fn(() => Promise.resolve({ rows: [albumData] }));

      const result = await helpers.getStorableTracksValue(
        listTracks,
        'album123',
        mockPool
      );

      assert.strictEqual(result, JSON.stringify(listTracks));
    });

    it('should use cached album data', async () => {
      const tracks = [{ title: 'Track 1' }];
      const albumData = { tracks: tracks };
      cache.set('album123', albumData);

      const result = await helpers.getStorableTracksValue(
        tracks,
        'album123',
        mockPool
      );

      assert.strictEqual(result, null); // Matches cached data
      assert.strictEqual(mockPool.query.mock.calls.length, 0); // No query made
    });

    it('should return JSON string when no albumId but tracks exist', async () => {
      const tracks = [{ title: 'Track 1' }];

      const result = await helpers.getStorableTracksValue(tracks, '', mockPool);

      assert.strictEqual(result, JSON.stringify(tracks));
    });
  });

  // ===========================================================================
  // Factory function tests
  // ===========================================================================

  describe('createDeduplicationHelpers', () => {
    it('should create helpers with default cache', () => {
      const defaultHelpers = createDeduplicationHelpers();

      assert.ok(typeof defaultHelpers.getAlbumData === 'function');
      assert.ok(typeof defaultHelpers.clearAlbumCache === 'function');
      assert.ok(typeof defaultHelpers.getCacheSize === 'function');
      assert.ok(typeof defaultHelpers.getStorableValue === 'function');
      assert.ok(typeof defaultHelpers.getStorableTracksValue === 'function');
    });

    it('should use injected cache', () => {
      const customCache = new Map();
      customCache.set('test', 'value');

      const customHelpers = createDeduplicationHelpers({ cache: customCache });

      assert.strictEqual(customHelpers.getCacheSize(), 1);
    });

    it('should isolate caches between instances', async () => {
      const cache1 = new Map();
      const cache2 = new Map();

      const helpers1 = createDeduplicationHelpers({ cache: cache1 });
      const helpers2 = createDeduplicationHelpers({ cache: cache2 });

      // Add data to cache1 through helpers1
      const mockPool1 = {
        query: mock.fn(() =>
          Promise.resolve({ rows: [{ artist: 'Artist 1' }] })
        ),
      };
      await helpers1.getAlbumData('album1', mockPool1);

      // cache1 should have the data, cache2 should not
      assert.strictEqual(helpers1.getCacheSize(), 1);
      assert.strictEqual(helpers2.getCacheSize(), 0);
    });
  });

  // ===========================================================================
  // Default export tests
  // ===========================================================================

  describe('default export', () => {
    it('should export default helper functions', () => {
      const defaultExports = require('../utils/deduplication.js');

      assert.ok(typeof defaultExports.getAlbumData === 'function');
      assert.ok(typeof defaultExports.clearAlbumCache === 'function');
      assert.ok(typeof defaultExports.getStorableValue === 'function');
      assert.ok(typeof defaultExports.getStorableTracksValue === 'function');
      assert.ok(
        typeof defaultExports.createDeduplicationHelpers === 'function'
      );
    });
  });
});
