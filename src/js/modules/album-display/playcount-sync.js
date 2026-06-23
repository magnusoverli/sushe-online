import {
  applyMobilePlaycount,
  applyDesktopPlaycount,
} from './playcount-view.js';

export function createPlaycountSync(deps = {}) {
  const {
    apiCall,
    formatPlaycount,
    logger = console,
    doc = globalThis.document,
    win = typeof window !== 'undefined' ? window : null,
    createAbortController = () => new AbortController(),
    schedule = (callback, delay) => setTimeout(callback, delay),
  } = deps;

  // Last.fm playcount cache: { listItemId: { playcount, status } | null }
  // status can be: 'success', 'not_found', 'error', or null (not yet fetched)
  let playcountCache = {};
  let playcountFetchInProgress = false;

  // AbortControllers for active polling sessions (one per list)
  const pollingControllers = new Map(); // listId -> AbortController

  function getPlaycountCacheEntry(itemId) {
    return playcountCache[itemId];
  }

  function clearPlaycountCache() {
    pollingControllers.forEach((controller) => {
      controller.abort();
    });
    pollingControllers.clear();

    playcountCache = {};
  }

  function primePlaycountCache(playcounts) {
    if (!playcounts || typeof playcounts !== 'object') return;
    Object.assign(playcountCache, playcounts);
  }

  function cancelPollingForList(listId) {
    const controller = pollingControllers.get(listId);
    if (controller) {
      controller.abort();
      pollingControllers.delete(listId);
    }
  }

  function hasLastfmConnection() {
    if (!win?.currentUser) return true;
    return !!win.currentUser.lastfmUsername;
  }

  function isLastfmNotConnectedError(err) {
    const data = err?.data || err;
    return (
      data?.service === 'lastfm' &&
      data?.code === 'NOT_AUTHENTICATED' &&
      data?.error === 'Last.fm not connected'
    );
  }

  function updateDesktopElement(itemId, playcount, status) {
    if (!doc?.querySelector) return;
    const desktopEl = doc.querySelector(`[data-playcount="${itemId}"]`);
    if (!desktopEl) return;

    if (status === 'not_found') {
      applyDesktopPlaycount(desktopEl, 'not_found');
    } else if (status === 'success') {
      applyDesktopPlaycount(
        desktopEl,
        'success',
        formatPlaycount(playcount),
        playcount
      );
    }
  }

  function updateMobileElement(itemId, playcount, status) {
    if (!doc?.querySelector) return;
    const mobileEl = doc.querySelector(`[data-playcount-mobile="${itemId}"]`);
    if (!mobileEl) return;

    if (status === 'not_found') {
      applyMobilePlaycount(mobileEl, 'not_found');
    } else if (status === 'success') {
      applyMobilePlaycount(mobileEl, 'success', formatPlaycount(playcount));
    }
  }

  function updatePlaycountElements(playcounts) {
    for (const [itemId, data] of Object.entries(playcounts)) {
      if (data === null || data === undefined) continue;

      const { playcount, status } = data;
      updateDesktopElement(itemId, playcount, status);
      updateMobileElement(itemId, playcount, status);
    }
  }

  function applyPlaycountUpdates(playcounts) {
    if (!playcounts || typeof playcounts !== 'object') return;
    Object.assign(playcountCache, playcounts);
    updatePlaycountElements(playcounts);
  }

  if (win?.addEventListener) {
    win.addEventListener('lastfm-playcounts-updated', (event) => {
      applyPlaycountUpdates(event.detail?.playcounts);
    });
  }

  async function pollForRefreshedPlaycounts(listId, expectedCount) {
    cancelPollingForList(listId);

    const controller = createAbortController();
    pollingControllers.set(listId, controller);
    const { signal } = controller;

    // Mirror the server's batch pacing (5 albums per batch, ~1.1s between
    // batches) so MAX_POLLS is bounded by a realistic completion estimate.
    const estimatedBatches = Math.ceil(expectedCount / 5);
    const estimatedTimeMs = estimatedBatches * 1100 + 3000;

    const POLL_INTERVAL = 3000;
    const MAX_POLLS = Math.max(
      5,
      Math.ceil(estimatedTimeMs / POLL_INTERVAL) + 2
    );
    const MIN_POLLS = 3;

    let pollCount = 0;
    let previousPlaycounts = { ...playcountCache };

    const poll = async () => {
      if (signal.aborted) {
        return;
      }

      if (!hasLastfmConnection()) {
        pollingControllers.delete(listId);
        return;
      }

      pollCount++;

      try {
        const response = await apiCall(
          `/api/lastfm/list-playcounts/${listId}`,
          {
            signal,
          }
        );

        if (response.playcounts) {
          let changedCount = 0;
          for (const [itemId, data] of Object.entries(response.playcounts)) {
            const prev = previousPlaycounts[itemId];
            const hasChanged =
              (data === null) !== (prev === null) ||
              (data &&
                prev &&
                (data.playcount !== prev.playcount ||
                  data.status !== prev.status));
            if (hasChanged) {
              changedCount++;
            }
          }

          applyPlaycountUpdates(response.playcounts);
          previousPlaycounts = JSON.parse(JSON.stringify(response.playcounts));

          const missingCount = Object.values(response.playcounts).filter(
            (value) => value === null || (value && value.status === 'error')
          ).length;

          // The server reports how many albums are still queued for a
          // background refresh. We must keep polling while that is > 0 —
          // otherwise a stale-but-cached value (which now displays instead of
          // showing blank) looks "done" and we'd stop before the fresh value
          // lands, freezing the UI on the stale number.
          const stillRefreshing = (response.refreshing || 0) > 0;

          if (changedCount > 0) {
            logger.log(
              `Playcounts updated: ${changedCount} changed, ${missingCount} missing, ${response.refreshing || 0} refreshing`
            );
          }

          if (
            !stillRefreshing &&
            changedCount === 0 &&
            pollCount >= MIN_POLLS
          ) {
            logger.log('All playcounts loaded');
            pollingControllers.delete(listId);
            return;
          }

          if (pollCount < MAX_POLLS) {
            const interval =
              changedCount > 0 || stillRefreshing
                ? POLL_INTERVAL
                : POLL_INTERVAL * 1.5;
            schedule(poll, interval);
          } else {
            pollingControllers.delete(listId);
          }
        }
      } catch (err) {
        if (err.name === 'AbortError') {
          logger.log(`Playcount polling cancelled for list ${listId}`);
          return;
        }

        if (err.message?.includes('List not found')) {
          logger.log(
            `List ${listId} no longer exists, stopping playcount poll`
          );
          pollingControllers.delete(listId);
          return;
        }

        logger.warn('Playcount poll failed:', err);
        if (pollCount < MAX_POLLS && !signal.aborted) {
          schedule(poll, POLL_INTERVAL);
        }
      }
    };

    schedule(poll, POLL_INTERVAL);
  }

  async function fetchAndDisplayPlaycounts(listId, forceRefresh = false) {
    if (!listId || playcountFetchInProgress) return;

    if (!hasLastfmConnection()) {
      clearPlaycountCache();
      return;
    }

    playcountFetchInProgress = true;

    try {
      const response = await apiCall(
        `/api/lastfm/list-playcounts/${listId}${forceRefresh ? '?refresh=true' : ''}`
      );

      if (response.error) {
        if (response.error !== 'Last.fm not connected') {
          logger.warn('Failed to fetch playcounts:', response.error);
        }
        return;
      }

      const { playcounts, refreshing } = response;

      applyPlaycountUpdates(playcounts);

      if (refreshing > 0) {
        pollForRefreshedPlaycounts(listId, refreshing);
      }
    } catch (err) {
      if (isLastfmNotConnectedError(err)) {
        clearPlaycountCache();
        return;
      }

      logger.warn('Playcount fetch error:', err);
    } finally {
      playcountFetchInProgress = false;
    }
  }

  async function prefetchPlaycountsForRender(listId) {
    if (!listId || playcountFetchInProgress) return null;

    if (!hasLastfmConnection()) {
      clearPlaycountCache();
      return null;
    }

    playcountFetchInProgress = true;

    try {
      const response = await apiCall(`/api/lastfm/list-playcounts/${listId}`);

      if (response.error) {
        if (response.error !== 'Last.fm not connected') {
          logger.warn('Failed to fetch playcounts:', response.error);
        }
        return null;
      }

      const { playcounts, refreshing } = response;
      applyPlaycountUpdates(playcounts);

      if (refreshing > 0) {
        pollForRefreshedPlaycounts(listId, refreshing);
      }

      return response;
    } catch (err) {
      if (isLastfmNotConnectedError(err)) {
        clearPlaycountCache();
        return null;
      }

      logger.warn('Playcount fetch error:', err);
      return null;
    } finally {
      playcountFetchInProgress = false;
    }
  }

  return {
    getPlaycountCacheEntry,
    primePlaycountCache,
    clearPlaycountCache,
    cancelPollingForList,
    prefetchPlaycountsForRender,
    fetchAndDisplayPlaycounts,
  };
}
