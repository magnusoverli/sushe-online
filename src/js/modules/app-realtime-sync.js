import { createRealtimeSync as createRealtimeSyncDefault } from './realtime-sync.js';

/**
 * Realtime sync composition helpers for app.js.
 */
export function createAppRealtimeSync(deps = {}) {
  const {
    createRealtimeSync = createRealtimeSyncDefault,
    getRealtimeSyncModuleInstance,
    setRealtimeSyncModuleInstance,
    getCurrentListId,
    getListData,
    apiCall,
    updateAlbumSummaryInPlace,
    wasRecentLocalSave,
    setListData,
    displayAlbums,
    loadLists,
    showToast,
    logger = console,
    win = typeof window !== 'undefined' ? window : null,
  } = deps;

  function getRealtimeSyncModule() {
    let realtimeSyncModule = getRealtimeSyncModuleInstance();
    if (!realtimeSyncModule) {
      realtimeSyncModule = createRealtimeSync({
        getCurrentList: () => getCurrentListId(),
        getListData,
        apiCall,
        updateAlbumSummaryInPlace,
        refreshListData: async (listId) => {
          if (wasRecentLocalSave(listId)) {
            logger.log(
              '[RealtimeSync] Skipping refresh for local save:',
              listId
            );
            return { wasLocalSave: true };
          }

          const data = await apiCall(
            `/api/lists/${encodeURIComponent(listId)}`
          );
          setListData(listId, data);
          if (getCurrentListId() === listId) {
            // Let the incremental detector apply the remote add/remove/edit/
            // reorder instead of forcing a full rebuild — this avoids the
            // row-recreate flicker, SortableJS re-init, and cover
            // re-observation on second-device edits. list:updated/reordered
            // only ever carry fingerprinted changes (item add/remove/comment/
            // track/order), never cover/availability/summary changes.
            displayAlbums(data);
          }
          return { wasLocalSave: false };
        },
        refreshListDataSilent: async (listId) => {
          const data = await apiCall(
            `/api/lists/${encodeURIComponent(listId)}`
          );
          setListData(listId, data);
          if (getCurrentListId() === listId) {
            displayAlbums(data, { forceFullRebuild: true });
          }
        },
        refreshListNav: () => {
          loadLists();
        },
        showToast,
        displayAlbums,
        logger,
      });

      setRealtimeSyncModuleInstance(realtimeSyncModule);
    }

    return realtimeSyncModule;
  }

  function initializeRealtimeSync() {
    const sync = getRealtimeSyncModule();
    sync.connect();

    if (win && typeof win.addEventListener === 'function') {
      win.addEventListener('beforeunload', () => {
        sync.disconnect();
      });
    }
  }

  return {
    getRealtimeSyncModule,
    initializeRealtimeSync,
  };
}
