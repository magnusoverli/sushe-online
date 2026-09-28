// Service-worker composition and browser lifecycle events.
/* global importScripts */
importScripts(
  'extension-constants.js',
  'shared-utils.js',
  'message-policy.js',
  'album-identity-service.js',
  'auth-state.js',
  'extension-state.js',
  'login-flow.js',
  'context-menu-service.js',
  'list-cache-service.js',
  'album-presence-service.js',
  'sushe-tab-navigation.js',
  'album-api-service.js',
  'album-add-enrichment.js',
  'album-add-service.js',
  'background-messages.js'
);

const {
  ACTIONS,
  STORAGE_KEYS: K,
  MENU,
  NOTIFICATIONS,
} = globalThis.ExtensionConstants;
const {
  showNotification,
  showNotificationWithImage,
  fetchApiWithTimeout,
  groupLists,
} = globalThis.SharedUtils;
const state = globalThis.ExtensionState.createExtensionState({
  chrome,
  onChange: invalidateAccount,
});
const menus = globalThis.ContextMenuService.createContextMenuService({
  chrome,
});
const lists = globalThis.ListCacheService.createListCacheService({
  state,
  render: createContextMenus,
});
const presence = globalThis.AlbumPresenceService.createAlbumPresenceService({
  chrome,
  ensureStateLoaded,
  getApiBase: () => state.get()?.apiUrl,
  getAuthHeaders,
  fetchWithTimeout: fetchApiWithTimeout,
  captureScope: () => state.capture(),
  persistCache: (scope, updates) => state.persist(scope, updates),
  handleUnauthorized: () => performLogout(false, { cancelLogin: false }),
  findListById: lists.find,
});
const navigation = globalThis.SusheTabNavigation.createSusheTabNavigation({
  chrome,
  getApiBase: () => state.get()?.apiUrl,
});
const login = globalThis.ExtensionLoginFlow.createLoginFlow({
  chrome,
  getApiBase: () => state.get()?.apiUrl,
  fetch: fetchApiWithTimeout,
  saveAuth: async (token, expiry) => {
    await state.setAuth(token, expiry);
    run(() => lists.refresh());
  },
});
const albumAdd = globalThis.AlbumAddService.createAlbumAddService({
  chrome,
  showNotification,
  showNotificationWithImage,
  ensureStateLoaded,
  getApiBase: () => state.get()?.apiUrl,
  getAuthHeaders,
  captureScope: () => state.capture(),
  fetchWithTimeout: fetchApiWithTimeout,
  validateAndCleanToken: async () => ({
    valid: !!(await ensureStateLoaded()).authToken,
  }),
  handleUnauthorized: () => performLogout(false, { cancelLogin: false }),
  showErrorMenu: (message) => menus.showError(message),
  onAlbumAdded,
});

function run(task) {
  Promise.resolve()
    .then(task)
    .catch((error) =>
      console.warn('Extension operation failed:', error.message)
    );
}

function invalidateAccount() {
  // Called synchronously at the account boundary, before persisted data changes.
  presence.reset();
  run(createContextMenus);
}

async function ensureStateLoaded(force = false) {
  return state.ensureLoaded(force);
}
function getAuthHeaders() {
  const token = state.get()?.authToken;
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}
function getAuthStatusResponse() {
  const data = state.get();
  const expired = globalThis.AuthState.isTokenExpired(data?.tokenExpiresAt);
  return {
    isAuthenticated: !!data?.authToken && !expired,
    hasToken: !!data?.authToken,
    isExpired: expired,
    apiUrl: data?.apiUrl || null,
  };
}

async function createContextMenus(error) {
  await ensureStateLoaded();
  const data = state.get();
  if (!data.apiUrl || !data.authToken) {
    const stored = await chrome.storage.local.get(K.HAS_EVER_AUTHENTICATED);
    // State may change while reading storage; retry with the new account.
    if (data !== state.get()) return createContextMenus();
    return stored[K.HAS_EVER_AUTHENTICATED]
      ? menus.showError(data.apiUrl ? 'Not logged in' : 'Not configured')
      : menus.showWelcome();
  }
  if (error && !data.listsLastFetched && !data.userLists.length)
    return menus.showError(error);
  return menus.updateWithLists(
    groupLists(data.userLists),
    data.userLists,
    data.lastUsedList
  );
}

async function performLogout(notify = true, { cancelLogin = true } = {}) {
  if (cancelLogin) await login.cancel();
  await state.logout();
  await createContextMenus();
  if (notify)
    await showNotification(
      'Logged out',
      'You have been logged out of SuShe Online'
    );
  return { success: true };
}

async function onAlbumAdded({
  listId,
  listName,
  album,
  tabId,
  added = true,
  scope = state.capture(),
}) {
  scope.assertCurrent();
  const list = lists.find(listId) || { _id: listId, name: listName };
  await lists.rememberList(list, added, scope);
  scope.assertCurrent();
  await presence.rememberAlbumInList(album, { ...list, id: list._id }, scope);
  scope.assertCurrent();
  await chrome.tabs
    .sendMessage(tabId, {
      action: ACTIONS.ALBUM_ADDED_TO_LIST,
      album,
      list: {
        listId: list._id,
        listName: list.name,
        year: list.year,
        isMain: list.isMain,
      },
      apiBase: scope.apiBase,
    })
    .catch(() => {});
  await lists.refresh(true);
}

async function handleMenuClick(info, tab) {
  await ensureStateLoaded();
  if (info.menuItemId === MENU.SETUP_ID)
    return chrome.runtime.openOptionsPage();
  if (info.menuItemId === MENU.LOGIN_ID) return login.begin();
  if (info.menuItemId === MENU.REFRESH_ID) return lists.refresh(true);
  const list = menus.findListForMenuId(
    info.menuItemId,
    state.get().userLists,
    state.get().lastUsedList
  );
  if (!list)
    return showNotification(
      'List unavailable',
      'Refresh lists and select a list again.'
    );
  return albumAdd.addAlbumToList(info, tab, list._id, list.name);
}

chrome.contextMenus.onClicked.addListener((info, tab) =>
  run(() => handleMenuClick(info, tab))
);
chrome.runtime.onInstalled.addListener((details) =>
  run(async () => {
    await ensureStateLoaded();
    if (details.reason === 'install')
      await showNotification(
        'Welcome to SuShe Online!',
        'Open Settings to configure your instance and login.',
        NOTIFICATIONS.WELCOME_ID
      );
    if (state.get().authToken) await lists.refresh();
    await createContextMenus();
  })
);
chrome.runtime.onStartup.addListener(() => run(createContextMenus));
chrome.notifications.onClicked.addListener((id) => {
  if (id === NOTIFICATIONS.WELCOME_ID)
    run(() => chrome.runtime.openOptionsPage());
});
let refreshAfterMenu = false;
if (chrome.contextMenus.onShown && chrome.contextMenus.onHidden) {
  chrome.contextMenus.onShown.addListener((info) => {
    if (info.menuIds?.includes(MENU.MAIN_ID)) refreshAfterMenu = true;
  });
  chrome.contextMenus.onHidden.addListener(() => {
    if (refreshAfterMenu) {
      refreshAfterMenu = false;
      run(() => lists.refresh());
    }
  });
}
run(() =>
  chrome.storage.local.set({
    [K.AUTO_REFRESH_SUPPORTED]: !!(
      chrome.contextMenus.onShown && chrome.contextMenus.onHidden
    ),
  })
);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  run(async () => {
    if (await state.storageChanged(changes)) {
      if (state.get().authToken) await lists.refresh();
      await createContextMenus();
    }
  });
});

globalThis.BackgroundMessages.install({
  chrome,
  state,
  lists,
  presence,
  navigation,
  login,
  getAuthStatusResponse,
  performLogout,
  createContextMenus,
});
