// Background-side album presence index for RYM page badges.

(function () {
  const CACHE_VERSION = 2;
  const NUMERIC_KEY_PREFIX = 'rym-id:';
  const CANONICAL_KEY_PREFIX = 'rym-path:';
  const NAME_KEY_PREFIX = 'name:';

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

    let presenceIndex = {};
    let lastFetched = 0;
    let fetchInFlight = null;
    let storageLoaded = false;
    let cacheNeedsRebuild = false;

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

      if (
        storedIndex?.version === CACHE_VERSION &&
        storedIndex.entries &&
        typeof storedIndex.entries === 'object'
      ) {
        presenceIndex = storedIndex.entries;
        lastFetched = Number(storedFetchedAt) || 0;
      } else if (storedIndex && typeof storedIndex === 'object') {
        presenceIndex = Object.fromEntries(
          Object.entries(storedIndex)
            .filter(([, entries]) => Array.isArray(entries))
            .map(([key, entries]) => [`${NAME_KEY_PREFIX}${key}`, entries])
        );
        lastFetched = 0;
        cacheNeedsRebuild = true;
      }

      storageLoaded = true;
    }

    async function persistPresenceIndex() {
      await chromeApi.storage.local.set({
        [STORAGE_KEYS.ALBUM_PRESENCE_INDEX]: {
          version: CACHE_VERSION,
          entries: presenceIndex,
        },
        [STORAGE_KEYS.ALBUM_PRESENCE_LAST_FETCHED]: lastFetched,
      });
    }

    function addPresenceEntry(index, key, entry) {
      if (!key) return;
      if (!index[key]) index[key] = [];

      const alreadyTracked = index[key].some(
        (item) => item.listId === entry.listId
      );
      if (!alreadyTracked) index[key].push(entry);
    }

    function normalizeNumericId(value) {
      if (value == null) return null;
      const numericId = String(value).trim();
      return /^\d+$/.test(numericId) ? numericId : null;
    }

    function getCanonicalPath(album) {
      const identity =
        album?.sourceObservation?.identity || album?.identity || {};
      const candidates = [
        album?.rymCanonicalUrl,
        album?.canonicalUrl,
        album?.canonicalPath,
        album?.albumUrl,
        identity.canonicalUrl,
        identity.canonicalPath,
      ];

      for (const candidate of candidates) {
        if (!candidate) continue;
        const value = String(candidate);
        const canonical = albumIdentity.canonicalizeRymAlbumUrl(
          value.startsWith('/') ? `https://rateyourmusic.com${value}` : value
        );
        if (canonical) return canonical.canonicalPath;
      }
      return null;
    }

    function getNameKey(album) {
      const identity =
        album?.sourceObservation?.identity || album?.identity || {};
      const key = albumIdentity.getAlbumKey({
        artist: album?.artist || identity.artist,
        album: album?.album || album?.title || identity.title,
      });
      return key ? `${NAME_KEY_PREFIX}${key}` : null;
    }

    function getIdentityKeys(album) {
      const identity =
        album?.sourceObservation?.identity || album?.identity || {};
      const numericId = normalizeNumericId(
        album?.rymNumericId ?? album?.numericId ?? identity.numericId
      );
      const canonicalPath = getCanonicalPath(album);
      return [
        numericId ? `${NUMERIC_KEY_PREFIX}${numericId}` : null,
        canonicalPath ? `${CANONICAL_KEY_PREFIX}${canonicalPath}` : null,
        getNameKey(album),
      ].filter(Boolean);
    }

    function addAlbumPresence(index, album, entry) {
      for (const key of getIdentityKeys(album)) {
        addPresenceEntry(index, key, entry);
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

    async function fetchPresenceData(apiBase, headers) {
      const response = await fetchWithTimeout(
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

      const fallbackResponse = await fetchWithTimeout(
        `${apiBase}${API.LISTS}?full=true`,
        { headers },
        15000
      );

      return { response: fallbackResponse, source: 'full-lists' };
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
          cacheNeedsRebuild = false;
          await persistPresenceIndex();
          return presenceIndex;
        }

        const { response, source } = await fetchPresenceData(apiBase, headers);

        if (!response.ok) {
          throw new Error(`Presence lookup failed (${response.status})`);
        }

        const data = await response.json();
        presenceIndex =
          source === 'full-lists'
            ? buildPresenceIndexFromFullLists(data)
            : buildPresenceIndex(data.items);
        lastFetched = Date.now();
        cacheNeedsRebuild = false;
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
        const matchKey = getIdentityKeys(album).find(
          (key) => presenceIndex[key]?.length
        );
        if (responseKey && matchKey) {
          matches[responseKey] = presenceIndex[matchKey];
        }
      }

      return matches;
    }

    async function rememberAlbumInList(albumData, list) {
      await loadStoredCache();
      addAlbumPresence(presenceIndex, albumData, {
        albumId: albumData.album_id || '',
        listId: list.id,
        listName: list.name,
        year: list.year || null,
        isMain: !!list.isMain,
      });
      lastFetched = Date.now();
      await persistPresenceIndex();
    }

    function clear() {
      presenceIndex = {};
      lastFetched = 0;
      fetchInFlight = null;
      storageLoaded = true;
      cacheNeedsRebuild = false;
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
