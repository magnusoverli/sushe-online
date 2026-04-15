export function createPlaycountSync(deps = {}) {
  const {
    apiCall,
    formatPlaycount,
    logger = console,
    doc = globalThis.document,
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

  function cancelPollingForList(listId) {
    const controller = pollingControllers.get(listId);
    if (controller) {
      controller.abort();
      pollingControllers.delete(listId);
    }
  }

  function updateDesktopElement(itemId, playcount, status) {
    if (!doc?.querySelector) return;
    const desktopEl = doc.querySelector(`[data-playcount="${itemId}"]`);
    if (!desktopEl) return;

    if (status === 'not_found') {
      desktopEl.innerHTML = `<i class="fas fa-times text-[10px]"></i>`;
      desktopEl.title = 'Album not found on Last.fm';
      desktopEl.className = 'text-xs text-red-500 shrink-0';
      desktopEl.dataset.status = 'not_found';
      desktopEl.classList.remove('hidden');
      return;
    }

    if (status === 'success') {
      const display = formatPlaycount(playcount);
      desktopEl.innerHTML = `<i class="fas fa-headphones text-[10px] mr-1"></i>${display}`;
      desktopEl.title = `${playcount} plays on Last.fm`;
      desktopEl.className = 'text-xs text-gray-500 shrink-0';
      desktopEl.dataset.status = 'success';
      desktopEl.classList.remove('hidden');
    }
  }

  function updateMobileElement(itemId, playcount, status) {
    if (!doc?.querySelector) return;
    const mobileEl = doc.querySelector(`[data-playcount-mobile="${itemId}"]`);
    if (!mobileEl) return;

    if (status === 'not_found') {
      mobileEl.innerHTML = `<i class="fas fa-times text-[10px]"></i>`;
      mobileEl.title = 'Album not found on Last.fm';
      mobileEl.className = 'text-red-500 ml-4';
      mobileEl.dataset.status = 'not_found';
      mobileEl.classList.remove('hidden');
      return;
    }

    if (status === 'success') {
      const display = formatPlaycount(playcount);
      mobileEl.innerHTML = `<i class="fas fa-headphones text-[10px]"></i> ${display}`;
      mobileEl.className = 'text-gray-600 ml-4';
      mobileEl.dataset.status = 'success';
      mobileEl.classList.remove('hidden');
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

  async function pollForRefreshedPlaycounts(listId, expectedCount) {
    cancelPollingForList(listId);

    const controller = createAbortController();
    pollingControllers.set(listId, controller);
    const { signal } = controller;

    const estimatedBatches = Math.ceil(expectedCount / 3);
    const estimatedTimeMs = estimatedBatches * 1500 + 3000;

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

          Object.assign(playcountCache, response.playcounts);
          updatePlaycountElements(response.playcounts);
          previousPlaycounts = JSON.parse(JSON.stringify(response.playcounts));

          const missingCount = Object.values(response.playcounts).filter(
            (value) => value === null || (value && value.status === 'error')
          ).length;

          if (changedCount > 0) {
            logger.log(
              `Playcounts updated: ${changedCount} changed, ${missingCount} missing`
            );
          }

          if (
            missingCount === 0 &&
            changedCount === 0 &&
            pollCount >= MIN_POLLS
          ) {
            logger.log('All playcounts loaded');
            pollingControllers.delete(listId);
            return;
          }

          if (pollCount < MAX_POLLS) {
            const interval =
              changedCount > 0 || missingCount > 0
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

      Object.assign(playcountCache, playcounts);
      updatePlaycountElements(playcounts);

      if (refreshing > 0) {
        pollForRefreshedPlaycounts(listId, refreshing);
      }
    } catch (err) {
      logger.warn('Playcount fetch error:', err);
    } finally {
      playcountFetchInProgress = false;
    }
  }

  return {
    getPlaycountCacheEntry,
    clearPlaycountCache,
    cancelPollingForList,
    fetchAndDisplayPlaycounts,
  };
}
