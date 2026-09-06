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
        selectList: mock.fn(),
        showToast: mock.fn(),
        showConfirmation: mock.fn(),
        apiCall: mock.fn(),
        downloadListAsJSON: mock.fn(),
        downloadListAsPDF: mock.fn(),
        downloadListAsCSV: mock.fn(),
        updatePlaylist: mock.fn(),
        openRenameModal: mock.fn(),
        updateListNav: mock.fn(),
        getContextList: mock.fn(() => null),
        setContextList: mock.fn(),
        setCurrentList: mock.fn(),
        toggleMainStatus: mock.fn(),
      };

      const module = createContextMenus(mockDeps);

      // Check all public methods exist
      assert.strictEqual(typeof module.positionContextMenu, 'function');
      assert.strictEqual(typeof module.hideAllContextMenus, 'function');
      assert.strictEqual(typeof module.getDeviceIcon, 'function');
      assert.strictEqual(typeof module.showDownloadListSubmenu, 'function');
      assert.strictEqual(typeof module.initializeContextMenu, 'function');
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

  // Cleanup global
  afterEach(() => {
    delete global.window;
  });
});
