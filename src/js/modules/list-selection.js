/**
 * List selection flow for app shell.
 *
 * Orchestrates immediate UI updates, optional list fetch, and preference save.
 */

export function createListSelection(deps = {}) {
  const doc = deps.doc || (typeof document !== 'undefined' ? document : null);
  const win = deps.win || (typeof window !== 'undefined' ? window : null);
  const storage =
    deps.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  const logger = deps.logger || console;

  const {
    setCurrentListId,
    setCurrentRecommendationsYear,
    getCurrentListId,
    getRealtimeSyncModuleInstance,
    clearPlaycountCache,
    getLists,
    updateListNavActiveState,
    updateHeaderTitle,
    updateMobileHeader,
    showLoadingSpinner,
    getListData,
    isListDataLoaded,
    apiCall,
    setListData,
    displayAlbums,
    fetchAndDisplayPlaycounts,
    showToast,
  } = deps;

  async function selectList(listId) {
    try {
      const previousListId = getCurrentListId();

      setCurrentListId(listId);
      setCurrentRecommendationsYear(null);

      const rtSync = getRealtimeSyncModuleInstance();
      if (rtSync) {
        if (previousListId && previousListId !== listId) {
          rtSync.unsubscribeFromList(previousListId);
        }
        if (listId) {
          rtSync.subscribeToList(listId);
        }
      }

      clearPlaycountCache();

      const listName = getLists()[listId]?.name || '';
      updateListNavActiveState(listId);
      updateHeaderTitle(listName);
      updateMobileHeader();

      const fab = doc?.getElementById('addAlbumFAB');
      if (fab) {
        fab.style.display = listId ? 'flex' : 'none';
      }

      const container = doc?.getElementById('albumContainer');
      if (container && listId) {
        showLoadingSpinner(container);
      }

      if (listId && storage) {
        try {
          storage.setItem('lastSelectedList', listId);
        } catch (error) {
          if (error?.name === 'QuotaExceededError') {
            logger.warn(
              'LocalStorage quota exceeded, skipping lastSelectedList save'
            );
          }
        }
      }

      if (listId) {
        try {
          let data = getListData(listId);
          const needsFetch = !isListDataLoaded(listId);

          if (needsFetch) {
            data = await apiCall(`/api/lists/${encodeURIComponent(listId)}`);
            setListData(listId, data);
          }

          if (getCurrentListId() === listId) {
            displayAlbums(data, { forceFullRebuild: true });

            fetchAndDisplayPlaycounts(listId).catch((error) => {
              logger.warn('Background playcount fetch failed:', error);
            });

            if (win?.refreshMobileBarVisibility) {
              win.refreshMobileBarVisibility();
            }
          }
        } catch (error) {
          logger.warn('Failed to fetch list data:', error);
          showToast('Error loading list data', 'error');
        }
      }

      if (listId && listId !== win?.lastSelectedList) {
        apiCall('/api/user/last-list', {
          method: 'POST',
          body: JSON.stringify({ listId }),
        })
          .then(() => {
            if (win) {
              win.lastSelectedList = listId;
            }
          })
          .catch((error) => {
            logger.warn('Failed to save list preference:', error);
          });
      }
    } catch (_error) {
      showToast('Error loading list', 'error');
    }
  }

  return {
    selectList,
  };
}
