/**
 * Tests for context-menus.js module
 */

const { describe, it, mock, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

describe('context-menus module', () => {
  describe('createContextMenus factory', () => {
    let createContextMenus;

    beforeEach(async () => {
      const module = await import('../src/js/modules/context-menus.js');
      createContextMenus = module.createContextMenus;
    });

    it('should export createContextMenus function', () => {
      assert.strictEqual(typeof createContextMenus, 'function');
    });

    it('should create module with all required methods', () => {
      const mockDeps = {
        getListData: mock.fn(() => []),
        getListMetadata: mock.fn(() => ({})),
        getCurrentList: mock.fn(() => 'test-list'),
        getLists: mock.fn(() => ({})),
        saveList: mock.fn(),
        selectList: mock.fn(),
        showToast: mock.fn(),
        showConfirmation: mock.fn(),
        apiCall: mock.fn(),
        findAlbumByIdentity: mock.fn(),
        downloadListAsJSON: mock.fn(),
        updatePlaylist: mock.fn(),
        openRenameModal: mock.fn(),
        updateListNav: mock.fn(),
        showMobileEditForm: mock.fn(),
        playAlbum: mock.fn(),
        playAlbumSafe: mock.fn(),
        loadLists: mock.fn(),
        getContextState: mock.fn(() => ({})),
        setContextState: mock.fn(),
        toggleMainStatus: mock.fn(),
      };

      const module = createContextMenus(mockDeps);

      // Check all public methods exist
      assert.strictEqual(typeof module.positionContextMenu, 'function');
      assert.strictEqual(typeof module.hideAllContextMenus, 'function');
      assert.strictEqual(typeof module.getDeviceIcon, 'function');
      assert.strictEqual(typeof module.getListMenuConfig, 'function');
      assert.strictEqual(typeof module.showMoveToListSubmenu, 'function');
      assert.strictEqual(typeof module.showCopyToListSubmenu, 'function');
      assert.strictEqual(typeof module.showMoveConfirmation, 'function');
      assert.strictEqual(typeof module.showCopyConfirmation, 'function');
      assert.strictEqual(typeof module.moveAlbumToList, 'function');
      assert.strictEqual(typeof module.copyAlbumToList, 'function');
      assert.strictEqual(typeof module.setupSubmenuHideOnLeave, 'function');
      assert.strictEqual(typeof module.positionPlaySubmenu, 'function');
      assert.strictEqual(typeof module.showPlayAlbumSubmenu, 'function');
    });

    it('should handle empty dependencies gracefully', () => {
      const module = createContextMenus({});
      assert.ok(module);
    });
  });

  describe('getDeviceIcon', () => {
    let createContextMenus;

    beforeEach(async () => {
      const module = await import('../src/js/modules/context-menus.js');
      createContextMenus = module.createContextMenus;
    });

    it('should return correct icons for known device types', () => {
      const module = createContextMenus({});

      assert.strictEqual(module.getDeviceIcon('computer'), 'fas fa-laptop');
      assert.strictEqual(
        module.getDeviceIcon('smartphone'),
        'fas fa-mobile-alt'
      );
      assert.strictEqual(module.getDeviceIcon('speaker'), 'fas fa-volume-up');
      assert.strictEqual(module.getDeviceIcon('tv'), 'fas fa-tv');
      assert.strictEqual(module.getDeviceIcon('tablet'), 'fas fa-tablet-alt');
      assert.strictEqual(module.getDeviceIcon('automobile'), 'fas fa-car');
    });

    it('should return default icon for unknown device types', () => {
      const module = createContextMenus({});

      assert.strictEqual(module.getDeviceIcon('unknown'), 'fas fa-music');
      assert.strictEqual(module.getDeviceIcon('randomdevice'), 'fas fa-music');
    });

    it('should handle null/undefined device types', () => {
      const module = createContextMenus({});

      assert.strictEqual(module.getDeviceIcon(null), 'fas fa-music');
      assert.strictEqual(module.getDeviceIcon(undefined), 'fas fa-music');
    });

    it('should be case insensitive', () => {
      const module = createContextMenus({});

      assert.strictEqual(module.getDeviceIcon('COMPUTER'), 'fas fa-laptop');
      assert.strictEqual(module.getDeviceIcon('Computer'), 'fas fa-laptop');
      assert.strictEqual(
        module.getDeviceIcon('SMARTPHONE'),
        'fas fa-mobile-alt'
      );
    });
  });

  describe('getListMenuConfig', () => {
    let createContextMenus;

    beforeEach(async () => {
      const module = await import('../src/js/modules/context-menus.js');
      createContextMenus = module.createContextMenus;
    });

    it('should return correct config for list with year', () => {
      // Mock window.currentUser
      global.window = {
        currentUser: {
          spotifyAuth: true,
          tidalAuth: false,
          musicService: 'spotify',
        },
      };

      const mockDeps = {
        getListMetadata: mock.fn(() => ({
          year: 2024,
          isMain: false,
        })),
      };

      const module = createContextMenus(mockDeps);
      const config = module.getListMenuConfig('My List');

      assert.strictEqual(config.hasYear, true);
      assert.strictEqual(config.isMain, false);
      assert.strictEqual(config.mainToggleText, 'Set as Main');
      assert.strictEqual(config.musicServiceText, 'Send to Spotify');
      assert.strictEqual(config.hasSpotify, true);
      assert.strictEqual(config.hasTidal, false);
    });

    it('should return correct config for main list', () => {
      global.window = {
        currentUser: {
          spotifyAuth: false,
          tidalAuth: true,
          musicService: 'tidal',
        },
      };

      const mockDeps = {
        getListMetadata: mock.fn(() => ({
          year: 2023,
          isMain: true,
        })),
      };

      const module = createContextMenus(mockDeps);
      const config = module.getListMenuConfig('Main List');

      assert.strictEqual(config.isMain, true);
      assert.strictEqual(config.mainToggleText, 'Remove Main Status');
      assert.strictEqual(config.musicServiceText, 'Send to Tidal');
    });

    it('should handle list without year', () => {
      global.window = {
        currentUser: {},
      };

      const mockDeps = {
        getListMetadata: mock.fn(() => ({
          year: null,
          isMain: false,
        })),
      };

      const module = createContextMenus(mockDeps);
      const config = module.getListMenuConfig('No Year List');

      assert.strictEqual(config.hasYear, false);
      assert.strictEqual(config.musicServiceText, 'Send to Music Service');
    });

    it('should handle no connected services', () => {
      global.window = {
        currentUser: {
          spotifyAuth: false,
          tidalAuth: false,
        },
      };

      const mockDeps = {
        getListMetadata: mock.fn(() => ({})),
      };

      const module = createContextMenus(mockDeps);
      const config = module.getListMenuConfig('Test');

      assert.strictEqual(config.hasSpotify, false);
      assert.strictEqual(config.hasTidal, false);
      assert.strictEqual(config.musicServiceText, 'Send to Music Service');
    });
  });

  describe('moveAlbumToList', () => {
    let createContextMenus;

    beforeEach(async () => {
      const module = await import('../src/js/modules/context-menus.js');
      createContextMenus = module.createContextMenus;
    });

    it('should throw error for invalid source list', async () => {
      const mockDeps = {
        getCurrentList: mock.fn(() => 'source'),
        getLists: mock.fn(() => ({})), // Empty lists
        getListData: mock.fn(() => null),
        showToast: mock.fn(),
        findAlbumByIdentity: mock.fn(),
      };

      const module = createContextMenus(mockDeps);

      await assert.rejects(
        () => module.moveAlbumToList(0, 'album-id', 'target'),
        { message: 'Invalid source or target list' }
      );
    });

    it('should throw error when source list data not loaded', async () => {
      const mockDeps = {
        getCurrentList: mock.fn(() => 'source'),
        getLists: mock.fn(() => ({ source: {}, target: {} })),
        getListData: mock.fn(() => null),
        showToast: mock.fn(),
        findAlbumByIdentity: mock.fn(),
      };

      const module = createContextMenus(mockDeps);

      await assert.rejects(
        () => module.moveAlbumToList(0, 'album-id', 'target'),
        { message: 'Source list data not loaded' }
      );
    });

    it('should throw error when album not found', async () => {
      const mockDeps = {
        getCurrentList: mock.fn(() => 'source'),
        getLists: mock.fn(() => ({ source: {}, target: {} })),
        getListData: mock.fn((name) => {
          if (name === 'source') return [];
          return [];
        }),
        showToast: mock.fn(),
        findAlbumByIdentity: mock.fn(),
      };

      const module = createContextMenus(mockDeps);

      await assert.rejects(
        () => module.moveAlbumToList(0, 'album-id', 'target'),
        { message: 'Album not found' }
      );
    });
  });

  describe('copyAlbumToList', () => {
    let createContextMenus;

    beforeEach(async () => {
      const module = await import('../src/js/modules/context-menus.js');
      createContextMenus = module.createContextMenus;
    });

    it('should throw error for invalid source list', async () => {
      const mockDeps = {
        getCurrentList: mock.fn(() => 'source'),
        getLists: mock.fn(() => ({})),
        getListData: mock.fn(() => null),
        showToast: mock.fn(),
        findAlbumByIdentity: mock.fn(),
      };

      const module = createContextMenus(mockDeps);

      await assert.rejects(
        () => module.copyAlbumToList(0, 'album-id', 'target'),
        { message: 'Invalid source or target list' }
      );
    });

    it('should throw error when album not found', async () => {
      const mockDeps = {
        getCurrentList: mock.fn(() => 'source'),
        getLists: mock.fn(() => ({ source: {}, target: {} })),
        getListData: mock.fn((name) => {
          if (name === 'source') return [];
          return [];
        }),
        showToast: mock.fn(),
        findAlbumByIdentity: mock.fn(),
      };

      const module = createContextMenus(mockDeps);

      await assert.rejects(
        () => module.copyAlbumToList(0, 'album-id', 'target'),
        { message: 'Album not found' }
      );
    });
  });

  // Cleanup global
  afterEach(() => {
    delete global.window;
  });
});
