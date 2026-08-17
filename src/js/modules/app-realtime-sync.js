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
    getLists = () => ({}),
    getListData,
    apiCall,
    updateAlbumSummaryInPlace,
    wasRecentLocalSave,
    setListData,
    updateListNav,
    displayAlbums,
    refreshGroupsAndLists,
    showToast,
    logger = console,
    win = typeof window !== 'undefined' ? window : null,
  } = deps;
  const taxonomyRequests = new Map();

  function patchLoadedAlbumCopies(albumId, patch) {
    let currentListChanged = false;
    const currentListId = getCurrentListId();

    for (const listId of Object.keys(getLists() || {})) {
      const albums = getListData(listId);
      if (!Array.isArray(albums)) continue;

      let listChanged = false;
      for (const album of albums) {
        if (album?.album_id !== albumId) continue;
        Object.assign(album, patch);
        listChanged = true;
      }
      if (listChanged && listId === currentListId) {
        currentListChanged = true;
      }
    }

    if (currentListChanged) {
      displayAlbums(getListData(currentListId));
    }
  }

  function hasLoadedAlbum(albumId) {
    return Object.keys(getLists() || {}).some((listId) =>
      getListData(listId)?.some((album) => album?.album_id === albumId)
    );
  }

  function handleAlbumAvailabilityUpdated(data) {
    if (
      typeof data?.albumId !== 'string' ||
      !Array.isArray(data.availability) ||
      !Array.isArray(data.availabilityLinks)
    ) {
      logger.warn?.(
        '[RealtimeSync] Ignoring invalid availability update',
        data
      );
      return;
    }

    patchLoadedAlbumCopies(data.albumId, {
      availability: data.availability,
      availability_links: data.availabilityLinks,
    });
  }

  async function handleAlbumTaxonomyUpdated(data) {
    if (typeof data?.albumId !== 'string' || !hasLoadedAlbum(data.albumId)) {
      return;
    }

    const eventTimestamp = Date.parse(data.taxonomyUpdatedAt || '');
    const previousRequest = taxonomyRequests.get(data.albumId);
    if (
      previousRequest?.timestamp &&
      Number.isFinite(eventTimestamp) &&
      eventTimestamp < previousRequest.timestamp
    ) {
      return;
    }
    const token = Symbol(data.albumId);
    taxonomyRequests.set(data.albumId, {
      token,
      timestamp: Number.isFinite(eventTimestamp)
        ? eventTimestamp
        : previousRequest?.timestamp || null,
    });

    try {
      const taxonomy = await apiCall(
        `/api/albums/${encodeURIComponent(data.albumId)}/taxonomy`
      );
      if (!taxonomy || typeof taxonomy !== 'object') {
        throw new Error('Invalid taxonomy response');
      }
      if (taxonomyRequests.get(data.albumId)?.token !== token) return;

      const responseTimestamp = Date.parse(taxonomy.taxonomy_updated_at || '');
      if (
        Number.isFinite(eventTimestamp) &&
        Number.isFinite(responseTimestamp) &&
        responseTimestamp < eventTimestamp
      ) {
        return;
      }
      patchLoadedAlbumCopies(data.albumId, {
        taxonomy: taxonomy.taxonomy,
        genre_1: taxonomy.genre_1,
        genre_2: taxonomy.genre_2,
        taxonomy_updated_at:
          taxonomy.taxonomy_updated_at ?? data.taxonomyUpdatedAt ?? null,
      });
    } catch (error) {
      logger.warn?.('[RealtimeSync] Failed to apply taxonomy update', {
        albumId: data.albumId,
        error,
      });
    }
  }

  function getRealtimeSyncModule() {
    let realtimeSyncModule = getRealtimeSyncModuleInstance();
    if (!realtimeSyncModule) {
      realtimeSyncModule = createRealtimeSync({
        getCurrentList: () => getCurrentListId(),
        getListData,
        apiCall,
        updateAlbumSummaryInPlace,
        onAlbumAvailabilityUpdated: handleAlbumAvailabilityUpdated,
        onAlbumTaxonomyUpdated: handleAlbumTaxonomyUpdated,
        refreshListData: async (listId) => {
          if (wasRecentLocalSave(listId)) {
            logger.log(
              '[RealtimeSync] Skipping refresh for local save:',
              listId
            );
            return { wasLocalSave: true };
          }

          const previousCount = getListData(listId)?.length;
          const data = await apiCall(
            `/api/lists/${encodeURIComponent(listId)}`
          );
          setListData(listId, data);
          if (previousCount !== data.length) {
            updateListNav();
          }
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
          const previousCount = getListData(listId)?.length;
          const data = await apiCall(
            `/api/lists/${encodeURIComponent(listId)}`
          );
          setListData(listId, data);
          if (previousCount !== data.length) {
            updateListNav();
          }
          if (getCurrentListId() === listId) {
            displayAlbums(data, { forceFullRebuild: true });
          }
        },
        refreshListNav: () => {
          refreshGroupsAndLists();
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
