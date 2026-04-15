const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert');

describe('app-bootstrap module', () => {
  let createAppBootstrap;

  beforeEach(async () => {
    const module = await import('../src/js/modules/app-bootstrap.js');
    createAppBootstrap = module.createAppBootstrap;
  });

  it('skips app initialization on auth pages', () => {
    let domReadyHandler = null;
    const doc = {
      addEventListener(eventName, handler) {
        if (eventName === 'DOMContentLoaded') {
          domReadyHandler = handler;
        }
      },
      getElementById() {
        return null;
      },
    };

    const loadLists = mock.fn(() => Promise.resolve());
    const initColumnConfig = mock.fn();

    const bootstrap = createAppBootstrap({
      doc,
      win: { location: { pathname: '/login' }, currentUser: null },
      convertFlashToToast: mock.fn(),
      initColumnConfig,
      loadLists,
      initializeSettingsDrawer: mock.fn(),
      initAboutModal: mock.fn(),
      initializeSidebarCollapse: mock.fn(),
      cleanupLegacyListCache: mock.fn(),
      hydrateSidebarFromCachedNames: mock.fn(),
      getLists: mock.fn(() => ({})),
      updateListNav: mock.fn(),
      initializeContextMenu: mock.fn(),
      initializeAlbumContextMenu: mock.fn(),
      getRecommendationsModule: () => ({
        initializeRecommendationContextMenu: mock.fn(),
      }),
      getListCrudModule: () => ({
        initializeCategoryContextMenu: mock.fn(),
        initializeCreateList: mock.fn(),
        initializeCreateCollection: mock.fn(),
        initializeRenameList: mock.fn(),
      }),
      initializeImportConflictHandling: mock.fn(),
      initializeRealtimeSync: mock.fn(),
      registerDiscoveryAddAlbumHandler: mock.fn(),
      initializeFileImportHandlers: mock.fn(),
      checkListSetupStatus: mock.fn(() => Promise.resolve()),
      showToast: mock.fn(),
    });

    bootstrap.initialize();
    assert.strictEqual(typeof domReadyHandler, 'function');

    domReadyHandler();

    assert.strictEqual(initColumnConfig.mock.calls.length, 0);
    assert.strictEqual(loadLists.mock.calls.length, 0);
  });

  it('runs startup orchestration and deferred setup checks', async () => {
    let domReadyHandler = null;
    let fabClickHandler = null;
    const fab = {
      addEventListener(eventName, handler) {
        if (eventName === 'click') {
          fabClickHandler = handler;
        }
      },
    };
    const doc = {
      addEventListener(eventName, handler) {
        if (eventName === 'DOMContentLoaded') {
          domReadyHandler = handler;
        }
      },
      getElementById(elementId) {
        if (elementId === 'addAlbumFAB') {
          return fab;
        }
        return null;
      },
    };

    let resolveLoadLists;
    const loadLists = mock.fn(
      () =>
        new Promise((resolve) => {
          resolveLoadLists = resolve;
        })
    );

    let timeoutHandler = null;
    const setTimeoutFn = (handler, ms) => {
      timeoutHandler = handler;
      assert.strictEqual(ms, 1000);
      return 1;
    };

    const convertFlashToToast = mock.fn();
    const initColumnConfig = mock.fn();
    const initializeSettingsDrawer = mock.fn();
    const initAboutModal = mock.fn();
    const initializeSidebarCollapse = mock.fn();
    const cleanupLegacyListCache = mock.fn();
    const hydrateSidebarFromCachedNames = mock.fn();
    const initializeContextMenu = mock.fn();
    const initializeAlbumContextMenu = mock.fn();
    const initializeImportConflictHandling = mock.fn();
    const initializeRealtimeSync = mock.fn();
    const registerDiscoveryAddAlbumHandler = mock.fn();
    const initializeFileImportHandlers = mock.fn();
    const checkListSetupStatus = mock.fn(() => Promise.resolve());
    const showToast = mock.fn();
    const recommendationMenuInit = mock.fn();
    const listCrudInit = {
      initializeCategoryContextMenu: mock.fn(),
      initializeCreateList: mock.fn(),
      initializeCreateCollection: mock.fn(),
      initializeRenameList: mock.fn(),
    };
    const importMusicbrainz = mock.fn(() => Promise.resolve());

    const bootstrap = createAppBootstrap({
      doc,
      win: {
        location: { pathname: '/spotify' },
        currentUser: { columnVisibility: { rating: true } },
      },
      setTimeoutFn,
      logger: { warn: mock.fn(), error: mock.fn() },
      convertFlashToToast,
      initColumnConfig,
      loadLists,
      initializeSettingsDrawer,
      initAboutModal,
      initializeSidebarCollapse,
      cleanupLegacyListCache,
      hydrateSidebarFromCachedNames,
      getLists: mock.fn(() => ({})),
      updateListNav: mock.fn(),
      initializeContextMenu,
      initializeAlbumContextMenu,
      getRecommendationsModule: () => ({
        initializeRecommendationContextMenu: recommendationMenuInit,
      }),
      getListCrudModule: () => listCrudInit,
      initializeImportConflictHandling,
      initializeRealtimeSync,
      registerDiscoveryAddAlbumHandler,
      initializeFileImportHandlers,
      checkListSetupStatus,
      showToast,
      importMusicbrainz,
    });

    bootstrap.initialize();
    assert.strictEqual(typeof domReadyHandler, 'function');

    domReadyHandler();

    assert.strictEqual(convertFlashToToast.mock.calls.length, 1);
    assert.strictEqual(initColumnConfig.mock.calls.length, 1);
    assert.strictEqual(loadLists.mock.calls.length, 1);
    assert.strictEqual(initializeSettingsDrawer.mock.calls.length, 1);
    assert.strictEqual(initAboutModal.mock.calls.length, 1);
    assert.strictEqual(initializeSidebarCollapse.mock.calls.length, 1);
    assert.strictEqual(cleanupLegacyListCache.mock.calls.length, 1);
    assert.strictEqual(hydrateSidebarFromCachedNames.mock.calls.length, 1);
    assert.strictEqual(typeof fabClickHandler, 'function');

    resolveLoadLists();
    await new Promise((resolve) => setImmediate(resolve));

    assert.strictEqual(initializeContextMenu.mock.calls.length, 1);
    assert.strictEqual(initializeAlbumContextMenu.mock.calls.length, 1);
    assert.strictEqual(recommendationMenuInit.mock.calls.length, 1);
    assert.strictEqual(
      listCrudInit.initializeCategoryContextMenu.mock.calls.length,
      1
    );
    assert.strictEqual(listCrudInit.initializeCreateList.mock.calls.length, 1);
    assert.strictEqual(
      listCrudInit.initializeCreateCollection.mock.calls.length,
      1
    );
    assert.strictEqual(listCrudInit.initializeRenameList.mock.calls.length, 1);
    assert.strictEqual(initializeImportConflictHandling.mock.calls.length, 1);
    assert.strictEqual(initializeRealtimeSync.mock.calls.length, 1);
    assert.strictEqual(registerDiscoveryAddAlbumHandler.mock.calls.length, 1);
    assert.strictEqual(initializeFileImportHandlers.mock.calls.length, 1);
    assert.strictEqual(typeof timeoutHandler, 'function');

    timeoutHandler();
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(checkListSetupStatus.mock.calls.length, 1);
    assert.strictEqual(
      checkListSetupStatus.mock.calls[0].arguments[0].refreshLists,
      loadLists
    );

    await fabClickHandler();
    assert.strictEqual(importMusicbrainz.mock.calls.length, 1);
  });
});
