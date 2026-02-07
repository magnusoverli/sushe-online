/**
 * Tests for album-transfer.js module
 *
 * Tests the shared transferAlbumToList function for both move and copy modes.
 */

const { describe, it, mock, beforeEach } = require('node:test');
const assert = require('node:assert');

describe('album-transfer module', () => {
  let transferAlbumToList;

  beforeEach(async () => {
    const module = await import('../src/js/modules/album-transfer.js');
    transferAlbumToList = module.transferAlbumToList;
  });

  it('should export transferAlbumToList function', () => {
    assert.strictEqual(typeof transferAlbumToList, 'function');
  });

  describe('move mode', () => {
    it('should throw error for invalid source list', async () => {
      const deps = {
        getCurrentList: mock.fn(() => 'source'),
        getLists: mock.fn(() => ({})),
        getListData: mock.fn(() => null),
        showToast: mock.fn(),
        findAlbumByIdentity: mock.fn(),
      };

      await assert.rejects(
        () =>
          transferAlbumToList(deps, {
            index: 0,
            albumId: 'artist::album::',
            targetListId: 'target',
            mode: 'move',
          }),
        { message: 'Invalid source or target list' }
      );
    });

    it('should throw error when source list data not loaded', async () => {
      const deps = {
        getCurrentList: mock.fn(() => 'source'),
        getLists: mock.fn(() => ({ source: {}, target: {} })),
        getListData: mock.fn(() => null),
        showToast: mock.fn(),
        findAlbumByIdentity: mock.fn(),
      };

      await assert.rejects(
        () =>
          transferAlbumToList(deps, {
            index: 0,
            albumId: 'artist::album::',
            targetListId: 'target',
            mode: 'move',
          }),
        { message: 'Source list data not loaded' }
      );
    });

    it('should throw error when album not found at index', async () => {
      const deps = {
        getCurrentList: mock.fn(() => 'source'),
        getLists: mock.fn(() => ({ source: {}, target: {} })),
        getListData: mock.fn(() => []),
        showToast: mock.fn(),
        findAlbumByIdentity: mock.fn(),
      };

      await assert.rejects(
        () =>
          transferAlbumToList(deps, {
            index: 0,
            albumId: 'artist::album::',
            targetListId: 'target',
            mode: 'move',
          }),
        { message: 'Album not found' }
      );
    });

    it('should remove album from source and add to target', async () => {
      const sourceAlbums = [
        { artist: 'Artist A', album: 'Album 1', release_date: '2020-01-01' },
        { artist: 'Artist B', album: 'Album 2', release_date: '2021-01-01' },
      ];
      const targetAlbums = [];

      const deps = {
        getCurrentList: mock.fn(() => 'source'),
        getLists: mock.fn(() => ({ source: {}, target: {} })),
        getListData: mock.fn((id) => {
          if (id === 'source') return sourceAlbums;
          if (id === 'target') return targetAlbums;
          return null;
        }),
        getListMetadata: mock.fn(() => ({ name: 'Target List' })),
        saveList: mock.fn(() => Promise.resolve()),
        selectList: mock.fn(),
        showToast: mock.fn(),
        apiCall: mock.fn(),
        findAlbumByIdentity: mock.fn(),
      };

      await transferAlbumToList(deps, {
        index: 0,
        albumId: 'artist a::album 1::2020-01-01',
        targetListId: 'target',
        mode: 'move',
      });

      // Source should have album removed
      assert.strictEqual(sourceAlbums.length, 1);
      assert.strictEqual(sourceAlbums[0].artist, 'Artist B');

      // Target should have album added
      assert.strictEqual(targetAlbums.length, 1);
      assert.strictEqual(targetAlbums[0].artist, 'Artist A');

      // Both lists should be saved
      assert.strictEqual(deps.saveList.mock.calls.length, 2);

      // Toast should show "Moved"
      assert.strictEqual(deps.showToast.mock.calls.length, 1);
      assert.ok(deps.showToast.mock.calls[0].arguments[0].includes('Moved'));
    });

    it('should show error toast if album already exists in target', async () => {
      const sourceAlbums = [
        { artist: 'Artist A', album: 'Album 1', release_date: '2020-01-01' },
      ];
      const targetAlbums = [
        { artist: 'Artist A', album: 'Album 1', release_date: '2020-01-01' },
      ];

      const deps = {
        getCurrentList: mock.fn(() => 'source'),
        getLists: mock.fn(() => ({ source: {}, target: {} })),
        getListData: mock.fn((id) => {
          if (id === 'source') return sourceAlbums;
          if (id === 'target') return targetAlbums;
          return null;
        }),
        getListMetadata: mock.fn(() => ({ name: 'Target List' })),
        saveList: mock.fn(() => Promise.resolve()),
        selectList: mock.fn(),
        showToast: mock.fn(),
        apiCall: mock.fn(),
        findAlbumByIdentity: mock.fn(),
      };

      await transferAlbumToList(deps, {
        index: 0,
        albumId: 'artist a::album 1::2020-01-01',
        targetListId: 'target',
        mode: 'move',
      });

      // Source should NOT have album removed (operation aborted)
      assert.strictEqual(sourceAlbums.length, 1);

      // Toast should show error
      assert.strictEqual(deps.showToast.mock.calls.length, 1);
      assert.strictEqual(deps.showToast.mock.calls[0].arguments[1], 'error');
      assert.ok(
        deps.showToast.mock.calls[0].arguments[0].includes('already exists')
      );

      // Save should not be called
      assert.strictEqual(deps.saveList.mock.calls.length, 0);
    });

    it('should rollback on save failure', async () => {
      const sourceAlbums = [
        { artist: 'Artist A', album: 'Album 1', release_date: '2020-01-01' },
      ];
      const targetAlbums = [];

      const deps = {
        getCurrentList: mock.fn(() => 'source'),
        getLists: mock.fn(() => ({ source: {}, target: {} })),
        getListData: mock.fn((id) => {
          if (id === 'source') return sourceAlbums;
          if (id === 'target') return targetAlbums;
          return null;
        }),
        getListMetadata: mock.fn(() => ({ name: 'Target List' })),
        saveList: mock.fn(() => Promise.reject(new Error('Save failed'))),
        selectList: mock.fn(),
        showToast: mock.fn(),
        apiCall: mock.fn(),
        findAlbumByIdentity: mock.fn(),
      };

      await assert.rejects(
        () =>
          transferAlbumToList(deps, {
            index: 0,
            albumId: 'artist a::album 1::2020-01-01',
            targetListId: 'target',
            mode: 'move',
          }),
        { message: 'Save failed' }
      );

      // Source should have album restored (rollback)
      assert.strictEqual(sourceAlbums.length, 1);
      assert.strictEqual(sourceAlbums[0].artist, 'Artist A');

      // Target should have album removed (rollback)
      assert.strictEqual(targetAlbums.length, 0);
    });
  });

  describe('copy mode', () => {
    it('should keep album in source and add to target', async () => {
      const sourceAlbums = [
        { artist: 'Artist A', album: 'Album 1', release_date: '2020-01-01' },
        { artist: 'Artist B', album: 'Album 2', release_date: '2021-01-01' },
      ];
      const targetAlbums = [];

      const deps = {
        getCurrentList: mock.fn(() => 'source'),
        getLists: mock.fn(() => ({ source: {}, target: {} })),
        getListData: mock.fn((id) => {
          if (id === 'source') return sourceAlbums;
          if (id === 'target') return targetAlbums;
          return null;
        }),
        getListMetadata: mock.fn(() => ({ name: 'Target List' })),
        saveList: mock.fn(() => Promise.resolve()),
        selectList: mock.fn(),
        showToast: mock.fn(),
        apiCall: mock.fn(),
        findAlbumByIdentity: mock.fn(),
      };

      await transferAlbumToList(deps, {
        index: 0,
        albumId: 'artist a::album 1::2020-01-01',
        targetListId: 'target',
        mode: 'copy',
      });

      // Source should still have both albums (not removed)
      assert.strictEqual(sourceAlbums.length, 2);
      assert.strictEqual(sourceAlbums[0].artist, 'Artist A');

      // Target should have the copied album
      assert.strictEqual(targetAlbums.length, 1);
      assert.strictEqual(targetAlbums[0].artist, 'Artist A');

      // Only target list should be saved (not source)
      assert.strictEqual(deps.saveList.mock.calls.length, 1);
      assert.strictEqual(deps.saveList.mock.calls[0].arguments[0], 'target');

      // Toast should show "Copied"
      assert.strictEqual(deps.showToast.mock.calls.length, 1);
      assert.ok(deps.showToast.mock.calls[0].arguments[0].includes('Copied'));
    });

    it('should show error toast if album already exists in target', async () => {
      const sourceAlbums = [
        { artist: 'Artist A', album: 'Album 1', release_date: '2020-01-01' },
      ];
      const targetAlbums = [
        { artist: 'Artist A', album: 'Album 1', release_date: '2020-01-01' },
      ];

      const deps = {
        getCurrentList: mock.fn(() => 'source'),
        getLists: mock.fn(() => ({ source: {}, target: {} })),
        getListData: mock.fn((id) => {
          if (id === 'source') return sourceAlbums;
          if (id === 'target') return targetAlbums;
          return null;
        }),
        getListMetadata: mock.fn(() => ({ name: 'Target List' })),
        saveList: mock.fn(() => Promise.resolve()),
        selectList: mock.fn(),
        showToast: mock.fn(),
        apiCall: mock.fn(),
        findAlbumByIdentity: mock.fn(),
      };

      await transferAlbumToList(deps, {
        index: 0,
        albumId: 'artist a::album 1::2020-01-01',
        targetListId: 'target',
        mode: 'copy',
      });

      // Toast should show error
      assert.strictEqual(deps.showToast.mock.calls.length, 1);
      assert.strictEqual(deps.showToast.mock.calls[0].arguments[1], 'error');

      // Save should not be called
      assert.strictEqual(deps.saveList.mock.calls.length, 0);
    });

    it('should rollback target on save failure', async () => {
      const sourceAlbums = [
        { artist: 'Artist A', album: 'Album 1', release_date: '2020-01-01' },
      ];
      const targetAlbums = [];

      const deps = {
        getCurrentList: mock.fn(() => 'source'),
        getLists: mock.fn(() => ({ source: {}, target: {} })),
        getListData: mock.fn((id) => {
          if (id === 'source') return sourceAlbums;
          if (id === 'target') return targetAlbums;
          return null;
        }),
        getListMetadata: mock.fn(() => ({ name: 'Target List' })),
        saveList: mock.fn(() => Promise.reject(new Error('Save failed'))),
        selectList: mock.fn(),
        showToast: mock.fn(),
        apiCall: mock.fn(),
        findAlbumByIdentity: mock.fn(),
      };

      await assert.rejects(
        () =>
          transferAlbumToList(deps, {
            index: 0,
            albumId: 'artist a::album 1::2020-01-01',
            targetListId: 'target',
            mode: 'copy',
          }),
        { message: 'Save failed' }
      );

      // Source should be unchanged (copy doesn't modify source)
      assert.strictEqual(sourceAlbums.length, 1);

      // Target should have album removed (rollback)
      assert.strictEqual(targetAlbums.length, 0);
    });

    it('should use fallback identity lookup when index mismatch', async () => {
      const sourceAlbums = [
        { artist: 'Artist B', album: 'Album 2', release_date: '2021-01-01' },
        { artist: 'Artist A', album: 'Album 1', release_date: '2020-01-01' },
      ];
      const targetAlbums = [];

      const deps = {
        getCurrentList: mock.fn(() => 'source'),
        getLists: mock.fn(() => ({ source: {}, target: {} })),
        getListData: mock.fn((id) => {
          if (id === 'source') return sourceAlbums;
          if (id === 'target') return targetAlbums;
          return null;
        }),
        getListMetadata: mock.fn(() => ({ name: 'Target List' })),
        saveList: mock.fn(() => Promise.resolve()),
        selectList: mock.fn(),
        showToast: mock.fn(),
        apiCall: mock.fn(),
        findAlbumByIdentity: mock.fn(() => ({
          album: sourceAlbums[1],
          index: 1,
        })),
      };

      // Pass index 0 but albumId for album at index 1 (stale index)
      await transferAlbumToList(deps, {
        index: 0,
        albumId: 'artist a::album 1::2020-01-01',
        targetListId: 'target',
        mode: 'copy',
      });

      // Should have used findAlbumByIdentity fallback
      assert.strictEqual(deps.findAlbumByIdentity.mock.calls.length, 1);

      // Target should have the correct album
      assert.strictEqual(targetAlbums.length, 1);
      assert.strictEqual(targetAlbums[0].artist, 'Artist A');
    });

    it('should fetch target list via API if not cached', async () => {
      const sourceAlbums = [
        { artist: 'Artist A', album: 'Album 1', release_date: '2020-01-01' },
      ];
      const fetchedTargetAlbums = [];

      const deps = {
        getCurrentList: mock.fn(() => 'source'),
        getLists: mock.fn(() => ({ source: {}, target: {} })),
        getListData: mock.fn((id) => {
          if (id === 'source') return sourceAlbums;
          if (id === 'target') return null; // Not cached
          return null;
        }),
        setListData: mock.fn(),
        getListMetadata: mock.fn(() => ({ name: 'Target List' })),
        saveList: mock.fn(() => Promise.resolve()),
        selectList: mock.fn(),
        showToast: mock.fn(),
        apiCall: mock.fn(() => Promise.resolve(fetchedTargetAlbums)),
        findAlbumByIdentity: mock.fn(),
      };

      await transferAlbumToList(deps, {
        index: 0,
        albumId: 'artist a::album 1::2020-01-01',
        targetListId: 'target',
        mode: 'copy',
      });

      // Should have called apiCall to fetch target list
      assert.strictEqual(deps.apiCall.mock.calls.length, 1);
      assert.ok(
        deps.apiCall.mock.calls[0].arguments[0].includes('/api/lists/target')
      );

      // Should have called setListData to cache the fetched list
      assert.strictEqual(deps.setListData.mock.calls.length, 1);
    });
  });
});
