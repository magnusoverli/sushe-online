/**
 * List loading, import, and persistence flows for app composition.
 */
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

  async function importList(name, albums, metadata = null) {
    try {
      let year;
      let groupId = null;

      if (metadata) {
        if (metadata.year !== null && metadata.year !== undefined) {
          year = metadata.year;
        }
        if (metadata.group_id) {
          groupId = metadata.group_id;
        }
      }

      const cleanedAlbums = albums.map((album) => {
        const cleaned = { ...album };
        delete cleaned.points;
        delete cleaned.rank;
        delete cleaned._id;
        return cleaned;
      });

      const body = { name, data: cleanedAlbums };
      if (year !== undefined) {
        body.year = year;
      }
      if (groupId) {
        body.groupId = groupId;
      }

      const createResult = await apiCall('/api/lists', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      const listId = createResult._id;
      const savedList = await apiCall(
        `/api/lists/${encodeURIComponent(listId)}`
      );

      getLists()[listId] = {
        _id: listId,
        name,
        year: year || null,
        isMain: false,
        count: savedList.length,
        groupId,
        sortOrder: 0,
        _data: savedList,
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };

      const albumToListItemMap = new Map();
      for (const item of savedList) {
        if (item.album_id && item._id) {
          albumToListItemMap.set(item.album_id, item._id);
        }
      }

      let trackPicksImported = 0;
      let summariesImported = 0;

      for (const album of albums) {
        const albumId = album.album_id;
        if (!albumId) continue;

        const listItemId = albumToListItemMap.get(albumId);
        if (listItemId && (album.primary_track || album.secondary_track)) {
          try {
            if (album.primary_track) {
              await apiCall(`/api/track-picks/${listItemId}`, {
                method: 'POST',
                body: JSON.stringify({
                  trackIdentifier: album.primary_track,
                  priority: 1,
                }),
              });
              trackPicksImported++;
            }

            if (album.secondary_track) {
              await apiCall(`/api/track-picks/${listItemId}`, {
                method: 'POST',
                body: JSON.stringify({
                  trackIdentifier: album.secondary_track,
                  priority: 2,
                }),
              });
              trackPicksImported++;
            }
          } catch (error) {
            logger.warn(
              'Failed to import track picks for list item',
              listItemId,
              error
            );
          }
        }

        if (album.summary || album.summary_source) {
          try {
            await apiCall(`/api/albums/${albumId}/summary`, {
              method: 'PUT',
              body: JSON.stringify({
                summary: album.summary || '',
                summary_source: album.summary_source || '',
              }),
            });
            summariesImported++;
          } catch (error) {
            logger.warn('Failed to import summary for album', albumId, error);
          }
        }
      }

      if (listId === getCurrentListId() && win?.refreshMobileBarVisibility) {
        win.refreshMobileBarVisibility();
      }

      if (trackPicksImported > 0 || summariesImported > 0) {
        logger.log(
          `Imported ${trackPicksImported} track picks and ${summariesImported} summaries`
        );
      }

      return listId;
    } catch (error) {
      showToast('Error importing list', 'error');
      throw error;
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
