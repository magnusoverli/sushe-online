// Background service worker for SuShe Online extension
// Handles context menu creation and API communication

let SUSHE_API_BASE = 'http://localhost:3000'; // Default, will be loaded from storage
let AUTH_TOKEN = null; // Authentication token
let userLists = [];
let listsLastFetched = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Load API URL and auth token from storage on startup
async function loadSettings() {
  const settings = await chrome.storage.local.get([
    'apiUrl',
    'authToken',
    'userLists',
    'listsLastFetched',
  ]);

  if (settings.apiUrl) {
    SUSHE_API_BASE = settings.apiUrl;
    console.log('Loaded API URL from settings:', SUSHE_API_BASE);
  } else {
    console.log('Using default API URL:', SUSHE_API_BASE);
  }

  if (settings.authToken) {
    AUTH_TOKEN = settings.authToken;
    console.log('Loaded auth token from storage');
  } else {
    console.log('No auth token found');
  }

  // Load cached lists if available
  if (settings.userLists && Array.isArray(settings.userLists)) {
    userLists = settings.userLists;
    listsLastFetched = settings.listsLastFetched || 0;
    console.log('Loaded cached lists from storage:', userLists.length, 'lists');
  } else {
    console.log('No cached lists found in storage');
  }
}

// Get authorization headers for API requests
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
async function ensureStateLoaded() {
  if (
    !AUTH_TOKEN ||
    userLists.length === 0 ||
    SUSHE_API_BASE === 'http://localhost:3000'
  ) {
    console.log('State potentially lost, reloading from storage...');
    const settings = await chrome.storage.local.get([
      'apiUrl',
      'authToken',
      'userLists',
    ]);

    // Always reload API URL from storage if available (fixes service worker restart issue)
    if (settings.apiUrl) {
      SUSHE_API_BASE = settings.apiUrl;
    }

    if (settings.authToken && !AUTH_TOKEN) {
      AUTH_TOKEN = settings.authToken;
    }

    if (settings.userLists && userLists.length === 0) {
      userLists = settings.userLists;
    }

    console.log('State reloaded:', {
      apiUrl: SUSHE_API_BASE,
      hasToken: !!AUTH_TOKEN,
      listsCount: userLists.length,
    });
  }
}

// Create main context menu on extension install
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('SuShe Online extension installed:', details.reason);

  // Show welcome notification on first install
  if (details.reason === 'install') {
    chrome.notifications.create('sushe-welcome', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: '🤘 Welcome to SuShe Online!',
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

    console.log(`Updated from ${previousVersion} to ${currentVersion}`);
  }

  await loadSettings();
  createContextMenus();
});

// Recreate context menus on startup
chrome.runtime.onStartup.addListener(async () => {
  await loadSettings();
  createContextMenus();
});

// Listen for storage changes to update token and invalidate cache
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local') {
    if (changes.authToken) {
      const hadToken = !!changes.authToken.oldValue;
      const hasToken = !!changes.authToken.newValue;

      AUTH_TOKEN = changes.authToken?.newValue || null;
      console.log('Auth token updated:', AUTH_TOKEN ? 'present' : 'removed');

      // Invalidate cache when auth changes
      listsLastFetched = 0;

      // Refresh lists if token is present
      if (AUTH_TOKEN) {
        // New login - fetch fresh lists and mark as authenticated
        userLists = [];
        // Track that user has successfully authenticated at least once
        chrome.storage.local.set({ hasEverAuthenticated: true });
        fetchUserLists();
      } else if (hadToken && !hasToken) {
        // Token was removed/expired - keep cached lists but mark as stale
        // Don't clear the menu immediately - wait for next fetch to fail
        console.log('Auth token removed - cached lists remain available');
      }
    }

    if (changes.apiUrl) {
      SUSHE_API_BASE = changes.apiUrl?.newValue || 'http://localhost:3000';
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

// Classify fetch errors to provide better user feedback
function classifyFetchError(error) {
  const errorMsg = error.message.toLowerCase();

  // Network connectivity issues
  if (
    errorMsg.includes('failed to fetch') ||
    errorMsg.includes('network request failed') ||
    errorMsg.includes('networkerror') ||
    errorMsg.includes('network error')
  ) {
    return 'network';
  }

  // CORS issues (usually appear as fetch failures)
  if (errorMsg.includes('cors') || errorMsg.includes('cross-origin')) {
    return 'cors';
  }

  // Authentication issues
  if (
    errorMsg.includes('401') ||
    errorMsg.includes('unauthorized') ||
    errorMsg.includes('not authenticated')
  ) {
    return 'auth';
  }

  // Server errors (5xx)
  if (errorMsg.includes('500') || errorMsg.includes('50')) {
    return 'server';
  }

  // Client errors (4xx) that aren't auth
  if (errorMsg.includes('400') || errorMsg.includes('404')) {
    return 'client';
  }

  // Timeout errors
  if (errorMsg.includes('timeout') || errorMsg.includes('timed out')) {
    return 'timeout';
  }

  // Unknown error
  return 'unknown';
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
async function fetchUserLists() {
  const now = Date.now();

  // Use cache if recent
  if (userLists.length > 0 && now - listsLastFetched < CACHE_DURATION) {
    console.log('Using cached lists:', userLists.length);
    updateContextMenuWithLists();
    return;
  }

  console.log('Fetching lists from API...');
  console.log('API Base:', SUSHE_API_BASE);
  console.log('Auth Token present:', !!AUTH_TOKEN);

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
    // If they've been logged in before but token is gone, fall through to show login error
  }

  try {
    const response = await fetch(`${SUSHE_API_BASE}/api/lists`, {
      headers: getAuthHeaders(),
    });

    console.log('API response status:', response.status);

    if (response.status === 401) {
      console.log('Not authenticated (401), showing login menu');
      userLists = [];
      listsLastFetched = 0;
      showErrorMenu('Not logged in');
      return;
    }

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const listsData = await response.json();
    userLists = Object.keys(listsData);
    listsLastFetched = now;

    // Store in chrome.storage for persistence
    await chrome.storage.local.set({ userLists, listsLastFetched });

    updateContextMenuWithLists();
  } catch (error) {
    console.error('Failed to fetch lists:', error);

    // Classify error type for better user feedback
    const errorType = classifyFetchError(error);

    // Don't clear existing lists or show error menu for temporary failures
    // Only reset if there were no cached lists to begin with
    if (userLists.length === 0) {
      // Show appropriate error message based on error type
      if (errorType === 'auth') {
        showErrorMenu('Not logged in');
      } else if (errorType === 'network') {
        showErrorMenu('Network error - check connection');
      } else if (errorType === 'server') {
        showErrorMenu('Server error - try again later');
      } else {
        showErrorMenu('Connection failed');
      }
    } else {
      console.warn(
        `Failed to refresh lists (${errorType}), keeping cached version:`,
        error.message
      );
      // Keep using cached lists - they're better than nothing
    }
  }
}

// Update context menu with user's lists
async function updateContextMenuWithLists() {
  console.log('Updating context menu with lists:', userLists);

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

    // Add each list as a submenu item
    userLists.forEach((listName, index) => {
      console.log(
        `Creating menu item: sushe-list-${index} for list "${listName}"`
      );
      // Use index-based ID to avoid issues with special characters in list names
      chrome.contextMenus.create(
        {
          id: `sushe-list-${index}`,
          parentId: 'sushe-main',
          title: listName,
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

    // Add refresh option at the end
    chrome.contextMenus.create(
      {
        id: 'sushe-separator',
        parentId: 'sushe-main',
        type: 'separator',
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

    chrome.contextMenus.create(
      {
        id: 'sushe-refresh',
        parentId: 'sushe-main',
        title: '🔄 Refresh Lists',
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

    console.log('Context menu updated successfully');
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
        title: '👋 Welcome! Click to get started',
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
        title: '⚙️ Open Settings & Login',
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
      ? '⚠️ Not logged in to SuShe Online'
      : `⚠️ Error: ${message.substring(0, 50)}`;

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
          title: '🔄 Try again',
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

  // Handle refresh
  if (info.menuItemId === 'sushe-refresh') {
    console.log('Refreshing lists...');
    listsLastFetched = 0; // Force refresh
    userLists = []; // Clear cache
    await fetchUserLists();
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

  // Handle list selection
  if (info.menuItemId.startsWith('sushe-list-')) {
    const listIndex = parseInt(info.menuItemId.replace('sushe-list-', ''));
    console.log(
      `Menu item clicked: ${info.menuItemId}, extracted index: ${listIndex}`
    );

    // State already loaded by ensureStateLoaded() above
    console.log('Available lists:', userLists);
    console.log(
      `Looking up index ${listIndex} in array of length ${userLists.length}`
    );

    const listName = userLists[listIndex];
    console.log(`List name for index ${listIndex}: "${listName}"`);

    if (listName && typeof listName === 'string') {
      await addAlbumToList(info, tab, listName);
    } else {
      console.error('List not found for index:', listIndex);
      console.error('userLists array:', JSON.stringify(userLists));
      showNotification(
        '✗ Error',
        'List not found. Try refreshing lists.'
      );
    }
  }
});

// Extract album data and add to list
async function addAlbumToList(info, tab, listName) {
  console.log('Adding album to list:', listName);
  console.log('Context info:', info);

  // Ensure state is loaded in case service worker restarted
  await ensureStateLoaded();

  console.log('Using API base:', SUSHE_API_BASE);
  console.log('Auth token present:', !!AUTH_TOKEN);

  try {
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
      console.error('Content script communication error:', err);
      // Try to inject the content script if it's not loaded
      console.log('Attempting to inject content script...');
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content-script.js'],
        });
        // Wait a moment for script to initialize
        await new Promise((resolve) => setTimeout(resolve, 100));
        // Try again
        albumData = await chrome.tabs.sendMessage(tab.id, {
          action: 'extractAlbumData',
          srcUrl: info.srcUrl,
          linkUrl: info.linkUrl,
          pageUrl: info.pageUrl,
        });
      } catch (injectErr) {
        console.error('Failed to inject content script:', injectErr);
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

    // Show progress notification with album cover from RateYourMusic
    const rymCoverUrl = info.srcUrl || 'icons/icon128.png';
    showNotificationWithImage(
      'Adding album...',
      `Adding ${albumData.album} by ${albumData.artist} to ${listName}`,
      rymCoverUrl
    );

    // Search MusicBrainz for the album
    console.log('Searching MusicBrainz for album...');

    const searchQuery = `${albumData.artist} ${albumData.album}`;
    const mbEndpoint = `release-group/?query=${encodeURIComponent(searchQuery)}&type=album|ep&fmt=json&limit=5`;

    const mbResponse = await fetch(
      `${SUSHE_API_BASE}/api/proxy/musicbrainz?endpoint=${encodeURIComponent(mbEndpoint)}&priority=high`,
      {
        headers: getAuthHeaders(),
      }
    );

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
    const deezerResponse = await fetch(
      `${SUSHE_API_BASE}/api/proxy/deezer?q=${encodeURIComponent(deezerQuery)}`,
      {
        headers: getAuthHeaders(),
      }
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
            const imageResponse = await fetch(proxyUrl, {
              headers: getAuthHeaders(),
            });

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

    // Get current list data
    console.log(
      `Fetching current list: ${SUSHE_API_BASE}/api/lists/${encodeURIComponent(listName)}`
    );
    const listResponse = await fetch(
      `${SUSHE_API_BASE}/api/lists/${encodeURIComponent(listName)}`,
      {
        headers: getAuthHeaders(),
      }
    );

    console.log('Fetch response status:', listResponse.status);

    let currentList = [];
    if (listResponse.ok) {
      currentList = await listResponse.json();
      console.log('Current list has', currentList.length, 'albums');
    } else if (listResponse.status === 401) {
      // Clear auth token since it's invalid
      AUTH_TOKEN = null;
      await chrome.storage.local.remove('authToken');
      throw new Error(
        'Your session has expired. Please click the extension icon and login again.'
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
        'ℹ Already in list',
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
        const artistResponse = await fetch(
          `${SUSHE_API_BASE}/api/proxy/musicbrainz?endpoint=${encodeURIComponent(artistEndpoint)}&priority=normal`,
          {
            headers: getAuthHeaders(),
          }
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
    currentList.push({
      artist: albumData.artist,
      album: albumData.album,
      album_id: releaseGroup.id || '',
      release_date: releaseGroup['first-release-date'] || '',
      country: artistCountry,
      genre_1: '',
      genre_2: '',
      comments: '',
      tracks: null,
      track_pick: null,
      cover_image: coverImageData,
      cover_image_format: coverImageFormat,
    });

    // Save updated list
    console.log('Saving list with', currentList.length, 'albums');
    const saveResponse = await fetch(
      `${SUSHE_API_BASE}/api/lists/${encodeURIComponent(listName)}`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ data: currentList }),
      }
    );

    console.log('Save response status:', saveResponse.status);

    if (!saveResponse.ok) {
      const errorText = await saveResponse.text();
      console.error('Save failed:', errorText);

      // Handle specific error cases
      if (saveResponse.status === 401) {
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
      '✓ Successfully added',
      `${albumData.album} added to ${listName}`,
      albumCoverUrl
    );
  } catch (error) {
    console.error('Error adding album:', error);
    showNotification(
      '✗ Error',
      error.message || 'Failed to add album to list'
    );
  }
}

// Show browser notification
function showNotification(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: title,
    message: message,
  });
}

// Show browser notification with custom image
function showNotificationWithImage(title, message, imageUrl) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: imageUrl,
    title: title,
    message: message,
  });
}

// Resolve 2-letter country code to full country name
async function resolveCountryCode(countryCode) {
  if (!countryCode || countryCode.length !== 2) {
    console.debug(`Invalid country code: ${countryCode}`);
    return '';
  }

  try {
    // Use RestCountries API to get country info
    const response = await fetch(
      `https://restcountries.com/v3.1/alpha/${countryCode}`
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
        await ensureStateLoaded();
        listsLastFetched = 0;
        userLists = [];
        await fetchUserLists();
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
        sendResponse({ apiUrl: 'http://localhost:3000' });
      }
    })();
    return true;
  }

  // Return false for unknown actions to avoid channel errors
  return false;
});
