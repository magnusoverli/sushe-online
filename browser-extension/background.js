// Background service worker for SuShe Online extension
// Handles context menu creation and API communication

// Import shared modules for service worker
// eslint-disable-next-line no-undef
importScripts('shared-utils.js', 'auth-state.js');

// Debug mode - set to false for production
const DEBUG = false;
const log = DEBUG ? console.log.bind(console) : () => {};

// In-memory state (ONLY used as cache, always re-validated from storage)
let SUSHE_API_BASE = null;
let AUTH_TOKEN = null;
let userListsByYear = {}; // { year: [{ name, count }], ... } - grouped by year
let userLists = []; // Flat list of names for backward compatibility
let listsLastFetched = 0;
const CACHE_DURATION = 1 * 60 * 1000; // 1 minute (server has its own 5-min cache)

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

// Ensure critical state is loaded from storage (handles service worker restarts)
// CRITICAL FIX: Always overwrite in-memory state from storage, never trust existing values
async function ensureStateLoaded() {
  console.log('[ensureStateLoaded] Loading state from storage...');

  const state = await loadFullState();

  // ALWAYS overwrite in-memory state from storage (fixes Issue #2)
  SUSHE_API_BASE = state.apiUrl;
  AUTH_TOKEN = state.authToken; // Will be null if expired (handled by loadFullState)
  userLists = state.userLists || [];
  userListsByYear = state.userListsByYear || {};
  listsLastFetched = state.listsLastFetched;

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
  userLists = [];
  userListsByYear = {};
  listsLastFetched = 0;

  // Clear all auth-related storage (fixes Issue #4 - clears cached data)
  await clearAllAuthData();

  // Update context menu to show logged-out state
  await showErrorMenu('Not logged in');

  if (showNotificationMsg) {
    showNotification('Logged out', 'You have been logged out of SuShe Online');
  }

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
    chrome.notifications.create('sushe-welcome', {
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
      chrome.notifications.clear('sushe-welcome');
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

// Refresh lists when context menu is shown (always fetch fresh)
// This ensures the user always sees up-to-date lists (e.g., after renaming)
// Note: onShown is only available in some browsers/versions, so we check first
// Server has its own 5-minute cache to prevent DB hammering, so we can be aggressive here
if (chrome.contextMenus.onShown) {
  chrome.contextMenus.onShown.addListener(async (info) => {
    // Only refresh if showing our menu on RYM pages
    if (info.menuIds && info.menuIds.includes('sushe-main')) {
      console.log('[onShown] Fetching fresh lists for context menu...');
      try {
        // Always fetch fresh - server cache protects against DB hammering
        // This ensures list renames/additions appear immediately
        await fetchUserLists(true);
        console.log('[onShown] Lists refreshed successfully');
      } catch (err) {
        console.error('[onShown] List refresh failed:', err.message);
        // Don't fail completely - the menu will show cached lists or error state
        // fetchUserLists() already handles showing error menus
      }
    }
  });

  // Store feature support flag for UI to display
  chrome.storage.local.set({ autoRefreshSupported: true });
} else {
  console.warn(
    '[Extension] chrome.contextMenus.onShown not supported - automatic refresh disabled'
  );
  // Store this information for UI to potentially display a notice
  chrome.storage.local.set({ autoRefreshSupported: false });
}

// Listen for storage changes to update token and invalidate cache
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName === 'local') {
    if (changes.authToken) {
      const hadToken = !!changes.authToken.oldValue;
      const hasToken = !!changes.authToken.newValue;

      AUTH_TOKEN = changes.authToken?.newValue || null;
      log('Auth token updated:', AUTH_TOKEN ? 'present' : 'removed');

      // Invalidate cache when auth changes
      listsLastFetched = 0;

      if (AUTH_TOKEN) {
        // New login - fetch fresh lists and mark as authenticated
        userLists = [];
        // Track that user has successfully authenticated at least once
        chrome.storage.local.set({ hasEverAuthenticated: true });
        fetchUserLists();
      } else if (hadToken && !hasToken) {
        // Token was removed - CLEAR EVERYTHING (fixes Issue #4)
        console.log(
          '[storage.onChanged] Token removed, clearing all cached data'
        );
        userLists = [];
        listsLastFetched = 0;
        // Clear cached lists from storage too
        await chrome.storage.local.remove(['userLists', 'listsLastFetched']);
        // Update context menu to show logged-out state immediately
        await showErrorMenu('Not logged in');
      }
    }

    if (changes.apiUrl) {
      SUSHE_API_BASE = changes.apiUrl?.newValue || null;
      console.log('API URL updated:', SUSHE_API_BASE);

      // Invalidate cache when API URL changes
      userLists = [];
      listsLastFetched = 0;
      createContextMenus();
    }
  }
});

// Helper to safely remove all context menus
async function removeAllMenus() {
  return new Promise((resolve) => {
    chrome.contextMenus.removeAll(() => {
      if (chrome.runtime.lastError) {
        console.log(
          'Remove all menus error (ignored):',
          chrome.runtime.lastError
        );
      }
      resolve();
    });
  });
}

// Create the base context menu structure
async function createContextMenus() {
  try {
    // Remove all existing menus first
    await removeAllMenus();

    // Create parent menu item
    chrome.contextMenus.create(
      {
        id: 'sushe-main',
        title: 'Add to SuShe Online',
        contexts: ['image', 'link'],
        documentUrlPatterns: ['*://*.rateyourmusic.com/*'],
      },
      () => {
        if (chrome.runtime.lastError) {
          console.log(
            'Menu creation error (ignored):',
            chrome.runtime.lastError
          );
        }
      }
    );

    // Create loading placeholder
    chrome.contextMenus.create(
      {
        id: 'sushe-loading',
        parentId: 'sushe-main',
        title: 'Loading lists...',
        contexts: ['image', 'link'],
        enabled: false,
      },
      () => {
        if (chrome.runtime.lastError) {
          console.log(
            'Menu creation error (ignored):',
            chrome.runtime.lastError
          );
        }
      }
    );

    // Fetch lists and update menu
    fetchUserLists();
  } catch (error) {
    console.error('Error creating context menus:', error);
  }
}

// Fetch user's lists from SuShe Online API
async function fetchUserLists(forceRefresh = false) {
  // CRITICAL: Always reload state first (fixes Issue #2)
  await ensureStateLoaded();

  const now = Date.now();

  // Use cache if recent AND we have a valid token (unless force refresh)
  if (
    !forceRefresh &&
    userLists.length > 0 &&
    now - listsLastFetched < CACHE_DURATION &&
    AUTH_TOKEN
  ) {
    console.log('Using cached lists:', userLists.length);
    updateContextMenuWithLists();
    return;
  }

  // Clear cache when forcing refresh
  if (forceRefresh) {
    console.log('Force refreshing lists...');
    userLists = [];
    userListsByYear = {};
    listsLastFetched = 0;
    // Also clear from storage so ensureStateLoaded doesn't reload old data
    await chrome.storage.local.remove([
      'userLists',
      'userListsByYear',
      'listsLastFetched',
    ]);
  }

  log('Fetching lists from API...');
  log('API Base:', SUSHE_API_BASE);
  log('Auth Token present:', !!AUTH_TOKEN);

  // Check if URL is configured
  if (!SUSHE_API_BASE) {
    console.log('No API URL configured');
    showErrorMenu('Not configured - open Settings');
    return;
  }

  // If there's no auth token, check if we've ever had one
  if (!AUTH_TOKEN) {
    const hasEverBeenLoggedIn = await chrome.storage.local.get([
      'hasEverAuthenticated',
    ]);

    if (!hasEverBeenLoggedIn.hasEverAuthenticated) {
      // First time user - show friendly welcome message
      console.log('First-time user, showing welcome menu');
      showWelcomeMenu();
      return;
    }
    // If they've been logged in before but token is gone, show login error
    showErrorMenu('Not logged in');
    return;
  }

  try {
    const response = await fetchWithTimeout(
      `${SUSHE_API_BASE}/api/lists`,
      { headers: getAuthHeaders() },
      10000 // 10 second timeout
    );

    log('API response status:', response.status);

    if (response.status === 401) {
      log('Not authenticated (401), clearing auth and showing login menu');
      // Handle 401 - clear everything (fixes Issue #3, #4)
      await performLogout(false);
      showErrorMenu('Not logged in');
      return;
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

    updateContextMenuWithLists();
  } catch (error) {
    console.error('Failed to fetch lists:', error);

    // Classify error type for better user feedback
    const errorType = classifyFetchError(error);

    // FIXED: Don't keep stale cache on auth errors (Issue #4)
    if (errorType === 'auth') {
      await performLogout(false);
      showErrorMenu('Not logged in');
    } else if (userLists.length === 0) {
      // Show appropriate error message based on error type
      if (errorType === 'network') {
        showErrorMenu('Network error - check connection');
      } else if (errorType === 'server') {
        showErrorMenu('Server error - try again later');
      } else {
        showErrorMenu('Connection failed');
      }
    } else {
      // For non-auth errors, we can still use cached lists temporarily
      // but log a warning
      console.warn(
        `Failed to refresh lists (${errorType}), using cache temporarily:`,
        error.message
      );
      updateContextMenuWithLists();
    }
  }
}

// Update context menu with user's lists grouped by year
async function updateContextMenuWithLists() {
  log('Updating context menu with lists by year:', userListsByYear);

  try {
    // Remove ALL menus and rebuild from scratch to ensure clean state
    await removeAllMenus();

    // Recreate the parent menu
    chrome.contextMenus.create(
      {
        id: 'sushe-main',
        title: 'Add to SuShe Online',
        contexts: ['image', 'link'],
        documentUrlPatterns: ['*://*.rateyourmusic.com/*'],
      },
      () => {
        if (chrome.runtime.lastError) {
          console.log(
            'Menu creation error (ignored):',
            chrome.runtime.lastError
          );
        }
      }
    );

    if (userLists.length === 0) {
      chrome.contextMenus.create(
        {
          id: 'sushe-no-lists',
          parentId: 'sushe-main',
          title: 'No lists found - Create one first!',
          contexts: ['image', 'link'],
          enabled: false,
        },
        () => {
          if (chrome.runtime.lastError) {
            console.log(
              'Menu creation error (ignored):',
              chrome.runtime.lastError
            );
          }
        }
      );
      return;
    }

    // Get years sorted: numeric years descending, then 'Uncategorized' at the end
    const years = Object.keys(userListsByYear).sort((a, b) => {
      if (a === 'Uncategorized') return 1;
      if (b === 'Uncategorized') return -1;
      return parseInt(b) - parseInt(a); // Descending order for years
    });

    // Create year submenus with lists inside
    for (const year of years) {
      const lists = userListsByYear[year];
      const yearId = `sushe-year-${year}`;

      // Create year submenu
      chrome.contextMenus.create(
        {
          id: yearId,
          parentId: 'sushe-main',
          title: `${year} (${lists.length})`,
          contexts: ['image', 'link'],
        },
        () => {
          if (chrome.runtime.lastError) {
            console.log(
              'Menu creation error (ignored):',
              chrome.runtime.lastError
            );
          }
        }
      );

      // Add lists under this year
      lists.forEach((list, index) => {
        const listId = `sushe-list-${year}-${index}`;
        chrome.contextMenus.create(
          {
            id: listId,
            parentId: yearId,
            title: list.name,
            contexts: ['image', 'link'],
          },
          () => {
            if (chrome.runtime.lastError) {
              console.log(
                'Menu creation error (ignored):',
                chrome.runtime.lastError
              );
            }
          }
        );
      });
    }

    console.log('Context menu updated successfully with year submenus');
  } catch (error) {
    console.error('Error updating context menu:', error);
  }
}

// Show welcome menu for first-time users
async function showWelcomeMenu() {
  console.log('Showing welcome menu for first-time user');

  try {
    await removeAllMenus();

    chrome.contextMenus.create(
      {
        id: 'sushe-main',
        title: 'Add to SuShe Online',
        contexts: ['image', 'link'],
        documentUrlPatterns: ['*://*.rateyourmusic.com/*'],
      },
      () => {
        if (chrome.runtime.lastError) {
          console.log(
            'Menu creation error (ignored):',
            chrome.runtime.lastError
          );
        }
      }
    );

    chrome.contextMenus.create(
      {
        id: 'sushe-welcome',
        parentId: 'sushe-main',
        title: 'Welcome! Click to get started',
        contexts: ['image', 'link'],
        enabled: false,
      },
      () => {
        if (chrome.runtime.lastError) {
          console.log(
            'Menu creation error (ignored):',
            chrome.runtime.lastError
          );
        }
      }
    );

    chrome.contextMenus.create(
      {
        id: 'sushe-setup',
        parentId: 'sushe-main',
        title: 'Open Settings & Login',
        contexts: ['image', 'link'],
      },
      () => {
        if (chrome.runtime.lastError) {
          console.log(
            'Menu creation error (ignored):',
            chrome.runtime.lastError
          );
        }
      }
    );
  } catch (error) {
    console.error('Error showing welcome menu:', error);
  }
}

// Show error in context menu
async function showErrorMenu(message) {
  console.log('Showing error menu:', message);

  try {
    // Remove ALL menus and rebuild from scratch
    await removeAllMenus();

    // Recreate the parent menu
    chrome.contextMenus.create(
      {
        id: 'sushe-main',
        title: 'Add to SuShe Online',
        contexts: ['image', 'link'],
        documentUrlPatterns: ['*://*.rateyourmusic.com/*'],
      },
      () => {
        if (chrome.runtime.lastError) {
          console.log(
            'Menu creation error (ignored):',
            chrome.runtime.lastError
          );
        }
      }
    );

    // Show appropriate error message based on the error type
    const isAuthError =
      message === 'Not logged in' ||
      message.includes('401') ||
      message.includes('authenticated');
    const errorTitle = isAuthError
      ? 'Not logged in to SuShe Online'
      : `Error: ${message.substring(0, 50)}`;

    chrome.contextMenus.create(
      {
        id: 'sushe-error',
        parentId: 'sushe-main',
        title: errorTitle,
        contexts: ['image', 'link'],
        enabled: false,
      },
      () => {
        if (chrome.runtime.lastError) {
          console.log(
            'Menu creation error (ignored):',
            chrome.runtime.lastError
          );
        }
      }
    );

    // Only show login option for authentication errors
    if (isAuthError) {
      chrome.contextMenus.create(
        {
          id: 'sushe-login',
          parentId: 'sushe-main',
          title: 'Click to login',
          contexts: ['image', 'link'],
        },
        () => {
          if (chrome.runtime.lastError) {
            console.log(
              'Menu creation error (ignored):',
              chrome.runtime.lastError
            );
          }
        }
      );
    } else {
      // For other errors, show a refresh option
      chrome.contextMenus.create(
        {
          id: 'sushe-refresh',
          parentId: 'sushe-main',
          title: 'Try again',
          contexts: ['image', 'link'],
        },
        () => {
          if (chrome.runtime.lastError) {
            console.log(
              'Menu creation error (ignored):',
              chrome.runtime.lastError
            );
          }
        }
      );
    }
  } catch (error) {
    console.error('Error showing error menu:', error);
  }
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  console.log('Context menu clicked:', info.menuItemId);

  // CRITICAL: Ensure state is loaded FIRST (service worker may have restarted)
  await ensureStateLoaded();

  // Handle "Try again" from error menu
  if (info.menuItemId === 'sushe-refresh') {
    await fetchUserLists(true);
    return;
  }

  // Handle setup/welcome redirect
  if (info.menuItemId === 'sushe-setup') {
    chrome.runtime.openOptionsPage();
    return;
  }

  // Handle login redirect
  if (info.menuItemId === 'sushe-login') {
    // Use the loaded API URL (already loaded by ensureStateLoaded above)
    chrome.tabs.create({ url: `${SUSHE_API_BASE}/extension/auth` });
    return;
  }

  // Handle list selection (format: sushe-list-{year}-{index})
  if (info.menuItemId.startsWith('sushe-list-')) {
    // Parse the menu ID to extract year and index
    // Format: sushe-list-{year}-{index} where year can be a number or 'Uncategorized'
    const idPart = info.menuItemId.replace('sushe-list-', '');
    const lastDashIndex = idPart.lastIndexOf('-');
    const year = idPart.substring(0, lastDashIndex);
    const index = parseInt(idPart.substring(lastDashIndex + 1));

    console.log(
      `Menu item clicked: ${info.menuItemId}, year: ${year}, index: ${index}`
    );

    // Look up the list from userListsByYear
    const listsForYear = userListsByYear[year];
    const listData = listsForYear ? listsForYear[index] : null;
    const listId = listData?._id;
    const listName = listData?.name;

    console.log(
      `List for ${year}[${index}]: id="${listId}", name="${listName}"`
    );

    if (listId && typeof listId === 'string') {
      await addAlbumToList(info, tab, listId, listName);
    } else {
      console.error('List not found:', { year, index, userListsByYear });
      showNotification('Error', 'List not found. Try refreshing lists.');
    }
  }
});

// Extract album data and add to list (now uses list ID instead of name)
async function addAlbumToList(info, tab, listId, listName) {
  log('Adding album to list:', listId, listName);

  // Ensure state is loaded in case service worker restarted
  await ensureStateLoaded();
  console.log('In-memory state:', {
    apiUrl: SUSHE_API_BASE,
    hasToken: !!AUTH_TOKEN,
  });

  // Verify URL is configured
  if (!SUSHE_API_BASE) {
    showNotification(
      'Not configured',
      'Please click the extension icon and configure your SuShe Online URL.'
    );
    return;
  }

  // Verify token is present and valid before starting
  const validation = await validateAndCleanToken();
  if (!validation.valid) {
    showNotification(
      'Not logged in',
      'Please click the extension icon and login to SuShe Online.'
    );
    await showErrorMenu('Not logged in');
    return;
  }

  try {
    // Show immediate feedback to user while we process
    // Parse the URL to get a rough album name for the notification
    const urlForParsing = info.linkUrl || info.pageUrl || '';
    const urlMatch = urlForParsing.match(/\/release\/[^/]+\/([^/]+)\/([^/]+)/);
    if (urlMatch) {
      const roughArtist = decodeURIComponent(urlMatch[1].replace(/[-_]/g, ' '));
      const roughAlbum = decodeURIComponent(urlMatch[2].replace(/[-_]/g, ' '));
      const rymCoverUrl = info.srcUrl || 'icons/icon128.png';
      showNotificationWithImage(
        'Adding album...',
        `Processing ${roughAlbum} by ${roughArtist}...`,
        rymCoverUrl
      );
    } else {
      showNotification('Adding album...', 'Processing album data...');
    }

    // Send message to content script to extract album data
    console.log('Sending message to content script...');
    let albumData;

    try {
      albumData = await chrome.tabs.sendMessage(tab.id, {
        action: 'extractAlbumData',
        srcUrl: info.srcUrl,
        linkUrl: info.linkUrl,
        pageUrl: info.pageUrl,
      });
    } catch (err) {
      // Content script not loaded yet - this is normal after extension reload
      console.log('Content script not ready, injecting...', err.message);
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content-script.js'],
        });
        // Wait a moment for script to initialize
        await new Promise((resolve) => setTimeout(resolve, 200));
        // Try again
        albumData = await chrome.tabs.sendMessage(tab.id, {
          action: 'extractAlbumData',
          srcUrl: info.srcUrl,
          linkUrl: info.linkUrl,
          pageUrl: info.pageUrl,
        });
      } catch (injectErr) {
        console.error('Failed to inject content script:', injectErr.message);
        throw new Error(
          'Could not communicate with page. Try refreshing RateYourMusic.'
        );
      }
    }

    if (!albumData || albumData.error) {
      console.error('Content script returned error:', albumData?.error);
      throw new Error(
        albumData?.error ||
          'Failed to extract album data. Make sure you are on an album page.'
      );
    }

    if (!albumData.artist || !albumData.album) {
      console.error('Invalid album data received:', albumData);
      throw new Error(
        `Could not extract album information from page. Artist: "${albumData?.artist}", Album: "${albumData?.album}"`
      );
    }

    console.log('Extracted album data:', albumData);

    // Search MusicBrainz for the album
    console.log('Searching MusicBrainz for album...');

    const searchQuery = `${albumData.artist} ${albumData.album}`;
    const mbEndpoint = `release-group/?query=${searchQuery}&type=album|ep&fmt=json&limit=5`;

    const mbResponse = await fetchWithTimeout(
      `${SUSHE_API_BASE}/api/proxy/musicbrainz?endpoint=${encodeURIComponent(mbEndpoint)}&priority=high`,
      { headers: getAuthHeaders() },
      15000 // 15 second timeout for MusicBrainz
    );

    if (mbResponse.status === 401) {
      await handleUnauthorized();
      throw new Error('Authentication failed. Please login again.');
    }

    if (!mbResponse.ok) {
      throw new Error('Failed to search MusicBrainz');
    }

    const mbData = await mbResponse.json();
    const releaseGroups = mbData['release-groups'] || [];

    if (releaseGroups.length === 0) {
      throw new Error(
        'Album not found in MusicBrainz. Try adding manually in SuShe Online.'
      );
    }

    // Take the first (best) match
    const releaseGroup = releaseGroups[0];
    console.log('Found release group:', releaseGroup);

    // Get cover art from Deezer
    console.log('Fetching cover art from Deezer...');

    const deezerQuery = `${albumData.artist} ${albumData.album}`
      .replace(/[^\w\s]/g, ' ')
      .trim();
    const deezerResponse = await fetchWithTimeout(
      `${SUSHE_API_BASE}/api/proxy/deezer?q=${encodeURIComponent(deezerQuery)}`,
      { headers: getAuthHeaders() },
      20000 // 20 second timeout for Deezer
    );

    let coverImageData = '';
    let coverImageFormat = '';

    if (deezerResponse.ok) {
      const deezerData = await deezerResponse.json();
      if (deezerData.data && deezerData.data.length > 0) {
        const coverUrl =
          deezerData.data[0].cover_xl || deezerData.data[0].cover_big;
        if (coverUrl) {
          console.log('Found cover art, processing through proxy...');
          try {
            const proxyUrl = `${SUSHE_API_BASE}/api/proxy/image?url=${encodeURIComponent(coverUrl)}`;
            const imageResponse = await fetchWithTimeout(
              proxyUrl,
              { headers: getAuthHeaders() },
              30000 // 30 second timeout for image proxy
            );

            if (imageResponse.ok) {
              const imageData = await imageResponse.json();
              if (imageData.data && imageData.contentType) {
                coverImageData = imageData.data;
                coverImageFormat = imageData.contentType
                  .split('/')[1]
                  .toUpperCase();
                console.log('Cover image processed successfully');
              }
            }
          } catch (error) {
            console.warn('Error processing cover image:', error);
          }
        }
      }
    }

    // Get current list data (now using list ID instead of name)
    console.log(
      `Fetching current list: ${SUSHE_API_BASE}/api/lists/${encodeURIComponent(listId)}`
    );
    const listResponse = await fetchWithTimeout(
      `${SUSHE_API_BASE}/api/lists/${encodeURIComponent(listId)}`,
      { headers: getAuthHeaders() },
      15000 // 15 second timeout
    );

    console.log('Fetch response status:', listResponse.status);

    let currentList = [];
    if (listResponse.ok) {
      currentList = await listResponse.json();
      console.log('Current list has', currentList.length, 'albums');
    } else if (listResponse.status === 401) {
      // Handle 401 - clear auth and notify user
      await handleUnauthorized();
      await showErrorMenu('Not logged in');
      throw new Error(
        'Authentication failed. Please click the extension icon and login again.'
      );
    } else if (listResponse.status === 404) {
      console.log('List not found, will create new one');
      // List doesn't exist yet, that's okay
    } else {
      throw new Error(`API returned status ${listResponse.status}`);
    }

    // Check if album already exists in list
    const isDuplicate = currentList.some(
      (item) =>
        item.artist === albumData.artist && item.album === albumData.album
    );

    if (isDuplicate) {
      showNotification(
        'Already in list',
        `${albumData.album} is already in ${listName}`
      );
      return;
    }

    // Get artist country from MusicBrainz and resolve to full name
    let artistCountry = '';
    if (
      releaseGroup['artist-credit'] &&
      releaseGroup['artist-credit'].length > 0
    ) {
      const artistId = releaseGroup['artist-credit'][0].artist.id;
      try {
        const artistEndpoint = `artist/${artistId}?fmt=json`;
        const artistResponse = await fetchWithTimeout(
          `${SUSHE_API_BASE}/api/proxy/musicbrainz?endpoint=${encodeURIComponent(artistEndpoint)}&priority=normal`,
          { headers: getAuthHeaders() },
          15000 // 15 second timeout
        );

        if (artistResponse.ok) {
          const artistData = await artistResponse.json();
          if (artistData.country && artistData.country.length === 2) {
            // Resolve 2-letter country code to full name
            artistCountry = await resolveCountryCode(artistData.country);
            console.log(
              `Resolved country code ${artistData.country} to: ${artistCountry}`
            );
          } else if (artistData.country) {
            // Already full name
            artistCountry = artistData.country;
          }
        }
      } catch (error) {
        console.warn('Could not fetch artist country:', error);
      }
    }

    // Add new album to list
    // Genres are extracted from the RYM page by the content script
    currentList.push({
      artist: albumData.artist,
      album: albumData.album,
      album_id: releaseGroup.id || '',
      release_date: releaseGroup['first-release-date'] || '',
      country: artistCountry,
      genre_1: albumData.genre_1 || '',
      genre_2: albumData.genre_2 || '',
      comments: '',
      tracks: null,
      track_pick: null,
      cover_image: coverImageData,
      cover_image_format: coverImageFormat,
    });

    console.log('Album genres from RYM:', {
      genre_1: albumData.genre_1,
      genre_2: albumData.genre_2,
    });

    // Save updated list (now using PUT with list ID)
    console.log('Saving list with', currentList.length, 'albums');
    const saveResponse = await fetchWithTimeout(
      `${SUSHE_API_BASE}/api/lists/${encodeURIComponent(listId)}`,
      {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ data: currentList }),
      },
      60000 // 60 second timeout for saves (large lists)
    );

    console.log('Save response status:', saveResponse.status);

    if (!saveResponse.ok) {
      const errorText = await saveResponse.text();
      console.error('Save failed:', errorText);

      // Handle specific error cases
      if (saveResponse.status === 401) {
        await handleUnauthorized();
        await showErrorMenu('Not logged in');
        throw new Error(
          'Not authenticated. Please click the extension icon and login again.'
        );
      }

      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        throw new Error(`Failed to save album (HTTP ${saveResponse.status})`);
      }
      throw new Error(errorData.error || 'Failed to save album');
    }

    // Success notification with album cover
    const albumCoverUrl = coverImageData
      ? `data:image/${coverImageFormat.toLowerCase()};base64,${coverImageData}`
      : 'icons/icon128.png';

    showNotificationWithImage(
      'Successfully added',
      `${albumData.album} added to ${listName}`,
      albumCoverUrl
    );
  } catch (error) {
    console.error('Error adding album:', error);
    showNotification('Error', error.message || 'Failed to add album to list');
  }
}

// Resolve 2-letter country code to full country name
async function resolveCountryCode(countryCode) {
  if (!countryCode || countryCode.length !== 2) {
    console.debug(`Invalid country code: ${countryCode}`);
    return '';
  }

  try {
    // Use RestCountries API to get country info
    const response = await fetchWithTimeout(
      `https://restcountries.com/v3.1/alpha/${countryCode}`,
      {},
      10000 // 10 second timeout
    );

    if (!response.ok) {
      console.warn(
        `Country code ${countryCode} not found in RestCountries API`
      );
      return '';
    }

    const data = await response.json();
    if (!data || !data[0]) {
      console.warn(`Empty data from RestCountries API for ${countryCode}`);
      return '';
    }

    const countryData = data[0];

    // Use the common name (e.g., "United States" instead of "United States of America")
    let countryName = countryData.name.common;

    // Special cases to match SuShe Online's country list
    if (countryCode === 'US') {
      countryName = 'United States';
    } else if (countryCode === 'GB') {
      countryName = 'United Kingdom';
    } else if (countryCode === 'KR') {
      countryName = 'Korea, South';
    } else if (countryCode === 'KP') {
      countryName = 'Korea, North';
    }

    console.debug(`Resolved ${countryCode} to ${countryName}`);
    return countryName;
  } catch (error) {
    console.error(`Error resolving country code ${countryCode}:`, error);
    return '';
  }
}

// Handle notification clicks (for install notification)
chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId === 'sushe-welcome') {
    // Open options page for first-time setup
    chrome.runtime.openOptionsPage();
    chrome.notifications.clear('sushe-welcome');
  }
});

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle async operations with proper error handling
  if (message.action === 'refreshLists') {
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

  if (message.action === 'updateApiUrl') {
    // Async operation - keep channel open
    (async () => {
      try {
        await ensureStateLoaded();
        SUSHE_API_BASE = message.apiUrl;
        console.log('API URL updated to:', SUSHE_API_BASE);
        listsLastFetched = 0; // Force refresh with new URL
        userLists = [];
        await createContextMenus();
        sendResponse({ success: true });
      } catch (error) {
        console.error('Error updating API URL:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  if (message.action === 'getApiUrl') {
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
  if (message.action === 'logout') {
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
  if (message.action === 'getAuthStatus') {
    (async () => {
      try {
        await ensureStateLoaded();
        const state = await loadFullState();
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

  // Get lists from background (single source of truth for popup)
  // This ensures popup and context menu always show the same data
  if (message.action === 'getLists') {
    (async () => {
      try {
        console.log(
          '[getLists] Request received, forceRefresh:',
          message.forceRefresh
        );

        // Fetch lists (and update context menu as a side effect)
        // forceRefresh bypasses cache to get fresh data
        await fetchUserLists(message.forceRefresh || false);

        // Return the lists data that's now cached in background
        sendResponse({
          success: true,
          lists: userListsByYear,
          flatLists: userLists,
          count: userLists.length,
        });

        console.log('[getLists] Returned', userLists.length, 'lists to popup');
      } catch (error) {
        console.error('[getLists] Error:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // Keep channel open for async response
  }

  // RYM page loaded - refresh lists to keep context menu fresh
  // This ensures the menu is always up-to-date when browsing RateYourMusic
  if (message.action === 'rymPageLoaded') {
    (async () => {
      try {
        console.log('[RYM Page Load] Refreshing lists for context menu...');

        // Always force refresh - server has 5-minute cache to prevent DB hammering
        // This gives us the best UX (always fresh) with minimal server impact
        await fetchUserLists(true);

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
