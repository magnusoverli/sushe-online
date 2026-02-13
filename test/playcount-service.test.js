/**
 * Tests for Playcount Service
 *
 * Uses createPlaycountService(deps) factory to inject a mock
 * refreshAlbumPlaycount function, avoiding real Last.fm API calls.
 */

const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const { createMockLogger, createMockPool } = require('./helpers');
const { createPlaycountService } = require('../services/playcount-service');

// Helper to create a mock album object
function createAlbum(id, artist = 'Artist', album = 'Album') {
  return { itemId: id, artist, album, albumId: `album-${id}` };
}

describe('playcount-service', () => {
  describe('refreshPlaycountsInBackground', () => {
    it('should return results for all albums', async () => {
      const mockLogger = createMockLogger();
      const mockPool = createMockPool();
      const mockRefresh = mock.fn(async () => ({
        playcount: 42,
        status: 'success',
      }));

      const { refreshPlaycountsInBackground } = createPlaycountService({
        refreshAlbumPlaycount: mockRefresh,
      });

      const albums = [createAlbum('1'), createAlbum('2')];
      const results = await refreshPlaycountsInBackground(
        'user1',
        'lastfm_user',
        albums,
        mockPool,
        mockLogger
      );

      assert.strictEqual(Object.keys(results).length, 2);
      assert.deepStrictEqual(results['1'], {
        playcount: 42,
        status: 'success',
      });
      assert.deepStrictEqual(results['2'], {
        playcount: 42,
        status: 'success',
      });
    });

    it('should call refreshAlbumPlaycount for each album', async () => {
      const mockLogger = createMockLogger();
      const mockPool = createMockPool();
      const mockRefresh = mock.fn(async () => ({
        playcount: 10,
        status: 'success',
      }));

      const { refreshPlaycountsInBackground } = createPlaycountService({
        refreshAlbumPlaycount: mockRefresh,
      });

      const albums = [createAlbum('a'), createAlbum('b'), createAlbum('c')];
      await refreshPlaycountsInBackground(
        'user1',
        'lastfm_user',
        albums,
        mockPool,
        mockLogger
      );

      assert.strictEqual(mockRefresh.mock.calls.length, 3);
    });

    it('should pass correct arguments to refreshAlbumPlaycount', async () => {
      const mockLogger = createMockLogger();
      const mockPool = createMockPool();
      const mockRefresh = mock.fn(async () => ({
        playcount: 5,
        status: 'success',
      }));

      const { refreshPlaycountsInBackground } = createPlaycountService({
        refreshAlbumPlaycount: mockRefresh,
      });

      const album = createAlbum('x', 'Radiohead', 'OK Computer');
      await refreshPlaycountsInBackground(
        'user42',
        'lfm_user',
        [album],
        mockPool,
        mockLogger
      );

      const callArgs = mockRefresh.mock.calls[0].arguments;
      assert.strictEqual(callArgs[0], mockPool);
      assert.strictEqual(callArgs[1], mockLogger);
      assert.strictEqual(callArgs[2], 'user42');
      assert.strictEqual(callArgs[3], 'lfm_user');
      assert.deepStrictEqual(callArgs[4], album);
    });

    it('should handle null results from refreshAlbumPlaycount', async () => {
      const mockLogger = createMockLogger();
      const mockPool = createMockPool();
      const mockRefresh = mock.fn(async () => null);

      const { refreshPlaycountsInBackground } = createPlaycountService({
        refreshAlbumPlaycount: mockRefresh,
      });

      const albums = [createAlbum('1')];
      const results = await refreshPlaycountsInBackground(
        'user1',
        'lastfm_user',
        albums,
        mockPool,
        mockLogger
      );

      assert.strictEqual(results['1'], null);
    });

    it('should handle not_found status', async () => {
      const mockLogger = createMockLogger();
      const mockPool = createMockPool();
      const mockRefresh = mock.fn(async () => ({
        playcount: 0,
        status: 'not_found',
      }));

      const { refreshPlaycountsInBackground } = createPlaycountService({
        refreshAlbumPlaycount: mockRefresh,
      });

      const albums = [createAlbum('1')];
      const results = await refreshPlaycountsInBackground(
        'user1',
        'lastfm_user',
        albums,
        mockPool,
        mockLogger
      );

      assert.deepStrictEqual(results['1'], {
        playcount: 0,
        status: 'not_found',
      });
    });

    it('should handle mixed results (success, not_found, null)', async () => {
      const mockLogger = createMockLogger();
      const mockPool = createMockPool();
      let callCount = 0;
      const mockRefresh = mock.fn(async () => {
        callCount++;
        if (callCount === 1) return { playcount: 42, status: 'success' };
        if (callCount === 2) return { playcount: 0, status: 'not_found' };
        return null;
      });

      const { refreshPlaycountsInBackground } = createPlaycountService({
        refreshAlbumPlaycount: mockRefresh,
      });

      const albums = [createAlbum('1'), createAlbum('2'), createAlbum('3')];
      const results = await refreshPlaycountsInBackground(
        'user1',
        'lastfm_user',
        albums,
        mockPool,
        mockLogger
      );

      assert.deepStrictEqual(results['1'], {
        playcount: 42,
        status: 'success',
      });
      assert.deepStrictEqual(results['2'], {
        playcount: 0,
        status: 'not_found',
      });
      assert.strictEqual(results['3'], null);
    });

    it('should log completion summary with correct counts', async () => {
      const mockLogger = createMockLogger();
      const mockPool = createMockPool();
      let callCount = 0;
      const mockRefresh = mock.fn(async () => {
        callCount++;
        if (callCount <= 2) return { playcount: 10, status: 'success' };
        if (callCount === 3) return { playcount: 0, status: 'not_found' };
        return null; // counts as failed
      });

      const { refreshPlaycountsInBackground } = createPlaycountService({
        refreshAlbumPlaycount: mockRefresh,
      });

      const albums = [
        createAlbum('1'),
        createAlbum('2'),
        createAlbum('3'),
        createAlbum('4'),
      ];
      await refreshPlaycountsInBackground(
        'user1',
        'lastfm_user',
        albums,
        mockPool,
        mockLogger
      );

      // Find the completion log call
      const infoCalls = mockLogger.info.mock.calls;
      assert.ok(infoCalls.length >= 1);
      const lastInfoCall = infoCalls[infoCalls.length - 1].arguments;
      assert.strictEqual(
        lastInfoCall[0],
        'Background playcount refresh completed'
      );
      assert.strictEqual(lastInfoCall[1].total, 4);
      assert.strictEqual(lastInfoCall[1].successful, 2);
      assert.strictEqual(lastInfoCall[1].notFound, 1);
      assert.strictEqual(lastInfoCall[1].failed, 1);
    });

    it('should log debug for each album fetch', async () => {
      const mockLogger = createMockLogger();
      const mockPool = createMockPool();
      const mockRefresh = mock.fn(async () => ({
        playcount: 5,
        status: 'success',
      }));

      const { refreshPlaycountsInBackground } = createPlaycountService({
        refreshAlbumPlaycount: mockRefresh,
      });

      const albums = [
        createAlbum('1', 'Radiohead', 'OK Computer'),
        createAlbum('2', 'Bjork', 'Homogenic'),
      ];
      await refreshPlaycountsInBackground(
        'user1',
        'lfm',
        albums,
        mockPool,
        mockLogger
      );

      // Should have debug calls for fetching + fetched playcount for each album
      const debugCalls = mockLogger.debug.mock.calls;
      assert.ok(debugCalls.length >= 4); // 2 "Fetching" + 2 "Fetched"
    });

    it('should return empty object for empty albums array', async () => {
      const mockLogger = createMockLogger();
      const mockPool = createMockPool();
      const mockRefresh = mock.fn(async () => ({
        playcount: 0,
        status: 'success',
      }));

      const { refreshPlaycountsInBackground } = createPlaycountService({
        refreshAlbumPlaycount: mockRefresh,
      });

      const results = await refreshPlaycountsInBackground(
        'user1',
        'lastfm_user',
        [],
        mockPool,
        mockLogger
      );

      assert.deepStrictEqual(results, {});
      assert.strictEqual(mockRefresh.mock.calls.length, 0);
    });

    it('should process albums in batches of 5', async () => {
      const mockLogger = createMockLogger();
      const mockPool = createMockPool();
      const callOrder = [];
      const mockRefresh = mock.fn(
        async (_pool, _logger, _userId, _lfm, album) => {
          callOrder.push(album.itemId);
          return { playcount: 1, status: 'success' };
        }
      );

      const { refreshPlaycountsInBackground } = createPlaycountService({
        refreshAlbumPlaycount: mockRefresh,
      });

      // Create 7 albums — should be processed in batches of 5 + 2
      const albums = Array.from({ length: 7 }, (_, i) =>
        createAlbum(String(i))
      );
      await refreshPlaycountsInBackground(
        'user1',
        'lastfm_user',
        albums,
        mockPool,
        mockLogger
      );

      assert.strictEqual(mockRefresh.mock.calls.length, 7);
      // All 7 albums should be in the results
      assert.strictEqual(callOrder.length, 7);
    });
  });
});
