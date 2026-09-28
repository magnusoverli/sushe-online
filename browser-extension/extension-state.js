// Owns account transitions and serializes persistence with account-scoped writes.
(function () {
  function createExtensionState({
    chrome,
    auth = globalThis.AuthState,
    onChange = () => {},
  }) {
    const { STORAGE_KEYS: K } = globalThis.ExtensionConstants;
    const { createSerialQueue, fetchApiWithTimeout } = globalThis.SharedUtils;
    const write = createSerialQueue();
    let state = null;
    let generation = 0;
    let loading = null;
    let controller = new AbortController();

    function invalidate() {
      generation++;
      controller.abort();
      controller = new AbortController();
    }

    function emptyAccount(apiUrl) {
      return {
        apiUrl,
        authToken: null,
        tokenExpiresAt: null,
        userLists: [],
        listsLastFetched: 0,
        lastUsedList: null,
      };
    }

    async function owner(account) {
      const bytes = new globalThis.TextEncoder().encode(
        `${account.apiUrl}\0${account.authToken}`
      );
      const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(hash), (byte) =>
        byte.toString(16).padStart(2, '0')
      ).join('');
    }

    async function load() {
      for (;;) {
        const revision = generation;
        // Finish queued account writes before taking a new storage snapshot.
        await write(() => {});
        const loaded = await auth.loadFullState();
        const stored = await chrome.storage.local.get(K.CACHE_OWNER);
        const expectedOwner = await owner(loaded);
        if (revision !== generation) {
          if (state) return state;
          continue;
        }
        if (!loaded.authToken || stored[K.CACHE_OWNER] !== expectedOwner) {
          loaded.userLists = [];
          loaded.listsLastFetched = 0;
          loaded.lastUsedList = null;
          await write(() =>
            revision === generation ? auth.clearAccountCache() : undefined
          );
          if (revision !== generation) continue;
        }
        if (
          state &&
          (state.apiUrl !== loaded.apiUrl ||
            state.authToken !== loaded.authToken)
        ) {
          invalidate();
          onChange();
        }
        state = loaded;
        return state;
      }
    }

    async function ensureLoaded(force = false) {
      if (!state || force) {
        if (!loading)
          loading = load().finally(() => {
            loading = null;
          });
        await loading;
      }
      if (auth.isTokenExpired(state.tokenExpiresAt)) await logout();
      return state;
    }

    function get() {
      return state;
    }

    function capture() {
      const account = state;
      const revision = generation;
      const signal = controller.signal;
      const isCurrent = () =>
        revision === generation &&
        !!account?.authToken &&
        !auth.isTokenExpired(account.tokenExpiresAt);
      const assertCurrent = () => {
        if (!isCurrent())
          throw new Error(
            'Account changed or session expired. Please try again.'
          );
      };
      const headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${account?.authToken}`,
      };
      return {
        generation: revision,
        apiBase: account?.apiUrl,
        headers,
        signal,
        isCurrent,
        assertCurrent,
        async request(url, options = {}, timeout) {
          assertCurrent();
          if (new URL(url).origin !== account.apiUrl)
            throw new Error('Request server does not match the account');
          const response = await fetchApiWithTimeout(
            url,
            { ...options, headers, signal },
            timeout
          );
          assertCurrent();
          return response;
        },
        unauthorized: () => (isCurrent() ? logout() : Promise.resolve()),
      };
    }

    function persist(scope, updates) {
      return write(async () => {
        if (!scope.isCurrent()) return false;
        const cacheOwner = await owner(state);
        if (!scope.isCurrent()) return false;
        await chrome.storage.local.set({
          ...updates,
          [K.CACHE_OWNER]: cacheOwner,
        });
        return scope.isCurrent();
      });
    }

    async function transition(next, credentials) {
      invalidate();
      state = { ...emptyAccount(next.apiUrl), ...next };
      // Synchronous invalidation notifies cache owners before any storage awaits.
      onChange();
      return write(async () => {
        await auth.clearAccountCache();
        if (credentials) await chrome.storage.local.set(credentials);
        else await auth.clearAllAuthData();
      });
    }

    async function logout() {
      const apiUrl = state?.apiUrl || null;
      await transition(emptyAccount(apiUrl));
    }

    async function setAuth(token, expiresAt) {
      await ensureLoaded();
      await transition(
        { apiUrl: state.apiUrl, authToken: token, tokenExpiresAt: expiresAt },
        {
          [K.AUTH_TOKEN]: token,
          [K.TOKEN_EXPIRES_AT]: expiresAt,
          [K.HAS_EVER_AUTHENTICATED]: true,
        }
      );
    }

    async function setApiUrl(apiUrl) {
      await ensureLoaded();
      if (state.apiUrl === apiUrl) return;
      await logout();
      invalidate();
      state.apiUrl = apiUrl;
      await write(() => chrome.storage.local.set({ [K.API_URL]: apiUrl }));
      onChange();
    }

    async function storageChanged(changes) {
      const fields = [
        [K.API_URL, 'apiUrl'],
        [K.AUTH_TOKEN, 'authToken'],
        [K.TOKEN_EXPIRES_AT, 'tokenExpiresAt'],
      ];
      if (!fields.some(([key]) => changes[key])) return false;
      // Chrome can deliver our older write's event after a newer transition.
      // Reconcile the settled storage state, never an obsolete event payload.
      await write(() => {});
      const revision = generation;
      const stored = await chrome.storage.local.get(fields.map(([key]) => key));
      if (revision !== generation) return false;
      if (
        !fields.some(([key, field]) => (stored[key] ?? null) !== state?.[field])
      )
        return false;
      invalidate();
      state = null;
      onChange();
      await ensureLoaded();
      return true;
    }

    return {
      get,
      ensureLoaded,
      capture,
      persist,
      logout,
      setAuth,
      setApiUrl,
      storageChanged,
    };
  }
  globalThis.ExtensionState = { createExtensionState };
})();
