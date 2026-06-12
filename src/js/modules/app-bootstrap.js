/**
 * App bootstrap orchestration for DOM-ready initialization.
 */

import {
  createPostRenderScheduler,
  FIRST_LIST_RENDERED_EVENT,
} from './post-render-scheduler.js';

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
    initializeFileImportHandlers,
    checkListSetupStatus,
    showToast,
    importMusicbrainz = () => import('../musicbrainz.js'),
  } = deps;
  const { schedulePostRenderTask } = deps.schedulePostRenderTask
    ? { schedulePostRenderTask: deps.schedulePostRenderTask }
    : createPostRenderScheduler({ win, setTimeoutFn });

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
    initializeFileImportHandlers();

    schedulePostRenderTask(() => {
      initializeRealtimeSync();
    });

    schedulePostRenderTask(
      () => {
        checkListSetupStatus({ refreshLists: loadLists }).catch((err) => {
          logger.warn('Failed to check list setup status:', err);
        });
      },
      { delayMs: 1000, timeoutMs: 3000 }
    );
  }

  function notifyFirstListRendered() {
    if (!doc || typeof doc.dispatchEvent !== 'function') return;

    schedulePostRenderTask(
      () => {
        if (typeof win?.CustomEvent === 'function') {
          doc.dispatchEvent(new win.CustomEvent(FIRST_LIST_RENDERED_EVENT));
        } else if (typeof win?.Event === 'function') {
          doc.dispatchEvent(new win.Event(FIRST_LIST_RENDERED_EVENT));
        }
      },
      { timeoutMs: 1000 }
    );
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
          notifyFirstListRendered();
        })
        .catch(() => {
          showToast('Failed to initialize', 'error');
        });
    });
  }

  return { initialize };
}
