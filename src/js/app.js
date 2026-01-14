// Import static data at build time
import genresText from '../data/genres.txt?raw';
import countriesText from '../data/countries.txt?raw';
import { createAlbumDisplay } from './modules/album-display.js';
import { createContextMenus } from './modules/context-menus.js';
import { createMobileUI } from './modules/mobile-ui.js';
import { createListNav } from './modules/list-nav.js';
import { createEditableFields } from './modules/editable-fields.js';
import { createSorting } from './modules/sorting.js';
import { createImportConflictHandler } from './modules/import-export.js';
// Date utilities are imported directly by modules that need them
import { createNowPlaying } from './modules/now-playing.js';
import { createRealtimeSync } from './modules/realtime-sync.js';
import {
  positionContextMenu,
  showToast,
  showConfirmation,
  hideConfirmation,
} from './modules/ui-utils.js';
import { checkListSetupStatus } from './modules/list-setup-wizard.js';
import { createSettingsDrawer } from './modules/settings-drawer.js';

// Re-export UI utilities for backward compatibility
export { showToast, showConfirmation };

// Lazy loading module cache
let musicServicesModule = null;
let importExportModule = null;

// Album display module instance (initialized lazily when first needed)
let albumDisplayModule = null;

// Context menus module instance (initialized lazily when first needed)
let contextMenusModule = null;

// Mobile UI module instance (initialized lazily when first needed)
let mobileUIModule = null;

// List navigation module instance (initialized lazily when first needed)
let listNavModule = null;

// Editable fields module instance (initialized lazily when first needed)
let editableFieldsModule = null;

// Sorting module instance (initialized lazily when first needed)
let sortingModule = null;

// Import conflict handler module instance (initialized lazily when first needed)
let importConflictModule = null;

// Now playing module instance (initialized lazily when first needed)
let nowPlayingModule = null;

// Realtime sync module instance (initialized on page load)
let realtimeSyncModule = null;

/**
 * Get or initialize the album display module
 * Uses lazy initialization to avoid dependency ordering issues
 */
function getAlbumDisplayModule() {
  if (!albumDisplayModule) {
    albumDisplayModule = createAlbumDisplay({
      getListData,
      getListMetadata,
      getCurrentList: () => currentList,
      saveList,
      showToast,
      apiCall,
      fetchTracksForAlbum,
      makeCountryEditable,
      makeGenreEditable,
      makeCommentEditable,
      attachLinkPreview,
      showTrackSelectionMenu,
      showMobileEditForm,
      showMobileAlbumMenu: (el) => window.showMobileAlbumMenu(el),
      showMobileSummarySheet: (summary, albumName, artist) =>
        window.showMobileSummarySheet(summary, albumName, artist),
      playTrackSafe: (albumId) => window.playTrackSafe(albumId),
      getTrackName,
      getTrackLength,
      formatTrackTime,
      reapplyNowPlayingBorder,
      initializeUnifiedSorting,
      setContextAlbum: (index, albumId) => {
        currentContextAlbum = index;
        currentContextAlbumId = albumId;
      },
    });
  }
  return albumDisplayModule;
}

// Wrapper functions that delegate to the module
function displayAlbums(albums, options = {}) {
  return getAlbumDisplayModule().displayAlbums(albums, options);
}

function fetchAndDisplayPlaycounts(listId, forceRefresh = false) {
  return getAlbumDisplayModule().fetchAndDisplayPlaycounts(
    listId,
    forceRefresh
  );
}

function clearPlaycountCache() {
  return getAlbumDisplayModule().clearPlaycountCache();
}

function updatePositionNumbers(container, isMobile) {
  return getAlbumDisplayModule().updatePositionNumbers(container, isMobile);
}

// Expose displayAlbums to window for templates and other modules
window.displayAlbums = displayAlbums;

/**
 * Get or initialize the context menus module
 * Uses lazy initialization to avoid dependency ordering issues
 */
function getContextMenusModule() {
  if (!contextMenusModule) {
    contextMenusModule = createContextMenus({
      getListData,
      getListMetadata,
      getCurrentList: () => currentList,
      getLists: () => lists,
      saveList,
      selectList,
      showToast,
      showConfirmation,
      apiCall,
      findAlbumByIdentity,
      downloadListAsJSON,
      downloadListAsPDF,
      downloadListAsCSV,
      updatePlaylist,
      openRenameModal,
      updateListNav,
      updateListMetadata,
      showMobileEditForm,
      playAlbum,
      playAlbumSafe: (albumId) => window.playAlbumSafe(albumId),
      loadLists,
      getContextState: () => ({
        album: currentContextAlbum,
        albumId: currentContextAlbumId,
        list: currentContextList,
      }),
      setContextState: (state) => {
        if ('album' in state) currentContextAlbum = state.album;
        if ('albumId' in state) currentContextAlbumId = state.albumId;
        if ('list' in state) currentContextList = state.list;
      },
      setCurrentList: (listName) => {
        currentList = listName;
      },
      refreshMobileBarVisibility: () => {
        if (window.refreshMobileBarVisibility) {
          window.refreshMobileBarVisibility();
        }
      },
      toggleMainStatus,
    });
  }
  return contextMenusModule;
}

// Wrapper functions for context menus module
function getListMenuConfig(listName) {
  return getContextMenusModule().getListMenuConfig(listName);
}

function getDeviceIcon(type) {
  return getContextMenusModule().getDeviceIcon(type);
}

function initializeContextMenu() {
  return getContextMenusModule().initializeContextMenu();
}

/**
 * Get or initialize the mobile UI module
 * Uses lazy initialization to avoid dependency ordering issues
 */
function getMobileUIModule() {
  if (!mobileUIModule) {
    mobileUIModule = createMobileUI({
      getListData,
      getListMetadata,
      getCurrentList: () => currentList,
      getLists: () => lists,
      setListData,
      saveList,
      selectList,
      showToast,
      showConfirmation,
      apiCall,
      getTrackName,
      getTrackLength,
      formatTrackTime,
      displayAlbums,
      updateListNav,
      fetchTracksForAlbum,
      playAlbum,
      playAlbumOnDeviceMobile,
      openRenameModal,
      downloadListAsJSON,
      downloadListAsPDF,
      downloadListAsCSV,
      updatePlaylist,
      toggleMainStatus,
      getDeviceIcon,
      getListMenuConfig,
      getAvailableCountries: () => availableCountries,
      getAvailableGenres: () => availableGenres,
      setCurrentContextAlbum: (idx) => {
        currentContextAlbum = idx;
      },
      refreshMobileBarVisibility: () => {
        if (window.refreshMobileBarVisibility) {
          window.refreshMobileBarVisibility();
        }
      },
      showDiscoveryModal: (type, data) => {
        import('./modules/discovery.js').then(({ showDiscoveryModal }) => {
          showDiscoveryModal(type, data);
        });
      },
      playSpecificTrack,
    });
  }
  return mobileUIModule;
}

// Wrapper functions for mobile UI module
function showMobileAlbumMenu(indexOrElement) {
  return getMobileUIModule().showMobileAlbumMenu(indexOrElement);
}

function showMobileMoveToListSheet(index, albumId) {
  return getMobileUIModule().showMobileMoveToListSheet(index, albumId);
}

function showMobileListMenu(listName) {
  return getMobileUIModule().showMobileListMenu(listName);
}

function showMobileEditForm(index) {
  return getMobileUIModule().showMobileEditForm(index);
}

function showMobileSummarySheet(summary, albumName, artist) {
  return getMobileUIModule().showMobileSummarySheet(summary, albumName, artist);
}

function showMobileEditFormSafe(albumId) {
  return getMobileUIModule().showMobileEditFormSafe(albumId);
}

function playAlbumSafe(albumId) {
  return getMobileUIModule().playAlbumSafe(albumId);
}

function removeAlbumSafe(albumId) {
  return getMobileUIModule().removeAlbumSafe(albumId);
}

function findAlbumByIdentity(albumId) {
  return getMobileUIModule().findAlbumByIdentity(albumId);
}

// Expose mobile UI functions to window for access from other modules
window.showMobileAlbumMenu = showMobileAlbumMenu;
window.showMobileMoveToListSheet = showMobileMoveToListSheet;
window.showMobileListMenu = showMobileListMenu;
window.showMobileEditForm = showMobileEditForm;
window.showMobileEditFormSafe = showMobileEditFormSafe;
window.showMobileSummarySheet = showMobileSummarySheet;
window.playAlbumSafe = playAlbumSafe;
window.removeAlbumSafe = removeAlbumSafe;

/**
 * Get or initialize the list navigation module
 * Uses lazy initialization to avoid dependency ordering issues
 */
function getListNavModule() {
  if (!listNavModule) {
    listNavModule = createListNav({
      getLists: () => lists,
      getListMetadata,
      getCurrentList: () => currentList,
      selectList,
      getListMenuConfig,
      hideAllContextMenus,
      positionContextMenu,
      toggleMobileLists,
      setCurrentContextList: (listName) => {
        currentContextList = listName;
      },
    });
  }
  return listNavModule;
}

// Wrapper functions for list navigation module
function updateListNav() {
  return getListNavModule().updateListNav();
}

function updateListNavActiveState(activeListName) {
  return getListNavModule().updateListNavActiveState(activeListName);
}

// Expose updateListNav to window for access from other modules
window.updateListNav = updateListNav;

/**
 * Get or initialize the editable fields module
 * Uses lazy initialization to avoid dependency ordering issues
 */
function getEditableFieldsModule() {
  if (!editableFieldsModule) {
    editableFieldsModule = createEditableFields({
      getListData,
      getCurrentList: () => currentList,
      saveList,
      showToast,
      getAvailableCountries: () => availableCountries,
      getAvailableGenres: () => availableGenres,
      isTextTruncated,
    });
  }
  return editableFieldsModule;
}

// Wrapper functions for editable fields module
function makeCountryEditable(countryDiv, albumIndex) {
  return getEditableFieldsModule().makeCountryEditable(countryDiv, albumIndex);
}

function makeGenreEditable(genreDiv, albumIndex, genreField) {
  return getEditableFieldsModule().makeGenreEditable(
    genreDiv,
    albumIndex,
    genreField
  );
}

function makeCommentEditable(commentDiv, albumIndex) {
  return getEditableFieldsModule().makeCommentEditable(commentDiv, albumIndex);
}

/**
 * Get or initialize the sorting module
 * Uses lazy initialization to avoid dependency ordering issues
 */
function getSortingModule() {
  if (!sortingModule) {
    sortingModule = createSorting({
      getListData,
      getCurrentList: () => currentList,
      debouncedSaveList,
      updatePositionNumbers,
      showToast,
    });
  }
  return sortingModule;
}

// Wrapper function for sorting module
function initializeUnifiedSorting(container, isMobile) {
  return getSortingModule().initializeUnifiedSorting(container, isMobile);
}

/**
 * Get or initialize the import conflict handler module
 * Uses lazy initialization to avoid dependency ordering issues
 */
function getImportConflictModule() {
  if (!importConflictModule) {
    importConflictModule = createImportConflictHandler({
      getListData,
      getLists: () => lists,
      saveList,
      selectList,
      updateListNav,
      getPendingImport: () => ({
        data: pendingImportData,
        filename: pendingImportFilename,
      }),
      setPendingImport: (data, filename) => {
        pendingImportData = data;
        pendingImportFilename = filename;
      },
    });
  }
  return importConflictModule;
}

// Wrapper function for import conflict handling
function initializeImportConflictHandling() {
  return getImportConflictModule().initializeImportConflictHandling();
}

/**
 * Get or initialize the now-playing module
 * Uses lazy initialization to avoid dependency ordering issues
 */
function getNowPlayingModule() {
  if (!nowPlayingModule) {
    nowPlayingModule = createNowPlaying({
      getListData,
      getCurrentList: () => currentList,
    });
    // Initialize event listeners
    nowPlayingModule.initialize();
  }
  return nowPlayingModule;
}

// Wrapper function for now-playing module (reapplyNowPlayingBorder is passed to album-display)
function reapplyNowPlayingBorder() {
  return getNowPlayingModule().reapplyNowPlayingBorder();
}

// Track recent local saves to avoid showing "updated from another device" for our own changes
const recentLocalSaves = new Map();
const LOCAL_SAVE_GRACE_PERIOD = 5000; // 5 seconds

/**
 * Mark a list as recently saved locally
 * @param {string} listName - Name of the list that was saved
 */
function markLocalSave(listName) {
  recentLocalSaves.set(listName, Date.now());
  // Clean up old entries
  setTimeout(() => {
    recentLocalSaves.delete(listName);
  }, LOCAL_SAVE_GRACE_PERIOD + 1000);
}

/**
 * Check if a list was recently saved locally (within grace period)
 * @param {string} listName - Name of the list to check
 * @returns {boolean} True if this was a local save
 */
function wasRecentLocalSave(listName) {
  const saveTime = recentLocalSaves.get(listName);
  if (!saveTime) return false;
  const elapsed = Date.now() - saveTime;
  if (elapsed < LOCAL_SAVE_GRACE_PERIOD) {
    // Clear it so we only skip once
    recentLocalSaves.delete(listName);
    return true;
  }
  return false;
}

/**
 * Get or initialize the realtime sync module
 * Uses lazy initialization to avoid dependency ordering issues
 */
function getRealtimeSyncModule() {
  if (!realtimeSyncModule) {
    realtimeSyncModule = createRealtimeSync({
      getCurrentList: () => currentList,
      getListData,
      apiCall,
      updateAlbumSummaryInPlace: (albumId, summaryData) =>
        getAlbumDisplayModule().updateAlbumSummaryInPlace(albumId, summaryData),
      refreshListData: async (listName) => {
        // Check if this was our own save - skip refresh and notification
        if (wasRecentLocalSave(listName)) {
          console.log(
            '[RealtimeSync] Skipping refresh for local save:',
            listName
          );
          return { wasLocalSave: true };
        }

        // Fetch fresh data and update the display
        const data = await apiCall(
          `/api/lists/${encodeURIComponent(listName)}`
        );
        setListData(listName, data);
        if (currentList === listName) {
          displayAlbums(data, { forceFullRebuild: true });
        }
        return { wasLocalSave: false };
      },
      refreshListDataSilent: async (listName) => {
        // Silent refresh without notifications (for summary updates)
        const data = await apiCall(
          `/api/lists/${encodeURIComponent(listName)}`
        );
        setListData(listName, data);
        if (currentList === listName) {
          displayAlbums(data, { forceFullRebuild: true });
        }
      },
      refreshListNav: () => {
        // Re-fetch list metadata and update sidebar
        loadLists();
      },
      showToast,
      displayAlbums,
    });
  }
  return realtimeSyncModule;
}

/**
 * Initialize realtime sync for cross-device list updates
 */
function initializeRealtimeSync() {
  const sync = getRealtimeSyncModule();
  sync.connect();

  // Clean up on page unload
  window.addEventListener('beforeunload', () => {
    sync.disconnect();
  });
}

// Global variables
let lists = {};
let currentList = '';
let currentContextAlbum = null;
let currentContextAlbumId = null; // Store album identity as backup
let currentContextList = null;

// Process static data at module load time
const availableGenres = genresText
  .split('\n')
  .map((g) => g.trim())
  .filter((g, index) => {
    // Keep the first empty line if it exists, but remove other empty lines
    return g.length > 0 || (index === 0 && g === '');
  })
  .sort((a, b) => {
    // Keep empty string at top if it exists
    if (a === '') return -1;
    if (b === '') return 1;
    return a.localeCompare(b);
  });

const availableCountries = countriesText
  .split('\n')
  .map((c) => c.trim())
  .filter((c, index) => {
    // Keep the first empty line if it exists, but remove other empty lines
    return c.length > 0 || (index === 0 && c === '');
  })
  .sort((a, b) => {
    // Keep empty string at top if it exists
    if (a === '') return -1;
    if (b === '') return 1;
    return a.localeCompare(b);
  });

// Expose to window for access from other modules
window.availableCountries = availableCountries;

let pendingImportData = null;
let pendingImportFilename = null;

// ============ LIST DATA ACCESS HELPERS ============
// These helpers provide a clean abstraction for accessing list data
// Lists now use metadata objects: { name, year, count, _data, updatedAt, createdAt }

/**
 * Get the album array for a list
 * @param {string} listName - The name of the list
 * @returns {Array|null} - The album array or null if not found/loaded
 */
function getListData(listName) {
  if (!listName || !lists[listName]) {
    return null;
  }

  const listEntry = lists[listName];

  // Handle legacy array format (for backward compatibility during transition)
  if (Array.isArray(listEntry)) {
    console.warn(
      `Legacy array format detected for list "${listName}". Consider reloading.`
    );
    return listEntry;
  }

  // New metadata object format
  return listEntry._data || null;
}

/**
 * Set the album array for a list, preserving metadata
 * @param {string} listName - The name of the list
 * @param {Array} albums - The album array to set
 */
function setListData(listName, albums) {
  if (!listName) return;

  if (!lists[listName]) {
    // Create new metadata object if list doesn't exist
    lists[listName] = {
      name: listName,
      year: null,
      isMain: false,
      count: albums ? albums.length : 0,
      _data: albums || [],
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
  } else if (Array.isArray(lists[listName])) {
    // Handle legacy array format - convert to metadata object
    console.warn(
      `Converting legacy array format for list "${listName}" to metadata object.`
    );
    lists[listName] = {
      name: listName,
      year: null,
      isMain: false,
      count: albums ? albums.length : 0,
      _data: albums || [],
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
  } else {
    // Update existing metadata object
    lists[listName]._data = albums || [];
    lists[listName].count = albums ? albums.length : 0;
  }
}

/**
 * Get metadata for a list (name, year, count, etc.)
 * @param {string} listName - The name of the list
 * @returns {Object|null} - The metadata object or null
 */
function getListMetadata(listName) {
  if (!listName || !lists[listName]) {
    return null;
  }

  const listEntry = lists[listName];

  // Handle legacy array format
  if (Array.isArray(listEntry)) {
    return {
      name: listName,
      year: null,
      isMain: false,
      count: listEntry.length,
      _data: listEntry,
      updatedAt: null,
      createdAt: null,
    };
  }

  return listEntry;
}

/**
 * Update metadata for a list (year, name, etc.)
 * @param {string} listName - The name of the list
 * @param {Object} updates - The metadata fields to update
 */
function updateListMetadata(listName, updates) {
  if (!listName || !lists[listName]) return;

  const listEntry = lists[listName];

  // Handle legacy array format - convert first
  if (Array.isArray(listEntry)) {
    lists[listName] = {
      name: listName,
      year: null,
      isMain: false,
      count: listEntry.length,
      _data: listEntry,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
  }

  // Apply updates
  Object.assign(lists[listName], updates);
}

/**
 * Check if list data has been loaded
 * @param {string} listName - The name of the list
 * @returns {boolean}
 */
function isListDataLoaded(listName) {
  if (!listName || !lists[listName]) return false;

  const listEntry = lists[listName];

  // Legacy array format is always "loaded"
  if (Array.isArray(listEntry)) return true;

  // Check if _data is populated (not null/empty when count > 0)
  return (
    listEntry._data !== null &&
    (listEntry._data.length > 0 || listEntry.count === 0)
  );
}

/**
 * Toggle main status for a list
 * @param {string} listName - The name of the list
 */
async function toggleMainStatus(listName) {
  const meta = getListMetadata(listName);
  if (!meta) return;

  // Check if list has a year assigned
  if (!meta.year) {
    showToast('List must have a year to be marked as main', 'error');
    return;
  }

  const newMainStatus = !meta.isMain;

  try {
    const response = await apiCall(
      `/api/lists/${encodeURIComponent(listName)}/main`,
      {
        method: 'POST',
        body: JSON.stringify({ isMain: newMainStatus }),
      }
    );

    // Update local metadata
    updateListMetadata(listName, { isMain: newMainStatus });

    // If another list lost its main status, update it too
    if (response.previousMainList) {
      updateListMetadata(response.previousMainList, { isMain: false });
    }

    // Refresh sidebar to show updated star icons
    updateListNav();

    // If this is the currently displayed list, re-render to show/hide position numbers
    // Position numbers only appear on main lists (they have semantic meaning for rankings)
    if (listName === currentList) {
      const albums = getListData(currentList);
      if (albums) {
        displayAlbums(albums, { forceFullRebuild: true });
      }
    }

    // Show appropriate message
    if (newMainStatus) {
      if (response.previousMainList) {
        showToast(
          `"${listName}" is now your main ${meta.year} list (replaced "${response.previousMainList}")`
        );
      } else {
        showToast(`"${listName}" is now your main ${meta.year} list`);
      }
    } else {
      showToast(`"${listName}" is no longer marked as main`);
    }
  } catch (error) {
    console.error('Error toggling main status:', error);
    showToast('Error updating main status', 'error');
  }
}

// Expose helpers to window for other modules
window.getListData = getListData;
window.setListData = setListData;
window.getListMetadata = getListMetadata;
window.updateListMetadata = updateListMetadata;
window.isListDataLoaded = isListDataLoaded;
window.toggleMainStatus = toggleMainStatus;

// Track loading performance optimization variables
let trackAbortController = null;

// Hide all context menus helper
function hideAllContextMenus() {
  const contextMenu = document.getElementById('contextMenu');
  if (contextMenu) {
    contextMenu.classList.add('hidden');
  }

  const albumContextMenu = document.getElementById('albumContextMenu');
  if (albumContextMenu) {
    albumContextMenu.classList.add('hidden');
    // Clear context album references when menu is hidden
    currentContextAlbum = null;
    currentContextAlbumId = null;

    // Cancel any pending track fetches
    if (trackAbortController) {
      trackAbortController.abort();
      trackAbortController = null;
    }
  }

  const albumMoveSubmenu = document.getElementById('albumMoveSubmenu');
  if (albumMoveSubmenu) {
    albumMoveSubmenu.classList.add('hidden');
  }

  const playAlbumSubmenu = document.getElementById('playAlbumSubmenu');
  if (playAlbumSubmenu) {
    playAlbumSubmenu.classList.add('hidden');
  }

  // Remove highlights from submenu parent options
  const moveOption = document.getElementById('moveAlbumOption');
  const playOption = document.getElementById('playAlbumOption');
  moveOption?.classList.remove('bg-gray-700', 'text-white');
  playOption?.classList.remove('bg-gray-700', 'text-white');

  // Restore FAB visibility if a list is selected
  const fab = document.getElementById('addAlbumFAB');
  if (fab && currentList) {
    fab.style.display = 'flex';
  }
}

// Hide context menus when clicking elsewhere
document.addEventListener('click', hideAllContextMenus);

// Hide context menus when right-clicking elsewhere (before new menu opens)
document.addEventListener('contextmenu', hideAllContextMenus);

// Prevent default context menu on right-click in list nav (only for list buttons, not year headers)
document.addEventListener('contextmenu', (e) => {
  const listButton = e.target.closest('[data-list-name]');
  if (listButton) {
    e.preventDefault();
  }
});

// Show modal to choose a music service
async function showServicePicker(hasSpotify, hasTidal) {
  if (!musicServicesModule) {
    musicServicesModule = await import('./modules/music-services.js');
  }
  return musicServicesModule.showServicePicker(hasSpotify, hasTidal);
}

async function downloadListAsJSON(listName) {
  if (!importExportModule) {
    showToast('Loading export module...', 'info', 1000);
    importExportModule = await import('./modules/import-export.js');
  }
  return importExportModule.downloadListAsJSON(listName);
}

async function downloadListAsPDF(listName) {
  if (!importExportModule) {
    showToast('Loading export module...', 'info', 1000);
    importExportModule = await import('./modules/import-export.js');
  }
  return importExportModule.downloadListAsPDF(listName);
}

async function downloadListAsCSV(listName) {
  if (!importExportModule) {
    showToast('Loading export module...', 'info', 1000);
    importExportModule = await import('./modules/import-export.js');
  }
  return importExportModule.downloadListAsCSV(listName);
}

async function updatePlaylist(listName, listData = null) {
  if (!musicServicesModule) {
    showToast('Loading playlist integration...', 'info', 1000);
    musicServicesModule = await import('./modules/music-services.js');
  }
  // If listData not provided, get it from global lists
  const data = listData !== null ? listData : getListData(listName) || [];
  return musicServicesModule.updatePlaylist(listName, data);
}
window.updatePlaylist = updatePlaylist;

// Make showToast globally available
window.showToast = showToast;

// Link preview caching and request deduplication
const linkPreviewCache = new Map(); // URL -> preview data
const pendingLinkPreviews = new Map(); // URL -> Promise (for deduplication)
let linkPreviewObserver = null;

/**
 * Initialize the IntersectionObserver for lazy loading link previews
 */
function initLinkPreviewObserver() {
  if (linkPreviewObserver) return linkPreviewObserver;

  linkPreviewObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const el = entry.target;
          const url = el.dataset.previewUrl;
          if (url) {
            fetchAndRenderLinkPreview(el, url);
          }
          linkPreviewObserver.unobserve(el);
        }
      });
    },
    {
      rootMargin: '100px', // Pre-load previews 100px before they enter viewport
      threshold: 0,
    }
  );

  return linkPreviewObserver;
}

/**
 * Fetch link preview with caching and request deduplication
 * @param {string} url - URL to unfurl
 * @returns {Promise<Object|null>} Preview data or null
 */
async function fetchLinkPreviewCached(url) {
  // Check cache first
  if (linkPreviewCache.has(url)) {
    return linkPreviewCache.get(url);
  }

  // Check if there's already a pending request for this URL
  if (pendingLinkPreviews.has(url)) {
    return pendingLinkPreviews.get(url);
  }

  // Create new request and store promise for deduplication
  const promise = apiCall(`/api/unfurl?url=${encodeURIComponent(url)}`)
    .then((data) => {
      linkPreviewCache.set(url, data);
      pendingLinkPreviews.delete(url);
      return data;
    })
    .catch((err) => {
      console.error('Link preview error:', err);
      pendingLinkPreviews.delete(url);
      // Cache null to prevent retrying failed URLs
      linkPreviewCache.set(url, null);
      return null;
    });

  pendingLinkPreviews.set(url, promise);
  return promise;
}

/**
 * Fetch and render a link preview
 * @param {HTMLElement} previewEl - Container element for the preview
 * @param {string} url - URL to unfurl
 */
async function fetchAndRenderLinkPreview(previewEl, url) {
  const data = await fetchLinkPreviewCached(url);

  if (!data) {
    previewEl.remove();
    return;
  }

  const img = data.image
    ? `<img src="${data.image}" class="w-12 h-12 object-cover rounded-sm shrink-0" alt="">`
    : '';
  const desc = data.description
    ? `<div class="text-gray-400 truncate">${data.description}</div>`
    : '';
  previewEl.innerHTML = `<a href="${url}" target="_blank" class="flex gap-2 p-2 items-center">${img}<div class="min-w-0"><div class="font-semibold text-gray-100 truncate">${data.title || url}</div>${desc}</div></a>`;
}

// API helper functions
export async function apiCall(url, options = {}) {
  try {
    // Get socket ID to exclude self from real-time broadcasts
    const socketId = realtimeSyncModule?.getSocket()?.id;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };
    if (socketId) {
      headers['X-Socket-ID'] = socketId;
    }
    // Add CSRF token for POST/PUT/DELETE requests
    const method = options.method || 'GET';
    if (
      window.csrfToken &&
      (method === 'POST' ||
        method === 'PUT' ||
        method === 'DELETE' ||
        method === 'PATCH')
    ) {
      headers['X-CSRF-Token'] = window.csrfToken;
    }

    const response = await fetch(url, {
      ...options,
      headers,
      credentials: 'same-origin',
    });

    if (!response.ok) {
      if (response.status === 401) {
        // Try to parse error response to distinguish between session expiration and OAuth issues
        try {
          const errorData = await response.json();

          // OAuth-specific errors (token expired, music service not authenticated)
          // These should be handled by the caller, not redirect to login
          if (
            errorData.code === 'TOKEN_EXPIRED' ||
            errorData.code === 'TOKEN_REFRESH_FAILED' ||
            (errorData.code === 'NOT_AUTHENTICATED' && errorData.service)
          ) {
            const error = new Error(
              errorData.error || `HTTP error! status: ${response.status}`
            );
            error.response = response;
            error.data = errorData;
            throw error;
          }

          // Session expired or generic authentication failure - redirect to login
          window.location.href = '/login';
          return;
        } catch (parseError) {
          // If we can't parse the response, treat it as session expiration
          if (parseError.data) {
            // This is the error we threw above for OAuth issues
            throw parseError;
          }
          // JSON parse failed, likely session expired
          window.location.href = '/login';
          return;
        }
      }
      const error = new Error(`HTTP error! status: ${response.status}`);
      error.response = response;
      throw error;
    }

    return await response.json();
  } catch (error) {
    console.error('API call failed:', error);
    throw error;
  }
}
window.apiCall = apiCall;

/**
 * Attach a deferred link preview to a container
 * Uses IntersectionObserver to only fetch when visible
 * @param {HTMLElement} container - Container element
 * @param {string} comment - Comment text that may contain URLs
 */
function attachLinkPreview(container, comment) {
  const urlMatch = comment && comment.match(/https?:\/\/\S+/);
  if (!urlMatch) return;

  const url = urlMatch[0];

  // Check if we already have cached data - render immediately if so
  if (linkPreviewCache.has(url)) {
    const data = linkPreviewCache.get(url);
    if (!data) return; // Previously failed URL

    const previewEl = document.createElement('div');
    previewEl.className = 'mt-2 text-xs bg-gray-800 rounded-sm';
    container.appendChild(previewEl);

    const img = data.image
      ? `<img src="${data.image}" class="w-12 h-12 object-cover rounded-sm shrink-0" alt="">`
      : '';
    const desc = data.description
      ? `<div class="text-gray-400 truncate">${data.description}</div>`
      : '';
    previewEl.innerHTML = `<a href="${url}" target="_blank" class="flex gap-2 p-2 items-center">${img}<div class="min-w-0"><div class="font-semibold text-gray-100 truncate">${data.title || url}</div>${desc}</div></a>`;
    return;
  }

  // Create placeholder element and defer loading via IntersectionObserver
  const previewEl = document.createElement('div');
  previewEl.className = 'mt-2 text-xs bg-gray-800 rounded-sm';
  previewEl.dataset.previewUrl = url;
  previewEl.textContent = 'Loading preview...';
  container.appendChild(previewEl);

  // Initialize and observe with IntersectionObserver
  const observer = initLinkPreviewObserver();
  observer.observe(previewEl);
}

// Load lists from server
async function loadLists() {
  try {
    // OPTIMIZATION: Determine which list to load
    const localLastList = localStorage.getItem('lastSelectedList');
    const serverLastList = window.lastSelectedList;
    const targetList = localLastList || serverLastList;

    // OPTIMIZATION: Parallel execution - fetch metadata and target list simultaneously
    // This dramatically improves page refresh performance by:
    // 1. Loading only metadata (tiny payload) for the sidebar
    // 2. Loading the target list data in parallel (only what's needed)
    const metadataPromise = apiCall('/api/lists'); // Metadata only (default)
    const listDataPromise = targetList
      ? apiCall(`/api/lists/${encodeURIComponent(targetList)}`)
      : null;

    // Wait for metadata (fast - just list names, years, and counts)
    const fetchedLists = await metadataPromise;

    // Initialize lists object with metadata objects (not arrays)
    // Structure: { _id, name, year, isMain, count, _data, updatedAt, createdAt }
    lists = {};
    Object.keys(fetchedLists).forEach((name) => {
      const meta = fetchedLists[name];
      lists[name] = {
        _id: meta._id || null, // List ID - needed for playcount API
        name: meta.name || name,
        year: meta.year || null,
        isMain: meta.isMain || false,
        count: meta.count || 0,
        _data: null, // Data not loaded yet (lazy load)
        updatedAt: meta.updatedAt || null,
        createdAt: meta.createdAt || null,
      };
    });
    window.lists = lists;

    // Update navigation immediately - sidebar appears right away
    updateListNav();

    // If we're loading a specific list, wait for it and display
    if (listDataPromise && targetList) {
      try {
        const listData = await listDataPromise;
        // Store the actual data in the metadata object
        setListData(targetList, listData);

        // Only auto-select if no list is currently selected
        if (!window.currentList) {
          selectList(targetList);
          // Sync localStorage if we used server preference
          if (!localLastList && serverLastList) {
            try {
              localStorage.setItem('lastSelectedList', serverLastList);
            } catch (_e) {
              // Silently fail if localStorage is full
            }
          }
        }
      } catch (err) {
        console.warn('Failed to load last selected list:', err);
        // Sidebar is still populated, user can manually select a list
      }
    }
  } catch (error) {
    console.error('Error loading lists:', error);
    showToast('Error loading lists', 'error');
  }
}

// Save list to server
// @param {string} name - List name
// @param {Array} data - Album array
// @param {number|null} year - Optional year for the list (required for new lists)
async function saveList(name, data, year = undefined) {
  try {
    const cleanedData = data.map((album) => {
      const cleaned = { ...album };
      delete cleaned.points;
      delete cleaned.rank;
      return cleaned;
    });

    const body = { data: cleanedData };

    // Include year if provided (required for new lists)
    if (year !== undefined) {
      body.year = year;
    } else {
      // For existing lists, preserve current year if not explicitly provided
      const existingMeta = getListMetadata(name);
      if (existingMeta && existingMeta.year) {
        body.year = existingMeta.year;
      }
    }

    // Mark this as a local save BEFORE the API call to prevent race condition
    // The WebSocket broadcast can arrive before the HTTP response
    markLocalSave(name);

    await apiCall(`/api/lists/${encodeURIComponent(name)}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    // Update in-memory list data using helper (preserves metadata)
    setListData(name, cleanedData);

    // Update year in metadata if provided
    if (year !== undefined) {
      updateListMetadata(name, { year: year });
    }

    // Refresh mobile bar visibility if this is the current list
    // (albums may have been added/removed, affecting whether current track is in list)
    if (name === currentList && window.refreshMobileBarVisibility) {
      window.refreshMobileBarVisibility();
    }
  } catch (error) {
    showToast('Error saving list', 'error');
    throw error;
  }
}
// Expose saveList for other modules
window.saveList = saveList;

/**
 * Get track name from track (string or object format)
 * @param {string|object} track - Track as string or object with name property
 * @returns {string} Track name
 */
function getTrackName(track) {
  if (!track) return '';
  if (typeof track === 'string') return track;
  if (typeof track === 'object' && track.name) return track.name;
  return String(track); // Fallback for unexpected types
}

/**
 * Get track length in milliseconds from track object
 * @param {string|object} track - Track as string or object with length property
 * @returns {number|null} Track length in milliseconds or null
 */
function getTrackLength(track) {
  if (!track || typeof track !== 'object') return null;
  return track.length || null;
}

/**
 * Format milliseconds to MM:SS format
 * @param {number|null|undefined} ms - Milliseconds
 * @returns {string} Formatted time string (e.g., "3:45") or empty string
 */
function formatTrackTime(ms) {
  if (!ms || ms < 0) return '';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

async function fetchTracksForAlbum(album, signal = null) {
  const params = new URLSearchParams({
    id: album.album_id || '',
    artist: album.artist,
    album: album.album,
  });

  const fetchOptions = {
    credentials: 'include',
  };

  // Add abort signal if provided
  if (signal) {
    fetchOptions.signal = signal;
  }

  const resp = await fetch(
    `/api/musicbrainz/tracks?${params.toString()}`,
    fetchOptions
  );
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || 'Failed');
  album.tracks = data.tracks;
  return data.tracks;
}
window.fetchTracksForAlbum = fetchTracksForAlbum;
window.getTrackName = getTrackName;
window.getTrackLength = getTrackLength;
window.formatTrackTime = formatTrackTime;

// Performance: Concurrency limiter for parallel requests
async function pLimit(concurrency, tasks) {
  const results = [];
  const executing = [];

  for (const task of tasks) {
    const promise = task().then((result) => {
      executing.splice(executing.indexOf(promise), 1);
      return result;
    });

    results.push(promise);
    executing.push(promise);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
    }
  }

  return Promise.allSettled(results);
}

// Fix #3: Add concurrency limiting to track fetching (3-5 concurrent requests)
// This prevents overwhelming the backend while still being much faster than sequential
async function autoFetchTracksForList(name) {
  const list = getListData(name);
  if (!list || !Array.isArray(list)) return;

  const toFetch = list.filter((album) => {
    // Fetch if missing/empty
    if (!Array.isArray(album.tracks) || album.tracks.length === 0) return true;
    // Also fetch if tracks exist but are in old string format (need upgrade)
    // Safety check: ensure array has elements before checking type
    return album.tracks.length > 0 && typeof album.tracks[0] === 'string';
  });
  if (toFetch.length === 0) return;

  // Fetch up to 5 tracks concurrently instead of sequentially
  // This reduces load time from N × 300ms to (N/5) × 300ms
  const tasks = toFetch.map((album) => () => {
    return fetchTracksForAlbum(album).catch((err) => {
      console.error('Auto track fetch failed:', err);
      return null; // Return null on error to continue with other fetches
    });
  });

  await pLimit(5, tasks);
}

function updateMobileHeader() {
  const headerContainer = document.getElementById('dynamicHeader');
  if (headerContainer && window.currentUser) {
    headerContainer.innerHTML = window.headerComponent(
      window.currentUser,
      'home',
      currentList || ''
    );
  }
}

// Initialize album context menu
function initializeAlbumContextMenu() {
  const contextMenu = document.getElementById('albumContextMenu');
  const removeOption = document.getElementById('removeAlbumOption');
  const editOption = document.getElementById('editAlbumOption');
  const playOption = document.getElementById('playAlbumOption');

  if (!contextMenu || !removeOption || !editOption || !playOption) return;

  // Handle edit option click
  editOption.onclick = () => {
    contextMenu.classList.add('hidden');

    if (currentContextAlbum === null) return;

    // Verify the album is still at the expected index, fallback to identity search
    const albumsForEdit = getListData(currentList);
    const expectedAlbum = albumsForEdit && albumsForEdit[currentContextAlbum];
    if (expectedAlbum && currentContextAlbumId) {
      const expectedId =
        `${expectedAlbum.artist}::${expectedAlbum.album}::${expectedAlbum.release_date || ''}`.toLowerCase();
      if (expectedId === currentContextAlbumId) {
        // Index is still valid
        showMobileEditForm(currentContextAlbum);
        return;
      }
    }

    // Index is stale, search by identity
    if (currentContextAlbumId) {
      showMobileEditFormSafe(currentContextAlbumId);
    } else {
      showToast('Album not found - it may have been moved or removed', 'error');
    }
  };

  // Handle play option - show submenu with devices (for Spotify) or direct play (for Tidal/local)
  let playHideTimeout;

  playOption.addEventListener('mouseenter', () => {
    if (playHideTimeout) clearTimeout(playHideTimeout);
    showPlayAlbumSubmenu();
  });

  playOption.addEventListener('mouseleave', (e) => {
    const submenu = document.getElementById('playAlbumSubmenu');
    const toSubmenu =
      submenu &&
      (e.relatedTarget === submenu || submenu.contains(e.relatedTarget));

    if (!toSubmenu) {
      playHideTimeout = setTimeout(() => {
        if (submenu) submenu.classList.add('hidden');
        playOption.classList.remove('bg-gray-700', 'text-white');
      }, 100);
    }
  });

  playOption.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showPlayAlbumSubmenu();
  });

  // Handle remove option click
  removeOption.onclick = async () => {
    contextMenu.classList.add('hidden');
    if (currentContextAlbum === null) return;

    // Verify the album is still at the expected index, fallback to identity search
    const albumsForRemove = getListData(currentList);
    let album = albumsForRemove && albumsForRemove[currentContextAlbum];
    let indexToRemove = currentContextAlbum;

    if (album && currentContextAlbumId) {
      const expectedId =
        `${album.artist}::${album.album}::${album.release_date || ''}`.toLowerCase();
      if (expectedId !== currentContextAlbumId) {
        // Index is stale, search by identity
        const result = findAlbumByIdentity(currentContextAlbumId);
        if (result) {
          album = result.album;
          indexToRemove = result.index;
        } else {
          showToast(
            'Album not found - it may have been moved or removed',
            'error'
          );
          return;
        }
      }
    } else if (!album) {
      showToast('Album not found - it may have been moved or removed', 'error');
      return;
    }

    showConfirmation(
      'Remove Album',
      `Remove "${album.album}" by ${album.artist}?`,
      'This will remove the album from this list.',
      'Remove',
      async () => {
        try {
          // Remove from the list using the correct index
          const albumsToModify = getListData(currentList);
          if (!albumsToModify) {
            showToast('Error: List data not found', 'error');
            return;
          }
          albumsToModify.splice(indexToRemove, 1);

          // Save to server
          await saveList(currentList, albumsToModify);

          // Update display
          selectList(currentList);

          showToast(`Removed "${album.album}" from the list`);
        } catch (error) {
          console.error('Error removing album:', error);
          showToast('Error removing album', 'error');

          // Reload the list to ensure consistency
          await loadLists();
          selectList(currentList);
        }

        currentContextAlbum = null;
        currentContextAlbumId = null;
      }
    );
  };

  // Handle move option click - show submenu
  const moveOption = document.getElementById('moveAlbumOption');
  if (moveOption) {
    let hideTimeout;

    moveOption.addEventListener('mouseenter', () => {
      if (hideTimeout) clearTimeout(hideTimeout);
      showMoveToListSubmenu();
    });

    moveOption.addEventListener('mouseleave', (e) => {
      const submenu = document.getElementById('albumMoveSubmenu');
      const listsSubmenu = document.getElementById('albumMoveListsSubmenu');
      // Check if moving to year submenu or lists submenu
      const toSubmenu =
        submenu &&
        (e.relatedTarget === submenu || submenu.contains(e.relatedTarget));
      const toListsSubmenu =
        listsSubmenu &&
        (e.relatedTarget === listsSubmenu ||
          listsSubmenu.contains(e.relatedTarget));

      if (!toSubmenu && !toListsSubmenu) {
        hideTimeout = setTimeout(() => {
          if (submenu) submenu.classList.add('hidden');
          if (listsSubmenu) listsSubmenu.classList.add('hidden');
          moveOption.classList.remove('bg-gray-700', 'text-white');
          currentHighlightedYear = null;
        }, 100);
      }
    });

    moveOption.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showMoveToListSubmenu();
    });
  }

  // Handle Last.fm discovery options
  const similarOption = document.getElementById('similarArtistsOption');

  if (similarOption) {
    similarOption.onclick = () => {
      contextMenu.classList.add('hidden');

      // Get the artist name from the currently selected album
      const albumsData = getListData(currentList);
      let album = albumsData && albumsData[currentContextAlbum];

      if (album && currentContextAlbumId) {
        const expectedId =
          `${album.artist}::${album.album}::${album.release_date || ''}`.toLowerCase();
        if (expectedId !== currentContextAlbumId) {
          const result = findAlbumByIdentity(currentContextAlbumId);
          if (result) album = result.album;
        }
      }

      if (album && album.artist) {
        // Import and call showDiscoveryModal dynamically
        import('./modules/discovery.js').then(({ showDiscoveryModal }) => {
          showDiscoveryModal('similar', { artist: album.artist });
        });
      } else {
        showToast('Could not find album artist', 'error');
      }

      currentContextAlbum = null;
      currentContextAlbumId = null;
    };
  }
}

// Track the currently highlighted year in the move submenu
let currentHighlightedYear = null;
let moveListsHideTimeout = null;

// Group lists by year for the move submenu (only lists with years, excluding current list)
function groupListsForMove() {
  const listsByYear = {};

  Object.keys(lists).forEach((listName) => {
    // Skip current list
    if (listName === currentList) return;

    const meta = lists[listName];
    const year = meta?.year;

    // Only include lists that have a year
    if (year) {
      if (!listsByYear[year]) {
        listsByYear[year] = [];
      }
      listsByYear[year].push(listName);
    }
  });

  // Sort years descending
  const sortedYears = Object.keys(listsByYear).sort(
    (a, b) => parseInt(b) - parseInt(a)
  );

  return { listsByYear, sortedYears };
}

// Show the move to list submenu for desktop (now shows years)
function showMoveToListSubmenu() {
  const submenu = document.getElementById('albumMoveSubmenu');
  const listsSubmenu = document.getElementById('albumMoveListsSubmenu');
  const moveOption = document.getElementById('moveAlbumOption');
  const playSubmenu = document.getElementById('playAlbumSubmenu');
  const playOption = document.getElementById('playAlbumOption');

  if (!submenu || !moveOption) return;

  // Hide the other submenus first
  if (playSubmenu) {
    playSubmenu.classList.add('hidden');
    playOption?.classList.remove('bg-gray-700', 'text-white');
  }
  if (listsSubmenu) {
    listsSubmenu.classList.add('hidden');
  }

  // Reset highlighted year
  currentHighlightedYear = null;

  // Highlight the parent menu item
  moveOption.classList.add('bg-gray-700', 'text-white');

  // Group lists by year
  const { listsByYear, sortedYears } = groupListsForMove();

  if (sortedYears.length === 0) {
    submenu.innerHTML =
      '<div class="px-4 py-2 text-sm text-gray-500">No other lists available</div>';
  } else {
    submenu.innerHTML = sortedYears
      .map(
        (year) => `
        <button class="flex items-center justify-between w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap" data-year="${year}">
          <span>${year}</span>
          <i class="fas fa-chevron-right text-xs ml-3 text-gray-500"></i>
        </button>
      `
      )
      .join('');

    // Add hover handlers to each year option
    submenu.querySelectorAll('[data-year]').forEach((btn) => {
      btn.addEventListener('mouseenter', () => {
        if (moveListsHideTimeout) {
          clearTimeout(moveListsHideTimeout);
          moveListsHideTimeout = null;
        }
        const year = btn.dataset.year;
        showMoveToListYearSubmenu(year, btn, listsByYear);
      });

      btn.addEventListener('mouseleave', (e) => {
        const listsMenu = document.getElementById('albumMoveListsSubmenu');
        const toListsSubmenu =
          listsMenu &&
          (e.relatedTarget === listsMenu ||
            listsMenu.contains(e.relatedTarget));

        if (!toListsSubmenu) {
          moveListsHideTimeout = setTimeout(() => {
            if (listsMenu) listsMenu.classList.add('hidden');
            // Remove highlight from year button
            btn.classList.remove('bg-gray-700', 'text-white');
            currentHighlightedYear = null;
          }, 100);
        }
      });
    });
  }

  // Position submenu next to the move option
  const moveRect = moveOption.getBoundingClientRect();
  const contextMenu = document.getElementById('albumContextMenu');
  const menuRect = contextMenu.getBoundingClientRect();

  submenu.style.left = `${menuRect.right}px`;
  submenu.style.top = `${moveRect.top}px`;
  submenu.classList.remove('hidden');
}

// Show the lists submenu for a specific year
function showMoveToListYearSubmenu(year, yearButton, listsByYear) {
  const listsSubmenu = document.getElementById('albumMoveListsSubmenu');
  const yearSubmenu = document.getElementById('albumMoveSubmenu');
  const moveOption = document.getElementById('moveAlbumOption');

  if (!listsSubmenu || !yearSubmenu) return;

  // Remove highlight from previously highlighted year
  if (currentHighlightedYear && currentHighlightedYear !== year) {
    const prevBtn = yearSubmenu.querySelector(
      `[data-year="${currentHighlightedYear}"]`
    );
    if (prevBtn) {
      prevBtn.classList.remove('bg-gray-700', 'text-white');
    }
  }

  // Highlight the current year button
  yearButton.classList.add('bg-gray-700', 'text-white');
  currentHighlightedYear = year;

  // Get lists for this year
  const yearLists = listsByYear[year] || [];

  if (yearLists.length === 0) {
    listsSubmenu.classList.add('hidden');
    return;
  }

  // Populate the lists submenu
  listsSubmenu.innerHTML = yearLists
    .map(
      (listName) => `
      <button class="block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap w-full" data-target-list="${listName}">
        <span class="mr-2">•</span>${listName}
      </button>
    `
    )
    .join('');

  // Add click handlers to each list option
  listsSubmenu.querySelectorAll('[data-target-list]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const targetList = btn.dataset.targetList;

      // Hide all menus and remove highlights
      document.getElementById('albumContextMenu')?.classList.add('hidden');
      yearSubmenu.classList.add('hidden');
      listsSubmenu.classList.add('hidden');
      moveOption?.classList.remove('bg-gray-700', 'text-white');

      // Show confirmation modal
      getMobileUIModule().showMoveConfirmation(
        currentContextAlbumId,
        targetList
      );
    });
  });

  // Handle mouse leaving the lists submenu
  listsSubmenu.onmouseenter = () => {
    if (moveListsHideTimeout) {
      clearTimeout(moveListsHideTimeout);
      moveListsHideTimeout = null;
    }
  };

  listsSubmenu.onmouseleave = (e) => {
    const yearMenu = document.getElementById('albumMoveSubmenu');
    const toYearSubmenu =
      yearMenu &&
      (e.relatedTarget === yearMenu || yearMenu.contains(e.relatedTarget));

    if (!toYearSubmenu) {
      moveListsHideTimeout = setTimeout(() => {
        listsSubmenu.classList.add('hidden');
        // Remove highlight from year button
        if (currentHighlightedYear) {
          const yearBtn = yearMenu?.querySelector(
            `[data-year="${currentHighlightedYear}"]`
          );
          if (yearBtn) {
            yearBtn.classList.remove('bg-gray-700', 'text-white');
          }
          currentHighlightedYear = null;
        }
      }, 100);
    }
  };

  // Position lists submenu next to the year button
  const yearRect = yearButton.getBoundingClientRect();
  const yearSubmenuRect = yearSubmenu.getBoundingClientRect();

  listsSubmenu.style.left = `${yearSubmenuRect.right}px`;
  listsSubmenu.style.top = `${yearRect.top}px`;
  listsSubmenu.classList.remove('hidden');
}

// Hide submenus when mouse leaves the context menu area
function hideSubmenuOnLeave() {
  const contextMenu = document.getElementById('albumContextMenu');
  const moveSubmenu = document.getElementById('albumMoveSubmenu');
  const moveListsSubmenu = document.getElementById('albumMoveListsSubmenu');
  const playSubmenu = document.getElementById('playAlbumSubmenu');
  const moveOption = document.getElementById('moveAlbumOption');
  const playOption = document.getElementById('playAlbumOption');

  if (!contextMenu) return;

  let submenuTimeout;

  const hideSubmenus = () => {
    submenuTimeout = setTimeout(() => {
      if (moveSubmenu) {
        moveSubmenu.classList.add('hidden');
        moveOption?.classList.remove('bg-gray-700', 'text-white');
      }
      if (playSubmenu) {
        playSubmenu.classList.add('hidden');
        playOption?.classList.remove('bg-gray-700', 'text-white');
      }
      // Also hide the lists submenu (third level for move)
      if (moveListsSubmenu) {
        moveListsSubmenu.classList.add('hidden');
      }
      // Reset highlighted year
      currentHighlightedYear = null;
    }, 100);
  };

  const cancelHide = () => {
    if (submenuTimeout) clearTimeout(submenuTimeout);
  };

  contextMenu.addEventListener('mouseleave', (e) => {
    // Check if moving to any submenu
    const toMoveSubmenu =
      moveSubmenu &&
      (e.relatedTarget === moveSubmenu ||
        moveSubmenu.contains(e.relatedTarget));
    const toMoveListsSubmenu =
      moveListsSubmenu &&
      (e.relatedTarget === moveListsSubmenu ||
        moveListsSubmenu.contains(e.relatedTarget));
    const toPlaySubmenu =
      playSubmenu &&
      (e.relatedTarget === playSubmenu ||
        playSubmenu.contains(e.relatedTarget));

    if (!toMoveSubmenu && !toMoveListsSubmenu && !toPlaySubmenu) {
      hideSubmenus();
    }
  });

  if (moveSubmenu) {
    moveSubmenu.addEventListener('mouseenter', cancelHide);
    moveSubmenu.addEventListener('mouseleave', (e) => {
      // Check if moving to the lists submenu (third level)
      const toListsSubmenu =
        moveListsSubmenu &&
        (e.relatedTarget === moveListsSubmenu ||
          moveListsSubmenu.contains(e.relatedTarget));
      // Check if moving back to context menu
      const toContextMenu =
        contextMenu &&
        (e.relatedTarget === contextMenu ||
          contextMenu.contains(e.relatedTarget));

      if (!toListsSubmenu && !toContextMenu) {
        hideSubmenus();
      }
    });
  }

  if (moveListsSubmenu) {
    moveListsSubmenu.addEventListener('mouseenter', cancelHide);
    moveListsSubmenu.addEventListener('mouseleave', (e) => {
      // Check if moving back to year submenu
      const toMoveSubmenu =
        moveSubmenu &&
        (e.relatedTarget === moveSubmenu ||
          moveSubmenu.contains(e.relatedTarget));

      if (!toMoveSubmenu) {
        hideSubmenus();
      }
    });
  }

  if (playSubmenu) {
    playSubmenu.addEventListener('mouseenter', cancelHide);
    playSubmenu.addEventListener('mouseleave', hideSubmenus);
  }
}

// Show the play album submenu with device options
async function showPlayAlbumSubmenu() {
  const submenu = document.getElementById('playAlbumSubmenu');
  const playOption = document.getElementById('playAlbumOption');
  const moveSubmenu = document.getElementById('albumMoveSubmenu');
  const moveOption = document.getElementById('moveAlbumOption');

  if (!submenu || !playOption) return;

  // Hide the other submenu first
  if (moveSubmenu) {
    moveSubmenu.classList.add('hidden');
    moveOption?.classList.remove('bg-gray-700', 'text-white');
  }

  // Highlight the parent menu item
  playOption.classList.add('bg-gray-700', 'text-white');

  const hasSpotify = window.currentUser?.spotifyAuth;
  const hasTidal = window.currentUser?.tidalAuth;
  const musicService = window.currentUser?.musicService;

  // Determine which service to show for "Open in..." based on preference
  // Priority: user preference > only connected service > Spotify (if both)
  let primaryService = null;
  if (musicService === 'tidal' && hasTidal) {
    primaryService = 'tidal';
  } else if (musicService === 'spotify' && hasSpotify) {
    primaryService = 'spotify';
  } else if (hasTidal && !hasSpotify) {
    primaryService = 'tidal';
  } else if (hasSpotify) {
    primaryService = 'spotify';
  }

  // Build menu items
  let menuItems = [];

  // Add "Open in [Service]" option based on user's preference/connected service
  if (primaryService === 'tidal') {
    menuItems.push(`
      <button class="w-full block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap" data-play-action="open-app">
        <svg class="inline-block w-4 h-4 mr-2 align-text-bottom" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12.012 3.992L8.008 7.996 4.004 3.992 0 7.996 4.004 12l-4.004 4.004L4.004 20.008 8.008 16.004 12.012 20.008 16.016 16.004 12.012 12l4.004-4.004L12.012 3.992zM16.042 7.996l3.979-3.979L24 7.996l-3.979 4.004 3.979 4.004-3.979 3.979-3.979-3.979L12.038 16.008 16.042 12l-4.004-4.004L16.042 7.996z"/>
        </svg>Open in Tidal
      </button>
    `);
  } else if (primaryService === 'spotify') {
    menuItems.push(`
      <button class="w-full block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap" data-play-action="open-app">
        <svg class="inline-block w-4 h-4 mr-2 text-[#1DB954] align-text-bottom" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
        </svg>Open in Spotify
      </button>
    `);
  }

  // Only show Spotify Connect devices if user's primary service is Spotify
  // (not if they explicitly chose Tidal as their preference)
  if (primaryService === 'spotify' && hasSpotify) {
    menuItems.push(`
      <div class="border-t border-gray-700 my-1"></div>
      <div class="px-4 py-1 text-xs text-gray-500 uppercase tracking-wide">Spotify Connect</div>
    `);

    // Show loading state
    submenu.innerHTML =
      menuItems.join('') +
      '<div class="px-4 py-2 text-sm text-gray-400"><i class="fas fa-spinner fa-spin mr-2"></i>Loading devices...</div>';
    positionPlaySubmenu();
    submenu.classList.remove('hidden');

    try {
      const response = await fetch('/api/spotify/devices', {
        credentials: 'include',
      });
      const data = await response.json();

      if (response.ok && data.devices && data.devices.length > 0) {
        const deviceItems = data.devices.map((device) => {
          const icon = getDeviceIcon(device.type);
          const activeClass = device.is_active ? 'text-green-500' : '';
          const activeBadge = device.is_active
            ? '<span class="ml-2 text-xs text-green-500">(active)</span>'
            : '';
          return `
            <button class="w-full block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap" data-play-action="spotify-device" data-device-id="${device.id}">
              <i class="${icon} mr-2 w-4 text-center ${activeClass}"></i>${device.name}${activeBadge}
            </button>
          `;
        });
        menuItems = menuItems.concat(deviceItems);
      } else {
        menuItems.push(`
          <div class="px-4 py-2 text-sm text-gray-500">No devices available</div>
          <div class="px-4 py-1 text-xs text-gray-600">Open Spotify on a device</div>
        `);
      }
    } catch (err) {
      console.error('Failed to fetch Spotify devices:', err);
      menuItems.push(`
        <div class="px-4 py-2 text-sm text-red-400">Failed to load devices</div>
      `);
    }
  }

  // If no services connected
  if (!hasSpotify && !hasTidal) {
    menuItems.push(`
      <div class="px-4 py-2 text-sm text-gray-500">No music service connected</div>
    `);
  }

  submenu.innerHTML = menuItems.join('');

  // Add click handlers
  submenu.querySelectorAll('[data-play-action]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const action = btn.dataset.playAction;
      const deviceId = btn.dataset.deviceId;

      // Hide menus and remove highlight
      document.getElementById('albumContextMenu')?.classList.add('hidden');
      submenu.classList.add('hidden');
      playOption?.classList.remove('bg-gray-700', 'text-white');

      if (action === 'open-app') {
        // Use existing playAlbum function (opens in app)
        triggerPlayAlbum();
      } else if (action === 'spotify-device') {
        // Play on specific Spotify Connect device
        playAlbumOnSpotifyDevice(deviceId);
      }
    });
  });

  positionPlaySubmenu();
  submenu.classList.remove('hidden');
}

// Position the play submenu next to the play option
function positionPlaySubmenu() {
  const submenu = document.getElementById('playAlbumSubmenu');
  const playOption = document.getElementById('playAlbumOption');
  const contextMenu = document.getElementById('albumContextMenu');

  if (!submenu || !playOption || !contextMenu) return;

  const playRect = playOption.getBoundingClientRect();
  const menuRect = contextMenu.getBoundingClientRect();

  submenu.style.left = `${menuRect.right}px`;
  submenu.style.top = `${playRect.top}px`;
}

// Trigger the existing play album flow (open in app)
function triggerPlayAlbum() {
  if (currentContextAlbum === null) return;

  const albumsForPlay = getListData(currentList);
  const expectedAlbum = albumsForPlay && albumsForPlay[currentContextAlbum];
  if (expectedAlbum && currentContextAlbumId) {
    const expectedId =
      `${expectedAlbum.artist}::${expectedAlbum.album}::${expectedAlbum.release_date || ''}`.toLowerCase();
    if (expectedId === currentContextAlbumId) {
      playAlbum(currentContextAlbum);
      return;
    }
  }

  if (currentContextAlbumId) {
    playAlbumSafe(currentContextAlbumId);
  } else {
    showToast('Album not found - it may have been moved or removed', 'error');
  }
}

// Play album on a specific Spotify Connect device
async function playAlbumOnSpotifyDevice(deviceId) {
  if (currentContextAlbum === null && !currentContextAlbumId) {
    showToast('No album selected', 'error');
    return;
  }

  // Get the album data
  const albumsForPlay = getListData(currentList);
  let album = albumsForPlay && albumsForPlay[currentContextAlbum];

  // Verify album identity
  if (album && currentContextAlbumId) {
    const expectedId =
      `${album.artist}::${album.album}::${album.release_date || ''}`.toLowerCase();
    if (expectedId !== currentContextAlbumId) {
      const result = findAlbumByIdentity(currentContextAlbumId);
      if (result) {
        album = result.album;
      } else {
        showToast('Album not found', 'error');
        return;
      }
    }
  }

  if (!album) {
    showToast('Album not found', 'error');
    return;
  }

  showToast('Starting playback...', 'info');

  try {
    // First, search for the album on Spotify to get the ID
    const searchQuery = `artist=${encodeURIComponent(album.artist)}&album=${encodeURIComponent(album.album)}`;
    const searchResp = await fetch(`/api/spotify/album?${searchQuery}`, {
      credentials: 'include',
    });
    const searchData = await searchResp.json();

    if (!searchResp.ok || !searchData.id) {
      showToast(searchData.error || 'Album not found on Spotify', 'error');
      return;
    }

    // Now play the album on the device
    const playResp = await fetch('/api/spotify/play', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        albumId: searchData.id,
        deviceId: deviceId,
      }),
    });

    const playData = await playResp.json();

    if (playResp.ok && playData.success) {
      showToast(`Now playing "${album.album}"`, 'success');
    } else {
      showToast(playData.error || 'Failed to start playback', 'error');
    }
  } catch (err) {
    console.error('Spotify Connect playback error:', err);
    showToast('Failed to start playback', 'error');
  }
}

// Play album on a specific Spotify Connect device (mobile version using albumId)
async function playAlbumOnDeviceMobile(albumId, deviceId) {
  const result = findAlbumByIdentity(albumId);
  if (!result) {
    showToast('Album not found', 'error');
    return;
  }

  const album = result.album;
  showToast('Starting playback...', 'info');

  try {
    // First, search for the album on Spotify to get the ID
    const searchQuery = `artist=${encodeURIComponent(album.artist)}&album=${encodeURIComponent(album.album)}`;
    const searchResp = await fetch(`/api/spotify/album?${searchQuery}`, {
      credentials: 'include',
    });
    const searchData = await searchResp.json();

    if (!searchResp.ok || !searchData.id) {
      showToast(searchData.error || 'Album not found on Spotify', 'error');
      return;
    }

    // Now play the album on the device
    const playResp = await fetch('/api/spotify/play', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        albumId: searchData.id,
        deviceId: deviceId,
      }),
    });

    const playData = await playResp.json();

    if (playResp.ok && playData.success) {
      showToast(`Now playing "${album.album}"`, 'success');
    } else {
      showToast(playData.error || 'Failed to start playback', 'error');
    }
  } catch (err) {
    console.error('Spotify Connect playback error:', err);
    showToast('Failed to start playback', 'error');
  }
}

// Play the selected album on the connected music service
function playAlbum(index) {
  const albums = getListData(currentList);
  const album = albums && albums[index];
  if (!album) return;

  const hasSpotify = window.currentUser?.spotifyAuth;
  const hasTidal = window.currentUser?.tidalAuth;
  const preferred = window.currentUser?.musicService;

  const chooseService = () => {
    if (preferred === 'spotify' && hasSpotify) {
      return Promise.resolve('spotify');
    }
    if (preferred === 'tidal' && hasTidal) {
      return Promise.resolve('tidal');
    }
    if (hasSpotify && hasTidal) {
      return showServicePicker(true, true);
    } else if (hasSpotify) {
      return Promise.resolve('spotify');
    } else if (hasTidal) {
      return Promise.resolve('tidal');
    } else {
      showToast('No music service connected', 'error');
      return Promise.resolve(null);
    }
  };

  chooseService().then((service) => {
    hideConfirmation();
    if (!service) return;

    const query = `artist=${encodeURIComponent(album.artist)}&album=${encodeURIComponent(album.album)}`;
    const endpoint =
      service === 'spotify' ? '/api/spotify/album' : '/api/tidal/album';

    fetch(`${endpoint}?${query}`, { credentials: 'include' })
      .then(async (r) => {
        let data;
        try {
          data = await r.json();
        } catch (_) {
          throw new Error('Invalid response');
        }

        if (!r.ok) {
          throw new Error(data.error || 'Request failed');
        }
        return data;
      })
      .then((data) => {
        if (data.id) {
          if (service === 'spotify') {
            window.location.href = `spotify:album:${data.id}`;
          } else {
            window.location.href = `tidal://album/${data.id}`;
          }
        } else if (data.error) {
          showToast(data.error, 'error');
        } else {
          showToast('Album not found on ' + service, 'error');
        }
      })
      .catch((err) => {
        console.error('Play album error:', err);
        showToast(err.message || 'Failed to open album', 'error');
      });
  });
}

// Play the selected track on the connected music service
function playTrack(index) {
  const albums = getListData(currentList);
  const album = albums && albums[index];
  if (!album) return;

  const trackPick = album.track_pick;
  if (!trackPick) {
    showToast('No track selected', 'error');
    return;
  }

  const hasSpotify = window.currentUser?.spotifyAuth;
  const hasTidal = window.currentUser?.tidalAuth;
  const preferred = window.currentUser?.musicService;

  const chooseService = () => {
    if (preferred === 'spotify' && hasSpotify) {
      return Promise.resolve('spotify');
    }
    if (preferred === 'tidal' && hasTidal) {
      return Promise.resolve('tidal');
    }
    if (hasSpotify && hasTidal) {
      return showServicePicker(true, true);
    } else if (hasSpotify) {
      return Promise.resolve('spotify');
    } else if (hasTidal) {
      return Promise.resolve('tidal');
    } else {
      showToast('No music service connected', 'error');
      return Promise.resolve(null);
    }
  };

  chooseService().then((service) => {
    hideConfirmation();
    if (!service) return;

    const query = `artist=${encodeURIComponent(album.artist)}&album=${encodeURIComponent(album.album)}&track=${encodeURIComponent(trackPick)}`;
    const endpoint =
      service === 'spotify' ? '/api/spotify/track' : '/api/tidal/track';

    fetch(`${endpoint}?${query}`, { credentials: 'include' })
      .then(async (r) => {
        let data;
        try {
          data = await r.json();
        } catch (_) {
          throw new Error('Invalid response');
        }

        if (!r.ok) {
          throw new Error(data.error || 'Request failed');
        }
        return data;
      })
      .then((data) => {
        if (data.id) {
          if (service === 'spotify') {
            window.location.href = `spotify:track:${data.id}`;
          } else {
            window.location.href = `tidal://track/${data.id}`;
          }
        } else if (data.error) {
          showToast(data.error, 'error');
        } else {
          showToast('Track not found on ' + service, 'error');
        }
      })
      .catch((err) => {
        console.error('Play track error:', err);
        showToast(err.message || 'Failed to open track', 'error');
      });
  });
}
window.playTrack = playTrack;

// Safe wrapper for play track that uses album identity
window.playTrackSafe = function (albumId) {
  const result = findAlbumByIdentity(albumId);
  if (!result) {
    showToast('Album not found - it may have been moved or removed', 'error');
    return;
  }
  playTrack(result.index);
};

// Play a specific track by name (for use in edit modal track list)
function playSpecificTrack(index, trackName) {
  const albums = getListData(currentList);
  const album = albums && albums[index];
  if (!album) return;

  if (!trackName) {
    showToast('No track specified', 'error');
    return;
  }

  const hasSpotify = window.currentUser?.spotifyAuth;
  const hasTidal = window.currentUser?.tidalAuth;
  const preferred = window.currentUser?.musicService;

  const chooseService = () => {
    if (preferred === 'spotify' && hasSpotify) {
      return Promise.resolve('spotify');
    }
    if (preferred === 'tidal' && hasTidal) {
      return Promise.resolve('tidal');
    }
    if (hasSpotify && hasTidal) {
      return showServicePicker(true, true);
    } else if (hasSpotify) {
      return Promise.resolve('spotify');
    } else if (hasTidal) {
      return Promise.resolve('tidal');
    } else {
      showToast('No music service connected', 'error');
      return Promise.resolve(null);
    }
  };

  chooseService().then((service) => {
    hideConfirmation();
    if (!service) return;

    const query = `artist=${encodeURIComponent(album.artist)}&album=${encodeURIComponent(album.album)}&track=${encodeURIComponent(trackName)}`;
    const endpoint =
      service === 'spotify' ? '/api/spotify/track' : '/api/tidal/track';

    fetch(`${endpoint}?${query}`, { credentials: 'include' })
      .then(async (r) => {
        let data;
        try {
          data = await r.json();
        } catch (_) {
          throw new Error('Invalid response');
        }

        if (!r.ok) {
          throw new Error(data.error || 'Request failed');
        }
        return data;
      })
      .then((data) => {
        if (data.id) {
          if (service === 'spotify') {
            window.location.href = `spotify:track:${data.id}`;
          } else {
            window.location.href = `tidal://track/${data.id}`;
          }
        } else if (data.error) {
          showToast(data.error, 'error');
        } else {
          showToast('Track not found on ' + service, 'error');
        }
      })
      .catch((err) => {
        console.error('Play track error:', err);
        showToast(err.message || 'Failed to open track', 'error');
      });
  });
}
window.playSpecificTrack = playSpecificTrack;

// Create list functionality
function initializeCreateList() {
  const createBtn = document.getElementById('createListBtn');
  const modal = document.getElementById('createListModal');
  const nameInput = document.getElementById('newListName');
  const cancelBtn = document.getElementById('cancelCreateBtn');
  const confirmBtn = document.getElementById('confirmCreateBtn');

  if (!createBtn || !modal) return;

  const yearInput = document.getElementById('newListYear');
  const yearError = document.getElementById('createYearError');

  // Open modal
  createBtn.onclick = () => {
    modal.classList.remove('hidden');
    nameInput.value = '';
    yearInput.value = '';
    if (yearError) yearError.classList.add('hidden');
    nameInput.focus();
  };

  // Close modal
  const closeModal = () => {
    modal.classList.add('hidden');
    nameInput.value = '';
    yearInput.value = '';
    if (yearError) yearError.classList.add('hidden');
  };

  cancelBtn.onclick = closeModal;

  // Click outside to close
  modal.onclick = (e) => {
    if (e.target === modal) {
      closeModal();
    }
  };

  // Validate year input
  const validateYear = (yearValue) => {
    if (!yearValue || yearValue === '') {
      return { valid: false, error: 'Year is required for new lists' };
    }
    const year = parseInt(yearValue, 10);
    if (!Number.isInteger(year) || year < 1000 || year > 9999) {
      return { valid: false, error: 'Year must be between 1000 and 9999' };
    }
    return { valid: true, value: year };
  };

  // Create list
  const createList = async () => {
    const listName = nameInput.value.trim();
    const yearValue = yearInput.value.trim();

    if (!listName) {
      showToast('Please enter a list name', 'error');
      nameInput.focus();
      return;
    }

    // Validate year
    const yearValidation = validateYear(yearValue);
    if (!yearValidation.valid) {
      if (yearError) {
        yearError.textContent = yearValidation.error;
        yearError.classList.remove('hidden');
      }
      showToast(yearValidation.error, 'error');
      yearInput.focus();
      return;
    }
    if (yearError) yearError.classList.add('hidden');

    // Check if list already exists
    if (lists[listName]) {
      showToast('A list with this name already exists', 'error');
      nameInput.focus();
      return;
    }

    try {
      // Create empty list with year
      await saveList(listName, [], yearValidation.value);

      // Update navigation
      updateListNav();

      // Select the new list
      selectList(listName);

      // Close modal
      closeModal();

      showToast(`Created list "${listName}" (${yearValidation.value})`);
    } catch (_error) {
      showToast('Error creating list', 'error');
    }
  };

  confirmBtn.onclick = createList;

  // Enter key to create (on name input)
  nameInput.onkeypress = (e) => {
    if (e.key === 'Enter') {
      createList();
    }
  };

  // Enter key to create (on year input)
  yearInput.onkeypress = (e) => {
    if (e.key === 'Enter') {
      createList();
    }
  };

  // ESC key to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeModal();
    }
  });
}

// Edit list details functionality (formerly Rename list)
function initializeRenameList() {
  const modal = document.getElementById('renameListModal');
  const currentNameSpan = document.getElementById('currentListName');
  const nameInput = document.getElementById('newListNameInput');
  const yearInput = document.getElementById('editListYear');
  const yearError = document.getElementById('editYearError');
  const cancelBtn = document.getElementById('cancelRenameBtn');
  const confirmBtn = document.getElementById('confirmRenameBtn');

  if (!modal) return;

  // Close modal function
  const closeModal = () => {
    modal.classList.add('hidden');
    nameInput.value = '';
    if (yearInput) yearInput.value = '';
    if (yearError) yearError.classList.add('hidden');
  };

  cancelBtn.onclick = closeModal;

  // Click outside to close
  modal.onclick = (e) => {
    if (e.target === modal) {
      closeModal();
    }
  };

  // Validate year input (optional for editing)
  const validateYear = (yearValue) => {
    if (!yearValue || yearValue === '') {
      return { valid: true, value: null }; // Empty is valid (removes year)
    }
    const year = parseInt(yearValue, 10);
    if (!Number.isInteger(year) || year < 1000 || year > 9999) {
      return { valid: false, error: 'Year must be between 1000 and 9999' };
    }
    return { valid: true, value: year };
  };

  // Edit list function
  const editList = async () => {
    const oldName = currentNameSpan.textContent;
    const newName = nameInput.value.trim();
    const yearValue = yearInput ? yearInput.value.trim() : '';

    if (!newName) {
      showToast('Please enter a list name', 'error');
      nameInput.focus();
      return;
    }

    // Validate year if provided
    const yearValidation = validateYear(yearValue);
    if (!yearValidation.valid) {
      if (yearError) {
        yearError.textContent = yearValidation.error;
        yearError.classList.remove('hidden');
      }
      showToast(yearValidation.error, 'error');
      if (yearInput) yearInput.focus();
      return;
    }
    if (yearError) yearError.classList.add('hidden');

    // Check if new name already exists (only if renaming)
    if (newName !== oldName && lists[newName]) {
      showToast('A list with this name already exists', 'error');
      nameInput.focus();
      return;
    }

    // Determine what changed
    const oldMeta = getListMetadata(oldName);
    const nameChanged = newName !== oldName;
    const yearChanged = yearValidation.value !== (oldMeta?.year || null);

    // If nothing changed, just close
    if (!nameChanged && !yearChanged) {
      closeModal();
      return;
    }

    try {
      // Use PATCH endpoint to update name and/or year
      const patchData = {};
      if (nameChanged) patchData.newName = newName;
      if (yearChanged) patchData.year = yearValidation.value;

      await apiCall(`/api/lists/${encodeURIComponent(oldName)}`, {
        method: 'PATCH',
        body: JSON.stringify(patchData),
      });

      // Update local state
      if (nameChanged) {
        // Move the list entry to new key
        lists[newName] = lists[oldName];
        lists[newName].name = newName;
        delete lists[oldName];

        if (currentList === oldName) {
          currentList = newName;
          window.currentList = currentList;
        }
      }

      // Update year in metadata
      if (yearChanged) {
        const listToUpdate = nameChanged ? lists[newName] : lists[oldName];
        if (listToUpdate) {
          listToUpdate.year = yearValidation.value;
        }
      }

      updateListNav();

      // Update display if current list was renamed
      if (nameChanged && currentList === newName) {
        selectList(newName);
      }

      closeModal();

      // Show appropriate message
      if (nameChanged && yearChanged) {
        showToast(
          `List updated: "${newName}" (${yearValidation.value || 'no year'})`
        );
      } else if (nameChanged) {
        showToast(`List renamed to "${newName}"`);
      } else {
        showToast(`Year updated to ${yearValidation.value || 'none'}`);
      }
    } catch (error) {
      console.error('Error updating list:', error);
      showToast('Error updating list', 'error');
    }
  };

  confirmBtn.onclick = editList;

  // Enter key to save
  nameInput.onkeypress = (e) => {
    if (e.key === 'Enter') {
      editList();
    }
  };

  if (yearInput) {
    yearInput.onkeypress = (e) => {
      if (e.key === 'Enter') {
        editList();
      }
    };
  }
}

// Open edit list details modal (formerly rename modal)
function openRenameModal(listName) {
  const modal = document.getElementById('renameListModal');
  const currentNameSpan = document.getElementById('currentListName');
  const nameInput = document.getElementById('newListNameInput');
  const yearInput = document.getElementById('editListYear');
  const yearError = document.getElementById('editYearError');

  if (!modal || !currentNameSpan || !nameInput) return;

  currentNameSpan.textContent = listName;
  nameInput.value = listName;

  // Populate year from metadata
  const meta = getListMetadata(listName);
  if (yearInput) {
    yearInput.value = meta?.year || '';
  }
  if (yearError) {
    yearError.classList.add('hidden');
  }

  modal.classList.remove('hidden');

  // Select all text in the input for easy editing
  setTimeout(() => {
    nameInput.focus();
    nameInput.select();
  }, 100);
}

// Removed complex initializeMobileSorting function - now using unified approach

// Helper function to show loading spinner
function showLoadingSpinner(container) {
  container.replaceChildren(); // Clear immediately
  const spinner = document.createElement('div');
  spinner.className = 'text-center text-gray-500 mt-20 px-4';
  spinner.innerHTML = `
    <i class="fas fa-spinner fa-spin text-4xl text-gray-600"></i>
    <p class="text-sm mt-4">Loading...</p>
  `;
  container.appendChild(spinner);
}

// Select and display a list
async function selectList(listName) {
  try {
    // Track previous list for realtime sync unsubscription
    const previousList = currentList;

    currentList = listName;
    window.currentList = currentList;

    // Update realtime sync subscriptions
    if (realtimeSyncModule) {
      if (previousList && previousList !== listName) {
        realtimeSyncModule.unsubscribeFromList(previousList);
      }
      if (listName) {
        realtimeSyncModule.subscribeToList(listName);
      }
    }

    // Clear playcount cache when switching lists (playcounts are list-item specific)
    clearPlaycountCache();

    // === IMMEDIATE UI UPDATES (before network call) ===
    // Update active state in sidebar immediately (optimized - no full rebuild)
    updateListNavActiveState(listName);

    // Update the header title immediately
    updateHeaderTitle(listName);

    // Update the header with current list name (moved here - doesn't depend on fetched data)
    updateMobileHeader();

    // Show/hide FAB based on whether a list is selected (mobile only)
    const fab = document.getElementById('addAlbumFAB');
    if (fab) {
      fab.style.display = listName ? 'flex' : 'none';
    }

    // Show loading spinner immediately to provide instant visual feedback
    const container = document.getElementById('albumContainer');
    if (container && listName) {
      showLoadingSpinner(container);
    }

    // Save to localStorage immediately (synchronous)
    if (listName) {
      try {
        localStorage.setItem('lastSelectedList', listName);
      } catch (e) {
        // Silently fail if localStorage is full - not critical
        if (e.name === 'QuotaExceededError') {
          console.warn(
            'LocalStorage quota exceeded, skipping lastSelectedList save'
          );
        }
      }
    }

    // === FETCH AND RENDER DATA ===
    // Fetch list data from server (server caches for 5min)
    if (listName) {
      try {
        // Use helper to check if data is loaded
        let data = getListData(listName);

        // OPTIMIZATION: Only fetch if data is missing or not loaded
        // This avoids duplicate fetches when loadLists() already loaded the data
        const needsFetch = !isListDataLoaded(listName);

        if (needsFetch) {
          data = await apiCall(`/api/lists/${encodeURIComponent(listName)}`);
          // Use helper to store data (preserves metadata)
          setListData(listName, data);
        }

        // Display the fetched data with images (single render)
        // Pass forceFullRebuild flag to skip incremental update checks when switching lists
        if (currentList === listName) {
          displayAlbums(data, { forceFullRebuild: true });
          // Fetch Last.fm playcounts in background (non-blocking)
          const listMeta = getListMetadata(listName);
          if (listMeta?._id) {
            fetchAndDisplayPlaycounts(listMeta._id).catch((err) => {
              console.warn('Background playcount fetch failed:', err);
            });
          }
          // Refresh mobile bar visibility when list changes
          if (window.refreshMobileBarVisibility) {
            window.refreshMobileBarVisibility();
          }
        }
      } catch (err) {
        console.warn('Failed to fetch list data:', err);
        showToast('Error loading list data', 'error');
      }
    }

    // === BACKGROUND TASKS (non-blocking) ===
    // Fix #1: Make track fetching non-blocking - run in background without await
    // This prevents blocking the UI for 4-10 seconds waiting for MusicBrainz API
    if (listName) {
      autoFetchTracksForList(listName).catch((err) => {
        console.error('Background track fetch failed:', err);
      });
    }

    // Persist the selection without blocking UI if changed
    if (listName && listName !== window.lastSelectedList) {
      apiCall('/api/user/last-list', {
        method: 'POST',
        body: JSON.stringify({ listName }),
      })
        .then(() => {
          window.lastSelectedList = listName;
        })
        .catch((error) => {
          console.warn('Failed to save list preference:', error);
        });
    }
  } catch (_error) {
    showToast('Error loading list', 'error');
  }
}

// Expose selectList to window after it's defined
window.selectList = selectList;
window.loadLists = loadLists;

function updateHeaderTitle(listName) {
  const headerAddAlbumBtn = document.getElementById('headerAddAlbumBtn');
  const mobileListName = document.getElementById('mobileCurrentListName');

  if (listName) {
    // Show the add album button in header if it exists
    if (headerAddAlbumBtn) {
      headerAddAlbumBtn.classList.remove('hidden');
    }
    // Update mobile header with current list name
    if (mobileListName) {
      mobileListName.textContent = listName;
      mobileListName.classList.remove('hidden');
    }
  } else {
    // Hide mobile list name when no list selected
    if (mobileListName) {
      mobileListName.classList.add('hidden');
      mobileListName.textContent = '';
    }
  }
}

// Update track cell display without re-rendering entire list (legacy, kept for reference)
function _updateTrackCellDisplay(albumIndex, trackValue, tracks) {
  const isMobile = window.innerWidth < 1024;

  if (isMobile) {
    // Mobile: Find the card and update it
    const container = document.getElementById('albumContainer');
    const mobileList = container?.querySelector('.mobile-album-list');
    if (!mobileList) return;

    const card = mobileList.children[albumIndex];
    if (!card) return;

    // For mobile, we'd need to re-render the card or just let it update on next interaction
    // Mobile cards don't show track picks as prominently, so less critical
    return;
  }

  // Desktop: Find the specific track cell and update it
  const container = document.getElementById('albumContainer');
  const rowsContainer = container?.querySelector('.album-rows-container');
  if (!rowsContainer) return;

  const row = rowsContainer.children[albumIndex];
  if (!row) return;

  const trackCell = row.querySelector('.track-cell');
  if (!trackCell) return;

  // Process track pick display (same logic as processAlbumData)
  let trackPickDisplay = '';
  let trackPickClass = 'text-gray-800 italic';
  let trackPickDuration = '';

  if (trackValue && tracks && Array.isArray(tracks)) {
    const trackMatch = tracks.find((t) => getTrackName(t) === trackValue);
    if (trackMatch) {
      const trackName = getTrackName(trackMatch);
      const match = trackName.match(/^(\d+)[.\s-]?\s*(.*)$/);
      if (match) {
        const trackNum = match[1];
        const displayName = match[2] || '';
        trackPickDisplay = displayName
          ? `${trackNum}. ${displayName}`
          : `Track ${trackNum}`;
        trackPickClass = 'text-gray-300';
      } else {
        trackPickDisplay = trackName;
        trackPickClass = 'text-gray-300';
      }
      // Extract track duration
      const length = getTrackLength(trackMatch);
      trackPickDuration = formatTrackTime(length);
    } else if (trackValue.match(/^\d+$/)) {
      trackPickDisplay = `Track ${trackValue}`;
      trackPickClass = 'text-gray-300';
    } else {
      trackPickDisplay = trackValue;
      trackPickClass = 'text-gray-300';
    }
  }

  if (!trackPickDisplay) {
    trackPickDisplay = 'Select Track';
  }

  // Update the cell content
  trackCell.innerHTML = `<span class="text-sm ${trackPickClass} truncate cursor-pointer hover:text-gray-100" title="${trackValue || 'Click to select track'}">${trackPickDisplay}</span>${trackPickDuration ? `<span class="text-xs text-gray-500 shrink-0 ml-2">${trackPickDuration}</span>` : ''}`;

  // Re-attach click handler
  trackCell.onclick = async () => {
    const currentIndex = parseInt(row.dataset.index);
    const albumsForTrack = getListData(currentList);
    const album = albumsForTrack && albumsForTrack[currentIndex];
    if (!album) return;
    if (!album.tracks || album.tracks.length === 0) {
      showToast('Fetching tracks...', 'info');
      try {
        await fetchTracksForAlbum(album);
        await saveList(currentList, albumsForTrack);
      } catch (_err) {
        showToast('Error fetching tracks', 'error');
        return;
      }
    }

    const rect = trackCell.getBoundingClientRect();
    showTrackSelectionMenu(album, currentIndex, rect.left, rect.bottom);
  };
}

// Update track cell display for dual track picks (primary + secondary)
function updateTrackCellDisplayDual(albumIndex, trackPicks, tracks) {
  const isMobile = window.innerWidth < 1024;

  // Helper to process a single track
  function processTrack(trackIdentifier) {
    if (!trackIdentifier) return { display: '', duration: '', class: '' };

    if (tracks && Array.isArray(tracks)) {
      const trackMatch = tracks.find(
        (t) => getTrackName(t) === trackIdentifier
      );
      if (trackMatch) {
        const trackName = getTrackName(trackMatch);
        const match = trackName.match(/^(\d+)[.\s-]?\s*(.*)$/);
        let display;
        if (match) {
          const trackNum = match[1];
          const displayName = match[2] || '';
          display = displayName
            ? `${trackNum}. ${displayName}`
            : `Track ${trackNum}`;
        } else {
          display = trackName;
        }
        const length = getTrackLength(trackMatch);
        const duration = formatTrackTime(length);
        return { display, duration, class: 'text-gray-300' };
      }
    }

    if (trackIdentifier.match(/^\d+$/)) {
      return {
        display: `Track ${trackIdentifier}`,
        duration: '',
        class: 'text-gray-300',
      };
    }

    return { display: trackIdentifier, duration: '', class: 'text-gray-300' };
  }

  const primaryData = processTrack(trackPicks.primary_track);
  const secondaryData = processTrack(trackPicks.secondary_track);
  const hasSecondary = !!trackPicks.secondary_track;

  if (isMobile) {
    // Mobile: Update the track text spans
    const container = document.getElementById('albumContainer');
    const mobileList = container?.querySelector('.mobile-album-list');
    if (!mobileList) return;

    const card = mobileList.children[albumIndex];
    if (!card) return;

    const trackText = card.querySelector('[data-field="track-mobile-text"]');
    if (trackText) {
      trackText.textContent = primaryData.display || '';
    }

    const secondaryText = card.querySelector(
      '[data-field="secondary-track-mobile-text"]'
    );
    if (secondaryText) {
      secondaryText.textContent = secondaryData.display || '';
    }
    return;
  }

  // Desktop: Find the specific track cell and update it
  const container = document.getElementById('albumContainer');
  const rowsContainer = container?.querySelector('.album-rows-container');
  if (!rowsContainer) return;

  const row = rowsContainer.children[albumIndex];
  if (!row) return;

  const trackCell = row.querySelector('.track-cell');
  if (!trackCell) return;

  // Build new cell content with stacked display
  let cellHTML = '';

  if (primaryData.display) {
    cellHTML += `
      <div class="flex items-center min-w-0 overflow-hidden w-full">
        <span class="text-yellow-400 mr-1.5 text-xs shrink-0" title="Primary track">★</span>
        <span class="album-cell-text ${primaryData.class} truncate hover:text-gray-100 flex-1 min-w-0" title="${trackPicks.primary_track || ''}">${primaryData.display}</span>
        ${primaryData.duration ? `<span class="text-xs text-gray-500 shrink-0 ml-2 tabular-nums">${primaryData.duration}</span>` : ''}
      </div>`;
  } else {
    cellHTML += `
      <div class="flex items-center min-w-0">
        <span class="album-cell-text text-gray-800 italic hover:text-gray-100">Select Track</span>
      </div>`;
  }

  if (hasSecondary) {
    cellHTML += `
      <div class="flex items-center min-w-0 mt-0.5 overflow-hidden w-full">
        <span class="text-yellow-400 mr-1.5 text-xs shrink-0" title="Secondary track">☆</span>
        <span class="album-cell-text ${secondaryData.class} truncate hover:text-gray-100 text-sm flex-1 min-w-0" title="${trackPicks.secondary_track || ''}">${secondaryData.display}</span>
        ${secondaryData.duration ? `<span class="text-xs text-gray-500 shrink-0 ml-2 tabular-nums">${secondaryData.duration}</span>` : ''}
      </div>`;
  }

  trackCell.innerHTML = cellHTML;

  // Re-attach click handler
  trackCell.onclick = async () => {
    const currentIndex = parseInt(row.dataset.index);
    const albumsForTrack = getListData(currentList);
    const album = albumsForTrack && albumsForTrack[currentIndex];
    if (!album) return;
    if (!album.tracks || album.tracks.length === 0) {
      showToast('Fetching tracks...', 'info');
      try {
        await fetchTracksForAlbum(album);
        await saveList(currentList, albumsForTrack);
      } catch (_err) {
        showToast('Error fetching tracks', 'error');
        return;
      }
    }

    const rect = trackCell.getBoundingClientRect();
    showTrackSelectionMenu(album, currentIndex, rect.left, rect.bottom);
  };
}

// Show track selection menu for quick track picking
function showTrackSelectionMenu(album, albumIndex, x, y) {
  // Remove any existing menu
  const existingMenu = document.getElementById('quickTrackMenu');
  if (existingMenu) existingMenu.remove();

  const menu = document.createElement('div');
  menu.id = 'quickTrackMenu';
  menu.className =
    'absolute z-50 bg-gray-800 rounded-lg shadow-xl border border-gray-700 max-h-96 overflow-y-auto';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.style.minWidth = '280px';

  if (!album.tracks || album.tracks.length === 0) {
    menu.innerHTML =
      '<div class="px-4 py-2 text-sm text-gray-500">No tracks available</div>';
  } else {
    // Sort tracks by track number
    const sortedTracks = [...album.tracks].sort((a, b) => {
      const nameA = getTrackName(a);
      const nameB = getTrackName(b);
      const numA = parseInt(nameA.match(/^(\d+)/)?.[1] || 0);
      const numB = parseInt(nameB.match(/^(\d+)/)?.[1] || 0);
      return numA && numB ? numA - numB : 0;
    });

    const albumsForMenu = getListData(currentList);
    const currentAlbum = albumsForMenu && albumsForMenu[albumIndex];

    // Get current track picks (new normalized fields or legacy)
    const primaryTrack =
      currentAlbum?.primary_track || currentAlbum?.track_pick || '';
    const secondaryTrack = currentAlbum?.secondary_track || '';
    const hasNoSelection = !primaryTrack && !secondaryTrack;

    // Build menu header with instructions
    let menuHTML = `
      <div class="px-4 py-2 text-xs text-gray-500 border-b border-gray-700">
        Click once = secondary (☆) | Click again = primary (★)
      </div>
      <div class="track-menu-option px-4 py-2 hover:bg-gray-700 cursor-pointer text-sm" data-track-value="" data-action="clear">
        <span class="${hasNoSelection ? 'text-red-500' : 'text-gray-400'}">
          ${hasNoSelection ? '<i class="fas fa-check mr-2"></i>' : ''}Clear all selections
        </span>
      </div>
      <div class="border-t border-gray-700"></div>
    `;

    sortedTracks.forEach((track, idx) => {
      const trackName = getTrackName(track);
      const isPrimary = primaryTrack === trackName;
      const isSecondary = secondaryTrack === trackName;
      const match = trackName.match(/^(\d+)[.\s-]?\s*(.*)$/);
      const trackNum = match ? match[1] : idx + 1;
      const displayName = match ? match[2] : trackName;
      const trackLength = formatTrackTime(getTrackLength(track));

      // Visual indicators
      let indicator = '';
      let textClass = 'text-gray-300';
      let bgClass = '';

      if (isPrimary) {
        indicator = '<span class="text-yellow-400 mr-2">★</span>';
        textClass = 'text-yellow-400';
        bgClass = 'bg-yellow-900/20';
      } else if (isSecondary) {
        indicator = '<span class="text-yellow-400 mr-2">☆</span>';
        textClass = 'text-gray-300';
        bgClass = 'bg-gray-700/30';
      }

      menuHTML += `
        <div class="track-menu-option px-4 py-2 hover:bg-gray-700 cursor-pointer text-sm ${bgClass}" 
             data-track-value="${trackName}"
             data-is-primary="${isPrimary}"
             data-is-secondary="${isSecondary}">
          <span class="${textClass}">
            ${indicator}
            <span class="font-medium">${trackNum}.</span> ${displayName}${trackLength ? ` <span class="text-gray-500 text-xs ml-2">${trackLength}</span>` : ''}
          </span>
        </div>
      `;
    });

    menu.innerHTML = menuHTML;

    // Add click handlers with new dual-track logic
    menu.querySelectorAll('.track-menu-option').forEach((option) => {
      option.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const trackValue = option.dataset.trackValue;
        const action = option.dataset.action;
        const albumId = album.album_id;

        if (!albumId) {
          showToast('Cannot save track selection - album has no ID', 'error');
          menu.remove();
          return;
        }

        menu.remove();

        try {
          if (action === 'clear') {
            // Clear all track picks
            const response = await fetch(`/api/track-picks/${albumId}`, {
              method: 'DELETE',
              headers: {
                'Content-Type': 'application/json',
              },
              credentials: 'same-origin',
            });

            if (!response.ok) throw new Error('Failed to clear track picks');

            const result = await response.json();

            // Update local data
            const albumsForSelection = getListData(currentList);
            const freshAlbum =
              albumsForSelection && albumsForSelection[albumIndex];
            if (freshAlbum) {
              freshAlbum.primary_track = null;
              freshAlbum.secondary_track = null;
              freshAlbum.track_pick = ''; // Legacy field
            }

            updateTrackCellDisplayDual(albumIndex, result, album.tracks);
            showToast('Track selections cleared');
          } else {
            // Determine target priority based on current state
            const isPrimary = option.dataset.isPrimary === 'true';
            const isSecondary = option.dataset.isSecondary === 'true';

            let targetPriority;
            if (isPrimary) {
              // Already primary - deselect by removing
              const response = await fetch(`/api/track-picks/${albumId}`, {
                method: 'DELETE',
                headers: {
                  'Content-Type': 'application/json',
                },
                credentials: 'same-origin',
                body: JSON.stringify({ trackIdentifier: trackValue }),
              });

              if (!response.ok) throw new Error('Failed to remove track pick');

              const result = await response.json();

              const albumsForSelection = getListData(currentList);
              const freshAlbum =
                albumsForSelection && albumsForSelection[albumIndex];
              if (freshAlbum) {
                freshAlbum.primary_track = result.primary_track;
                freshAlbum.secondary_track = result.secondary_track;
                freshAlbum.track_pick = result.primary_track || '';
              }

              updateTrackCellDisplayDual(albumIndex, result, album.tracks);
              showToast('Primary track deselected');
              return;
            } else if (isSecondary) {
              // Secondary - promote to primary
              targetPriority = 1;
            } else {
              // Not selected - set as secondary first
              targetPriority = 2;
            }

            const response = await fetch(`/api/track-picks/${albumId}`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              credentials: 'same-origin',
              body: JSON.stringify({
                trackIdentifier: trackValue,
                priority: targetPriority,
              }),
            });

            if (!response.ok) throw new Error('Failed to set track pick');

            const result = await response.json();

            // Update local data
            const albumsForSelection = getListData(currentList);
            const freshAlbum =
              albumsForSelection && albumsForSelection[albumIndex];
            if (freshAlbum) {
              freshAlbum.primary_track = result.primary_track;
              freshAlbum.secondary_track = result.secondary_track;
              freshAlbum.track_pick = result.primary_track || ''; // Legacy field
            }

            updateTrackCellDisplayDual(albumIndex, result, album.tracks);

            if (targetPriority === 1) {
              showToast(`★ Primary: ${trackValue.substring(0, 40)}...`);
            } else {
              showToast(`☆ Secondary: ${trackValue.substring(0, 40)}...`);
            }
          }
        } catch (error) {
          console.error('Track pick error:', error);
          showToast('Error saving track selection', 'error');
        }
      };
    });
  }

  document.body.appendChild(menu);

  // Position adjustment to keep menu on screen (using batched style operations)
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let adjustedX = x;
    let adjustedY = y;

    if (rect.right > viewportWidth) {
      adjustedX = viewportWidth - rect.width - 10;
    }
    if (rect.bottom > viewportHeight) {
      adjustedY = y - rect.height;
    }

    if (adjustedX !== x || adjustedY !== y) {
      menu.style.left = `${adjustedX}px`;
      menu.style.top = `${adjustedY}px`;
    }
  });

  // Close menu when clicking outside
  const closeMenu = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    }
  };

  setTimeout(() => {
    document.addEventListener('click', closeMenu);
  }, 0);
}

// Album display functions moved to modules/album-display.js

// Helper function to check if text is truncated
function isTextTruncated(element) {
  // For elements with line-clamp, check if scrollHeight exceeds clientHeight
  return element.scrollHeight > element.clientHeight;
}

// Debounced save function to batch rapid changes
let saveTimeout = null;
function debouncedSaveList(listName, listData, delay = 300) {
  clearTimeout(saveTimeout);

  saveTimeout = setTimeout(async () => {
    try {
      await saveList(listName, listData);
    } catch (error) {
      console.error('Error saving list:', error);
      showToast('Error saving list order', 'error');
    }
  }, delay);
}

// File import handlers moved inside DOMContentLoaded

document.addEventListener('DOMContentLoaded', () => {
  // Convert server-side flash messages to toast notifications
  function convertFlashToToast() {
    // Add 'js-enabled' class to body to enable CSS that hides flash messages
    document.body.classList.add('js-enabled');

    // Find all flash messages with data-flash attribute
    const flashMessages = document.querySelectorAll('[data-flash]');

    console.log('Flash messages found:', flashMessages.length);
    flashMessages.forEach((element) => {
      const type = element.dataset.flash; // 'error', 'success', 'info'
      let message;

      // For login.ejs which uses data-flash-content
      if (element.dataset.flashContent) {
        message = element.dataset.flashContent;
      } else {
        // For templates.js which has text content directly
        message = element.textContent.trim();
      }

      console.log('Processing flash:', {
        type,
        message,
        hasContent: !!message,
      });

      if (message) {
        showToast(message, type);
      }
    });
  }

  // Call the conversion function immediately - this works on all pages
  convertFlashToToast();

  // Check if we're on a main app page (not auth pages)
  const isAuthPage = window.location.pathname.match(
    /\/(login|register|forgot)/
  );
  if (isAuthPage) {
    // Don't initialize main app features on auth pages
    return;
  }

  // Initialize settings drawer
  function initializeSettingsDrawer() {
    const settingsDrawer = createSettingsDrawer({
      showToast,
      showConfirmation,
      apiCall: window.apiCall,
    });

    settingsDrawer.initialize();

    // Expose open function globally for header button
    window.openSettingsDrawer = () => {
      settingsDrawer.openDrawer();
    };
  }

  // Initialize settings drawer
  initializeSettingsDrawer();

  // Sidebar collapse functionality
  function initializeSidebarCollapse() {
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebarToggle');
    const mainContent = document.querySelector('.main-content');

    if (!sidebar || !sidebarToggle || !mainContent) return;

    // Check localStorage for saved state
    const isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';

    // Apply initial state
    if (isCollapsed) {
      sidebar.classList.add('collapsed');
      mainContent.classList.add('sidebar-collapsed');
    }

    // Toggle handler
    sidebarToggle.addEventListener('click', () => {
      const isCurrentlyCollapsed = sidebar.classList.contains('collapsed');

      if (isCurrentlyCollapsed) {
        sidebar.classList.remove('collapsed');
        mainContent.classList.remove('sidebar-collapsed');
        localStorage.setItem('sidebarCollapsed', 'false');
      } else {
        sidebar.classList.add('collapsed');
        mainContent.classList.add('sidebar-collapsed');
        localStorage.setItem('sidebarCollapsed', 'true');
      }
    });
  }

  // Initialize sidebar collapse first
  initializeSidebarCollapse();

  // Initialize FAB button click handler
  const fab = document.getElementById('addAlbumFAB');
  if (fab) {
    fab.addEventListener('click', () => {
      if (window.openAddAlbumModal) {
        window.openAddAlbumModal();
      } else {
        console.error('openAddAlbumModal not found');
        showToast('Error: Add album function not available', 'error');
      }
    });
  }

  // Clean up old cache keys from previous implementation
  try {
    localStorage.removeItem('lists_cache');
    localStorage.removeItem('lists_cache_timestamp');
    // Clean up individual list caches
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith('lastSelectedListData_')) {
        localStorage.removeItem(key);
      }
    }
  } catch (err) {
    console.warn('Failed to clean up old cache:', err);
  }

  // Quickly populate sidebar using cached list names
  const cachedLists = localStorage.getItem('cachedListNames');
  if (cachedLists) {
    try {
      const names = JSON.parse(cachedLists);
      names.forEach((name) => {
        if (!lists[name]) {
          // Initialize with metadata object structure (data loaded later)
          lists[name] = {
            name: name,
            year: null,
            isMain: false,
            count: 0,
            _data: null,
            updatedAt: null,
            createdAt: null,
          };
        }
      });
      updateListNav();
    } catch (err) {
      console.warn('Failed to parse cached list names:', err);
    }
  }

  // Load all required data and initialize features
  // Note: Genres and countries are now loaded synchronously at module initialization
  loadLists()
    .then(() => {
      initializeContextMenu();
      initializeAlbumContextMenu();
      hideSubmenuOnLeave();
      initializeCreateList();
      initializeRenameList();
      initializeImportConflictHandling();

      // Initialize real-time sync for cross-device list updates
      initializeRealtimeSync();

      // Handle discovery module's album add requests
      window.addEventListener('discovery-add-album', async (e) => {
        const { artist, album, listName } = e.detail;
        if (!artist || !album || !listName) {
          showToast('Missing album information', 'error');
          return;
        }

        try {
          // Search MusicBrainz for the album
          showToast(`Searching for "${album}" by ${artist}...`, 'info');

          const searchQuery = encodeURIComponent(`${artist} ${album}`);
          const mbResponse = await fetch(
            `/api/proxy/musicbrainz?endpoint=release-group/?query=${searchQuery}&type=album&limit=5&fmt=json`,
            { credentials: 'include' }
          );

          if (!mbResponse.ok) {
            throw new Error('MusicBrainz search failed');
          }

          const mbData = await mbResponse.json();
          const releaseGroups = mbData['release-groups'] || [];

          if (releaseGroups.length === 0) {
            showToast(
              `Could not find "${album}" on MusicBrainz. Try adding manually.`,
              'error'
            );
            return;
          }

          // Find best match (exact or closest)
          const normalizeStr = (s) =>
            s?.toLowerCase().replace(/[^a-z0-9]/g, '') || '';
          const targetArtist = normalizeStr(artist);
          const targetAlbum = normalizeStr(album);

          let bestMatch = releaseGroups[0];
          for (const rg of releaseGroups) {
            const rgArtist = normalizeStr(
              rg['artist-credit']?.[0]?.name ||
                rg['artist-credit']?.[0]?.artist?.name
            );
            const rgAlbum = normalizeStr(rg.title);
            if (rgArtist === targetArtist && rgAlbum === targetAlbum) {
              bestMatch = rg;
              break;
            }
          }

          // Build album object
          const artistName =
            bestMatch['artist-credit']?.[0]?.name ||
            bestMatch['artist-credit']?.[0]?.artist?.name ||
            artist;
          const albumTitle = bestMatch.title || album;
          const releaseDate = bestMatch['first-release-date'] || '';

          const newAlbum = {
            artist: artistName,
            album: albumTitle,
            album_id: bestMatch.id,
            release_date: releaseDate,
            country: '',
            genre_1: '',
            genre_2: '',
          };

          // Get the target list data
          let targetListData = getListData(listName);
          if (!targetListData) {
            // Fetch the list data if not cached
            targetListData = await apiCall(
              `/api/lists/${encodeURIComponent(listName)}`
            );
          }

          if (!targetListData) {
            targetListData = [];
          }

          // Check for duplicates
          const isDuplicate = targetListData.some(
            (a) =>
              a.artist?.toLowerCase() === artistName.toLowerCase() &&
              a.album?.toLowerCase() === albumTitle.toLowerCase()
          );

          if (isDuplicate) {
            showToast(
              `"${albumTitle}" already exists in "${listName}"`,
              'error'
            );
            return;
          }

          // Add to list
          targetListData.push(newAlbum);
          await saveList(listName, targetListData);

          // Refresh if viewing the same list
          if (currentList === listName) {
            selectList(listName);
          }

          // Refresh discovery module's user lists cache
          import('./modules/discovery.js').then(({ refreshUserLists }) => {
            refreshUserLists();
          });

          showToast(`Added "${albumTitle}" to "${listName}"`);
        } catch (err) {
          console.error('Error adding album from discovery:', err);
          showToast('Failed to add album. Try adding manually.', 'error');
        }
      });

      // Note: Last list selection is now handled in loadLists() for faster display

      // Initialize file import handlers
      const importBtn = document.getElementById('importBtn');
      const fileInput = document.getElementById('fileInput');

      if (importBtn && fileInput) {
        importBtn.onclick = () => {
          fileInput.click();
        };

        fileInput.onchange = async (e) => {
          const file = e.target.files[0];
          if (file) {
            const reader = new FileReader();
            reader.onload = async (e) => {
              try {
                const data = JSON.parse(e.target.result);
                const fileName = file.name.replace(/\.json$/, '');

                // Check for existing list
                if (lists[fileName]) {
                  // Show import conflict modal
                  pendingImportData = data;
                  pendingImportFilename = fileName;
                  document.getElementById('conflictListName').textContent =
                    fileName;
                  document
                    .getElementById('importConflictModal')
                    .classList.remove('hidden');
                } else {
                  // Import directly
                  await saveList(fileName, data);
                  updateListNav();
                  selectList(fileName);
                  showToast(`Successfully imported ${data.length} albums`);
                }
              } catch (err) {
                showToast('Error importing file: ' + err.message, 'error');
              }
            };
            reader.onerror = () => {
              showToast('Error reading file', 'error');
            };
            reader.readAsText(file);
          }
          e.target.value = ''; // Reset file input
        };
      }

      // Confirmation modal handlers are managed by showConfirmation function
      // No static handlers needed since we use the Promise-based approach

      // Check if user needs to complete list setup (year + main list designation)
      // Delay slightly to let the main UI render first
      setTimeout(() => {
        checkListSetupStatus().catch((err) => {
          console.warn('Failed to check list setup status:', err);
        });
      }, 1000);
    })
    .catch((_err) => {
      showToast('Failed to initialize', 'error');
    });
});
// Add this right after the DOMContentLoaded event listener
window.addEventListener('beforeunload', () => {
  if (currentList) {
    try {
      localStorage.setItem('lastSelectedList', currentList);
    } catch (e) {
      // Silently fail - not critical during page unload
      console.warn('Failed to save last selected list on unload:', e.name);
    }
  }
});

// Expose playAlbum for inline handlers
window.playAlbum = playAlbum;
