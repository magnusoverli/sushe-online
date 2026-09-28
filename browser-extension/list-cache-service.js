// A single list model and one refresh per account, with at most one forced follow-up.
(function () {
  function createListCacheService({ state, render, logger = console }) {
    const {
      API,
      STORAGE_KEYS: K,
      LIST_CACHE_DURATION_MS,
    } = globalThis.ExtensionConstants;
    const { groupLists, readApiError } = globalThis.SharedUtils;
    let inFlight = null;
    let forcedFollowUp = null;
    let contentRevision = 0;

    function response(result = {}) {
      const data = state.get();
      const lists = data?.userLists || [];
      return {
        success: !result.error,
        ...result,
        lists: groupLists(lists),
        flatLists: lists,
        count: lists.length,
        lastFetched: data?.listsLastFetched || 0,
        stale:
          !data?.listsLastFetched ||
          Date.now() - data.listsLastFetched >= LIST_CACHE_DURATION_MS,
      };
    }

    async function fetchLists(scope, force, revision) {
      const data = state.get();
      if (!data?.apiUrl || !data.authToken)
        return { error: 'Not logged in', fromCache: false };
      if (!force && !response().stale) return { fromCache: true };
      let failure;
      try {
        const res = await scope.request(
          `${scope.apiBase}${API.LISTS}`,
          {},
          10000
        );
        if (res.status === 401) {
          await scope.unauthorized();
          throw new Error('Not logged in');
        }
        if (!res.ok) throw await readApiError(res, 'Failed to load lists');
        const payload = await res.json();
        scope.assertCurrent();
        if (!payload || typeof payload !== 'object' || Array.isArray(payload))
          throw new Error('Invalid lists response');
        const lists = Object.entries(payload).map(([id, metadata]) => ({
          _id: id,
          name: metadata.name || 'Unknown',
          count: metadata.count || 0,
          year: metadata.year || null,
          isMain: !!metadata.isMain,
        }));
        data.userLists = lists;
        data.listsLastFetched = revision === contentRevision ? Date.now() : 0;
        const previous = lists.find(
          (list) => list._id === data.lastUsedList?.id
        );
        data.lastUsedList = previous
          ? { id: previous._id, name: previous.name, year: previous.year }
          : null;
        await state.persist(scope, {
          [K.USER_LISTS]: lists,
          [K.LISTS_LAST_FETCHED]: data.listsLastFetched,
          [K.LAST_USED_LIST]: data.lastUsedList,
        });
        return { fromCache: false };
      } catch (error) {
        if (scope.isCurrent()) failure = error.message;
        logger.warn('List refresh failed:', error.message);
        return {
          fromCache: !!state.get()?.listsLastFetched,
          error: error.message,
        };
      } finally {
        await render(failure);
      }
    }

    async function refresh(force = false) {
      await state.ensureLoaded();
      const scope = state.capture();
      if (inFlight?.generation === scope.generation) {
        if (!force || (inFlight.force && inFlight.revision === contentRevision))
          return inFlight.promise;
        if (!forcedFollowUp) {
          const followUp = inFlight.promise
            .then(() =>
              scope.isCurrent() ? refresh(true) : { error: 'Account changed' }
            )
            .finally(() => {
              if (forcedFollowUp === followUp) forcedFollowUp = null;
            });
          forcedFollowUp = followUp;
        }
        return forcedFollowUp;
      }
      forcedFollowUp = null;
      const entry = {
        generation: scope.generation,
        force,
        revision: contentRevision,
      };
      entry.promise = fetchLists(scope, force, entry.revision).finally(() => {
        if (inFlight === entry) inFlight = null;
      });
      inFlight = entry;
      return entry.promise;
    }

    async function rememberList(list, added, scope) {
      scope.assertCurrent();
      const data = state.get();
      contentRevision++;
      if (added) list.count = (list.count || 0) + 1;
      // The server is authoritative for counts, including duplicate attempts and concurrent edits.
      data.listsLastFetched = 0;
      data.lastUsedList = {
        id: list._id,
        name: list.name,
        year: list.year || null,
      };
      await state.persist(scope, {
        [K.USER_LISTS]: data.userLists,
        [K.LAST_USED_LIST]: data.lastUsedList,
        [K.LISTS_LAST_FETCHED]: data.listsLastFetched,
      });
    }

    return {
      refresh,
      response,
      rememberList,
      find: (id) =>
        state.get()?.userLists.find((list) => list._id === id) || null,
    };
  }
  globalThis.ListCacheService = { createListCacheService };
})();
