// Background-side album presence index for RYM page badges.

(function () {
  function createAlbumPresenceService(deps = {}) {
    const chromeApi = deps.chrome || chrome;
    const logger = deps.logger || console;
    const constants = deps.constants || globalThis.ExtensionConstants;
    const albumIdentity = deps.albumIdentity || globalThis.AlbumIdentity;
    const { STORAGE_KEYS } = constants;
    const { API, ALBUM_PRESENCE_CACHE_DURATION_MS } = constants;
    const {
      fetchWithTimeout,
      getApiBase,
      getAuthHeaders,
      ensureStateLoaded,
      refreshListMetadata,
      getListMetadata,
    } = deps;

    let presenceIndex = {};
    let lastFetched = 0;
    let fetchInFlight = null;
    let storageLoaded = false;

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

      const data = await chromeApi.storage.local.get([
        STORAGE_KEYS.ALBUM_PRESENCE_INDEX,
        STORAGE_KEYS.ALBUM_PRESENCE_LAST_FETCHED,
      ]);

      const storedIndex = data[STORAGE_KEYS.ALBUM_PRESENCE_INDEX];
      const storedFetchedAt = data[STORAGE_KEYS.ALBUM_PRESENCE_LAST_FETCHED];

      if (storedIndex && typeof storedIndex === 'object') {
        presenceIndex = storedIndex;
        lastFetched = Number(storedFetchedAt) || 0;
      }

      storageLoaded = true;
    }

    async function persistPresenceIndex() {
      await chromeApi.storage.local.set({
        [STORAGE_KEYS.ALBUM_PRESENCE_INDEX]: presenceIndex,
        [STORAGE_KEYS.ALBUM_PRESENCE_LAST_FETCHED]: lastFetched,
      });
    }

    function getListLookup() {
      const { userLists = [], userListsByYear = {} } = getListMetadata();
      const lookup = new Map();

      for (const list of userLists) {
        lookup.set(list._id, list);
      }

      for (const lists of Object.values(userListsByYear)) {
        for (const list of lists || []) {
          lookup.set(list._id, list);
        }
      }

      return lookup;
    }

    function addPresenceEntry(index, key, entry) {
      if (!key) return;
      if (!index[key]) index[key] = [];

      const alreadyTracked = index[key].some(
        (item) => item.listId === entry.listId
      );
      if (!alreadyTracked) index[key].push(entry);
    }

    function buildPresenceIndex(listsWithItems) {
      const index = {};
      const listLookup = getListLookup();

      for (const [listId, items] of Object.entries(listsWithItems || {})) {
        const list = listLookup.get(listId) || { _id: listId, name: 'List' };

        for (const item of items || []) {
          const key = albumIdentity.getAlbumKey(item);
          addPresenceEntry(index, key, {
            albumId: item.album_id || '',
            listId,
            listName: list.name || 'List',
            year: list.year || null,
          });
        }
      }

      return index;
    }

    async function fetchPresenceIndex(forceRefresh = false) {
      await loadStoredCache();

      if (!forceRefresh && isFresh()) return presenceIndex;
      if (fetchInFlight) return fetchInFlight;

      fetchInFlight = (async () => {
        await ensureStateLoaded();
        const apiBase = getApiBase();
        const headers = getAuthHeaders();

        if (!apiBase || !headers.Authorization) {
          presenceIndex = {};
          lastFetched = 0;
          await persistPresenceIndex();
          return presenceIndex;
        }

        await refreshListMetadata();

        const response = await fetchWithTimeout(
          `${apiBase}${API.LISTS}?full=true`,
          { headers },
          15000
        );

        if (!response.ok) {
          throw new Error(`Presence lookup failed (${response.status})`);
        }

        presenceIndex = buildPresenceIndex(await response.json());
        lastFetched = Date.now();
        await persistPresenceIndex();
        return presenceIndex;
      })().finally(() => {
        fetchInFlight = null;
      });

      try {
        return await fetchInFlight;
      } catch (error) {
        logger.warn('Could not refresh album presence index:', error);
        return presenceIndex;
      }
    }

    async function getPresenceForAlbums(albums = [], options = {}) {
      await loadStoredCache();

      if (options.forceRefresh) {
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
        const key = album.key || albumIdentity.getAlbumKey(album);
        if (key && presenceIndex[key]) matches[key] = presenceIndex[key];
      }

      return matches;
    }

    function rememberAlbumInList(albumData, list) {
      const key = albumIdentity.getAlbumKey(albumData);
      addPresenceEntry(presenceIndex, key, {
        albumId: albumData.album_id || '',
        listId: list.id,
        listName: list.name,
        year: list.year || null,
      });
      lastFetched = Date.now();
      persistPresenceIndex().catch((error) => {
        logger.warn('Could not persist album presence cache:', error);
      });
    }

    function clear() {
      presenceIndex = {};
      lastFetched = 0;
      fetchInFlight = null;
      storageLoaded = true;
      chromeApi.storage.local.remove([
        STORAGE_KEYS.ALBUM_PRESENCE_INDEX,
        STORAGE_KEYS.ALBUM_PRESENCE_LAST_FETCHED,
      ]);
    }

    return {
      clear,
      getPresenceForAlbums,
      rememberAlbumInList,
    };
  }

  globalThis.AlbumPresenceService = { createAlbumPresenceService };
})();
