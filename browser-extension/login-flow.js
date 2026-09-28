(function () {
  const PENDING_KEY = 'pendingExtensionLogin';
  const LOGIN_TTL_MS = 10 * 60 * 1000;
  const VALIDATION_TIMEOUT_MS = 10000;

  function createLoginFlow({
    chrome,
    getApiBase,
    fetch = globalThis.SharedUtils.fetchApiWithTimeout,
    saveAuth,
  }) {
    const serialize = globalThis.SharedUtils.createSerialQueue();
    function loginUrl() {
      return new URL(
        '/extension/auth',
        globalThis.SharedUtils.normalizeApiUrl(getApiBase())
      );
    }

    async function begin() {
      const url = loginUrl();
      const tab = await chrome.tabs.create({ url: 'about:blank' });
      await chrome.storage.session.set({
        [PENDING_KEY]: {
          tabId: tab.id,
          origin: url.origin,
          expiresAt: Date.now() + LOGIN_TTL_MS,
        },
      });
      try {
        await chrome.tabs.update(tab.id, { url: url.href });
      } catch (error) {
        await chrome.storage.session.remove(PENDING_KEY);
        throw error;
      }
      return { success: true };
    }

    async function complete(message, sender) {
      const pending = (await chrome.storage.session.get(PENDING_KEY))[
        PENDING_KEY
      ];
      const url = new URL(sender.url || 'about:blank');
      if (
        !pending ||
        pending.expiresAt <= Date.now() ||
        pending.tabId !== sender.tab?.id ||
        sender.frameId !== 0 ||
        url.origin !== pending.origin ||
        url.origin !== loginUrl().origin ||
        url.pathname !== '/extension/auth'
      ) {
        throw new Error(
          'No matching login request. Start login again from the extension.'
        );
      }
      if (
        typeof message.token !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(message.token)
      ) {
        throw new Error('Invalid login token');
      }
      const expiresAt = Date.parse(message.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now())
        throw new Error('Expired login token');
      const response = await fetch(
        new URL('/api/auth/validate-token', url.origin).href,
        {
          headers: { Authorization: `Bearer ${message.token}` },
          credentials: 'omit',
        },
        VALIDATION_TIMEOUT_MS
      );
      if (!response.ok || !(await response.json()).valid) {
        if (response.status >= 500 || response.status === 429)
          throw new Error('Login validation unavailable. Please retry.');
        await chrome.storage.session.remove(PENDING_KEY);
        throw new Error('Login token was rejected');
      }
      // Only successful validation consumes the handshake; network failures can retry.
      if (url.origin !== loginUrl().origin || pending.expiresAt <= Date.now())
        throw new Error('Login request expired or server changed');
      const keys = globalThis.ExtensionConstants.STORAGE_KEYS;
      if (saveAuth) await saveAuth(message.token, expiresAt);
      else
        await chrome.storage.local.set({
          [keys.AUTH_TOKEN]: message.token,
          [keys.TOKEN_EXPIRES_AT]: expiresAt,
        });
      await chrome.storage.session.remove(PENDING_KEY);
      return { success: true };
    }
    return {
      begin: () => serialize(begin),
      cancel: () => serialize(() => chrome.storage.session.remove(PENDING_KEY)),
      complete: (message, sender) => serialize(() => complete(message, sender)),
    };
  }
  globalThis.ExtensionLoginFlow = { createLoginFlow };
})();
