/**
 * Tests for album-identity.js utility module
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

// Dynamic import for ESM module
let createAlbumIdentity, verifyAlbumAtIndex;

describe('album-identity', async () => {
  // Load the ESM module before running tests
  const mod = await import('../src/js/utils/album-identity.js');
  createAlbumIdentity = mod.createAlbumIdentity;
  verifyAlbumAtIndex = mod.verifyAlbumAtIndex;

  describe('createAlbumIdentity', () => {
    it('should create identity string from album object', () => {
      const album = {
        artist: 'Radiohead',
        album: 'OK Computer',
        release_date: '1997-06-16',
      };
      assert.strictEqual(
        createAlbumIdentity(album),
        'radiohead::ok computer::1997-06-16'
      );
    });

    it('should handle missing release_date', () => {
      const album = { artist: 'Radiohead', album: 'OK Computer' };
      assert.strictEqual(
        createAlbumIdentity(album),
        'radiohead::ok computer::'
      );
    });

    it('should handle empty release_date', () => {
      const album = {
        artist: 'Radiohead',
        album: 'OK Computer',
        release_date: '',
      };
      assert.strictEqual(
        createAlbumIdentity(album),
        'radiohead::ok computer::'
      );
    });

    it('should lowercase the identity string', () => {
      const album = {
        artist: 'RADIOHEAD',
        album: 'OK COMPUTER',
        release_date: '1997',
      };
      assert.strictEqual(
        createAlbumIdentity(album),
        'radiohead::ok computer::1997'
      );
    });
  });

  describe('verifyAlbumAtIndex', () => {
    const albums = [
      { artist: 'Radiohead', album: 'OK Computer', release_date: '1997' },
      { artist: 'Bjork', album: 'Homogenic', release_date: '1997' },
      { artist: 'Portishead', album: 'Third', release_date: '2008' },
    ];

    const mockFindByIdentity = (id) => {
      for (let i = 0; i < albums.length; i++) {
        if (createAlbumIdentity(albums[i]) === id) {
          return { album: albums[i], index: i };
        }
      }
      return null;
    };

    it('should return album at correct index when identity matches', () => {
      const expectedId = 'radiohead::ok computer::1997';
      const result = verifyAlbumAtIndex(
        albums,
        0,
        expectedId,
        mockFindByIdentity
      );
      assert.deepStrictEqual(result, { album: albums[0], index: 0 });
    });

    it('should search by identity when index is stale', () => {
      // Album was at index 0, but we say index 2 (wrong)
      const expectedId = 'radiohead::ok computer::1997';
      const result = verifyAlbumAtIndex(
        albums,
        2,
        expectedId,
        mockFindByIdentity
      );
      assert.deepStrictEqual(result, { album: albums[0], index: 0 });
    });

    it('should return null when album not found by identity', () => {
      const expectedId = 'nonexistent::album::2000';
      const result = verifyAlbumAtIndex(
        albums,
        0,
        expectedId,
        mockFindByIdentity
      );
      assert.strictEqual(result, null);
    });

    it('should return null when albums array is null', () => {
      const result = verifyAlbumAtIndex(
        null,
        0,
        'some::id::',
        mockFindByIdentity
      );
      assert.strictEqual(result, null);
    });

    it('should return null when index out of bounds and no identity', () => {
      const result = verifyAlbumAtIndex(albums, 99, null, mockFindByIdentity);
      assert.strictEqual(result, null);
    });

    it('should return album at index when no identity to verify', () => {
      const result = verifyAlbumAtIndex(albums, 1, null, mockFindByIdentity);
      assert.deepStrictEqual(result, { album: albums[1], index: 1 });
    });

    it('should try identity search when index out of bounds but identity provided', () => {
      const expectedId = 'bjork::homogenic::1997';
      const result = verifyAlbumAtIndex(
        albums,
        99,
        expectedId,
        mockFindByIdentity
      );
      assert.deepStrictEqual(result, { album: albums[1], index: 1 });
    });
  });
});
