/**
 * List loading, import, and persistence flows for app composition.
 */
import { createListImporter } from './app-list-import.js';

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

  const importList = createListImporter({
    apiCall,
    showToast,
    getLists,
    getCurrentListId,
    win,
    logger,
  });

  async function refreshGroupsAndLists() {
    try {
      const [fetchedLists, fetchedGroups] = await Promise.all([
        apiCall('/api/lists'),
        apiCall('/api/groups'),
      ]);

      updateGroupsFromServer(fetchedGroups);

      const currentLists = getLists();
      Object.keys(fetchedLists).forEach((listId) => {
        const meta = fetchedLists[listId];
        if (currentLists[listId]) {
          currentLists[listId] = {
            ...currentLists[listId],
            name: meta.name || currentLists[listId].name || 'Unknown',
            year: meta.year || null,
            isMain: meta.isMain || false,
            count: meta.count || 0,
            groupId: meta.groupId || null,
            sortOrder: meta.sortOrder || 0,
            updatedAt: meta.updatedAt || null,
          };
        } else {
          currentLists[listId] = {
            _id: listId,
            name: meta.name || 'Unknown',
            year: meta.year || null,
            isMain: meta.isMain || false,
            count: meta.count || 0,
            groupId: meta.groupId || null,
            sortOrder: meta.sortOrder || 0,
            _data: null,
            updatedAt: meta.updatedAt || null,
            createdAt: meta.createdAt || null,
          };
        }
      });

      updateListNav();
    } catch (error) {
      logger.error('Failed to refresh groups and lists:', error);
    }
  }

  async function loadLists() {
    try {
      const localLastListId = storage?.getItem?.('lastSelectedList');
      const serverLastListId = win?.lastSelectedList;
      const targetListId = localLastListId || serverLastListId;

      const metadataPromise = apiCall('/api/lists');
      const groupsPromise = apiCall('/api/groups');
      const recYearsPromise = apiCall('/api/recommendations/years').catch(
        () => ({
          years: [],
        })
      );
      const listDataPromise = targetListId
        ? apiCall(`/api/lists/${encodeURIComponent(targetListId)}`)
        : null;

      const [fetchedLists, fetchedGroups, recYearsData] = await Promise.all([
        metadataPromise,
        groupsPromise,
        recYearsPromise,
      ]);

      setRecommendationYears(recYearsData.years || []);
      updateGroupsFromServer(fetchedGroups);

      const newLists = {};
      Object.keys(fetchedLists).forEach((listId) => {
        const meta = fetchedLists[listId];
        newLists[listId] = {
          _id: listId,
          name: meta.name || 'Unknown',
          year: meta.year || null,
          isMain: meta.isMain || false,
          count: meta.count || 0,
          groupId: meta.groupId || null,
          sortOrder: meta.sortOrder || 0,
          _data: null,
          updatedAt: meta.updatedAt || null,
          createdAt: meta.createdAt || null,
        };
      });
      setLists(newLists);

      const lists = getLists();
      Object.keys(lists).forEach((listId) => {
        const snapshot = loadSnapshotFromStorage(listId);
        if (snapshot && snapshot.length > 0) {
          getLastSavedSnapshots().set(listId, snapshot);
        }
      });

      updateListNav();

      if (listDataPromise && targetListId) {
        try {
          const listData = await listDataPromise;
          setListData(targetListId, listData);

          if (!getCurrentListId()) {
            selectList(targetListId);
            if (!localLastListId && serverLastListId) {
              try {
                storage?.setItem?.('lastSelectedList', serverLastListId);
              } catch (_error) {
                // Ignore local storage write failures.
              }
            }
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

      if (year !== undefined) {
        updateListMetadata(listId, { year });
      }

      if (listId === getCurrentListId() && win?.refreshMobileBarVisibility) {
        win.refreshMobileBarVisibility();
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
