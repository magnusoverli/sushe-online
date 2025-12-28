/**
 * Tests for album-display.js module
 */

const { describe, it, mock, beforeEach } = require('node:test');
const assert = require('node:assert');

// Since this is a browser module, we need to mock the DOM and dependencies
// For now, we test the factory function and basic structure

describe('album-display module', () => {
  describe('createAlbumDisplay factory', () => {
    let createAlbumDisplay;

    beforeEach(async () => {
      // Dynamic import of ES module
      const module = await import('../src/js/modules/album-display.js');
      createAlbumDisplay = module.createAlbumDisplay;
    });

    it('should export createAlbumDisplay function', () => {
      assert.strictEqual(typeof createAlbumDisplay, 'function');
    });

    it('should create module with all required methods', () => {
      // Create with minimal mock dependencies
      const mockDeps = {
        getListData: mock.fn(() => []),
        getListMetadata: mock.fn(() => ({})),
        getCurrentList: mock.fn(() => 'test-list'),
        saveList: mock.fn(),
        showToast: mock.fn(),
        apiCall: mock.fn(),
        formatReleaseDate: mock.fn((d) => d),
        isYearMismatch: mock.fn(() => false),
        extractYearFromDate: mock.fn(() => 2024),
        fetchTracksForAlbum: mock.fn(),
        makeCountryEditable: mock.fn(),
        makeGenreEditable: mock.fn(),
        makeCommentEditable: mock.fn(),
        attachLinkPreview: mock.fn(),
        showTrackSelectionMenu: mock.fn(),
        showMobileEditForm: mock.fn(),
        showMobileAlbumMenu: mock.fn(),
        playTrackSafe: mock.fn(),
        reapplyNowPlayingBorder: mock.fn(),
        initializeUnifiedSorting: mock.fn(),
      };

      const module = createAlbumDisplay(mockDeps);

      // Check all public methods exist
      assert.strictEqual(typeof module.displayAlbums, 'function');
      assert.strictEqual(typeof module.fetchAndApplyCovers, 'function');
      assert.strictEqual(typeof module.updatePositionNumbers, 'function');
      assert.strictEqual(typeof module.clearLastRenderedCache, 'function');
      assert.strictEqual(typeof module.processAlbumData, 'function');
      assert.strictEqual(typeof module.createAlbumItem, 'function');
      assert.strictEqual(typeof module.detectUpdateType, 'function');
    });

    it('should handle empty dependencies gracefully', () => {
      // Should not throw when called with empty deps
      const module = createAlbumDisplay({});
      assert.ok(module);
    });
  });

  describe('processAlbumData', () => {
    let createAlbumDisplay;

    beforeEach(async () => {
      const module = await import('../src/js/modules/album-display.js');
      createAlbumDisplay = module.createAlbumDisplay;
    });

    it('should process album data correctly', () => {
      const mockDeps = {
        getListData: mock.fn(() => []),
        getListMetadata: mock.fn(() => ({ year: 2024 })),
        getCurrentList: mock.fn(() => 'test-list'),
        formatReleaseDate: mock.fn((d) => d || ''),
        isYearMismatch: mock.fn(() => false),
        extractYearFromDate: mock.fn(() => 2024),
      };

      const module = createAlbumDisplay(mockDeps);

      const album = {
        album: 'Test Album',
        artist: 'Test Artist',
        release_date: '2024-01-15',
        country: 'USA',
        genre_1: 'Rock',
        genre_2: 'Alternative',
        comments: 'Great album',
        track_pick: '1. First Track',
        tracks: ['1. First Track', '2. Second Track'],
      };

      const data = module.processAlbumData(album, 0);

      assert.strictEqual(data.position, 1);
      assert.strictEqual(data.albumName, 'Test Album');
      assert.strictEqual(data.artist, 'Test Artist');
      assert.strictEqual(data.country, 'USA');
      assert.strictEqual(data.genre1, 'Rock');
      assert.strictEqual(data.genre2, 'Alternative');
      assert.strictEqual(data.comment, 'Great album');
      assert.strictEqual(data.countryDisplay, 'USA');
      assert.strictEqual(data.genre1Display, 'Rock');
      assert.strictEqual(data.genre2Display, 'Alternative');
    });

    it('should handle missing album data with defaults', () => {
      const mockDeps = {
        getListData: mock.fn(() => []),
        getListMetadata: mock.fn(() => ({})),
        getCurrentList: mock.fn(() => 'test-list'),
        formatReleaseDate: mock.fn(() => ''),
        isYearMismatch: mock.fn(() => false),
        extractYearFromDate: mock.fn(() => null),
      };

      const module = createAlbumDisplay(mockDeps);

      const album = {};
      const data = module.processAlbumData(album, 0);

      assert.strictEqual(data.position, 1);
      assert.strictEqual(data.albumName, 'Unknown Album');
      assert.strictEqual(data.artist, 'Unknown Artist');
      assert.strictEqual(data.country, '');
      assert.strictEqual(data.countryDisplay, 'Country');
      assert.strictEqual(data.genre1Display, 'Genre 1');
      assert.strictEqual(data.genre2Display, 'Genre 2');
      assert.strictEqual(data.trackPickDisplay, 'Select Track');
    });

    it('should handle genre_2 placeholder values', () => {
      const mockDeps = {
        getListData: mock.fn(() => []),
        getListMetadata: mock.fn(() => ({})),
        getCurrentList: mock.fn(() => 'test-list'),
        formatReleaseDate: mock.fn(() => ''),
        isYearMismatch: mock.fn(() => false),
        extractYearFromDate: mock.fn(() => null),
      };

      const module = createAlbumDisplay(mockDeps);

      // Test with 'Genre 2' placeholder
      let album = { genre_2: 'Genre 2' };
      let data = module.processAlbumData(album, 0);
      assert.strictEqual(data.genre2, '');
      assert.strictEqual(data.genre2Display, 'Genre 2');

      // Test with '-' placeholder
      album = { genre_2: '-' };
      data = module.processAlbumData(album, 0);
      assert.strictEqual(data.genre2, '');
    });

    it('should format track picks correctly', () => {
      const mockDeps = {
        getListData: mock.fn(() => []),
        getListMetadata: mock.fn(() => ({})),
        getCurrentList: mock.fn(() => 'test-list'),
        formatReleaseDate: mock.fn(() => ''),
        isYearMismatch: mock.fn(() => false),
        extractYearFromDate: mock.fn(() => null),
      };

      const module = createAlbumDisplay(mockDeps);

      // Test with full track info
      let album = {
        track_pick: '3. Favorite Song',
        tracks: ['1. First', '2. Second', '3. Favorite Song'],
      };
      let data = module.processAlbumData(album, 0);
      assert.strictEqual(data.trackPickDisplay, '3. Favorite Song');
      assert.strictEqual(data.trackPickClass, 'text-gray-300');

      // Test with just track number
      album = {
        track_pick: '5',
        tracks: [],
      };
      data = module.processAlbumData(album, 0);
      assert.strictEqual(data.trackPickDisplay, 'Track 5');
    });
  });

  describe('detectUpdateType', () => {
    let createAlbumDisplay;

    beforeEach(async () => {
      const module = await import('../src/js/modules/album-display.js');
      createAlbumDisplay = module.createAlbumDisplay;
    });

    it('should return FULL_REBUILD when no previous state', () => {
      const module = createAlbumDisplay({});
      const result = module.detectUpdateType(null, [{ album: 'Test' }]);
      assert.strictEqual(result, 'FULL_REBUILD');
    });

    it('should return FULL_REBUILD when lengths differ', () => {
      const module = createAlbumDisplay({});
      const oldAlbums = [{ artist: 'A', album: '1', release_date: '' }];
      const newAlbums = [
        { artist: 'A', album: '1', release_date: '' },
        { artist: 'B', album: '2', release_date: '' },
      ];
      const result = module.detectUpdateType(oldAlbums, newAlbums);
      assert.strictEqual(result, 'FULL_REBUILD');
    });

    it('should return FIELD_UPDATE for small field changes', () => {
      const module = createAlbumDisplay({});
      const oldAlbums = [
        { artist: 'A', album: '1', release_date: '', country: 'USA' },
      ];
      const newAlbums = [
        { artist: 'A', album: '1', release_date: '', country: 'UK' },
      ];
      const result = module.detectUpdateType(oldAlbums, newAlbums);
      assert.strictEqual(result, 'FIELD_UPDATE');
    });

    it('should not track cover_image changes (handled by batch fetch)', () => {
      // Note: cover_image is intentionally NOT tracked in detectUpdateType
      // because storing it in the lightweight mutable state would be expensive.
      // Cover image changes are handled by the fetchAndApplyCovers batch pattern.
      // In practice, cover_image-only changes are also caught by the fingerprint
      // comparison at the displayAlbums level before detectUpdateType is called.
      const module = createAlbumDisplay({});
      const oldState = [
        { artist: 'A', album: '1', release_date: '' },
      ];
      const newAlbums = [
        { artist: 'A', album: '1', release_date: '', cover_image: 'new' },
      ];
      const result = module.detectUpdateType(oldState, newAlbums);
      // No tracked field changes, no position changes = falls through to HYBRID_UPDATE
      // (0 + 0 <= 15 is true, so HYBRID_UPDATE is returned)
      assert.strictEqual(result, 'HYBRID_UPDATE');
    });

    it('should return POSITION_UPDATE when only positions change', () => {
      const module = createAlbumDisplay({});
      const oldAlbums = [
        { artist: 'A', album: '1', release_date: '' },
        { artist: 'B', album: '2', release_date: '' },
      ];
      const newAlbums = [
        { artist: 'B', album: '2', release_date: '' },
        { artist: 'A', album: '1', release_date: '' },
      ];
      const result = module.detectUpdateType(oldAlbums, newAlbums);
      assert.strictEqual(result, 'POSITION_UPDATE');
    });
  });
});
