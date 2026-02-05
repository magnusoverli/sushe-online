/**
 * Tests for album-display.js module
 */

const { describe, it, mock, beforeEach } = require('node:test');
const assert = require('node:assert');
const { register } = require('node:module');
const path = require('node:path');

// Register a loader that handles Vite-specific features for Node.js:
// 1. .txt?raw imports (used by app.js for genres data)
// 2. @utils/ alias (used by normalization.js to import from utils/)
const projectRoot = path.resolve(__dirname, '..').replace(/\\/g, '/');
register(
  'data:text/javascript,' +
    encodeURIComponent(`
  const PROJECT_ROOT = ${JSON.stringify(projectRoot)};
  export function resolve(specifier, context, next) {
    if (specifier.startsWith('@utils/')) {
      const resolved = 'file://' + PROJECT_ROOT + '/utils/' + specifier.slice(7);
      return { url: resolved, shortCircuit: true };
    }
    if (specifier.endsWith('.txt') || specifier.includes('.txt?')) {
      return { url: new URL(specifier.split('?')[0], context.parentURL).href, shortCircuit: true };
    }
    return next(specifier, context);
  }
  export function load(url, context, next) {
    if (url.endsWith('.txt')) {
      return { format: 'module', source: 'export default ""', shortCircuit: true };
    }
    return next(url, context);
  }
`)
);

// Provide minimal browser globals needed by the ESM import chain
// (various modules in src/js/modules/ reference window/document at module level)
if (typeof globalThis.window === 'undefined') {
  globalThis.addEventListener = globalThis.addEventListener || (() => {});
  globalThis.removeEventListener = globalThis.removeEventListener || (() => {});
  globalThis.dispatchEvent = globalThis.dispatchEvent || (() => {});
  globalThis.window = globalThis;
  globalThis.document = {
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    createElement: () => ({
      style: {},
      classList: { add: () => {}, remove: () => {}, toggle: () => {} },
      setAttribute: () => {},
      getAttribute: () => null,
      appendChild: () => {},
      addEventListener: () => {},
    }),
    body: { appendChild: () => {}, style: {} },
    documentElement: { style: {} },
  };
  globalThis.navigator = { userAgent: 'node' };
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  globalThis.sessionStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  globalThis.IntersectionObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  };
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  };
  globalThis.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  globalThis.getComputedStyle = () => ({});
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, options) {
      this.type = type;
      this.detail = options?.detail;
    }
  };
  globalThis.fetch = () => Promise.resolve({ ok: true, json: () => ({}) });
}

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
        getListMetadata: mock.fn(() => ({ year: 2024, isMain: true })),
        getCurrentList: mock.fn(() => 'test-list'),
        formatReleaseDate: mock.fn((d) => d || ''),
        isYearMismatch: mock.fn(() => false),
        extractYearFromDate: mock.fn(() => 2024),
        getTrackName: mock.fn((t) =>
          typeof t === 'string' ? t : t?.name || ''
        ),
        getTrackLength: mock.fn(() => ''),
        formatTrackTime: mock.fn(() => ''),
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

      // Position is only set for main lists
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
        getListMetadata: mock.fn(() => ({})), // No isMain, so position should be null
        getCurrentList: mock.fn(() => 'test-list'),
        formatReleaseDate: mock.fn(() => ''),
        isYearMismatch: mock.fn(() => false),
        extractYearFromDate: mock.fn(() => null),
      };

      const module = createAlbumDisplay(mockDeps);

      const album = {};
      const data = module.processAlbumData(album, 0);

      // Position is null for non-main lists (isMain not set)
      assert.strictEqual(data.position, null);
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
        getTrackName: mock.fn((t) =>
          typeof t === 'string' ? t : t?.name || ''
        ),
        getTrackLength: mock.fn(() => ''),
        formatTrackTime: mock.fn(() => ''),
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

    it('should set position only for main lists', () => {
      // Test with main list - position should be set
      let mockDeps = {
        getListData: mock.fn(() => []),
        getListMetadata: mock.fn(() => ({ year: 2024, isMain: true })),
        getCurrentList: mock.fn(() => 'test-list'),
        formatReleaseDate: mock.fn(() => ''),
        isYearMismatch: mock.fn(() => false),
        extractYearFromDate: mock.fn(() => 2024),
      };

      let module = createAlbumDisplay(mockDeps);
      let data = module.processAlbumData({ album: 'Test' }, 0);
      assert.strictEqual(data.position, 1);

      data = module.processAlbumData({ album: 'Test' }, 4);
      assert.strictEqual(data.position, 5);

      // Test with non-main list - position should be null
      mockDeps = {
        getListData: mock.fn(() => []),
        getListMetadata: mock.fn(() => ({ year: 2024, isMain: false })),
        getCurrentList: mock.fn(() => 'test-list'),
        formatReleaseDate: mock.fn(() => ''),
        isYearMismatch: mock.fn(() => false),
        extractYearFromDate: mock.fn(() => 2024),
      };

      module = createAlbumDisplay(mockDeps);
      data = module.processAlbumData({ album: 'Test' }, 0);
      assert.strictEqual(data.position, null);

      // Test with list without isMain property - position should be null
      mockDeps = {
        getListData: mock.fn(() => []),
        getListMetadata: mock.fn(() => ({ year: 2024 })), // No isMain
        getCurrentList: mock.fn(() => 'test-list'),
        formatReleaseDate: mock.fn(() => ''),
        isYearMismatch: mock.fn(() => false),
        extractYearFromDate: mock.fn(() => 2024),
      };

      module = createAlbumDisplay(mockDeps);
      data = module.processAlbumData({ album: 'Test' }, 0);
      assert.strictEqual(data.position, null);
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

    it('should return SINGLE_ADD when one album is added', () => {
      const module = createAlbumDisplay({});
      const oldAlbums = [{ artist: 'A', album: '1', release_date: '' }];
      const newAlbums = [
        { artist: 'A', album: '1', release_date: '' },
        { artist: 'B', album: '2', release_date: '' },
      ];
      const result = module.detectUpdateType(oldAlbums, newAlbums);
      assert.strictEqual(result.type, 'SINGLE_ADD');
      assert.strictEqual(result.index, 1);
      assert.deepStrictEqual(result.album, {
        artist: 'B',
        album: '2',
        release_date: '',
      });
    });

    it('should return FULL_REBUILD when multiple albums differ', () => {
      const module = createAlbumDisplay({});
      const oldAlbums = [{ artist: 'A', album: '1', release_date: '' }];
      const newAlbums = [
        { artist: 'B', album: '2', release_date: '' },
        { artist: 'C', album: '3', release_date: '' },
        { artist: 'D', album: '4', release_date: '' },
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

    it('should not track cover_image changes (handled by URL-based loading)', () => {
      // Note: cover_image is intentionally NOT tracked in detectUpdateType
      // because storing it in the lightweight mutable state would be expensive.
      // Cover images are now loaded via URL with IntersectionObserver lazy loading.
      // In practice, cover_image-only changes are also caught by the fingerprint
      // comparison at the displayAlbums level before detectUpdateType is called.
      const module = createAlbumDisplay({});
      const oldState = [{ artist: 'A', album: '1', release_date: '' }];
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
