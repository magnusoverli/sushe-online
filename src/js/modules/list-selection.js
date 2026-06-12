/**
 * List selection flow for app shell.
 *
 * Orchestrates immediate UI updates, optional list fetch, and preference save.
 */

import { createPostRenderScheduler } from './post-render-scheduler.js';

const INITIAL_DESKTOP_COVER_PRELOAD_COUNT = 16;
const INITIAL_MOBILE_COVER_PRELOAD_COUNT = 8;
const INITIAL_COVER_PRELOAD_TIMEOUT_MS = 650;
const INITIAL_PLAYCOUNT_PRELOAD_TIMEOUT_MS = 650;

export function createListSelection(deps = {}) {
  const doc = deps.doc || (typeof document !== 'undefined' ? document : null);
  const win = deps.win || (typeof window !== 'undefined' ? window : null);
  const storage =
    deps.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  const logger = deps.logger || console;
  const setTimeoutFn = deps.setTimeoutFn || setTimeout;
  const clearTimeoutFn = deps.clearTimeoutFn || clearTimeout;
  const createImage =
    deps.createImage ||
    (() => {
      if (typeof win?.Image === 'function') return new win.Image();
      if (typeof globalThis.Image === 'function') return new globalThis.Image();
      return null;
    });
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

  function getAlbumIdentity(album) {
    return (
      album?._id ||
      album?.album_id ||
      `${album?.artist || ''}::${album?.album || ''}::${album?.release_date || ''}`
    );
  }

  function hasSameAlbumOrder(currentData, nextData) {
    if (!Array.isArray(currentData) || !Array.isArray(nextData)) return false;
    if (currentData.length !== nextData.length) return false;

    return currentData.every(
      (album, index) =>
        getAlbumIdentity(album) === getAlbumIdentity(nextData[index])
    );
  }

  function getInitialCoverPreloadCount() {
    return win?.innerWidth < 1024
      ? INITIAL_MOBILE_COVER_PRELOAD_COUNT
      : INITIAL_DESKTOP_COVER_PRELOAD_COUNT;
  }

  function getCoverPreloadUrl(album) {
    if (!album || album.cover_image) return null;
    return album.cover_thumb_url || album.cover_image_url || null;
  }

  function preloadCoverImage(url) {
    return new Promise((resolve) => {
      const image = createImage();
      if (!image) {
        resolve();
        return;
      }

      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const finishAfterDecode = () => {
        if (typeof image.decode === 'function') {
          image
            .decode()
            .catch(() => {})
            .finally(done);
          return;
        }
        done();
      };

      image.onload = finishAfterDecode;
      image.onerror = done;
      image.src = url;

      if (image.complete && image.naturalWidth !== 0) {
        finishAfterDecode();
      }
    });
  }

  async function preloadInitialCoverImages(albums) {
    if (!Array.isArray(albums) || albums.length === 0) return;

    const urls = [];
    const seen = new Set();
    const initialCount = getInitialCoverPreloadCount();

    for (const album of albums.slice(0, initialCount)) {
      const url = getCoverPreloadUrl(album);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
    }

    if (urls.length === 0) return;

    await new Promise((resolve) => {
      let settled = false;
      const timer = setTimeoutFn(() => {
        if (settled) return;
        settled = true;
        resolve();
      }, INITIAL_COVER_PRELOAD_TIMEOUT_MS);
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeoutFn(timer);
        resolve();
      };

      Promise.all(urls.map(preloadCoverImage)).then(finish, finish);
    });
  }

  function hasRenderablePlaycounts(playcounts) {
    if (!playcounts || typeof playcounts !== 'object') return false;
    return Object.values(playcounts).some(
      (entry) =>
        entry && (entry.status === 'not_found' || entry.playcount != null)
    );
  }

  async function preloadInitialPlaycounts(listId, initialPlaycounts) {
    if (hasRenderablePlaycounts(initialPlaycounts)) {
      primePlaycountCache?.(initialPlaycounts);
      return { source: 'bootstrap', timedOut: false };
    }

    if (initialPlaycounts && typeof initialPlaycounts === 'object') {
      primePlaycountCache?.(initialPlaycounts);
    }

    if (!prefetchPlaycountsForRender) {
      return { source: 'none', timedOut: false };
    }

    let settled = false;
    let timeoutId = null;
    const prefetchPromise = prefetchPlaycountsForRender(listId)
      .then((response) => {
        settled = true;
        if (timeoutId !== null) clearTimeoutFn(timeoutId);
        return { source: 'prefetch', response, timedOut: false };
      })
      .catch((error) => {
        settled = true;
        if (timeoutId !== null) clearTimeoutFn(timeoutId);
        logger.warn('Early playcount fetch failed:', error);
        return { source: 'prefetch', response: null, timedOut: false };
      });

    const timeoutPromise = new Promise((resolve) => {
      timeoutId = setTimeoutFn(() => {
        if (settled) return;
        resolve({ source: 'prefetch', response: null, timedOut: true });
      }, INITIAL_PLAYCOUNT_PRELOAD_TIMEOUT_MS);
    });

    return Promise.race([prefetchPromise, timeoutPromise]);
  }

  async function hydrateListDetails(listId) {
    if (!listId || isListDataFullyLoaded?.(listId)) return;

    try {
      const fullData = await apiCall(
        `/api/lists/${encodeURIComponent(listId)}`
      );
      if (getCurrentListId() !== listId) return;
      if (wasRecentLocalSave?.(listId)) return;

      const currentData = getListData(listId);
      setListData(listId, fullData, true, { profile: 'full' });
      if (getCurrentListId() === listId) {
        if (!hasSameAlbumOrder(currentData, fullData)) {
          displayAlbums(fullData, { forceFullRebuild: true });
        }
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
