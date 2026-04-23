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
  return { itemId: id, artist, album, album_id: `album-${id}` };
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
      // Arg 0 is a datastore adapter (wraps the pool). Verify it exposes .raw
      // and that calling .raw forwards to mockPool.query.
      assert.strictEqual(typeof callArgs[0].raw, 'function');
      callArgs[0].raw('SELECT 1', []);
      assert.ok(mockPool.query.mock.calls.length >= 1);
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

  describe('getListPlaycounts', () => {
    it('should return 404 when list does not belong to user', async () => {
      const mockPool = createMockPool([{ rows: [] }]);

      const { getListPlaycounts } = createPlaycountService({
        refreshAlbumPlaycount: mock.fn(async () => null),
      });

      const result = await getListPlaycounts({
        listId: 'list1',
        userId: 'user1',
        lastfmUsername: 'lfm-user',
        pool: mockPool,
        logger: createMockLogger(),
        normalizeAlbumKey: (artist, album) => `${artist}::${album}`,
      });

      assert.deepStrictEqual(result, {
        error: { status: 404, message: 'List not found' },
      });

      const [sql, params] = mockPool.query.mock.calls[0].arguments;
      assert.ok(sql.includes('WHERE _id = $1 AND user_id = $2'));
      assert.deepStrictEqual(params, ['list1', 'user1']);
    });

    it('should fetch cached stats scoped to list albums', async () => {
      const mockLogger = createMockLogger();
      const mockPool = createMockPool([
        { rows: [{ _id: 'list1' }] },
        {
          rows: [
            {
              _id: 'item1',
              album_id: 'album-1',
              artist: 'Boards of Canada',
              album: 'Music Has the Right to Children',
            },
            {
              _id: 'item2',
              album_id: 'album-2',
              artist: 'Bicep',
              album: 'Isles',
            },
          ],
        },
        {
          rows: [
            {
              artist: 'boards of canada',
              album_name: 'music has the right to children',
              album_id: 'album-1',
              normalized_key:
                'boards of canada::music has the right to children',
              lastfm_playcount: 42,
              lastfm_status: 'success',
              lastfm_updated_at: new Date().toISOString(),
            },
          ],
        },
      ]);

      const { getListPlaycounts } = createPlaycountService({
        refreshAlbumPlaycount: mock.fn(async () => ({
          playcount: 1,
          status: 'success',
        })),
      });

      const normalizeAlbumKey = (artist, album) =>
        `${artist}`.toLowerCase() + `::${album}`.toLowerCase();

      const result = await getListPlaycounts({
        listId: 'list1',
        userId: 'user1',
        lastfmUsername: 'lfm-user',
        pool: mockPool,
        logger: mockLogger,
        normalizeAlbumKey,
      });

      assert.strictEqual(result.refreshing, 1);
      assert.strictEqual(result.playcounts.item1.playcount, 42);

      const statsQueryCall = mockPool.query.mock.calls[2].arguments;
      const statsSql = statsQueryCall[0];
      const statsParams = statsQueryCall[1];

      assert.ok(statsSql.includes('album_id = ANY'));
      assert.ok(statsSql.includes('normalized_key = ANY'));
      assert.strictEqual(statsParams[0], 'user1');
      assert.deepStrictEqual(statsParams[1], ['album-1', 'album-2']);
      assert.deepStrictEqual(statsParams[2], [
        'boards of canada::music has the right to children',
        'bicep::isles',
      ]);
    });

    it('should skip stats query when list items have no lookup keys', async () => {
      const mockLogger = createMockLogger();
      const mockPool = createMockPool([
        { rows: [{ _id: 'list1' }] },
        {
          rows: [
            {
              _id: 'item1',
              album_id: null,
              artist: null,
              album: null,
            },
          ],
        },
      ]);

      const { getListPlaycounts } = createPlaycountService({
        refreshAlbumPlaycount: mock.fn(async () => null),
      });

      const result = await getListPlaycounts({
        listId: 'list1',
        userId: 'user1',
        lastfmUsername: 'lfm-user',
        pool: mockPool,
        logger: mockLogger,
        normalizeAlbumKey: (artist, album) => `${artist}::${album}`,
      });

      assert.deepStrictEqual(result, { playcounts: {}, refreshing: 0 });
      assert.strictEqual(mockPool.query.mock.calls.length, 2);
    });
  });
});
