/**
 * List loading, import, and persistence flows for app composition.
 */
import { createListImporter } from './app-list-import.js';
import { createListWriteQueue } from './list-write-queue.js';
import { createListReorder } from './list-reorder.js';
import { getListRevision } from './list-revisions.js';
import { rebaseListChanges } from '../utils/rebase-list.js';
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
    updateHeaderTitle = () => {},
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
  const failedAdditions = new Map();
  const queuedSnapshots = new Map();
  const writes = createListWriteQueue({
    onIdle: (listId) => {
      failedAdditions.delete(listId);
      queuedSnapshots.delete(listId);
    },
  });
  const { saveReorder } = createListReorder({
    apiCall,
    logger,
    getLastSavedSnapshots,
    saveSnapshotToStorage,
  });

  function debouncedSaveReorder(listId, data) {
    const order = data.map((item) => ({ album_id: item.album_id }));
    return writes.schedule(
      listId,
      async () => {
        markLocalSave(listId);
        await saveReorder(listId, order);
      },
      { kind: 'reorder' }
    );
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
      if (reconciledLists[currentListId])
        updateHeaderTitle(reconciledLists[currentListId].name);
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

  function saveList(listId, data, year = undefined, { expectedRevision } = {}) {
    const baseline =
      queuedSnapshots.get(listId) || getLastSavedSnapshots().get(listId);
    const revision = expectedRevision ?? getListRevision(listId);
    const precondition =
      revision === undefined
        ? {}
        : { headers: { 'If-Match': `"${revision}"` } };
    const visibleData = getLists()[listId]?._data;
    const visibleFingerprint = JSON.stringify(visibleData);
    let cleanedData = data.map((album) => {
      const cleaned = { ...album };
      delete cleaned.points;
      delete cleaned.rank;
      return cleaned;
    });
    let addedIds = [];
    queuedSnapshots.set(listId, createListSnapshot(cleanedData));

    return writes.schedule(
      listId,
      async (queuedVersion) => {
        let saveResult;
        let requestedData;
        const listUrl = `/api/lists/${encodeURIComponent(listId)}`;
        const prepareWrite =
          expectedRevision === undefined && baseline?.records
            ? async () => {
                const remote = await apiCall(listUrl);
                cleanedData = rebaseListChanges(
                  baseline,
                  requestedData,
                  remote
                );
                return {
                  body: JSON.stringify({ data: cleanedData }),
                  headers: {
                    'If-Match': `"${remote._listRevision ?? getListRevision(listId)}"`,
                  },
                };
              }
            : undefined;
        const persist = async (url, options) => {
          try {
            return await apiCall(url, options);
          } catch (error) {
            if (error.code !== 'LIST_CONFLICT' || !prepareWrite) throw error;
            return apiCall(listUrl, {
              method: 'PUT',
              prepareWrite,
              body: JSON.stringify({ data: cleanedData }),
            });
          }
        };
        try {
          // Queued edits may include an optimistic addition whose earlier write
          // failed. Do not silently retry it; an explicit later retry is allowed.
          cleanedData = cleanedData.filter(
            (album) =>
              !(
                failedAdditions.get(listId)?.get(album.album_id) > queuedVersion
              )
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

          requestedData = cleanedData;
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
            const result = await persist(
              `/api/lists/${encodeURIComponent(listId)}/items`,
              {
                method: 'PATCH',
                ...precondition,
                body: JSON.stringify({
                  added: diff.added,
                  removed: diff.removed,
                  updated: diff.updated,
                }),
              }
            );
            saveResult = result;

            if (result.addedItems && result.addedItems.length > 0) {
              for (const added of result.addedItems) {
                const localItem = cleanedData.find(
                  (album) =>
                    album.album_id === (added.inputAlbumId || added.album_id)
                );
                if (localItem) {
                  localItem._id = added._id;
                  localItem.album_id = added.album_id;
                }
              }
            }
            if (result.duplicates?.length) {
              const inserted = new Set(
                (result.addedItems || []).map((item) => item.album_id)
              );
              const seen = new Set();
              cleanedData = cleanedData.filter((album) => {
                const duplicate = result.duplicates.some(
                  (item) =>
                    item.album_id === album.album_id ||
                    (item.artist === album.artist && item.album === album.album)
                );
                if (
                  (duplicate &&
                    !previousIds.has(album.album_id) &&
                    !inserted.has(album.album_id)) ||
                  seen.has(album.album_id)
                )
                  return false;
                seen.add(album.album_id);
                return true;
              });
            }

            const listName = getLists()[listId]?.name || listId;
            logger.log(
              `List "${listName}" saved incrementally: +${diff.added.length} -${diff.removed.length} ~${diff.updated.length}`
            );
          } else {
            saveResult = await persist(
              `/api/lists/${encodeURIComponent(listId)}`,
              {
                method: 'PUT',
                ...precondition,
                prepareWrite,
                body: JSON.stringify({ data: cleanedData }),
              }
            );
          }

          for (const added of saveResult?.addedItems || []) {
            const item = cleanedData.find(
              (entry) =>
                entry.album_id === (added.inputAlbumId || added.album_id)
            );
            if (item) {
              item._id = added._id;
              item.album_id = added.album_id;
            }
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
          return saveResult;
        } catch (error) {
          showToast(
            error.code === 'LIST_CONFLICT' ||
              error.code === 'LIST_REVISION_REQUIRED' ||
              error.code === 'SESSION_EXPIRED'
              ? error.message
              : 'Error saving list',
            'error'
          );
          throw error;
        }
      },
      {
        onError: (_error, failedVersion) => {
          if (!failedAdditions.has(listId))
            failedAdditions.set(listId, new Map());
          for (const id of addedIds) {
            failedAdditions.get(listId).set(id, failedVersion);
          }
        },
      }
    );
  }

  return {
    refreshGroupsAndLists,
    loadLists,
    importList,
    saveList,
    debouncedSaveReorder,
    flushReorder: writes.flush,
    getListSaveState: writes.getState,
    waitForListSaves: writes.wait,
  };
}
