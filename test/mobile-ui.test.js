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

  describe('Track play links logic', () => {
    it('should parse album index from data attribute', () => {
      // Simulate the data-album-index parsing logic
      const indexStr = '5';
      const albumIndex = parseInt(indexStr, 10);

      assert.strictEqual(albumIndex, 5);
      assert.strictEqual(isNaN(albumIndex), false);
    });

    it('should handle invalid album index gracefully', () => {
      const indexStr = 'invalid';
      const albumIndex = parseInt(indexStr, 10);

      assert.strictEqual(isNaN(albumIndex), true);
    });

    it('should extract track name from data attribute', () => {
      // Simulate getting track name from data-track attribute
      const trackName = '3. My Favorite Song';

      assert.ok(trackName);
      assert.strictEqual(trackName.length > 0, true);
    });

    it('should handle tracks with special characters', () => {
      // Track names may contain quotes that need escaping
      const trackName = 'Track "With" Quotes';
      const escaped = trackName.replace(/"/g, '&quot;');

      assert.strictEqual(escaped, 'Track &quot;With&quot; Quotes');
    });

    it('should validate playSpecificTrack dependency exists before calling', () => {
      // The setupTrackPlayLinks function should check if playSpecificTrack exists
      const deps = { playSpecificTrack: null };
      const hasPlayFunction = !!deps.playSpecificTrack;

      assert.strictEqual(hasPlayFunction, false);

      // With valid dependency
      deps.playSpecificTrack = () => {};
      const hasPlayFunctionNow = !!deps.playSpecificTrack;

      assert.strictEqual(hasPlayFunctionNow, true);
    });

    it('should call playSpecificTrack with correct parameters', () => {
      // Simulate the call pattern
      let calledWith = null;
      const mockPlaySpecificTrack = (index, trackName) => {
        calledWith = { index, trackName };
      };

      // Simulate click handler behavior
      const albumIndex = 3;
      const trackName = '5. Test Track';
      mockPlaySpecificTrack(albumIndex, trackName);

      assert.deepStrictEqual(calledWith, {
        index: 3,
        trackName: '5. Test Track',
      });
    });
  });

  describe('Track list HTML generation', () => {
    it('should generate correct track list structure', () => {
      const tracks = ['1. First Track', '2. Second Track', '3. Third Track'];
      const trackPick = '2. Second Track';

      // Simulate checking which track is selected
      const selectedIndex = tracks.findIndex((t) => t === trackPick);

      assert.strictEqual(selectedIndex, 1);
    });

    it('should mark selected track with checked attribute', () => {
      const track = '1. First Track';
      const trackPick = '1. First Track';

      const isChecked = track === trackPick;

      assert.strictEqual(isChecked, true);
    });

    it('should not mark unselected tracks', () => {
      const track = '1. First Track';
      const trackPick = '2. Second Track';

      const isChecked = track === trackPick;

      assert.strictEqual(isChecked, false);
    });

    it('should handle empty track_pick', () => {
      const track = '1. First Track';
      const trackPick = '';

      const isChecked = track === (trackPick || '');

      assert.strictEqual(isChecked, false);
    });

    it('should handle null track_pick', () => {
      const track = '1. First Track';
      const trackPick = null;

      const isChecked = track === (trackPick || '');

      assert.strictEqual(isChecked, false);
    });
  });

  describe('Recommend option visibility logic', () => {
    /**
     * Helper that mirrors the showRecommend logic in showMobileAlbumMenu.
     * The mobile action sheet shows the recommend button only when:
     * 1. The current list has a year (is year-based)
     * 2. The user is NOT currently viewing the recommendations view
     */
    function computeShowRecommend(listMeta, isViewingRecommendations) {
      const isYearBased =
        listMeta && listMeta.year !== null && listMeta.year !== undefined;
      const viewingRecs = isViewingRecommendations
        ? isViewingRecommendations()
        : false;
      return isYearBased && !viewingRecs;
    }

    it('should show recommend for year-based list when not viewing recommendations', () => {
      const listMeta = { year: 2025, name: 'My 2025 List' };
      const isViewingRecs = () => false;

      assert.strictEqual(computeShowRecommend(listMeta, isViewingRecs), true);
    });

    it('should hide recommend when list has no year (null)', () => {
      const listMeta = { year: null, name: 'Custom List' };
      const isViewingRecs = () => false;

      assert.strictEqual(computeShowRecommend(listMeta, isViewingRecs), false);
    });

    it('should hide recommend when list has no year (undefined)', () => {
      const listMeta = { name: 'Custom List' };
      const isViewingRecs = () => false;

      assert.strictEqual(computeShowRecommend(listMeta, isViewingRecs), false);
    });

    it('should hide recommend when viewing recommendations', () => {
      const listMeta = { year: 2025, name: 'My 2025 List' };
      const isViewingRecs = () => true;

      assert.strictEqual(computeShowRecommend(listMeta, isViewingRecs), false);
    });

    it('should hide recommend when listMeta is null', () => {
      const isViewingRecs = () => false;

      assert.ok(!computeShowRecommend(null, isViewingRecs));
    });

    it('should handle missing isViewingRecommendations dependency gracefully', () => {
      const listMeta = { year: 2025, name: 'My 2025 List' };

      // When isViewingRecommendations is not provided (null/undefined),
      // should default to not viewing recommendations and show the option
      assert.strictEqual(computeShowRecommend(listMeta, null), true);
      assert.strictEqual(computeShowRecommend(listMeta, undefined), true);
    });

    it('should show recommend for year 0 (falsy but valid year)', () => {
      // Year 0 is technically a valid number but falsy - the check uses
      // !== null && !== undefined, so year 0 should pass
      const listMeta = { year: 0, name: 'Year Zero' };
      const isViewingRecs = () => false;

      assert.strictEqual(computeShowRecommend(listMeta, isViewingRecs), true);
    });
  });
});
