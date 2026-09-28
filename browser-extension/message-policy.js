// Authorize messages by their actual source, not whether they happen to have a tab.
(function () {
  const { ACTIONS } = globalThis.ExtensionConstants;
  const pageActions = new Set([
    ACTIONS.START_LOGIN,
    ACTIONS.UPDATE_API_URL,
    ACTIONS.LOGOUT,
    ACTIONS.REFRESH_LISTS,
    ACTIONS.GET_API_URL,
    ACTIONS.GET_AUTH_STATUS,
    ACTIONS.GET_POPUP_STATE,
    ACTIONS.GET_LISTS,
  ]);
  const rymActions = new Set([
    ACTIONS.RYM_PAGE_LOADED,
    ACTIONS.GET_ALBUM_PRESENCE,
    ACTIONS.OPEN_ALBUM_IN_SUSHE,
  ]);

  function isAllowedMessage(message, sender, runtime) {
    if (
      !message ||
      typeof message.action !== 'string' ||
      sender?.id !== runtime.id ||
      (sender.frameId != null && sender.frameId !== 0)
    ) {
      return false;
    }
    let url;
    try {
      url = new URL(sender.url);
    } catch {
      return false;
    }
    if (message.action === ACTIONS.COMPLETE_LOGIN) {
      // The login flow additionally checks the pending tab, origin and expiry.
      return (
        Number.isInteger(sender.tab?.id) && url.pathname === '/extension/auth'
      );
    }
    if (pageActions.has(message.action)) {
      url.search = '';
      url.hash = '';
      return ['popup.html', 'options.html'].some(
        (page) => url.href === runtime.getURL(page)
      );
    }
    return (
      rymActions.has(message.action) &&
      Number.isInteger(sender.tab?.id) &&
      ['https:', 'http:'].includes(url.protocol) &&
      (url.hostname === 'rateyourmusic.com' ||
        url.hostname.endsWith('.rateyourmusic.com'))
    );
  }

  globalThis.ExtensionMessagePolicy = { isAllowedMessage };
})();
