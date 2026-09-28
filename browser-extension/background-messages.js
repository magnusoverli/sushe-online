// One authorization and error boundary for all worker messages.
(function () {
  function install({
    chrome,
    state,
    lists,
    presence,
    navigation,
    login,
    getAuthStatusResponse,
    performLogout,
    createContextMenus,
  }) {
    const { ACTIONS: A } = globalThis.ExtensionConstants;
    async function popupState() {
      let result = { fromCache: true };
      if (state.get().authToken) {
        if (!state.get().listsLastFetched) result = await lists.refresh();
        else if (lists.response().stale)
          void lists.refresh().catch(console.warn);
      }
      return {
        ...lists.response({ fromCache: result.fromCache }),
        warning: result.error,
        auth: getAuthStatusResponse(),
      };
    }
    const handlers = {
      [A.START_LOGIN]: () => login.begin(),
      [A.COMPLETE_LOGIN]: (message, sender) => login.complete(message, sender),
      [A.LOGOUT]: () => performLogout(),
      [A.GET_API_URL]: () => ({ apiUrl: state.get().apiUrl }),
      [A.GET_POPUP_STATE]: popupState,
      [A.REFRESH_LISTS]: async () => {
        const result = await lists.refresh(true);
        return { ...result, success: !result.error };
      },
      [A.RYM_PAGE_LOADED]: () => (state.get().authToken ? lists.refresh() : {}),
      [A.UPDATE_API_URL]: async (message) => {
        const apiUrl = globalThis.SharedUtils.normalizeApiUrl(message.apiUrl);
        if (apiUrl !== state.get().apiUrl) {
          await login.cancel();
          await state.setApiUrl(apiUrl);
        }
        await createContextMenus();
        return { apiUrl };
      },
      [A.GET_ALBUM_PRESENCE]: async (message) => {
        const scope = state.capture();
        const matches = await presence.getPresenceForAlbums(
          Array.isArray(message.albums) ? message.albums.slice(0, 100) : [],
          { forceRefresh: !!message.forceRefresh }
        );
        return {
          matches: scope.isCurrent() ? matches : {},
          apiBase: state.get().apiUrl,
        };
      },
      [A.OPEN_ALBUM_IN_SUSHE]: (message) =>
        navigation.openAlbum(message.listId, message.albumId),
    };
    chrome.runtime.onMessage.addListener((message, sender, respond) => {
      if (
        !globalThis.ExtensionMessagePolicy.isAllowedMessage(
          message,
          sender,
          chrome.runtime
        )
      ) {
        respond({
          success: false,
          error: 'This action is not allowed from this page',
        });
        return false;
      }
      const handler = handlers[message.action];
      if (!handler) return false;
      (async () => {
        try {
          await state.ensureLoaded();
          respond({ success: true, ...(await handler(message, sender)) });
        } catch (error) {
          respond({ success: false, error: error.message });
        }
      })();
      return true;
    });
  }
  globalThis.BackgroundMessages = { install };
})();
