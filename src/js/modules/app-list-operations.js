/**
 * List loading, import, and persistence flows for app composition.
 */
import { createListImporter } from './app-list-import.js';
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

  async function saveList(listId, data, year = undefined) {
    try {
      const cleanedData = data.map((album) => {
        const cleaned = { ...album };
        delete cleaned.points;
        delete cleaned.rank;
        return cleaned;
      });

      markLocalSave(listId);

      const oldSnapshot = getLastSavedSnapshots().get(listId);
      const previousCount = Array.isArray(oldSnapshot)
        ? oldSnapshot.length
        : getLists()[listId]?.count;
      const diff = computeListDiff(oldSnapshot, cleanedData);

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

      setListData(listId, cleanedData);
      if (previousCount !== cleanedData.length) {
        updateListNav();
      }

      if (year !== undefined) {
        updateListMetadata(listId, { year });
      }
    } catch (error) {
      showToast('Error saving list', 'error');
      throw error;
    }
  }

  return {
    refreshGroupsAndLists,
    loadLists,
    importList,
    saveList,
  };
}
