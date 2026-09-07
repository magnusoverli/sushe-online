/**
 * List loading, import, and persistence flows for app composition.
 */
import { createListImporter } from './app-list-import.js';
import { createKeyedTaskQueue } from '../utils/keyed-task-queue.js';
import {
  buildListMetadataEntries,
  fetchCoreList,
  loadListStartupData,
  parseAlbumDeepLink,
  resolveLastSelectedList,
} from './app-list-load-helpers.js';

export function createAppListOperations(deps = {}) {
  const {
    apiCall,
    showToast,
    getLists,
    setLists,
    setListData,
    updateListMetadata,
    updateGroupsFromServer,
    getCurrentListId,
    selectList,
    focusAlbum,
    updateListNav,
    setRecommendationYears,
    loadSnapshotFromStorage,
    getLastSavedSnapshots,
    createListSnapshot,
    saveSnapshotToStorage,
    markLocalSave,
    computeListDiff,
    storage = typeof localStorage !== 'undefined' ? localStorage : null,
    win = typeof window !== 'undefined' ? window : null,
    logger = console,
  } = deps;
  let metadataRefreshGeneration = 0;
  const enqueueSave = createKeyedTaskQueue();
  const saveStates = new Map();

  function getListSaveState(listId) {
    const state = saveStates.get(listId);
    return { pending: state?.pending || 0, version: state?.version || 0 };
  }

  const importList = createListImporter({
    apiCall,
    showToast,
    getLists,
    getCurrentListId,
    win,
    logger,
  });

  async function refreshGroupsAndLists() {
    const refreshGeneration = ++metadataRefreshGeneration;
    try {
      const [fetchedLists, fetchedGroups] = await Promise.all([
        apiCall('/api/lists'),
        apiCall('/api/groups'),
      ]);
      if (refreshGeneration !== metadataRefreshGeneration) return;

      updateGroupsFromServer(fetchedGroups);

      const currentLists = getLists();
      const reconciledLists = buildListMetadataEntries(fetchedLists);
      Object.keys(reconciledLists).forEach((listId) => {
        const current = currentLists[listId];
        if (!Array.isArray(current?._data)) return;

        reconciledLists[listId]._data = current._data;
        reconciledLists[listId]._dataProfile = current._dataProfile || 'full';
      });
      setLists(reconciledLists);

      updateListNav();
      const currentListId = getCurrentListId();
      if (currentListId && !reconciledLists[currentListId]) {
        await selectList(null);
      }
    } catch (error) {
      logger.error('Failed to refresh groups and lists:', error);
    }
  }

  async function loadLists() {
    try {
      const localLastListId = storage?.getItem?.('lastSelectedList');
      const serverLastListId = win?.lastSelectedList;
      const albumDeepLink = parseAlbumDeepLink(win?.location);

      const candidateTargetId =
        albumDeepLink?.listId || localLastListId || serverLastListId || null;
      const {
        candidateDataPromise,
        fetchedLists,
        fetchedGroups,
        recommendationYears,
      } = await loadListStartupData({ apiCall, candidateTargetId, logger });

      setRecommendationYears(recommendationYears);
      updateGroupsFromServer(fetchedGroups);

      const newLists = buildListMetadataEntries(fetchedLists);
      setLists(newLists);
      const hasList = (listId) =>
        Object.prototype.hasOwnProperty.call(newLists, listId);

      const targetListId = resolveLastSelectedList({
        requestedListId: albumDeepLink?.listId,
        localLastListId,
        serverLastListId,
        lists: newLists,
      });

      if (localLastListId && !hasList(localLastListId)) {
        try {
          storage?.removeItem?.('lastSelectedList');
        } catch (_error) {
          // Ignore local storage write failures.
        }
      }

      if (serverLastListId && !hasList(serverLastListId) && win) {
        win.lastSelectedList = null;
      }

      const lists = getLists();
      Object.keys(lists).forEach((listId) => {
        const snapshot = loadSnapshotFromStorage(listId);
        if (snapshot && snapshot.length > 0) {
          getLastSavedSnapshots().set(listId, snapshot);
        }
      });

      if (targetListId) {
        updateListNav(targetListId);
      } else {
        updateListNav();
      }

      if (targetListId) {
        try {
          // Reuse the in-flight prefetch when it was for this same list;
          // otherwise fetch the correct one.
          let listPayload =
            targetListId === candidateTargetId && candidateDataPromise
              ? await candidateDataPromise
              : null;
          if (!listPayload) {
            listPayload = await fetchCoreList(apiCall, targetListId);
          }
          setListData(targetListId, listPayload.items, true, {
            profile: listPayload.profile || 'full',
          });

          let targetIsVisible = getCurrentListId() === targetListId;
          if (!getCurrentListId()) {
            await selectList(targetListId, {
              initialPlaycounts: listPayload.playcounts || null,
            });
            targetIsVisible = true;
            if (localLastListId !== targetListId) {
              try {
                storage?.setItem?.('lastSelectedList', targetListId);
              } catch (_error) {
                // Ignore local storage write failures.
              }
            }
          }
          if (
            targetIsVisible &&
            albumDeepLink?.listId === targetListId &&
            typeof focusAlbum === 'function'
          ) {
            focusAlbum(targetListId, albumDeepLink.albumId);
          }
        } catch (error) {
          logger.warn('Failed to load last selected list:', error);
        }
      }
    } catch (error) {
      logger.error('Error loading lists:', error);
      showToast('Error loading lists', 'error');
    }
  }

  function saveList(listId, data, year = undefined) {
    const visibleData = getLists()[listId]?._data;
    const visibleFingerprint = JSON.stringify(visibleData);
    let cleanedData = data.map((album) => {
      const cleaned = { ...album };
      delete cleaned.points;
      delete cleaned.rank;
      return cleaned;
    });
    if (!saveStates.has(listId)) {
      saveStates.set(listId, {
        pending: 0,
        version: 0,
        failedAdditions: new Map(),
      });
    }
    const saveState = saveStates.get(listId);
    const queuedVersion = ++saveState.version;
    saveState.pending++;

    return enqueueSave(listId, async () => {
      let addedIds = [];
      try {
        // Queued edits may include an optimistic addition whose earlier write
        // failed. Do not silently retry it; an explicit later retry is allowed.
        cleanedData = cleanedData.filter(
          (album) =>
            !(saveState.failedAdditions.get(album.album_id) > queuedVersion)
        );
        // A preceding save may have assigned IDs while this write was queued.
        const liveIds = new Map(
          (getLists()[listId]?._data || []).map((item) => [
            item.album_id,
            item._id,
          ])
        );
        for (const album of cleanedData) {
          if (!album._id && liveIds.get(album.album_id)) {
            album._id = liveIds.get(album.album_id);
          }
        }

        markLocalSave(listId);

        const oldSnapshot = getLastSavedSnapshots().get(listId);
        const previousCount = Array.isArray(oldSnapshot)
          ? oldSnapshot.length
          : getLists()[listId]?.count;
        const diff = computeListDiff(oldSnapshot, cleanedData);
        const previousIds = new Set(oldSnapshot || []);
        addedIds = cleanedData
          .filter((album) => !previousIds.has(album.album_id))
          .map((album) => album.album_id);

        if (diff && diff.totalChanges > 0) {
          const result = await apiCall(
            `/api/lists/${encodeURIComponent(listId)}/items`,
            {
              method: 'PATCH',
              body: JSON.stringify({
                added: diff.added,
                removed: diff.removed,
                updated: diff.updated,
              }),
            }
          );

          if (result.addedItems && result.addedItems.length > 0) {
            for (const added of result.addedItems) {
              const localItem = cleanedData.find(
                (album) => album.album_id === added.album_id
              );
              if (localItem && !localItem._id) {
                localItem._id = added._id;
              }
            }
          }

          const listName = getLists()[listId]?.name || listId;
          logger.log(
            `List "${listName}" saved incrementally: +${diff.added.length} -${diff.removed.length} ~${diff.updated.length}`
          );
        } else {
          await apiCall(`/api/lists/${encodeURIComponent(listId)}`, {
            method: 'PUT',
            body: JSON.stringify({ data: cleanedData }),
          });
        }

        const snapshot = createListSnapshot(cleanedData);
        getLastSavedSnapshots().set(listId, snapshot);
        saveSnapshotToStorage(listId, snapshot);

        const currentData = getLists()[listId]?._data;
        if (
          currentData === visibleData &&
          JSON.stringify(currentData) === visibleFingerprint
        ) {
          setListData(listId, cleanedData, false);
        } else if (currentData) {
          // Never replace newer edits with this response. Only fill missing IDs.
          const savedIds = new Map(
            cleanedData
              .filter((item) => item._id)
              .map((item) => [item.album_id, item._id])
          );
          const withIds = currentData.map((item) =>
            !item._id && savedIds.has(item.album_id)
              ? { ...item, _id: savedIds.get(item.album_id) }
              : item
          );
          if (withIds.some((item, index) => item !== currentData[index])) {
            setListData(listId, withIds, false);
          }
        }
        if (previousCount !== cleanedData.length) {
          updateListNav();
        }

        if (year !== undefined) {
          updateListMetadata(listId, { year });
        }
      } catch (error) {
        const failedVersion = ++saveState.version;
        for (const id of addedIds) {
          saveState.failedAdditions.set(id, failedVersion);
        }
        showToast('Error saving list', 'error');
        throw error;
      } finally {
        saveState.pending--;
        if (!saveState.pending) saveState.failedAdditions.clear();
      }
    });
  }

  return {
    refreshGroupsAndLists,
    loadLists,
    importList,
    saveList,
    getListSaveState,
  };
}
