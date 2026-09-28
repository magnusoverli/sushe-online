// Storage schema and expiry policy. Account transitions belong to ExtensionState.
(function () {
  const { STORAGE_KEYS: K } = globalThis.ExtensionConstants;
  const API_CACHE_VERSION = 1;
  const EXPIRY_BUFFER_MS = 30000;
  const ACCOUNT_CACHE_KEYS = [
    K.USER_LISTS,
    K.USER_LISTS_BY_YEAR,
    K.LISTS_LAST_FETCHED,
    K.LAST_USED_LIST,
    K.ALBUM_PRESENCE_INDEX,
    K.ALBUM_PRESENCE_LAST_FETCHED,
    K.CACHE_OWNER,
  ];
  let migration;

  function isTokenExpired(expiresAt) {
    if (expiresAt == null) return false;
    return (
      !Number.isFinite(expiresAt) || Date.now() >= expiresAt - EXPIRY_BUFFER_MS
    );
  }

  function clearAccountCache() {
    return chrome.storage.local.remove(ACCOUNT_CACHE_KEYS);
  }
  function clearAllAuthData() {
    return chrome.storage.local.remove([
      K.AUTH_TOKEN,
      K.TOKEN_EXPIRES_AT,
      ...ACCOUNT_CACHE_KEYS,
    ]);
  }

  function migrate() {
    if (!migration)
      migration = (async () => {
        const data = await chrome.storage.local.get(K.API_CACHE_VERSION);
        if (data[K.API_CACHE_VERSION] === API_CACHE_VERSION) return;
        await clearAccountCache();
        await chrome.storage.local.set({
          [K.API_CACHE_VERSION]: API_CACHE_VERSION,
        });
      })().catch((error) => {
        migration = null;
        throw error;
      });
    return migration;
  }

  async function loadFullState() {
    await migrate();
    const data = await chrome.storage.local.get([
      K.API_URL,
      K.AUTH_TOKEN,
      K.TOKEN_EXPIRES_AT,
      K.USER_LISTS,
      K.LISTS_LAST_FETCHED,
      K.LAST_USED_LIST,
    ]);
    const expiresAt = data[K.TOKEN_EXPIRES_AT] ?? null;
    const expired = isTokenExpired(expiresAt);
    const token = data[K.AUTH_TOKEN] || null;
    return {
      apiUrl: data[K.API_URL] || null,
      authToken: expired ? null : token,
      tokenExpiresAt: expiresAt,
      userLists: Array.isArray(data[K.USER_LISTS]) ? data[K.USER_LISTS] : [],
      listsLastFetched: data[K.LISTS_LAST_FETCHED] || 0,
      lastUsedList: data[K.LAST_USED_LIST] || null,
      isValid: !!token && !expired,
      isExpired: expired,
    };
  }
  globalThis.AuthState = {
    isTokenExpired,
    clearAccountCache,
    clearAllAuthData,
    loadFullState,
  };
})();
