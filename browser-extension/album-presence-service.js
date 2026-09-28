// Background-side album presence index for RYM page badges.

(function () {
  const CACHE_VERSION = 4;

  function createAlbumPresenceService(deps = {}) {
    const chromeApi = deps.chrome || chrome;
    const logger = deps.logger || console;
    const constants = deps.constants || globalThis.ExtensionConstants;
    const albumIdentity = deps.albumIdentity || globalThis.AlbumIdentity;
    const { STORAGE_KEYS } = constants;
    const { API, ALBUM_PRESENCE_CACHE_DURATION_MS } = constants;
    const { fetchWithTimeout, getApiBase, getAuthHeaders, ensureStateLoaded } =
      deps;
    const findListById = deps.findListById || (() => null);
    const handleUnauthorized = deps.handleUnauthorized || (async () => {});

    let presenceIndex = {};
    let lastFetched = 0;
    let fetchInFlight = null;
    let storageLoaded = false;
    let cacheNeedsRebuild = false;
    let cacheGeneration = 0;
    let storageLoading = null;
    let additions = [];
    let additionRevision = 0;

    function isFresh() {
      return (
        lastFetched &&
        Date.now() - lastFetched < ALBUM_PRESENCE_CACHE_DURATION_MS
      );
    }

    function hasCachedPresence() {
      return Object.keys(presenceIndex).length > 0;
    }

    async function loadStoredCache() {
      if (storageLoaded) return;
      if (storageLoading) return storageLoading;
      storageLoading = readStoredCache().finally(() => {
        storageLoading = null;
      });
      return storageLoading;
    }

    async function readStoredCache() {
      const generation = cacheGeneration;

      const data = await chromeApi.storage.local.get([
        STORAGE_KEYS.ALBUM_PRESENCE_INDEX,
        STORAGE_KEYS.ALBUM_PRESENCE_LAST_FETCHED,
      ]);

      const storedIndex = data[STORAGE_KEYS.ALBUM_PRESENCE_INDEX];
      const storedFetchedAt = data[STORAGE_KEYS.ALBUM_PRESENCE_LAST_FETCHED];
      if (generation !== cacheGeneration) return;

      if (
        storedIndex?.version === CACHE_VERSION &&
        storedIndex.entries &&
        typeof storedIndex.entries === 'object'
      ) {
        presenceIndex = storedIndex.entries;
        lastFetched = Number(storedFetchedAt) || 0;
      } else if (storedIndex && typeof storedIndex === 'object') {
        // Older entries lack the identity evidence needed to reject conflicts.
        presenceIndex = {};
        lastFetched = 0;
        cacheNeedsRebuild = true;
      }

      storageLoaded = true;
    }

    async function persistPresenceIndex(scope) {
      const updates = {
        [STORAGE_KEYS.ALBUM_PRESENCE_INDEX]: {
          version: CACHE_VERSION,
          entries: presenceIndex,
        },
        [STORAGE_KEYS.ALBUM_PRESENCE_LAST_FETCHED]: lastFetched,
      };
      if (deps.persistCache) return deps.persistCache(scope, updates);
      await chromeApi.storage.local.set(updates);
    }

    function addPresenceEntry(index, key, entry) {
      if (!key) return;
      if (!index[key]) index[key] = [];

      const alreadyTracked = index[key].findIndex(
        (item) => item.listId === entry.listId && item.albumId === entry.albumId
      );
      if (alreadyTracked < 0) index[key].push(entry);
      else index[key][alreadyTracked] = entry;
    }

    const { getIdentityKeys, identityKeysMatch } = albumIdentity;

    function addAlbumPresence(index, album, entry) {
      const identityKeys = getIdentityKeys(album);
      for (const key of identityKeys) {
        addPresenceEntry(index, key, { ...entry, identityKeys });
      }
    }

    function buildPresenceIndex(items) {
      const index = {};

      for (const item of items || []) {
        addAlbumPresence(index, item, {
          albumId: item.albumId || '',
          listId: item.listId,
          listName: item.listName || 'List',
          year: item.year || null,
          isMain: !!item.isMain,
        });
      }

      return index;
    }

    function buildPresenceIndexFromFullLists(listsById) {
      const index = {};

      for (const [listId, items] of Object.entries(listsById || {})) {
        if (!Array.isArray(items)) continue;
        const list = findListById(listId) || {};

        for (const item of items) {
          addAlbumPresence(index, item, {
            albumId: item.album_id || item.albumId || '',
            listId,
            listName: list.name || 'List',
            year: list.year || null,
            isMain: !!list.isMain,
          });
        }
      }

      return index;
    }

    async function fetchPresenceData(
      apiBase,
      headers,
      request = fetchWithTimeout
    ) {
      const response = await request(
        `${apiBase}${API.LIST_ALBUM_PRESENCE}`,
        { headers },
        15000
      );

      if (response.status !== 404) {
        return { response, source: 'presence' };
      }

      logger.warn(
        'Album presence endpoint unavailable; falling back to full lists'
      );

      const fallbackResponse = await request(
        `${apiBase}${API.LISTS}?full=true`,
        { headers },
        15000
      );

      return { response: fallbackResponse, source: 'full-lists' };
    }

    async function fetchPresenceIndex(forceRefresh = false) {
      await ensureStateLoaded();
      await loadStoredCache();

      if (!forceRefresh && isFresh()) return presenceIndex;
      if (fetchInFlight) return fetchInFlight;

      const generation = cacheGeneration;
      const revision = additionRevision;
      const scope = deps.captureScope?.();
      const pendingFetch = (async () => {
        const apiBase = getApiBase();
        const headers = getAuthHeaders();

        if (!apiBase || !headers.Authorization) {
          presenceIndex = {};
          lastFetched = 0;
          cacheNeedsRebuild = false;
          return presenceIndex;
        }

        const { response, source } = await fetchPresenceData(
          apiBase,
          headers,
          scope?.request
        );

        if (generation !== cacheGeneration) return presenceIndex;
        if (response.status === 401) {
          if (scope) await scope.unauthorized();
          else {
            await clear();
            await handleUnauthorized();
          }
          return presenceIndex;
        }

        if (!response.ok) {
          throw await globalThis.SharedUtils.readApiError(
            response,
            'Presence lookup failed'
          );
        }

        const data = await response.json();
        if (generation !== cacheGeneration) return presenceIndex;
        if (source === 'presence' && !Array.isArray(data.items))
          throw new Error('Invalid presence response');
        presenceIndex =
          source === 'full-lists'
            ? buildPresenceIndexFromFullLists(data)
            : buildPresenceIndex(data.items);
        for (const addition of additions.filter(
          (item) => item.revision > revision
        )) {
          addAlbumPresence(presenceIndex, addition.album, addition.entry);
        }
        additions = [];
        lastFetched = Date.now();
        cacheNeedsRebuild = false;
        await persistPresenceIndex(scope);
        return presenceIndex;
      })()
        .catch((error) => {
          logger.warn('Could not refresh album presence index:', error);
          return presenceIndex;
        })
        .finally(() => {
          if (fetchInFlight === pendingFetch) fetchInFlight = null;
        });
      fetchInFlight = pendingFetch;

      return pendingFetch;
    }

    async function getPresenceForAlbums(albums = [], options = {}) {
      await ensureStateLoaded();
      await loadStoredCache();

      if (options.forceRefresh || cacheNeedsRebuild) {
        await fetchPresenceIndex(true);
      } else if (!isFresh()) {
        if (hasCachedPresence()) {
          fetchPresenceIndex(true).catch((error) => {
            logger.warn('Background presence refresh failed:', error);
          });
        } else {
          await fetchPresenceIndex(false);
        }
      }

      const matches = {};

      for (const album of albums) {
        const responseKey = album.key || albumIdentity.getAlbumKey(album);
        if (!responseKey) continue;
        const keys = getIdentityKeys(album);
        for (const key of keys) {
          const candidates = (presenceIndex[key] || []).filter((entry) =>
            identityKeysMatch(keys, entry.identityKeys || [])
          );
          if (!candidates.length) continue;
          matches[responseKey] = candidates.map(
            ({ identityKeys: _keys, ...entry }) => entry
          );
          break;
        }
      }

      return matches;
    }

    async function rememberAlbumInList(
      albumData,
      list,
      scope = deps.captureScope?.()
    ) {
      const generation = cacheGeneration;
      await loadStoredCache();
      if (generation !== cacheGeneration) return;
      scope?.assertCurrent();
      const entry = {
        albumId: albumData.album_id || '',
        listId: list.id,
        listName: list.name,
        year: list.year || null,
        isMain: !!list.isMain,
      };
      addAlbumPresence(presenceIndex, albumData, entry);
      if (fetchInFlight)
        additions.push({
          album: albumData,
          entry,
          revision: ++additionRevision,
        });
      // A local addition says nothing about the completeness/freshness of other entries.
      await persistPresenceIndex(scope);
    }

    function reset() {
      cacheGeneration += 1;
      presenceIndex = {};
      lastFetched = 0;
      fetchInFlight = null;
      storageLoaded = true;
      cacheNeedsRebuild = false;
      additions = [];
    }

    function clear() {
      reset();
      return chromeApi.storage.local.remove([
        STORAGE_KEYS.ALBUM_PRESENCE_INDEX,
        STORAGE_KEYS.ALBUM_PRESENCE_LAST_FETCHED,
      ]);
    }

    return {
      reset,
      clear,
      getPresenceForAlbums,
      rememberAlbumInList,
    };
  }

  globalThis.AlbumPresenceService = { createAlbumPresenceService };
})();
