/**
 * List selection flow for app shell.
 *
 * Orchestrates immediate UI updates, optional list fetch, and preference save.
 */

import { createPostRenderScheduler } from './post-render-scheduler.js';
import { createListSelectionPreloader } from './list-selection-preload.js';
import { fetchCoreList } from './app-list-load-helpers.js';

export function createListSelection(deps = {}) {
  const doc = deps.doc || (typeof document !== 'undefined' ? document : null);
  const win = deps.win || (typeof window !== 'undefined' ? window : null);
  const storage =
    deps.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  const logger = deps.logger || console;
  const setTimeoutFn = deps.setTimeoutFn || setTimeout;
  const clearTimeoutFn = deps.clearTimeoutFn || clearTimeout;
  const createAbortController =
    deps.createAbortController || (() => new AbortController());
  const { schedulePostRenderTask } = deps.schedulePostRenderTask
    ? { schedulePostRenderTask: deps.schedulePostRenderTask }
    : createPostRenderScheduler({ win, setTimeoutFn });

  const {
    setCurrentListId,
    setCurrentRecommendationsYear,
    getCurrentListId,
    getRealtimeSyncModuleInstance,
    clearPlaycountCache,
    primePlaycountCache,
    getLists,
    updateListNavActiveState,
    updateHeaderTitle,
    showLoadingSpinner,
    getListData,
    isListDataLoaded,
    isListDataFullyLoaded,
    getListDataProfile,
    apiCall,
    setListData,
    displayAlbums,
    prefetchPlaycountsForRender,
    fetchAndDisplayPlaycounts,
    wasRecentLocalSave,
    showToast,
  } = deps;
  const { preloadInitialCoverImages, preloadInitialPlaycounts } =
    createListSelectionPreloader({
      win,
      setTimeoutFn,
      clearTimeoutFn,
      createImage: deps.createImage,
      logger,
      primePlaycountCache,
      prefetchPlaycountsForRender,
    });
  let selectionGeneration = 0;
  let selectionAbortController = null;

  function beginSelection(listId) {
    selectionAbortController?.abort();
    selectionGeneration += 1;
    selectionAbortController = createAbortController();

    return {
      controller: selectionAbortController,
      generation: selectionGeneration,
      listId,
    };
  }

  function ownsSelection(selection) {
    return (
      selection.generation === selectionGeneration &&
      selection.controller === selectionAbortController &&
      !selection.controller.signal.aborted &&
      getCurrentListId() === selection.listId
    );
  }

  function isSelectionAbort(error, selection) {
    return error?.name === 'AbortError' || selection.controller.signal.aborted;
  }

  async function hydrateListDetails(selection) {
    const { listId } = selection;
    if (!listId || isListDataFullyLoaded?.(listId)) return;

    try {
      const fullData = await apiCall(
        `/api/lists/${encodeURIComponent(listId)}`,
        { signal: selection.controller.signal }
      );
      if (!ownsSelection(selection)) return;
      if (wasRecentLocalSave?.(listId)) return;

      setListData(listId, fullData, true, { profile: 'full' });
      if (ownsSelection(selection)) {
        displayAlbums(fullData, { hydrate: true });
      }
    } catch (error) {
      if (isSelectionAbort(error, selection)) return;
      logger.warn('Failed to hydrate list details:', error);
    }
  }

  function scheduleCurrentListTask(selection, task, options) {
    schedulePostRenderTask(() => {
      if (!ownsSelection(selection)) return;
      task();
    }, options);
  }

  async function selectList(listId, options = {}) {
    const selection = beginSelection(listId);
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
          const needsFetch = options.forceRefresh || !isListDataLoaded(listId);

          if (needsFetch) {
            const payload = await fetchCoreList(apiCall, listId, {
              signal: selection.controller.signal,
            });
            if (!ownsSelection(selection)) return;
            data = payload.items;
            setListData(listId, data, true, { profile: payload.profile });
          }

          if (ownsSelection(selection)) {
            const [playcountPreloadResult] = await Promise.all([
              preloadInitialPlaycounts(listId, options.initialPlaycounts),
              preloadInitialCoverImages(data),
            ]);
            if (!ownsSelection(selection)) return;

            displayAlbums(data, { forceFullRebuild: true });

            const loadedProfile = getListDataProfile?.(listId) || 'full';
            if (loadedProfile !== 'full') {
              scheduleCurrentListTask(
                selection,
                () => {
                  hydrateListDetails(selection);
                },
                { timeoutMs: 2500 }
              );
            }

            if (
              playcountPreloadResult?.source !== 'prefetch' ||
              (!playcountPreloadResult?.response &&
                !playcountPreloadResult?.timedOut)
            ) {
              scheduleCurrentListTask(
                selection,
                () => {
                  fetchAndDisplayPlaycounts(listId).catch((error) => {
                    logger.warn('Background playcount fetch failed:', error);
                  });
                },
                { delayMs: 250, timeoutMs: 3000 }
              );
            }
          }
        } catch (error) {
          if (isSelectionAbort(error, selection)) return;
          logger.warn('Failed to fetch list data:', error);
          showToast('Error loading list data', 'error');
        }
      }

      if (listId && listId !== win?.lastSelectedList) {
        apiCall('/api/user/last-list', {
          method: 'POST',
          body: JSON.stringify({ listId }),
          signal: selection.controller.signal,
        })
          .then(() => {
            if (win && ownsSelection(selection)) {
              win.lastSelectedList = listId;
            }
          })
          .catch((error) => {
            if (isSelectionAbort(error, selection)) return;
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
