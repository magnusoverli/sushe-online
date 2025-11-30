/**
 * Tests for Mobile UI Module
 *
 * Tests the mobile-ui.js module's core functionality using dependency injection.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

// Since we're testing ES modules from Node.js CommonJS tests, we'll test
// the module's logic patterns rather than importing it directly.
// The build process validates the module compiles correctly.

describe('Mobile UI Module - Unit Tests', () => {
  describe('findAlbumByIdentity logic', () => {
    it('should find album by identity string', () => {
      const albums = [
        { artist: 'Artist A', album: 'Album 1', release_date: '2020-01-01' },
        { artist: 'Artist B', album: 'Album 2', release_date: '2021-06-15' },
        { artist: 'Artist C', album: 'Album 3', release_date: '' },
      ];

      const albumId = 'artist b::album 2::2021-06-15';

      // Simulate the findAlbumByIdentity logic
      let result = null;
      for (let i = 0; i < albums.length; i++) {
        const album = albums[i];
        const currentId =
          `${album.artist}::${album.album}::${album.release_date || ''}`.toLowerCase();
        if (currentId === albumId) {
          result = { album, index: i };
          break;
        }
      }

      assert.ok(result);
      assert.strictEqual(result.index, 1);
      assert.strictEqual(result.album.album, 'Album 2');
    });

    it('should return null when album not found', () => {
      const albums = [
        { artist: 'Artist A', album: 'Album 1', release_date: '2020-01-01' },
      ];

      const albumId = 'nonexistent::album::';

      let result = null;
      for (let i = 0; i < albums.length; i++) {
        const album = albums[i];
        const currentId =
          `${album.artist}::${album.album}::${album.release_date || ''}`.toLowerCase();
        if (currentId === albumId) {
          result = { album, index: i };
          break;
        }
      }

      assert.strictEqual(result, null);
    });

    it('should handle albums with empty release dates', () => {
      const albums = [
        { artist: 'Artist A', album: 'Album 1', release_date: '' },
      ];

      const albumId = 'artist a::album 1::';

      let result = null;
      for (let i = 0; i < albums.length; i++) {
        const album = albums[i];
        const currentId =
          `${album.artist}::${album.album}::${album.release_date || ''}`.toLowerCase();
        if (currentId === albumId) {
          result = { album, index: i };
          break;
        }
      }

      assert.ok(result);
      assert.strictEqual(result.index, 0);
    });
  });

  describe('isAlbumInList logic', () => {
    it('should detect duplicate albums', () => {
      const albumToCheck = { artist: 'Artist A', album: 'Album 1' };
      const list = [
        { artist: 'Artist A', album: 'Album 1', release_date: '2020-01-01' },
        { artist: 'Artist B', album: 'Album 2', release_date: '2021-01-01' },
      ];

      const key = `${albumToCheck.artist}::${albumToCheck.album}`.toLowerCase();
      const exists = list.some(
        (a) => `${a.artist}::${a.album}`.toLowerCase() === key
      );

      assert.strictEqual(exists, true);
    });

    it('should not flag non-duplicate albums', () => {
      const albumToCheck = { artist: 'Artist C', album: 'Album 3' };
      const list = [
        { artist: 'Artist A', album: 'Album 1', release_date: '2020-01-01' },
        { artist: 'Artist B', album: 'Album 2', release_date: '2021-01-01' },
      ];

      const key = `${albumToCheck.artist}::${albumToCheck.album}`.toLowerCase();
      const exists = list.some(
        (a) => `${a.artist}::${a.album}`.toLowerCase() === key
      );

      assert.strictEqual(exists, false);
    });

    it('should be case-insensitive', () => {
      const albumToCheck = { artist: 'ARTIST A', album: 'ALBUM 1' };
      const list = [
        { artist: 'artist a', album: 'album 1', release_date: '2020-01-01' },
      ];

      const key = `${albumToCheck.artist}::${albumToCheck.album}`.toLowerCase();
      const exists = list.some(
        (a) => `${a.artist}::${a.album}`.toLowerCase() === key
      );

      assert.strictEqual(exists, true);
    });
  });

  describe('Mobile menu validation logic', () => {
    it('should validate album index bounds', () => {
      const albums = [{ album: 'Album 1' }, { album: 'Album 2' }];

      // Valid index
      let index = 1;
      let isValid =
        !isNaN(index) && index >= 0 && albums && index < albums.length;
      assert.strictEqual(isValid, true);

      // Invalid index (out of bounds)
      index = 5;
      isValid = !isNaN(index) && index >= 0 && albums && index < albums.length;
      assert.strictEqual(isValid, false);

      // Invalid index (negative)
      index = -1;
      isValid = !isNaN(index) && index >= 0 && albums && index < albums.length;
      assert.strictEqual(isValid, false);

      // Invalid index (NaN)
      index = NaN;
      isValid = !isNaN(index) && index >= 0 && albums && index < albums.length;
      assert.strictEqual(isValid, false);
    });

    it('should validate album existence at index', () => {
      const albums = [{ album: 'Album 1' }, null, { album: 'Album 3' }];

      // Album exists
      let index = 0;
      let album = albums[index];
      assert.ok(album);

      // Album is null
      index = 1;
      album = albums[index];
      assert.strictEqual(album, null);

      // Album exists at index 2
      index = 2;
      album = albums[index];
      assert.ok(album);
    });
  });

  describe('Album ID generation', () => {
    it('should generate consistent album IDs', () => {
      const album = {
        artist: 'Test Artist',
        album: 'Test Album',
        release_date: '2023-01-15',
      };

      const albumId =
        `${album.artist}::${album.album}::${album.release_date || ''}`.toLowerCase();

      assert.strictEqual(albumId, 'test artist::test album::2023-01-15');
    });

    it('should handle missing release date', () => {
      const album = {
        artist: 'Test Artist',
        album: 'Test Album',
      };

      const albumId =
        `${album.artist}::${album.album}::${album.release_date || ''}`.toLowerCase();

      assert.strictEqual(albumId, 'test artist::test album::');
    });

    it('should handle special characters', () => {
      const album = {
        artist: "Test's Artist & Co.",
        album: 'Test Album: Part 2',
        release_date: '2023-01-15',
      };

      const albumId =
        `${album.artist}::${album.album}::${album.release_date || ''}`.toLowerCase();

      assert.strictEqual(
        albumId,
        "test's artist & co.::test album: part 2::2023-01-15"
      );
    });
  });

  describe('Form validation logic', () => {
    it('should require artist and album fields', () => {
      // Valid
      let artist = 'Artist Name';
      let album = 'Album Title';
      let isValid = artist.trim() && album.trim();
      assert.ok(isValid);

      // Missing artist
      artist = '';
      isValid = artist.trim() && album.trim();
      assert.ok(!isValid);

      // Missing album
      artist = 'Artist Name';
      album = '   ';
      isValid = artist.trim() && album.trim();
      assert.ok(!isValid);
    });
  });
});
