/**
 * App bootstrap orchestration for DOM-ready initialization.
 */

export function createAppBootstrap(deps = {}) {
  const {
    doc = typeof document !== 'undefined' ? document : null,
    win = typeof window !== 'undefined' ? window : null,
    setTimeoutFn = setTimeout,
    logger = console,
    convertFlashToToast,
    initColumnConfig,
    loadLists,
    initializeSettingsDrawer,
    initAboutModal,
    initializeSidebarCollapse,
    cleanupLegacyListCache,
    hydrateSidebarFromCachedNames,
    getLists,
    updateListNav,
    initializeContextMenu,
    initializeAlbumContextMenu,
    getRecommendationsModule,
    getListCrudModule,
    initializeImportConflictHandling,
    initializeRealtimeSync,
    registerDiscoveryAddAlbumHandler,
    initializeFileImportHandlers,
    checkListSetupStatus,
    showToast,
    importMusicbrainz = () => import('../musicbrainz.js'),
  } = deps;

  function initializeFabHandler() {
    const fab = doc?.getElementById('addAlbumFAB');
    if (!fab) return;

    fab.addEventListener('click', async () => {
      if (!win.openAddAlbumModal) {
        try {
          await importMusicbrainz();
        } catch (err) {
          logger.error('Failed to load album editor:', err);
          showToast('Error loading album editor. Please try again.', 'error');
          return;
        }
      }

      if (win.openAddAlbumModal) {
        win.openAddAlbumModal();
      }
    });
  }

  function initializeAfterListLoad() {
    initializeContextMenu();
    initializeAlbumContextMenu();
    getRecommendationsModule().initializeRecommendationContextMenu();
    getListCrudModule().initializeCategoryContextMenu();
    getListCrudModule().initializeCreateList();
    getListCrudModule().initializeCreateCollection();
    getListCrudModule().initializeRenameList();
    initializeImportConflictHandling();
    initializeRealtimeSync();
    registerDiscoveryAddAlbumHandler();
    initializeFileImportHandlers();

    setTimeoutFn(() => {
      checkListSetupStatus({ refreshLists: loadLists }).catch((err) => {
        logger.warn('Failed to check list setup status:', err);
      });
    }, 1000);
  }

  function initialize() {
    if (!doc || !win) return;

    doc.addEventListener('DOMContentLoaded', () => {
      convertFlashToToast();

      const isAuthPage = win.location.pathname.match(
        /\/(login|register|forgot)/
      );
      if (isAuthPage) {
        return;
      }

      initColumnConfig(win.currentUser?.columnVisibility || null);

      const listLoadPromise = loadLists();

      initializeSettingsDrawer();
      initAboutModal();
      initializeSidebarCollapse();
      initializeFabHandler();
      cleanupLegacyListCache();
      hydrateSidebarFromCachedNames(getLists, updateListNav);

      listLoadPromise
        .then(() => {
          initializeAfterListLoad();
        })
        .catch(() => {
          showToast('Failed to initialize', 'error');
        });
    });
  }

  return { initialize };
}
