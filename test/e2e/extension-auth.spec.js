/* global chrome, albumAdd, lists, state, presence */
const { test, expect, chromium } = require('@playwright/test');
const { once } = require('node:events');
const {
  createExtensionAuthApp,
  VALID_TOKEN,
  EXTENSION_USER,
  SESSION_USER,
} = require('../helpers/extension-auth-app');
const { stageExtensionPackage } = require('../helpers/extension-package');

function rymDetailHtml({
  artist = 'Artist',
  album = 'Album',
  numericId = '111',
  canonicalUrl,
} = {}) {
  return `<!doctype html><html><head><title>${album} by ${artist} (Album, Rock) - Rate Your Music</title>
    <link rel="canonical" href="${canonicalUrl}"></head><body>
    <h1 class="album_title">${album}</h1><span itemprop="byArtist"><span itemprop="name">${artist}</span></span>
    <div class="album_id">[Album${numericId}]</div>
    <div class="release_left_column"><a href="https://images.test/full.jpg"><img class="coverart_img" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></a><div class="release_media_links"></div></div>
    <div class="release_pri_genres"><span class="genre">Rock</span></div>
    <div class="release_sec_genres"></div><div class="release_descriptors"></div></body></html>`;
}

async function openRymFixture(fixture, pageUrl, pages) {
  await fixture.context.route('https://rateyourmusic.com/**', (route) => {
    const body = pages[route.request().url()];
    return route.fulfill({
      contentType: 'text/html',
      status: body ? 200 : 403,
      body: body || 'Unavailable',
    });
  });
  const page = await fixture.context.newPage();
  await page.goto(pageUrl);
  return page;
}

function addFromRym(fixture, info) {
  return fixture.worker.evaluate(async (info) => {
    const [tab] = await chrome.tabs.query({ url: info.pageUrl });
    await albumAdd.addAlbumToList(
      info,
      tab,
      'extension-user-list',
      'Main list'
    );
  }, info);
}

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
        await lists.refresh(true);
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
          handleUnauthorized: () =>
            globalThis.performLogout(false, { cancelLogin: false }),
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
      expect(result.lastUsedList).toBeNull();
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
      state.get().userLists = [];
      state.get().listsLastFetched = 0;
      await chrome.storage.local.remove(['userLists', 'listsLastFetched']);
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
    reading = fixture.worker.evaluate(() => lists.refresh(true));
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
            [
              'updateApiUrl',
              'startExtensionLogin',
              'logout',
              'getPopupState',
            ].map((action) =>
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
          () => !globalThis.getAuthStatusResponse().isAuthenticated
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

test('packaged RYM extraction, addition, duplicate handling and reinjection keep badges and counts consistent', async ({
  browserName: _browserName,
}, testInfo) => {
  let saved = false;
  const saves = [];
  const fixture = await startExtension(testInfo, {
    listService: {
      getAllLists: async (userId) => ({
        [`${userId}-list`]: {
          name: 'Main list',
          year: 2026,
          isMain: true,
          count: saved ? 1 : 0,
        },
      }),
      getAlbumPresence: async () =>
        saved
          ? [
              {
                listId: `${EXTENSION_USER}-list`,
                listName: 'Main list',
                year: 2026,
                isMain: true,
                albumId: 'album-1',
                artist: 'Artist',
                album: 'Album',
              },
            ]
          : [],
      incrementalUpdate: async (id, userId, { added }) => {
        const duplicate = saved;
        saved = true;
        saves.push({ userId, added });
        return {
          list: { _id: id, revision: '1' },
          addedItems: duplicate ? [] : added,
          duplicateAlbums: duplicate ? added : [],
          changeCount: duplicate ? 0 : 1,
        };
      },
    },
  });
  try {
    const url = 'https://rateyourmusic.com/release/album/artist/album/';
    await fixture.context.route('https://rateyourmusic.com/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<html><head><title>Album by Artist - Rate Your Music</title></head><body>
      <div class="release_left_column"><img class="coverart_img" alt="Cover" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" /><div class="release_media_links"></div></div>
      <div class="release_pri_genres"><span class="genre">Rock</span></div><div class="release_sec_genres"></div><div class="release_descriptors"></div>
      </body></html>`,
      })
    );
    const page = await fixture.context.newPage();
    await page.goto(url);
    const add = () =>
      fixture.worker.evaluate(async (url) => {
        const [tab] = await chrome.tabs.query({ url });
        await albumAdd.addAlbumToList(
          { pageUrl: url, linkUrl: url },
          tab,
          'extension-user-list',
          'Main list'
        );
      }, url);
    await add();
    await expect(page.locator('[data-sushe-presence-badge]')).toHaveCount(1);
    expect(saves[0].userId).toBe(EXTENSION_USER);
    expect(saves[0].added[0].sourceObservation.taxonomy.complete).toBe(true);
    await add();
    await fixture.worker.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({ url });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: [
          'extension-constants.js',
          'shared-utils.js',
          'album-identity-service.js',
          'rym-album-extractor.js',
          'rym-presence-badges.js',
          'content-script.js',
        ],
      });
    }, url);
    await expect(page.locator('[data-sushe-presence-badge]')).toHaveCount(1);
    await expect(page.locator('[data-sushe-presence-badge]')).toHaveAttribute(
      'data-sushe-list-main',
      'true'
    );
    const popup = await fixture.context.newPage();
    await popup.goto(new URL('popup.html', fixture.worker.url()).href);
    await expect(popup.locator('#listItems')).toContainText(
      'Main list (1 albums)'
    );
    await page.screenshot({ path: testInfo.outputPath('rym-badge.png') });
    await popup.screenshot({ path: testInfo.outputPath('popup.png') });
  } finally {
    await fixture.close();
  }
});

test('unsupported release links never save the current album, while its linked cover still works', async ({
  browserName: _browserName,
}, testInfo) => {
  const fixture = await startExtension(testInfo);
  try {
    const url = 'https://rateyourmusic.com/release/album/artist/album/';
    const page = await openRymFixture(fixture, url, {
      [url]: rymDetailHtml({ canonicalUrl: url }),
    });
    const srcUrl = await page.locator('img.coverart_img').getAttribute('src');
    for (const src of [undefined, srcUrl]) {
      await addFromRym(fixture, {
        pageUrl: url,
        linkUrl: url.replace('/album/', '/ep/'),
        srcUrl: src,
      });
    }
    expect(fixture.mutations).toHaveLength(0);
    expect(
      fixture.requests.filter(
        (request) => request.path === '/api/proxy/musicbrainz'
      )
    ).toHaveLength(0);
    await addFromRym(fixture, {
      pageUrl: url,
      linkUrl: 'https://images.test/full.jpg',
      srcUrl,
    });
    const additions = fixture.mutations.filter(
      (mutation) => mutation.operation === 'add'
    );
    expect(additions).toHaveLength(1);
    expect(additions[0].added[0].album).toBe('Album');
  } finally {
    await fixture.close();
  }
});

test('a release cover linked to its own buy page adds the album', async ({
  browserName: _browserName,
}, testInfo) => {
  const fixture = await startExtension(testInfo);
  try {
    const url = 'https://rateyourmusic.com/release/album/artist/album/';
    const page = await openRymFixture(fixture, url, {
      [url]: rymDetailHtml({ canonicalUrl: url }).replace(
        'https://images.test/full.jpg',
        `${url}buy/`
      ),
    });
    const srcUrl = await page.locator('img.coverart_img').getAttribute('src');
    await addFromRym(fixture, {
      pageUrl: url,
      linkUrl: `${url}buy/`,
      srcUrl,
      mediaType: 'image',
    });
    const additions = fixture.mutations.filter(
      (mutation) => mutation.operation === 'add'
    );
    expect(additions).toHaveLength(1);
    expect(additions[0].added[0].sourceObservation.identity.canonicalUrl).toBe(
      url
    );
  } finally {
    await fixture.close();
  }
});

test('an unavailable linked detail page cannot supply genres from the current album', async ({
  browserName: _browserName,
}, testInfo) => {
  const fixture = await startExtension(testInfo);
  try {
    const current =
      'https://rateyourmusic.com/release/album/other-artist/other-album/';
    const selected = 'https://rateyourmusic.com/release/album/artist/album/';
    await openRymFixture(fixture, current, {
      [current]: rymDetailHtml({
        artist: 'Other Artist',
        album: 'Other Album',
        canonicalUrl: current,
      }),
    });
    await addFromRym(fixture, { pageUrl: current, linkUrl: selected });
    const additions = fixture.mutations.filter(
      (mutation) => mutation.operation === 'add'
    );
    expect(additions).toHaveLength(1);
    expect(additions[0].added[0]).toMatchObject({
      artist: 'Artist',
      album: 'Album',
      genre_1: '',
      genre_2: '',
      sourceObservation: {
        identity: { canonicalUrl: selected },
        taxonomy: { complete: false },
      },
    });
  } finally {
    await fixture.close();
  }
});

for (const local of [true, false]) {
  test(`punctuated display names save the correct album from ${local ? 'detail' : 'listing'} pages`, async ({
    browserName: _browserName,
  }, testInfo) => {
    const fixture = await startExtension(testInfo, {
      musicBrainzResponse: () => ({
        'release-groups': [
          {
            id: 'whats-going-on',
            title: "What's Going On",
            'artist-credit': [{ name: 'Marvin Gaye' }],
          },
        ],
      }),
    });
    try {
      const url =
        'https://rateyourmusic.com/release/album/marvin-gaye/whats-going-on-43/';
      const current = local
        ? url
        : 'https://rateyourmusic.com/charts/top/album/all-time/';
      await openRymFixture(fixture, current, {
        'https://rateyourmusic.com/charts/top/album/all-time/':
          '<!doctype html><title>Charts - Rate Your Music</title>',
        [url]: rymDetailHtml({
          artist: 'Marvin Gaye',
          album: "What's Going On",
          canonicalUrl: url,
        }),
      });
      await addFromRym(fixture, { pageUrl: current, linkUrl: url });
      const additions = fixture.mutations.filter(
        (mutation) => mutation.operation === 'add'
      );
      expect(additions).toHaveLength(1);
      expect(additions[0].added[0]).toMatchObject({
        album_id: 'whats-going-on',
        artist: 'Marvin Gaye',
        album: "What's Going On",
        sourceObservation: {
          identity: { canonicalUrl: url, title: "What's Going On" },
        },
      });
    } finally {
      await fixture.close();
    }
  });
}

test('packaged badges reject conflicting RYM IDs even when canonical URL and names match', async ({
  browserName: _browserName,
}, testInfo) => {
  const url = 'https://rateyourmusic.com/release/album/artist/album/';
  let numericId = '111';
  const fixture = await startExtension(testInfo, {
    listService: {
      getAlbumPresence: async () => [
        {
          listId: 'extension-user-list',
          listName: 'Main list',
          albumId: 'saved-album',
          artist: 'Artist',
          album: 'Album',
          rymNumericId: numericId,
          rymCanonicalUrl: url,
        },
      ],
    },
  });
  try {
    const page = await openRymFixture(fixture, url, {
      [url]: rymDetailHtml({ canonicalUrl: url }),
    });
    await expect(page.locator('[data-sushe-presence-badge]')).toHaveCount(1);
    numericId = '222';
    const matches = await fixture.worker.evaluate(
      async (canonicalUrl) =>
        presence.getPresenceForAlbums(
          [
            {
              key: 'selected',
              numericId: '111',
              canonicalUrl,
              artist: 'Artist',
              album: 'Album',
            },
          ],
          { forceRefresh: true }
        ),
      url
    );
    expect(matches).toEqual({});
    await page.reload();
    await expect(page.locator('[data-sushe-presence-badge]')).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath('conflicting-identity-no-badge.png'),
    });
  } finally {
    await fixture.close();
  }
});
