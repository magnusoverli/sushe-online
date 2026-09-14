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

async function startExtension(testInfo, overrides) {
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
        channel: process.env.EXTENSION_BROWSER_CHANNEL || 'chromium',
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
    await worker.evaluate(
      async ({ apiBase, token }) => {
        await chrome.storage.local.set({ apiUrl: apiBase });
        await globalThis.ensureStateLoaded(true);
        // Exercise the packaged login module and its pending-tab/origin checks.
        const flow = globalThis.ExtensionLoginFlow.createLoginFlow({
          chrome,
          getApiBase: () => apiBase,
          fetch: globalThis.SharedUtils.fetchApiWithTimeout,
        });
        await flow.begin();
        const { pendingExtensionLogin } = await chrome.storage.session.get(
          'pendingExtensionLogin'
        );
        await flow.complete(
          { token, expiresAt: new Date(Date.now() + 600000).toISOString() },
          {
            tab: { id: pendingExtensionLogin.tabId },
            frameId: 0,
            url: `${apiBase}/extension/auth`,
          }
        );
        await globalThis.ensureStateLoaded(true);
        await globalThis.fetchUserLists(true);
      },
      { apiBase, token: VALID_TOKEN }
    );
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
  const fixture = await startExtension(testInfo);
  try {
    await fixture.context.request.post(
      `${fixture.apiBase}/test/session/${SESSION_USER}`
    );
    await fixture.worker.evaluate(async () => {
      await chrome.storage.local.set({
        authToken: 'invalid-token',
        lastUsedList: { id: 'old-list', name: 'Old account' },
      });
      await globalThis.ensureStateLoaded(true);
      await globalThis.fetchUserLists(true);
    });
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
