import { createRealtimeSync as createRealtimeSyncDefault } from './realtime-sync.js';
import { createRealtimeAlbumPatches } from './realtime-album-patches.js';

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
  const albumPatches = createRealtimeAlbumPatches();
  const METADATA_PATCH_FIELDS = new Set([
    'album',
    'artist',
    'country',
    'cover_image_url',
    'cover_image_format',
    'cover_image_updated_at',
    'cover_thumb_url',
    'cover_thumbnail_format',
    'cover_thumbnail_updated_at',
    'tracks',
  ]);

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

    const patch = {
      availability: data.availability,
      availability_links: data.availabilityLinks,
    };
    albumPatches.remember(data.albumId, patch);
    patchLoadedAlbumCopies(data.albumId, patch);
  }

  function handleAlbumMetadataUpdated(data) {
    if (
      typeof data?.albumId !== 'string' ||
      !data.patch ||
      typeof data.patch !== 'object' ||
      Array.isArray(data.patch)
    ) {
      logger.warn?.('[RealtimeSync] Ignoring invalid metadata update', data);
      return;
    }

    const patch = Object.fromEntries(
      Object.entries(data.patch).filter(([field]) =>
        METADATA_PATCH_FIELDS.has(field)
      )
    );
    if (Object.keys(patch).length === 0) return;
    const acceptedPatch = albumPatches.remember(
      data.albumId,
      patch,
      data.metadataVersion
    );
    if (Object.keys(acceptedPatch).length === 0) return;
    patchLoadedAlbumCopies(data.albumId, acceptedPatch);
  }

  async function handleAlbumTaxonomyUpdated(data) {
    if (typeof data?.albumId !== 'string') return;

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
      const patch = {
        taxonomy: taxonomy.taxonomy,
        genre_1: taxonomy.genre_1,
        genre_2: taxonomy.genre_2,
        taxonomy_updated_at:
          taxonomy.taxonomy_updated_at ?? data.taxonomyUpdatedAt ?? null,
      };
      albumPatches.remember(data.albumId, patch);
      patchLoadedAlbumCopies(data.albumId, patch);
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
        onAlbumMetadataUpdated: handleAlbumMetadataUpdated,
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
          const refreshGeneration = albumPatches.generation;
          const data = await apiCall(
            `/api/lists/${encodeURIComponent(listId)}`
          );
          albumPatches.applyAfter(data, refreshGeneration);
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
          const refreshGeneration = albumPatches.generation;
          const data = await apiCall(
            `/api/lists/${encodeURIComponent(listId)}`
          );
          albumPatches.applyAfter(data, refreshGeneration);
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
