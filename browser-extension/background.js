// Background service worker for SuShe Online extension
// Handles context menu creation and API communication

// Import shared modules for service worker
// eslint-disable-next-line no-undef
importScripts(
  'extension-constants.js',
  'album-identity-service.js',
  'shared-utils.js',
  'auth-state.js',
  'context-menu-service.js',
  'album-presence-service.js',
  'album-api-service.js',
  'album-add-service.js'
);

// Debug mode - set to false for production
const DEBUG = false;
const log = DEBUG ? console.log.bind(console) : () => {};

// In-memory state (loaded from storage on service worker cold start, then kept
// current through chrome.storage.onChanged while the worker stays warm)
let SUSHE_API_BASE = null;
let AUTH_TOKEN = null;
let TOKEN_EXPIRES_AT = null;
let userListsByYear = {}; // { year: [{ name, count }], ... } - grouped by year
let userLists = []; // Flat list of names for backward compatibility
let listsLastFetched = 0;
let stateLoaded = false;
let listFetchInFlight = null;
let listFetchInFlightForce = false;
let menuRefreshAfterHidden = false;
let authCleanupInProgress = false;
let lastUsedList = null;
const {
  STORAGE_KEYS,
  LIST_CACHE_DURATION_MS,
  MENU,
  ACTIONS,
  API,
  NOTIFICATIONS,
} = globalThis.ExtensionConstants;

// Use shared utilities
const {
  fetchWithTimeout,
  classifyFetchError,
  showNotification,
  showNotificationWithImage,
} = globalThis.SharedUtils;
const {
  loadFullState,
  clearAllAuthData,
  validateAndCleanToken,
  handleUnauthorized,
} = globalThis.AuthState;

const contextMenuService =
  globalThis.ContextMenuService.createContextMenuService({
    chrome,
    constants: globalThis.ExtensionConstants,
    logger: console,
  });

const albumPresenceService =
  globalThis.AlbumPresenceService.createAlbumPresenceService({
    chrome,
    constants: globalThis.ExtensionConstants,
    albumIdentity: globalThis.AlbumIdentity,
    fetchWithTimeout,
    ensureStateLoaded,
    getApiBase: () => SUSHE_API_BASE,
    getAuthHeaders,
    refreshListMetadata: () => fetchUserLists(false),
    getListMetadata: () => ({ userLists, userListsByYear }),
    logger: console,
  });

const albumAddService = globalThis.AlbumAddService.createAlbumAddService({
  chrome,
  constants: globalThis.ExtensionConstants,
  fetchWithTimeout,
  showNotification,
  showNotificationWithImage,
  validateAndCleanToken,
  handleUnauthorized,
  ensureStateLoaded,
  getApiBase: () => SUSHE_API_BASE,
  getAuthHeaders,
  showErrorMenu,
  onAlbumAdded,
  logger: console,
});

// Get authorization headers for API requests (uses in-memory token for performance)
function getAuthHeaders() {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  if (AUTH_TOKEN) {
    headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  }

  return headers;
}

function isTokenExpired(expiresAt) {
  if (!expiresAt) return false;
  return Date.now() >= expiresAt - 30000;
}

function hasFreshListCache() {
  return (
    AUTH_TOKEN &&
    userLists.length > 0 &&
    Date.now() - listsLastFetched < LIST_CACHE_DURATION_MS
  );
}

function getListResponseMeta(fetchResult = {}) {
  const stale =
    !listsLastFetched ||
    Date.now() - listsLastFetched >= LIST_CACHE_DURATION_MS;
  return {
    fromCache: fetchResult.fromCache ?? false,
    stale,
    lastFetched: listsLastFetched,
  };
}

async function getHasEverAuthenticated() {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.HAS_EVER_AUTHENTICATED,
  ]);
  return !!data[STORAGE_KEYS.HAS_EVER_AUTHENTICATED];
}

function getListStateResponse(fetchResult = {}) {
  const meta = getListResponseMeta(fetchResult);
  return {
    success: true,
    lists: userListsByYear,
    flatLists: userLists,
    count: userLists.length,
    fromCache: meta.fromCache,
    stale: meta.stale,
    lastFetched: meta.lastFetched,
  };
}

function findListById(listId) {
  return (
    userLists.find((list) => list._id === listId) ||
    Object.values(userListsByYear)
      .flat()
      .find((list) => list._id === listId) ||
    null
  );
}

async function saveLastUsedList(list) {
  if (!list?._id) return;

  lastUsedList = {
    id: list._id,
    name: list.name || 'List',
    year: list.year || null,
  };

  await chrome.storage.local.set({
    [STORAGE_KEYS.LAST_USED_LIST]: lastUsedList,
  });
}

function notifyAlbumAddedToTab(tabId, album, list) {
  if (!tabId) return;

  chrome.tabs
    .sendMessage(tabId, {
      action: ACTIONS.ALBUM_ADDED_TO_LIST,
      album,
      list: {
        listId: list._id,
        listName: list.name || 'List',
        year: list.year || null,
      },
    })
    .catch((error) => {
      console.debug('Could not update RYM badge immediately:', error.message);
    });
}

async function onAlbumAdded({ listId, listName, album, tabId }) {
  const list = findListById(listId) || { _id: listId, name: listName };
  await saveLastUsedList(list);
  albumPresenceService.rememberAlbumInList(album, {
    id: list._id,
    name: list.name || listName || 'List',
    year: list.year || null,
  });
  notifyAlbumAddedToTab(tabId, album, list);
  await updateContextMenuWithLists();
}

function getAuthStatusResponse() {
  return {
    isAuthenticated: !!AUTH_TOKEN,
    hasToken: !!AUTH_TOKEN,
    isExpired: AUTH_TOKEN ? isTokenExpired(TOKEN_EXPIRES_AT) : false,
    apiUrl: SUSHE_API_BASE,
  };
}

function clearListCacheInMemory() {
  userLists = [];
  userListsByYear = {};
  listsLastFetched = 0;
  albumPresenceService.clear();
}

async function clearStoredListCache() {
  await chrome.storage.local.remove([
    STORAGE_KEYS.USER_LISTS,
    STORAGE_KEYS.USER_LISTS_BY_YEAR,
    STORAGE_KEYS.LISTS_LAST_FETCHED,
  ]);
}

async function buildMenusFromCurrentState() {
  await ensureStateLoaded();

  if (!SUSHE_API_BASE) {
    if (await getHasEverAuthenticated()) {
      await showErrorMenu('Not configured - open Settings');
    } else {
      await showWelcomeMenu();
    }
    return;
  }

  if (!AUTH_TOKEN) {
    if (await getHasEverAuthenticated()) {
      await showErrorMenu('Not logged in');
    } else {
      await showWelcomeMenu();
    }
    return;
  }

  if (userLists.length > 0) {
    await updateContextMenuWithLists();
    return;
  }

  await showErrorMenu('Lists not loaded');
}

// Ensure critical state is loaded from storage (handles service worker restarts)
// CRITICAL FIX: Always overwrite in-memory state from storage, never trust existing values
async function ensureStateLoaded(forceReload = false) {
  if (stateLoaded && !forceReload) {
    if (AUTH_TOKEN && isTokenExpired(TOKEN_EXPIRES_AT)) {
      console.log('[ensureStateLoaded] Token expired, clearing auth data');
      await performLogout(false);
    }

    return {
      apiUrl: SUSHE_API_BASE,
      authToken: AUTH_TOKEN,
      tokenExpiresAt: TOKEN_EXPIRES_AT,
      userLists,
      userListsByYear,
      listsLastFetched,
      lastUsedList,
      isValid: !!AUTH_TOKEN,
      isExpired: false,
    };
  }

  console.log('[ensureStateLoaded] Loading state from storage...');

  const state = await loadFullState();

  // ALWAYS overwrite in-memory state from storage (fixes Issue #2)
  SUSHE_API_BASE = state.apiUrl;
  AUTH_TOKEN = state.authToken; // Will be null if expired (handled by loadFullState)
  TOKEN_EXPIRES_AT = state.tokenExpiresAt || null;
  userLists = state.userLists || [];
  userListsByYear = state.userListsByYear || {};
  listsLastFetched = state.listsLastFetched;
  lastUsedList = state.lastUsedList || null;
  stateLoaded = true;

  // If token was expired, clear all auth data (fixes Issue #3)
  if (state.isExpired) {
    console.log('[ensureStateLoaded] Token expired, clearing auth data');
    await performLogout(false); // Don't show notification, just clean up
  }

  console.log('[ensureStateLoaded] State loaded:', {
    apiUrl: SUSHE_API_BASE,
    hasToken: !!AUTH_TOKEN,
    listsCount: userLists.length,
    yearsCount: Object.keys(userListsByYear).length,
    hasLastUsedList: !!lastUsedList,
    isValid: state.isValid,
  });

  return state;
}

// Centralized logout function (fixes Issue #6)
// All logout operations should go through this function
async function performLogout(showNotificationMsg = true) {
  console.log('[performLogout] Clearing all auth data');

  // Clear in-memory state
  AUTH_TOKEN = null;
  TOKEN_EXPIRES_AT = null;
  lastUsedList = null;
  clearListCacheInMemory();
  stateLoaded = true;

  // Clear all auth-related storage (fixes Issue #4 - clears cached data)
  authCleanupInProgress = true;
  try {
    await clearAllAuthData();
  } catch (error) {
    authCleanupInProgress = false;
    throw error;
  }

  // Update context menu to show logged-out state
  await showErrorMenu('Not logged in');

  if (showNotificationMsg) {
    showNotification('Logged out', 'You have been logged out of SuShe Online');
  }

  setTimeout(() => {
    authCleanupInProgress = false;
  }, 1000);

  return { success: true };
}

// Load API URL and auth token from storage on startup
async function loadSettings() {
  await ensureStateLoaded();
  log('Settings loaded');
}

// Create main context menu on extension install
chrome.runtime.onInstalled.addListener(async (details) => {
  log('SuShe Online extension installed:', details.reason);

  // Show welcome notification on first install
  if (details.reason === 'install') {
    chrome.notifications.create(NOTIFICATIONS.WELCOME_ID, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Welcome to SuShe Online!',
      message:
        'Click the extension icon to configure your SuShe instance and login.',
      priority: 2,
      requireInteraction: false,
    });

    // Auto-dismiss after 10 seconds
    setTimeout(() => {
      chrome.notifications.clear(NOTIFICATIONS.WELCOME_ID);
    }, 10000);
  }

  // Log update information
  if (details.reason === 'update') {
    const previousVersion = details.previousVersion;
    const currentVersion = chrome.runtime.getManifest().version;

    log(`Updated from ${previousVersion} to ${currentVersion}`);
  }

  await loadSettings();
  createContextMenus();
});

// Recreate context menus on startup
chrome.runtime.onStartup.addListener(async () => {
  await loadSettings();
  createContextMenus();
});

// Refresh lists when context menu is shown if the cache is stale.
// Note: onShown is only available in some browsers/versions, so we check first
// Manual refresh remains available when users need immediate list changes.
if (chrome.contextMenus.onShown) {
  chrome.contextMenus.onShown.addListener(async (info) => {
    // Only refresh if showing our menu on RYM pages
    if (info.menuIds && info.menuIds.includes(MENU.MAIN_ID)) {
      try {
        await ensureStateLoaded();
        if (AUTH_TOKEN && !hasFreshListCache()) {
          menuRefreshAfterHidden = true;
        }
      } catch (err) {
        console.error('[onShown] Failed to inspect list cache:', err.message);
      }
    }
  });

  if (chrome.contextMenus.onHidden) {
    chrome.contextMenus.onHidden.addListener(() => {
      if (!menuRefreshAfterHidden) return;
      menuRefreshAfterHidden = false;
      fetchUserLists(false).catch((err) => {
        console.error('[onHidden] Deferred list refresh failed:', err.message);
      });
    });
  }

  // Store feature support flag for UI to display
  chrome.storage.local.set({
    [STORAGE_KEYS.AUTO_REFRESH_SUPPORTED]: !!chrome.contextMenus.onHidden,
  });
} else {
  console.warn(
    '[Extension] chrome.contextMenus.onShown not supported - automatic refresh disabled'
  );
  // Store this information for UI to potentially display a notice
  chrome.storage.local.set({ [STORAGE_KEYS.AUTO_REFRESH_SUPPORTED]: false });
}

// Listen for storage changes to update token and invalidate cache
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName === 'local') {
    if (changes[STORAGE_KEYS.AUTH_TOKEN]) {
      const hadToken = !!changes[STORAGE_KEYS.AUTH_TOKEN].oldValue;
      const hasToken = !!changes[STORAGE_KEYS.AUTH_TOKEN].newValue;

      AUTH_TOKEN = changes[STORAGE_KEYS.AUTH_TOKEN]?.newValue || null;
      log('Auth token updated:', AUTH_TOKEN ? 'present' : 'removed');

      // Invalidate cache when auth changes
      listsLastFetched = 0;

      if (AUTH_TOKEN) {
        // New login - fetch fresh lists and mark as authenticated
        clearListCacheInMemory();
        // Track that user has successfully authenticated at least once
        chrome.storage.local.set({
          [STORAGE_KEYS.HAS_EVER_AUTHENTICATED]: true,
        });
        fetchUserLists();
      } else if (hadToken && !hasToken) {
        clearListCacheInMemory();

        if (authCleanupInProgress) {
          authCleanupInProgress = false;
          return;
        }

        // Token was removed - CLEAR EVERYTHING (fixes Issue #4)
        console.log(
          '[storage.onChanged] Token removed, clearing all cached data'
        );
        // Clear cached lists from storage too
        await clearStoredListCache();
        // Update context menu to show logged-out state immediately
        await showErrorMenu('Not logged in');
      }
    }

    if (changes[STORAGE_KEYS.TOKEN_EXPIRES_AT]) {
      TOKEN_EXPIRES_AT =
        changes[STORAGE_KEYS.TOKEN_EXPIRES_AT]?.newValue || null;
    }

    if (changes[STORAGE_KEYS.API_URL]) {
      SUSHE_API_BASE = changes[STORAGE_KEYS.API_URL]?.newValue || null;
      console.log('API URL updated:', SUSHE_API_BASE);

      // Invalidate cache when API URL changes
      clearListCacheInMemory();
      lastUsedList = null;
      await chrome.storage.local.remove([STORAGE_KEYS.LAST_USED_LIST]);
      createContextMenus();
    }

    if (changes[STORAGE_KEYS.LAST_USED_LIST]) {
      lastUsedList = changes[STORAGE_KEYS.LAST_USED_LIST]?.newValue || null;
      createContextMenus();
    }
  }
});

// Create the base context menu structure
async function createContextMenus() {
  try {
    // Startup/menu recreation is cache-only. Network refreshes happen from
    // explicit refresh actions or after the user has opened the context menu.
    await buildMenusFromCurrentState();
  } catch (error) {
    console.error('Error creating context menus:', error);
  }
}

// Fetch user's lists from SuShe Online API. Concurrent callers share work so
// page loads, popup opens, and context-menu events cannot stampede the API.
async function fetchUserLists(forceRefresh = false) {
  if (listFetchInFlight) {
    if (!forceRefresh || listFetchInFlightForce) {
      return listFetchInFlight;
    }

    try {
      await listFetchInFlight;
    } catch (_error) {
      // A force refresh should still get its own attempt after an older failure.
    }
  }

  listFetchInFlightForce = forceRefresh;
  listFetchInFlight = fetchUserListsInternal(forceRefresh).finally(() => {
    listFetchInFlight = null;
    listFetchInFlightForce = false;
  });

  return listFetchInFlight;
}

async function fetchUserListsInternal(forceRefresh = false) {
  // CRITICAL: Always reload state first (fixes Issue #2)
  await ensureStateLoaded();

  const now = Date.now();

  // Use cache if recent AND we have a valid token (unless force refresh)
  if (!forceRefresh && hasFreshListCache()) {
    console.log('Using cached lists:', userLists.length);
    await updateContextMenuWithLists();
    return { fromCache: true };
  }

  // Clear cache when forcing refresh
  if (forceRefresh) {
    console.log('Force refreshing lists...');
    clearListCacheInMemory();
    // Also clear from storage so ensureStateLoaded doesn't reload old data
    await clearStoredListCache();
  }

  log('Fetching lists from API...');
  log('API Base:', SUSHE_API_BASE);
  log('Auth Token present:', !!AUTH_TOKEN);

  // Check if URL is configured
  if (!SUSHE_API_BASE) {
    console.log('No API URL configured');
    await showErrorMenu('Not configured - open Settings');
    return { fromCache: false };
  }

  // If there's no auth token, check if we've ever had one
  if (!AUTH_TOKEN) {
    if (!(await getHasEverAuthenticated())) {
      // First time user - show friendly welcome message
      console.log('First-time user, showing welcome menu');
      await showWelcomeMenu();
      return { fromCache: false };
    }
    // If they've been logged in before but token is gone, show login error
    await showErrorMenu('Not logged in');
    return { fromCache: false };
  }

  try {
    const response = await fetchWithTimeout(
      `${SUSHE_API_BASE}${API.LISTS}`,
      { headers: getAuthHeaders() },
      10000 // 10 second timeout
    );

    log('API response status:', response.status);

    if (response.status === 401) {
      log('Not authenticated (401), clearing auth and showing login menu');
      // Handle 401 - clear everything (fixes Issue #3, #4)
      await performLogout(false);
      await showErrorMenu('Not logged in');
      return { fromCache: false };
    }

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const listsData = await response.json();

    // Group lists by year for submenu structure
    // NOTE: listsData is now keyed by list ID, not list name
    userListsByYear = {};
    userLists = []; // Flat list for backward compatibility

    for (const [listId, metadata] of Object.entries(listsData)) {
      const year = metadata.year || 'Uncategorized';
      if (!userListsByYear[year]) {
        userListsByYear[year] = [];
      }
      userListsByYear[year].push({
        _id: listId,
        name: metadata.name || 'Unknown',
        count: metadata.count || 0,
      });
      userLists.push({ _id: listId, name: metadata.name || 'Unknown' });
    }

    // Sort lists within each year alphabetically
    for (const year of Object.keys(userListsByYear)) {
      userListsByYear[year].sort((a, b) => a.name.localeCompare(b.name));
    }

    listsLastFetched = now;

    // Store in chrome.storage for persistence
    try {
      await chrome.storage.local.set({
        userLists,
        userListsByYear,
        listsLastFetched,
      });
    } catch (error) {
      console.error(
        '[fetchUserLists] Failed to store lists in storage:',
        error
      );
      // Continue anyway - lists are in memory
    }

    await updateContextMenuWithLists();
    return { fromCache: false };
  } catch (error) {
    console.error('Failed to fetch lists:', error);

    // Classify error type for better user feedback
    const errorType = classifyFetchError(error);

    // FIXED: Don't keep stale cache on auth errors (Issue #4)
    if (errorType === 'auth') {
      await performLogout(false);
      await showErrorMenu('Not logged in');
    } else if (userLists.length === 0) {
      // Show appropriate error message based on error type
      if (errorType === 'network') {
        await showErrorMenu('Network error - check connection');
      } else if (errorType === 'server') {
        await showErrorMenu('Server error - try again later');
      } else {
        await showErrorMenu('Connection failed');
      }
    } else {
      // For non-auth errors, we can still use cached lists temporarily
      // but log a warning
      console.warn(
        `Failed to refresh lists (${errorType}), using cache temporarily:`,
        error.message
      );
      await updateContextMenuWithLists();
      return { fromCache: true };
    }

    return { fromCache: false };
  }
}

// Update context menu with user's lists grouped by year
async function updateContextMenuWithLists() {
  log('Updating context menu with lists by year:', userListsByYear);
  await contextMenuService.updateWithLists(
    userListsByYear,
    userLists,
    lastUsedList
  );
}

// Show welcome menu for first-time users
async function showWelcomeMenu() {
  console.log('Showing welcome menu for first-time user');
  await contextMenuService.showWelcome();
}

// Show error in context menu
async function showErrorMenu(message) {
  console.log('Showing error menu:', message);
  await contextMenuService.showError(message);
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  console.log('Context menu clicked:', info.menuItemId);

  // CRITICAL: Ensure state is loaded FIRST (service worker may have restarted)
  await ensureStateLoaded();

  // Handle "Try again" from error menu
  if (info.menuItemId === MENU.REFRESH_ID) {
    await fetchUserLists(true);
    return;
  }

  // Handle setup/welcome redirect
  if (info.menuItemId === MENU.SETUP_ID) {
    chrome.runtime.openOptionsPage();
    return;
  }

  // Handle login redirect
  if (info.menuItemId === MENU.LOGIN_ID) {
    // Use the loaded API URL (already loaded by ensureStateLoaded above)
    chrome.tabs.create({ url: `${SUSHE_API_BASE}${API.EXTENSION_AUTH}` });
    return;
  }

  if (info.menuItemId === MENU.LAST_USED_ID) {
    const listData = lastUsedList?.id ? findListById(lastUsedList.id) : null;
    if (listData?._id) {
      await addAlbumToList(info, tab, listData._id, listData.name);
    } else {
      await chrome.storage.local.remove([STORAGE_KEYS.LAST_USED_LIST]);
      showNotification('Error', 'Last used list not found. Pick a list again.');
      await updateContextMenuWithLists();
    }
    return;
  }

  // Handle list selection (format: sushe-list-{listId})
  if (info.menuItemId.startsWith(MENU.LIST_PREFIX)) {
    const listData = contextMenuService.findListForMenuId(
      info.menuItemId,
      userLists,
      userListsByYear
    );
    const listId = listData?._id;
    const listName = listData?.name;

    console.log(`Menu item clicked: ${info.menuItemId}, list: ${listName}`);

    if (listId && typeof listId === 'string') {
      await addAlbumToList(info, tab, listId, listName);
    } else {
      console.error('List not found:', { menuItemId: info.menuItemId });
      showNotification('Error', 'List not found. Try refreshing lists.');
    }
  }
});

// Extract album data and add to list (now uses list ID instead of name)
async function addAlbumToList(info, tab, listId, listName) {
  log('Adding album to list:', listId, listName);
  await albumAddService.addAlbumToList(info, tab, listId, listName);
}

// Handle notification clicks (for install notification)
chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId === NOTIFICATIONS.WELCOME_ID) {
    // Open options page for first-time setup
    chrome.runtime.openOptionsPage();
    chrome.notifications.clear(NOTIFICATIONS.WELCOME_ID);
  }
});

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle async operations with proper error handling
  if (message.action === ACTIONS.REFRESH_LISTS) {
    // Async operation - keep channel open
    (async () => {
      try {
        await fetchUserLists(true); // Force refresh
        sendResponse({ success: true });
      } catch (error) {
        console.error('Error refreshing lists:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // Keep channel open for async response
  }

  if (message.action === ACTIONS.UPDATE_API_URL) {
    // Async operation - keep channel open
    (async () => {
      try {
        await ensureStateLoaded();
        SUSHE_API_BASE = message.apiUrl;
        console.log('API URL updated to:', SUSHE_API_BASE);
        clearListCacheInMemory();
        await chrome.storage.local.set({
          [STORAGE_KEYS.API_URL]: message.apiUrl,
        });
        await clearStoredListCache();
        sendResponse({ success: true });
      } catch (error) {
        console.error('Error updating API URL:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  if (message.action === ACTIONS.GET_API_URL) {
    // Async operation - ensure state loaded first
    (async () => {
      try {
        await ensureStateLoaded();
        sendResponse({ apiUrl: SUSHE_API_BASE });
      } catch (error) {
        console.error('Error getting API URL:', error);
        sendResponse({ apiUrl: null });
      }
    })();
    return true;
  }

  // Centralized logout handler (fixes Issue #6)
  if (message.action === ACTIONS.LOGOUT) {
    (async () => {
      try {
        await performLogout(true);
        sendResponse({ success: true });
      } catch (error) {
        console.error('Error during logout:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  // Get authentication status (for popup/options to check)
  if (message.action === ACTIONS.GET_AUTH_STATUS) {
    (async () => {
      try {
        const state = await ensureStateLoaded();
        sendResponse({
          isAuthenticated: state.isValid,
          hasToken: !!state.authToken,
          isExpired: state.isExpired,
          apiUrl: state.apiUrl,
        });
      } catch (error) {
        console.error('Error getting auth status:', error);
        sendResponse({ isAuthenticated: false, error: error.message });
      }
    })();
    return true;
  }

  if (message.action === ACTIONS.GET_POPUP_STATE) {
    (async () => {
      try {
        await ensureStateLoaded();
        const auth = getAuthStatusResponse();

        if (!SUSHE_API_BASE || !AUTH_TOKEN) {
          sendResponse({
            success: true,
            auth,
            lists: userListsByYear,
            flatLists: userLists,
            count: userLists.length,
            fromCache: true,
            stale: true,
            lastFetched: listsLastFetched,
          });
          return;
        }

        if (userLists.length > 0) {
          sendResponse({ auth, ...getListStateResponse({ fromCache: true }) });
          fetchUserLists(false).catch((error) => {
            console.error('[getPopupState] Background refresh failed:', error);
          });
          return;
        }

        const fetchResult = await fetchUserLists(false);
        sendResponse({ auth, ...getListStateResponse(fetchResult) });
      } catch (error) {
        console.error('[getPopupState] Error:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  // Get lists from background (single source of truth for popup)
  // This ensures popup and context menu always show the same data
  if (message.action === ACTIONS.GET_LISTS) {
    (async () => {
      try {
        console.log(
          '[getLists] Request received, forceRefresh:',
          message.forceRefresh
        );

        await ensureStateLoaded();

        if (!message.forceRefresh && AUTH_TOKEN && userLists.length > 0) {
          const meta = getListResponseMeta({ fromCache: true });
          sendResponse({
            success: true,
            lists: userListsByYear,
            flatLists: userLists,
            count: userLists.length,
            fromCache: meta.fromCache,
            stale: meta.stale,
            lastFetched: meta.lastFetched,
          });

          fetchUserLists(false).catch((error) => {
            console.error('[getLists] Background refresh failed:', error);
          });
          return;
        }

        // Fetch lists (and update context menu as a side effect)
        // forceRefresh bypasses cache to get fresh data
        const fetchResult = await fetchUserLists(message.forceRefresh || false);
        const meta = getListResponseMeta(fetchResult);

        // Return the lists data that's now cached in background
        sendResponse({
          success: true,
          lists: userListsByYear,
          flatLists: userLists,
          count: userLists.length,
          fromCache: meta.fromCache,
          stale: meta.stale,
          lastFetched: meta.lastFetched,
        });

        console.log('[getLists] Returned', userLists.length, 'lists to popup');
      } catch (error) {
        console.error('[getLists] Error:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // Keep channel open for async response
  }

  if (message.action === ACTIONS.GET_ALBUM_PRESENCE) {
    (async () => {
      try {
        const matches = await albumPresenceService.getPresenceForAlbums(
          Array.isArray(message.albums) ? message.albums : [],
          { forceRefresh: !!message.forceRefresh }
        );
        sendResponse({ success: true, matches });
      } catch (error) {
        console.error('[getAlbumPresence] Error:', error);
        sendResponse({ success: false, error: error.message, matches: {} });
      }
    })();
    return true;
  }

  // RYM page loaded - refresh lists to keep context menu fresh
  // This ensures the menu is always up-to-date when browsing RateYourMusic
  if (message.action === ACTIONS.RYM_PAGE_LOADED) {
    (async () => {
      try {
        console.log('[RYM Page Load] Refreshing lists for context menu...');

        // Page loads are passive; avoid forced refreshes while browsing RYM.
        await fetchUserLists(false);

        console.log('[RYM Page Load] Context menu refreshed successfully');
        sendResponse({ success: true });
      } catch (error) {
        console.error('[RYM Page Load] Error refreshing lists:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // Keep channel open for async response
  }

  // Return false for unknown actions to avoid channel errors
  return false;
});
