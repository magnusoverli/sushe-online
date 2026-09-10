(function () {
  const PENDING_KEY = 'pendingExtensionLogin';
  const LOGIN_TTL_MS = 10 * 60 * 1000;

  function createLoginFlow({ chrome, getApiBase, fetch = globalThis.fetch }) {
    let pendingOperation = Promise.resolve();
    const serialize = (fn) => {
      const operation = pendingOperation.then(fn);
      pendingOperation = operation.catch(() => {});
      return operation;
    };
    function loginUrl() {
      const url = new URL('/extension/auth', getApiBase());
      if (
        url.protocol !== 'https:' &&
        !(
          url.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
        )
      ) {
        throw new Error('Login requires HTTPS or a local development server');
      }
      return url;
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
      await chrome.tabs.update(tab.id, { url: url.href });
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
        throw new Error('No matching login request');
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
      await chrome.storage.session.remove(PENDING_KEY);
      const response = await fetch(
        new URL('/api/auth/validate-token', url.origin).href,
        {
          headers: { Authorization: `Bearer ${message.token}` },
          credentials: 'omit',
          signal: globalThis.AbortSignal.timeout(10000),
        }
      );
      if (!response.ok || !(await response.json()).valid)
        throw new Error('Login token was rejected');
      const keys = globalThis.ExtensionConstants.STORAGE_KEYS;
      await chrome.storage.local.set({
        [keys.AUTH_TOKEN]: message.token,
        [keys.TOKEN_EXPIRES_AT]: expiresAt,
      });
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
