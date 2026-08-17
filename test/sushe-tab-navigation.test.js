const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert');

describe('SuShe tab navigation', () => {
  let createSusheTabNavigation;

  beforeEach(() => {
    delete globalThis.SusheTabNavigation;
    delete require.cache[
      require.resolve('../browser-extension/sushe-tab-navigation.js')
    ];
    require('../browser-extension/sushe-tab-navigation.js');
    createSusheTabNavigation =
      globalThis.SusheTabNavigation.createSusheTabNavigation;
  });

  afterEach(() => {
    delete globalThis.SusheTabNavigation;
  });

  it('reuses and focuses the most recently accessed SuShe tab', async () => {
    const chromeApi = {
      tabs: {
        query: mock.fn(async () => [
          {
            id: 10,
            windowId: 1,
            url: 'https://sushe.example/?listId=old',
            lastAccessed: 100,
          },
          {
            id: 20,
            windowId: 2,
            url: 'https://sushe.example/settings',
            lastAccessed: 300,
          },
          {
            id: 30,
            windowId: 3,
            url: 'https://rateyourmusic.com/',
            lastAccessed: 400,
          },
        ]),
        update: mock.fn(async () => ({})),
        reload: mock.fn(async () => {}),
        create: mock.fn(async () => ({ id: 40 })),
      },
      scripting: {
        executeScript: mock.fn(async () => [{ result: { handled: true } }]),
      },
      windows: {
        update: mock.fn(async () => ({})),
      },
    };
    const navigation = createSusheTabNavigation({
      chrome: chromeApi,
      getApiBase: () => 'https://sushe.example',
    });

    const result = await navigation.openAlbum('main-list', 'album/1');

    assert.strictEqual(result.reused, true);
    assert.strictEqual(result.handledInPage, true);
    assert.strictEqual(chromeApi.tabs.create.mock.calls.length, 0);
    assert.strictEqual(chromeApi.scripting.executeScript.mock.calls.length, 1);
    assert.deepStrictEqual(chromeApi.tabs.update.mock.calls[0].arguments, [
      20,
      { active: true },
    ]);
    assert.deepStrictEqual(chromeApi.windows.update.mock.calls[0].arguments, [
      2,
      { focused: true },
    ]);
  });

  it('creates a tab when the configured SuShe instance is not open', async () => {
    const chromeApi = {
      tabs: {
        query: mock.fn(async () => [
          { id: 30, url: 'https://other-sushe.example/' },
        ]),
        update: mock.fn(async () => ({})),
        create: mock.fn(async () => ({ id: 40 })),
      },
      windows: { update: mock.fn(async () => ({})) },
    };
    const navigation = createSusheTabNavigation({
      chrome: chromeApi,
      getApiBase: () => 'https://sushe.example',
    });

    const result = await navigation.openAlbum('list-1', 'album-1');

    assert.strictEqual(result.reused, false);
    assert.deepStrictEqual(chromeApi.tabs.create.mock.calls[0].arguments, [
      {
        url: 'https://sushe.example/?listId=list-1&albumId=album-1',
        active: true,
      },
    ]);
    assert.strictEqual(chromeApi.tabs.update.mock.calls.length, 0);
  });

  it('uses the existing selectList binding when the new app API is unavailable', async () => {
    const previousWindow = globalThis.window;
    const pageWindow = {
      currentListId: 'old-list',
      selectList: mock.fn(async (listId) => {
        pageWindow.currentListId = listId;
      }),
    };
    globalThis.window = pageWindow;

    try {
      const chromeApi = {
        tabs: {
          query: mock.fn(async () => [
            {
              id: 20,
              windowId: 2,
              url: 'https://sushe.example/',
              lastAccessed: 300,
            },
          ]),
          update: mock.fn(async () => ({})),
          reload: mock.fn(async () => {}),
          create: mock.fn(async () => ({ id: 40 })),
        },
        scripting: {
          executeScript: mock.fn(async (options) => [
            { result: await options.func(...options.args) },
          ]),
        },
        windows: { update: mock.fn(async () => ({})) },
      };
      const navigation = createSusheTabNavigation({
        chrome: chromeApi,
        getApiBase: () => 'https://sushe.example',
      });

      const result = await navigation.openAlbum('main-list', 'album-1');

      assert.strictEqual(result.handledInPage, true);
      assert.deepStrictEqual(result.inPageResult, {
        handled: true,
        highlighted: false,
        strategy: 'legacy-select-list',
      });
      assert.deepStrictEqual(pageWindow.selectList.mock.calls[0].arguments, [
        'main-list',
      ]);
      assert.deepStrictEqual(chromeApi.tabs.update.mock.calls[0].arguments, [
        20,
        { active: true },
      ]);
      assert.strictEqual(chromeApi.tabs.reload.mock.calls.length, 0);
    } finally {
      globalThis.window = previousWindow;
    }
  });

  it('falls back to URL navigation when the running app API is unavailable', async () => {
    const chromeApi = {
      tabs: {
        query: mock.fn(async () => [
          {
            id: 20,
            windowId: 2,
            url: 'https://sushe.example/',
            lastAccessed: 300,
          },
        ]),
        update: mock.fn(async () => ({})),
        reload: mock.fn(async () => {}),
        create: mock.fn(async () => ({ id: 40 })),
      },
      scripting: {
        executeScript: mock.fn(async () => [
          { result: { handled: false, reason: 'unavailable' } },
        ]),
      },
      windows: { update: mock.fn(async () => ({})) },
    };
    const navigation = createSusheTabNavigation({
      chrome: chromeApi,
      getApiBase: () => 'https://sushe.example',
    });

    const result = await navigation.openAlbum('main-list', 'album-1');

    assert.strictEqual(result.handledInPage, false);
    assert.deepStrictEqual(chromeApi.tabs.update.mock.calls[0].arguments, [
      20,
      {
        url: 'https://sushe.example/?listId=main-list&albumId=album-1',
        active: true,
      },
    ]);
    assert.strictEqual(chromeApi.tabs.reload.mock.calls.length, 0);
  });

  it('reloads an unchanged fallback URL so startup handles it again', async () => {
    const targetUrl = 'https://sushe.example/?listId=main-list&albumId=album-1';
    const chromeApi = {
      tabs: {
        query: mock.fn(async () => [
          { id: 20, windowId: 2, url: targetUrl, lastAccessed: 300 },
        ]),
        update: mock.fn(async () => ({})),
        reload: mock.fn(async () => {}),
        create: mock.fn(async () => ({ id: 40 })),
      },
      scripting: {
        executeScript: mock.fn(async () => [
          { result: { handled: false, reason: 'unavailable' } },
        ]),
      },
      windows: { update: mock.fn(async () => ({})) },
    };
    const navigation = createSusheTabNavigation({
      chrome: chromeApi,
      getApiBase: () => 'https://sushe.example',
    });

    await navigation.openAlbum('main-list', 'album-1');

    assert.deepStrictEqual(chromeApi.tabs.reload.mock.calls[0].arguments, [20]);
    assert.deepStrictEqual(chromeApi.tabs.update.mock.calls[0].arguments, [
      20,
      { active: true },
    ]);
  });
});
