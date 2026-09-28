/* global chrome */
const { test, expect, chromium } = require('@playwright/test');
const { once } = require('node:events');
const {
  createExtensionAuthApp,
  VALID_TOKEN,
  EXTENSION_USER,
  SESSION_USER,
} = require('../helpers/extension-auth-app');
const { stageExtensionPackage } = require('../helpers/extension-package');

async function startExtension(
  testInfo,
  overrides,
  { authenticate = true } = {}
) {
  const fixture = createExtensionAuthApp(overrides);
  const server = fixture.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const apiBase = `http://127.0.0.1:${server.address().port}`;
  let context;
  const close = async () => {
    await context?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  };
  try {
    const packageDir = stageExtensionPackage(testInfo.outputPath('extension'));
    context = await chromium.launchPersistentContext(
      testInfo.outputPath('profile'),
      {
        ...(process.env.EXTENSION_BROWSER_EXECUTABLE
          ? { executablePath: process.env.EXTENSION_BROWSER_EXECUTABLE }
          : { channel: process.env.EXTENSION_BROWSER_CHANNEL || 'chromium' }),
        headless: true,
        args: [
          `--disable-extensions-except=${packageDir}`,
          `--load-extension=${packageDir}`,
        ],
      }
    );
    const worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent('serviceworker'));
    await context.request.post(`${apiBase}/test/session/${SESSION_USER}`);
    if (authenticate) {
      const options = await context.newPage();
      await options.goto(new URL('options.html', worker.url()).href);
      await options.locator('#apiUrl').fill(`${apiBase}/`);
      // Use the real tab sender, background handlers, content script and handshake.
      // Login also saves the visible URL without requiring a separate Save click.
      const authPagePromise = context.waitForEvent('page');
      await options.locator('#loginBtn').click();
      const authPage = await authPagePromise;
      await authPage.waitForURL(`${apiBase}/extension/auth`);
      await authPage.locator('#authorizeBtn').click();
      await expect(authPage.locator('#status')).toContainText(
        'Extension authorized!'
      );
      await expect(options.locator('#authStatus')).toContainText('Logged in');
      await expect
        .poll(() =>
          worker.evaluate(async (token) => {
            const state = await chrome.storage.local.get([
              'authToken',
              'userLists',
            ]);
            return state.authToken === token && state.userLists?.length === 1;
          }, VALID_TOKEN)
        )
        .toBe(true);
      await options.close();
    }
    return { ...fixture, context, worker, apiBase, close };
  } catch (error) {
    await close();
    throw error;
  }
}

test('packaged extension saves and enriches using its token with any website session', async ({
  browserName: _browserName,
}, testInfo) => {
  const fixture = await startExtension(testInfo);
  try {
    for (const sessionUser of [null, EXTENSION_USER, SESSION_USER]) {
      await fixture.context.clearCookies();
      if (sessionUser) {
        await fixture.context.request.post(
          `${fixture.apiBase}/test/session/${sessionUser}`
        );
      }
      const start = fixture.requests.length;
      const mutationsBefore = fixture.mutations.length;
      const result = await fixture.worker.evaluate(async () => {
        await chrome.storage.local.set({
          lastUsedList: { id: 'old-session-list', name: 'Old session list' },
        });
        await globalThis.ensureStateLoaded(true);
        await globalThis.fetchUserLists(true);
        const state = await chrome.storage.local.get([
          'apiUrl',
          'authToken',
          'userLists',
          'lastUsedList',
        ]);
        const api = globalThis.AlbumApiService.createAlbumApiService({
          fetchWithTimeout: globalThis.SharedUtils.fetchApiWithTimeout,
          getAuthHeaders: () => ({
            Authorization: `Bearer ${state.authToken}`,
            'Content-Type': 'application/json',
          }),
          handleUnauthorized: globalThis.AuthState.handleUnauthorized,
        });
        const release = await api.searchMusicBrainz(state.apiUrl, {
          artist: 'Artist',
          album: 'Album',
        });
        const country = await api.fetchArtistCountry(state.apiUrl, release);
        const album = api.buildAlbumPayload(
          { artist: 'Artist', album: 'Album' },
          release,
          country
        );
        const listId = state.userLists[0]._id;
        const responses = [];
        responses.push(
          (await api.saveAlbum(state.apiUrl, listId, album)).status
        );
        responses.push(
          (
            await api.updateAlbumMetadata(state.apiUrl, [
              { albumId: release.id, country },
            ])
          ).status
        );
        responses.push(
          (
            await api.updateSourceObservation(state.apiUrl, release.id, {
              schemaVersion: 1,
            })
          ).status
        );
        return { listId, responses, lastUsedList: state.lastUsedList };
      });
      expect(result.listId).toBe(`${EXTENSION_USER}-list`);
      expect(result.lastUsedList).toBeUndefined();
      expect(result.responses).toEqual([200, 200, 200]);
      const mutations = fixture.mutations.slice(mutationsBefore);
      expect(mutations.map((entry) => entry.operation)).toEqual([
        'add',
        'metadata',
        'observation',
      ]);
      expect(mutations.every((entry) => entry.userId === EXTENSION_USER)).toBe(
        true
      );
      const requests = fixture.requests.slice(start);
      expect(requests.length).toBeGreaterThanOrEqual(6);
      expect(
        requests.every(
          (entry) =>
            entry.hasBearer && !entry.hasCookie && entry.authMethod === 'token'
        )
      ).toBe(true);
      const session = await fixture.context.request.get(
        `${fixture.apiBase}/test/session`
      );
      expect((await session.json()).userId).toBe(sessionUser || undefined);
    }

    // Verify the rendered options page uses the same transport and distinguishes
    // an anonymous reachability probe from token authentication.
    const page = await fixture.context.newPage();
    await page.goto(new URL('options.html', fixture.worker.url()).href);
    await expect(page.locator('#authStatus')).toContainText('Logged in');
    await page.locator('#testBtn').click();
    await expect(page.locator('#testResult')).toContainText(
      'SuShe Online is reachable'
    );
    await page.screenshot({
      path: testInfo.outputPath('options.png'),
      fullPage: true,
    });
  } finally {
    await fixture.close();
  }
});

test('a failed token clears extension state while the website session stays signed in', async ({
  browserName: _browserName,
}, testInfo) => {
  let tokenValid = true;
  const fixture = await startExtension(testInfo, {
    validateExtensionToken: async () => (tokenValid ? EXTENSION_USER : null),
  });
  try {
    await fixture.context.request.post(
      `${fixture.apiBase}/test/session/${SESSION_USER}`
    );
    tokenValid = false;
    await fixture.worker.evaluate(async () => {
      await chrome.storage.local.set({
        lastUsedList: { id: 'old-list', name: 'Old account' },
      });
      globalThis.clearListCacheInMemory();
      await globalThis.clearStoredListCache();
    });
    const popup = await fixture.context.newPage();
    await popup.goto(new URL('popup.html', fixture.worker.url()).href);
    await expect(popup.locator('#status')).toContainText('Not logged in');
    await expect(popup.locator('#loginBtn')).toBeVisible();
    await expect
      .poll(async () =>
        fixture.worker.evaluate(async () => {
          const state = await chrome.storage.local.get(null);
          return [
            state.authToken,
            state.userLists,
            state.lastUsedList,
            state.albumPresenceIndex,
          ].every((value) => value == null);
        })
      )
      .toBe(true);
    expect(
      fixture.requests.some((entry) => entry.status === 401 && !entry.hasCookie)
    ).toBe(true);
    const session = await fixture.context.request.get(
      `${fixture.apiBase}/test/session`
    );
    expect((await session.json()).userId).toBe(SESSION_USER);
  } finally {
    await fixture.close();
  }
});

test('a late list response cannot restore account caches after logout', async ({
  browserName: _browserName,
}, testInfo) => {
  let delayRead = false;
  let releaseRead;
  const fixture = await startExtension(testInfo, {
    listService: {
      getAllLists: async (userId) => {
        if (delayRead)
          await new Promise((resolve) => {
            releaseRead = resolve;
          });
        return { [`${userId}-list`]: { name: 'Old account list', count: 0 } };
      },
    },
  });
  let reading;
  try {
    delayRead = true;
    reading = fixture.worker.evaluate(() => globalThis.fetchUserLists(true));
    await expect.poll(() => Boolean(releaseRead)).toBe(true);
    await fixture.worker.evaluate(() => globalThis.performLogout(false));
    releaseRead();
    await reading;
    const state = await fixture.worker.evaluate(() =>
      chrome.storage.local.get(null)
    );
    expect(state.authToken).toBeUndefined();
    expect(state.userLists).toBeUndefined();
    expect(state.lastUsedList).toBeUndefined();
  } finally {
    releaseRead?.();
    await reading?.catch(() => {});
    await fixture.close();
  }
});

test('settings saves survive reload, invalid URLs preserve auth, and later errors remain visible', async ({
  browserName: _browserName,
}, testInfo) => {
  const fixture = await startExtension(testInfo);
  try {
    const page = await fixture.context.newPage();
    await page.goto(new URL('options.html', fixture.worker.url()).href);
    await expect(page.locator('#authStatus')).toContainText('Logged in');
    await page.locator('#settingsForm button[type=submit]').click();
    await expect(page.locator('#status')).toContainText(
      'Settings saved successfully'
    );
    await page.reload();
    await expect(page.locator('#apiUrl')).toHaveValue(fixture.apiBase);
    await expect(page.locator('#authStatus')).toContainText('Logged in');
    await page.clock.install();
    await page.locator('#settingsForm button[type=submit]').click();
    await expect(page.locator('#status')).toContainText(
      'Settings saved successfully'
    );
    await page.locator('#apiUrl').fill('http://insecure.example');
    await page.locator('#settingsForm button[type=submit]').click();
    await expect(page.locator('#status')).toContainText('Use HTTPS');
    await page.clock.fastForward(4000);
    await expect(page.locator('#status')).toBeVisible();
    const state = await fixture.worker.evaluate(() =>
      chrome.storage.local.get(['apiUrl', 'authToken'])
    );
    expect(state).toEqual({ apiUrl: fixture.apiBase, authToken: VALID_TOKEN });
    const otherBase = fixture.apiBase.replace('127.0.0.1', 'localhost');
    await page.locator('#apiUrl').fill(otherBase);
    await page.locator('#settingsForm button[type=submit]').click();
    await expect(page.locator('#authStatus')).toContainText('Not logged in');
    const switched = await fixture.worker.evaluate(() =>
      chrome.storage.local.get(null)
    );
    expect(switched.apiUrl).toBe(otherBase);
    for (const key of [
      'authToken',
      'userLists',
      'lastUsedList',
      'albumPresenceIndex',
    ]) {
      expect(switched[key]).toBeUndefined();
    }
    // Transport errors must not be reported as successful saves either.
    await page.locator('#apiUrl').fill(fixture.apiBase);
    await page.evaluate(() => {
      chrome.runtime.sendMessage = async () => {
        throw new Error('Worker unavailable');
      };
    });
    await page.locator('#settingsForm button[type=submit]').click();
    await expect(page.locator('#status')).toContainText('Worker unavailable');
    await page.screenshot({
      path: testInfo.outputPath('settings-error.png'),
      fullPage: true,
    });
  } finally {
    await fixture.close();
  }
});

test('logout cancels pending login and the authorization page displays rejection instead of success', async ({
  browserName: _browserName,
}, testInfo) => {
  const fixture = await startExtension(testInfo, undefined, {
    authenticate: false,
  });
  try {
    const page = await fixture.context.newPage();
    await page.goto(new URL('options.html', fixture.worker.url()).href);
    await page.locator('#apiUrl').fill(fixture.apiBase);
    const authPagePromise = fixture.context.waitForEvent('page');
    await page.locator('#loginBtn').click();
    const authPage = await authPagePromise;
    await authPage.waitForURL(`${fixture.apiBase}/extension/auth`);
    const result = await page.evaluate(() =>
      chrome.runtime.sendMessage({ action: 'logout' })
    );
    expect(result.success).toBe(true);
    await authPage.locator('#authorizeBtn').click();
    await expect(authPage.locator('#status')).toContainText(
      'No matching login request'
    );
    await expect(authPage.locator('#authorizeBtn')).toHaveText('Retry');
    expect(
      (
        await fixture.worker.evaluate(() =>
          chrome.storage.local.get('authToken')
        )
      ).authToken
    ).toBeUndefined();
    await authPage.screenshot({
      path: testInfo.outputPath('authorization-rejected.png'),
      fullPage: true,
    });
  } finally {
    await fixture.close();
  }
});

test('content scripts cannot change settings or logout, and popup login errors are shown', async ({
  browserName: _browserName,
}, testInfo) => {
  const fixture = await startExtension(testInfo);
  try {
    const webPage = await fixture.context.newPage();
    await webPage.goto(`${fixture.apiBase}/extension/auth`);
    const results = await fixture.worker.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({ url });
      return chrome.scripting.executeScript({
        target: { tabId: tabs.at(-1).id },
        func: async () =>
          Promise.all(
            ['updateApiUrl', 'startExtensionLogin', 'logout', 'getLists'].map(
              (action) =>
                chrome.runtime.sendMessage({
                  action,
                  apiUrl: 'https://other.test',
                })
            )
          ),
      });
    }, `${fixture.apiBase}/extension/auth`);
    expect(results[0].result.every((result) => result.success === false)).toBe(
      true
    );
    const popup = await fixture.context.newPage();
    await popup.goto(new URL('popup.html', fixture.worker.url()).href);
    await expect(popup.locator('#logoutBtn')).toBeVisible();
    await popup.locator('#logoutBtn').click();
    await expect(popup.locator('#loginBtn')).toBeVisible();
    await popup.evaluate(() => {
      const original = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = async (message) =>
        message.action === 'startExtensionLogin'
          ? { success: false, error: '<b>Login failed</b>' }
          : original(message);
    });
    await popup.locator('#loginBtn').click();
    await expect(popup.locator('#status')).toHaveText('<b>Login failed</b>');
    await expect(popup.locator('#status b')).toHaveCount(0);
  } finally {
    await fixture.close();
  }
});

test('authorization without an active content script times out with actionable feedback', async ({
  browserName: _browserName,
}, testInfo) => {
  const fixture = await startExtension(testInfo, undefined, {
    authenticate: false,
  });
  try {
    // /test/authorize deliberately does not match the extension's content scripts.
    fixture.app.get('/test/authorize', (_req, res) =>
      res.send(
        require('../../templates/extension-auth-template').extensionAuthTemplate()
      )
    );
    const page = await fixture.context.newPage();
    await page.goto(`${fixture.apiBase}/test/authorize`);
    await page.clock.install();
    await page.locator('#authorizeBtn').click();
    await expect(page.locator('#authorizeBtn')).toHaveText(
      'Connecting to extension...'
    );
    await page.clock.fastForward(16000);
    await expect(page.locator('#status')).toContainText(
      'No response from the extension'
    );
    await expect(page.locator('#authorizeBtn')).toBeEnabled();
  } finally {
    await fixture.close();
  }
});

test('a fresh login expiry is applied before requests start with the replacement token', async ({
  browserName: _browserName,
}, testInfo) => {
  const fixture = await startExtension(testInfo, {
    validateExtensionToken: async () => EXTENSION_USER,
  });
  try {
    await fixture.worker.evaluate(() =>
      chrome.storage.local.set({ tokenExpiresAt: Date.now() - 1000 })
    );
    await expect
      .poll(() =>
        fixture.worker.evaluate(
          () => globalThis.getAuthStatusResponse().isExpired
        )
      )
      .toBe(true);
    await fixture.worker.evaluate(() =>
      chrome.storage.local.set({
        authToken: 'r'.repeat(43),
        tokenExpiresAt: Date.now() + 600000,
      })
    );
    await expect
      .poll(() =>
        fixture.worker.evaluate(() => {
          const state = globalThis.getAuthStatusResponse();
          return state.isAuthenticated && !state.isExpired;
        })
      )
      .toBe(true);
    const state = await fixture.worker.evaluate(() =>
      chrome.storage.local.get('authToken')
    );
    expect(state.authToken).toBe('r'.repeat(43));
  } finally {
    await fixture.close();
  }
});

test('manual list refresh displays server failures instead of reporting an empty successful result', async ({
  browserName: _browserName,
}, testInfo) => {
  let failRead = false;
  const fixture = await startExtension(testInfo, {
    listService: {
      getAllLists: async (userId) => {
        if (failRead) throw new Error('List backend unavailable');
        return { [`${userId}-list`]: { name: 'My list', count: 0 } };
      },
    },
  });
  try {
    const page = await fixture.context.newPage();
    await page.goto(new URL('popup.html', fixture.worker.url()).href);
    await expect(page.locator('#status')).toContainText('1 list(s) loaded');
    failRead = true;
    await page.locator('#refreshBtn').click();
    await expect(page.locator('#status .error')).toBeVisible();
    await expect(page.locator('#refreshBtn')).toBeEnabled();
  } finally {
    await fixture.close();
  }
});

test('expiry of the previous token does not cancel a replacement authorization in progress', async ({
  browserName: _browserName,
}, testInfo) => {
  const fixture = await startExtension(testInfo);
  try {
    const options = await fixture.context.newPage();
    await options.goto(new URL('options.html', fixture.worker.url()).href);
    await expect(options.locator('#authStatus')).toContainText('Logged in');
    const authPagePromise = fixture.context.waitForEvent('page');
    expect(
      (
        await options.evaluate(() =>
          chrome.runtime.sendMessage({ action: 'startExtensionLogin' })
        )
      ).success
    ).toBe(true);
    const authPage = await authPagePromise;
    await authPage.waitForURL(`${fixture.apiBase}/extension/auth`);
    await fixture.worker.evaluate(() =>
      chrome.storage.local.set({ tokenExpiresAt: Date.now() - 1000 })
    );
    await expect
      .poll(() =>
        fixture.worker.evaluate(
          () => globalThis.getAuthStatusResponse().isAuthenticated
        )
      )
      .toBe(false);
    await authPage.locator('#authorizeBtn').click();
    await expect(authPage.locator('#status')).toContainText(
      'Extension authorized!'
    );
    await expect(options.locator('#authStatus')).toContainText('Logged in');
  } finally {
    await fixture.close();
  }
});
