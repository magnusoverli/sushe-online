/**
 * List selection flow for app shell.
 *
 * Orchestrates immediate UI updates, optional list fetch, and preference save.
 */

import { createPostRenderScheduler } from './post-render-scheduler.js';
import { createListSelectionPreloader } from './list-selection-preload.js';

export function createListSelection(deps = {}) {
  const doc = deps.doc || (typeof document !== 'undefined' ? document : null);
  const win = deps.win || (typeof window !== 'undefined' ? window : null);
  const storage =
    deps.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  const logger = deps.logger || console;
  const setTimeoutFn = deps.setTimeoutFn || setTimeout;
  const clearTimeoutFn = deps.clearTimeoutFn || clearTimeout;
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
    updateMobileHeader,
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

  async function hydrateListDetails(listId) {
    if (!listId || isListDataFullyLoaded?.(listId)) return;

    try {
      const fullData = await apiCall(
        `/api/lists/${encodeURIComponent(listId)}`
      );
      if (getCurrentListId() !== listId) return;
      if (wasRecentLocalSave?.(listId)) return;

      setListData(listId, fullData, true, { profile: 'full' });
      if (getCurrentListId() === listId) {
        // Always rebuild on the core->full upgrade. The full profile adds data
        // the core render cannot show — the summary and recommendation badges
        // and track names — and those fields are part of neither the album-order
        // identity nor the mutable fingerprint, so a diff or order check would
        // skip them and the badges would never appear. wasRecentLocalSave above
        // already guards against clobbering in-flight local edits.
        displayAlbums(fullData, { forceFullRebuild: true });
      }
    } catch (error) {
      logger.warn('Failed to hydrate list details:', error);
    }
  }

  async function fetchCoreList(listId) {
    return apiCall(`/api/lists/${encodeURIComponent(listId)}?profile=core`)
      .then((items) => ({ items, profile: 'core' }))
      .catch(() =>
        apiCall(`/api/lists/${encodeURIComponent(listId)}`).then((items) => ({
          items,
          profile: 'full',
        }))
      );
  }

  function scheduleCurrentListTask(listId, task, options) {
    schedulePostRenderTask(() => {
      if (getCurrentListId() !== listId) return;
      task();
    }, options);
  }

  async function selectList(listId, options = {}) {
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
            const payload = await fetchCoreList(listId);
            data = payload.items;
            setListData(listId, data, true, { profile: payload.profile });
          }

          if (getCurrentListId() === listId) {
            const [playcountPreloadResult] = await Promise.all([
              preloadInitialPlaycounts(listId, options.initialPlaycounts),
              preloadInitialCoverImages(data),
            ]);
            if (getCurrentListId() !== listId) return;

            displayAlbums(data, { forceFullRebuild: true });

            const loadedProfile = getListDataProfile?.(listId) || 'full';
            if (loadedProfile !== 'full') {
              scheduleCurrentListTask(
                listId,
                () => {
                  hydrateListDetails(listId);
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
                listId,
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
