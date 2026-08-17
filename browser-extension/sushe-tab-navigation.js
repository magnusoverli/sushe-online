// Opens album deep links in the most recently used tab for this SuShe instance.

(function () {
  function createSusheTabNavigation(deps = {}) {
    const chromeApi = deps.chrome || chrome;
    const getApiBase = deps.getApiBase;

    function buildAlbumUrl(apiBase, listId, albumId) {
      if (!apiBase || !listId || !albumId) return null;

      const url = new URL('/', apiBase);
      url.searchParams.set('listId', listId);
      url.searchParams.set('albumId', albumId);
      return url.toString();
    }

    function getTabUrl(tab) {
      return tab.url || tab.pendingUrl || '';
    }

    function hasOrigin(tab, origin) {
      try {
        return new URL(getTabUrl(tab)).origin === origin;
      } catch (_error) {
        return false;
      }
    }

    async function openAlbumInExistingPage(tabId, listId, albumId) {
      if (!chromeApi.scripting?.executeScript) {
        return { handled: false, reason: 'scripting-unavailable' };
      }

      try {
        const results = await chromeApi.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          args: [listId, albumId],
          func: async (targetListId, targetAlbumId) => {
            let appApiResult = null;
            if (typeof window.SuSheAppNavigation?.openAlbum === 'function') {
              appApiResult = await window.SuSheAppNavigation.openAlbum({
                listId: targetListId,
                albumId: targetAlbumId,
              });
              if (appApiResult?.handled) {
                return { ...appApiResult, strategy: 'app-api' };
              }
            }

            if (typeof window.selectList !== 'function') {
              return {
                handled: false,
                reason: appApiResult?.reason || 'app-api-unavailable',
              };
            }

            try {
              await window.selectList(targetListId);
            } catch (_error) {
              return { handled: false, reason: 'legacy-selection-failed' };
            }

            if (String(window.currentListId || '') !== targetListId) {
              return { handled: false, reason: 'legacy-selection-rejected' };
            }

            return {
              handled: true,
              highlighted: false,
              strategy: 'legacy-select-list',
            };
          },
        });
        return (
          results?.[0]?.result || {
            handled: false,
            reason: 'empty-script-result',
          }
        );
      } catch (error) {
        return {
          handled: false,
          reason: 'script-injection-failed',
          error: error.message,
        };
      }
    }

    async function focusTab(tab) {
      await chromeApi.tabs.update(tab.id, { active: true });
      if (tab.windowId && chromeApi.windows?.update) {
        await chromeApi.windows.update(tab.windowId, { focused: true });
      }
    }

    async function openAlbum(listId, albumId) {
      const url = buildAlbumUrl(getApiBase(), listId, albumId);
      if (!url) throw new Error('Missing SuShe album link details');

      const origin = new URL(url).origin;
      const tabs = await chromeApi.tabs.query({});
      const existingTab = tabs
        .filter((tab) => hasOrigin(tab, origin))
        .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];

      if (!existingTab?.id) {
        const createdTab = await chromeApi.tabs.create({ url, active: true });
        return { reused: false, tabId: createdTab?.id || null, url };
      }

      const inPageResult = await openAlbumInExistingPage(
        existingTab.id,
        listId,
        albumId
      );
      if (inPageResult.handled) {
        await focusTab(existingTab);
        return {
          reused: true,
          handledInPage: true,
          inPageResult,
          tabId: existingTab.id,
          url,
        };
      }

      if (getTabUrl(existingTab) === url && chromeApi.tabs.reload) {
        await chromeApi.tabs.reload(existingTab.id);
        await focusTab(existingTab);
      } else {
        await chromeApi.tabs.update(existingTab.id, { url, active: true });
        if (existingTab.windowId && chromeApi.windows?.update) {
          await chromeApi.windows.update(existingTab.windowId, {
            focused: true,
          });
        }
      }

      return {
        reused: true,
        handledInPage: false,
        inPageResult,
        tabId: existingTab.id,
        url,
      };
    }

    return { buildAlbumUrl, openAlbum };
  }

  globalThis.SusheTabNavigation = { createSusheTabNavigation };
})();
