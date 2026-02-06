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
  showReasoningModal,
  hideReasoningModal,
  showViewReasoningModal,
} from './modules/ui-utils.js';
import { escapeHtml } from './modules/html-utils.js';
import { checkListSetupStatus } from './modules/list-setup-wizard.js';
import { createSettingsDrawer } from './modules/settings-drawer.js';
import { createActionSheet } from './modules/ui-factories.js';
import {
  invalidateLockedYearsCache,
  invalidateLockedRecommendationYearsCache,
  isListLocked,
} from './modules/year-lock.js';
import { formatTrackTime } from './modules/time-utils.js';

// Expose recommendation lock cache invalidation to window
window.invalidateLockedRecommendationYearsCache =
  invalidateLockedRecommendationYearsCache;

// Re-export UI utilities for backward compatibility
export { showToast, showConfirmation, showReasoningModal, hideReasoningModal };

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
      getCurrentList: () => currentListId,
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
      destroySorting,
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
      getCurrentList: () => currentListId,
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
        currentListId = listName;
      },
      refreshMobileBarVisibility: () => {
        if (window.refreshMobileBarVisibility) {
          window.refreshMobileBarVisibility();
        }
      },
      toggleMainStatus,
      getSortedGroups,
      refreshGroupsAndLists,
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
      getCurrentList: () => currentListId,
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
      getSortedGroups,
      refreshGroupsAndLists,
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

function showMobileCategoryMenu(groupId, groupName, isYearGroup) {
  return getMobileUIModule().showMobileCategoryMenu(
    groupId,
    groupName,
    isYearGroup
  );
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
window.showMobileCategoryMenu = showMobileCategoryMenu;
window.showMobileEditForm = showMobileEditForm;
window.showMobileEditFormSafe = showMobileEditFormSafe;
window.showMobileSummarySheet = showMobileSummarySheet;
window.playAlbumSafe = playAlbumSafe;
window.removeAlbumSafe = removeAlbumSafe;
// openRenameCategoryModal is exposed later after it's defined

/**
 * Get or initialize the list navigation module
 * Uses lazy initialization to avoid dependency ordering issues
 */
/**
 * Refresh groups and lists from server
 * Used after drag-and-drop reordering
 */
async function refreshGroupsAndLists() {
  try {
    const [fetchedLists, fetchedGroups] = await Promise.all([
      apiCall('/api/lists'),
      apiCall('/api/groups'),
    ]);

    // Update groups
    updateGroupsFromServer(fetchedGroups);

    // Update lists metadata (preserve loaded _data)
    // Note: fetchedLists is now keyed by _id, not name
    Object.keys(fetchedLists).forEach((listId) => {
      const meta = fetchedLists[listId];
      if (lists[listId]) {
        // Preserve existing _data if loaded, but update all metadata including name
        lists[listId] = {
          ...lists[listId],
          name: meta.name || lists[listId].name || 'Unknown',
          year: meta.year || null,
          isMain: meta.isMain || false,
          count: meta.count || 0,
          groupId: meta.groupId || null,
          sortOrder: meta.sortOrder || 0,
          updatedAt: meta.updatedAt || null,
        };
      } else {
        lists[listId] = {
          _id: listId,
          name: meta.name || 'Unknown',
          year: meta.year || null,
          isMain: meta.isMain || false,
          count: meta.count || 0,
          groupId: meta.groupId || null,
          sortOrder: meta.sortOrder || 0,
          _data: null,
          updatedAt: meta.updatedAt || null,
          createdAt: meta.createdAt || null,
        };
      }
    });
    window.lists = lists;

    // Re-render the sidebar navigation
    updateListNav();
  } catch (err) {
    console.error('Failed to refresh groups and lists:', err);
  }
}

function getListNavModule() {
  if (!listNavModule) {
    listNavModule = createListNav({
      getLists: () => lists,
      getListMetadata,
      getGroups,
      getSortedGroups,
      getCurrentList: () => currentListId,
      selectList,
      getListMenuConfig,
      hideAllContextMenus,
      positionContextMenu,
      toggleMobileLists,
      setCurrentContextList: (listName) => {
        currentContextList = listName;
      },
      setCurrentContextGroup: (group) => {
        currentContextGroup = group;
      },
      apiCall,
      showToast,
      refreshGroupsAndLists,
    });
  }
  return listNavModule;
}

// Wrapper functions for list navigation module
function updateListNav() {
  return getListNavModule().updateListNav();
}

function updateListNavActiveState(
  activeListId,
  activeRecommendationsYear = null
) {
  return getListNavModule().updateListNavActiveState(
    activeListId,
    activeRecommendationsYear
  );
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
      getCurrentList: () => currentListId,
      apiCall,
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
 * Lightweight reorder function for drag-and-drop.
 * Sends album_id (or albumId) when present; falls back to list item _id for
 * legacy items without album_id. Preserves array indices so unidentifiable
 * items are skipped without shifting others' positions.
 *
 * @param {string} listName - Name of the list to reorder
 * @param {Array} list - Array of album objects in new order (may have _id, album_id, or albumId)
 */
async function saveReorder(listName, list) {
  if (!list || !Array.isArray(list)) {
    console.error('List data not found:', listName);
    return;
  }

  try {
    // Prefer album_id, then albumId; if neither, use list item _id for legacy rows.
    // null preserves the index so the server can skip unidentifiable items without shifting positions.
    const order = list.map((a) => {
      const id = a.album_id || a.albumId;
      if (id) return id;
      if (a._id) return { _id: a._id };
      return null;
    });

    await apiCall(`/api/lists/${encodeURIComponent(listName)}/reorder`, {
      method: 'POST',
      body: JSON.stringify({ order }),
    });

    console.log('List reordered successfully:', listName);
  } catch (error) {
    console.error('Error reordering list:', error);
    throw error;
  }
}

/**
 * Get or initialize the sorting module
 * Uses lazy initialization to avoid dependency ordering issues
 */
function getSortingModule() {
  if (!sortingModule) {
    sortingModule = createSorting({
      getListData,
      getCurrentList: () => currentListId,
      debouncedSaveList,
      saveReorder, // Add lightweight reorder function
      updatePositionNumbers,
      showToast,
    });
  }
  return sortingModule;
}

// Wrapper functions for sorting module
function initializeUnifiedSorting(container, isMobile) {
  return getSortingModule().initializeUnifiedSorting(container, isMobile);
}

function destroySorting(container) {
  return getSortingModule().destroySorting(container);
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
      findListByName,
      saveList,
      importList,
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
      getCurrentList: () => currentListId,
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
      getCurrentList: () => currentListId,
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
        if (currentListId === listName) {
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
        if (currentListId === listName) {
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
// NOTE: lists is now keyed by _id instead of name to support duplicate names
let lists = {};
let groups = {}; // List groups (years and collections)
let currentListId = ''; // Now stores list ID instead of name
let currentRecommendationsYear = null; // Year if viewing recommendations, null otherwise
let currentContextAlbum = null;
let currentContextAlbumId = null; // Store album identity as backup
let currentContextList = null; // Now stores list ID
let currentContextGroup = null; // { id, name, isYearGroup }

// Legacy compatibility - expose currentList as alias for currentListId (for external code)
Object.defineProperty(window, 'currentList', {
  get: () => currentListId,
  set: (val) => {
    currentListId = val;
  },
  configurable: true,
});
// Also expose currentListId directly
Object.defineProperty(window, 'currentListId', {
  get: () => currentListId,
  set: (val) => {
    currentListId = val;
  },
  configurable: true,
});

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
// Lists are now keyed by _id (not name) to support duplicate names in different categories
// Structure: { _id, name, year, count, _data, updatedAt, createdAt, groupId, sortOrder }

/**
 * Get the album array for a list by ID
 * @param {string} listId - The ID of the list
 * @returns {Array|null} - The album array or null if not found/loaded
 */
function getListData(listId) {
  if (!listId || !lists[listId]) {
    return null;
  }

  const listEntry = lists[listId];

  // Handle legacy array format (for backward compatibility during transition)
  if (Array.isArray(listEntry)) {
    console.warn(
      `Legacy array format detected for list "${listId}". Consider reloading.`
    );
    return listEntry;
  }

  // New metadata object format
  return listEntry._data || null;
}

/**
 * Find a list by name (and optionally groupId for disambiguation)
 * @param {string} name - The name of the list
 * @param {string|null} groupId - Optional group ID for disambiguation
 * @returns {Object|null} - The list metadata or null if not found
 */
function findListByName(name, groupId = null) {
  for (const listId of Object.keys(lists)) {
    const list = lists[listId];
    if (list.name === name) {
      if (groupId === null || list.groupId === groupId) {
        return list;
      }
    }
  }
  return null;
}

/**
 * Get the current list's name (helper for display purposes)
 * @returns {string} - The current list's name or empty string
 */
function getCurrentListName() {
  if (!currentListId || !lists[currentListId]) {
    return '';
  }
  return lists[currentListId].name || '';
}

/**
 * Set the album array for a list, preserving metadata
 * Also updates the snapshot for diff-based saves
 * @param {string} listId - The ID of the list
 * @param {Array} albums - The album array to set
 * @param {boolean} updateSnapshot - Whether to update the saved snapshot (default: true)
 */
function setListData(listId, albums, updateSnapshot = true) {
  if (!listId) return;

  if (!lists[listId]) {
    // Create new metadata object if list doesn't exist
    lists[listId] = {
      _id: listId,
      name: 'Unknown',
      year: null,
      isMain: false,
      count: albums ? albums.length : 0,
      _data: albums || [],
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
  } else if (Array.isArray(lists[listId])) {
    // Handle legacy array format - convert to metadata object
    console.warn(
      `Converting legacy array format for list "${listId}" to metadata object.`
    );
    lists[listId] = {
      _id: listId,
      name: 'Unknown',
      year: null,
      isMain: false,
      count: albums ? albums.length : 0,
      _data: albums || [],
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
  } else {
    // Update existing metadata object
    lists[listId]._data = albums || [];
    lists[listId].count = albums ? albums.length : 0;
  }

  // Update snapshot for diff-based saves (when data is fetched from server)
  if (updateSnapshot && albums) {
    const snapshot = createListSnapshot(albums);
    lastSavedSnapshots.set(listId, snapshot);
    saveSnapshotToStorage(listId, snapshot);
  }
}

/**
 * Get metadata for a list by ID (name, year, count, etc.)
 * @param {string} listId - The ID of the list
 * @returns {Object|null} - The metadata object or null
 */
function getListMetadata(listId) {
  if (!listId || !lists[listId]) {
    return null;
  }

  const listEntry = lists[listId];

  // Handle legacy array format
  if (Array.isArray(listEntry)) {
    return {
      _id: listId,
      name: 'Unknown',
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
 * @param {string} listId - The ID of the list
 * @param {Object} updates - The metadata fields to update
 */
function updateListMetadata(listId, updates) {
  if (!listId || !lists[listId]) return;

  const listEntry = lists[listId];

  // Handle legacy array format - convert first
  if (Array.isArray(listEntry)) {
    lists[listId] = {
      _id: listId,
      name: 'Unknown',
      year: null,
      isMain: false,
      count: listEntry.length,
      _data: listEntry,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
  }

  // Apply updates
  Object.assign(lists[listId], updates);
}

/**
 * Check if list data has been loaded
 * @param {string} listId - The ID of the list
 * @returns {boolean}
 */
function isListDataLoaded(listId) {
  if (!listId || !lists[listId]) return false;

  const listEntry = lists[listId];

  // Legacy array format is always "loaded"
  if (Array.isArray(listEntry)) return true;

  // Check if _data is populated (not null/empty when count > 0)
  return (
    listEntry._data !== null &&
    (listEntry._data.length > 0 || listEntry.count === 0)
  );
}

// ============ GROUP DATA ACCESS HELPERS ============

/**
 * Get all groups
 * @returns {Object} - Map of group ID to group data
 */
function getGroups() {
  return groups;
}

/**
 * Get a group by ID
 * @param {string} groupId - The group ID
 * @returns {Object|null} - The group data or null
 */
function getGroup(groupId) {
  return groups[groupId] || null;
}
// Export for future use in UI components
window.getGroup = getGroup;

/**
 * Get groups sorted by sort_order
 * @returns {Array} - Sorted array of groups
 */
function getSortedGroups() {
  return Object.values(groups).sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Update groups from server data
 * @param {Array} groupsArray - Array of group objects from server
 */
function updateGroupsFromServer(groupsArray) {
  groups = {};
  groupsArray.forEach((group) => {
    groups[group._id] = {
      _id: group._id,
      name: group.name,
      year: group.year,
      sortOrder: group.sortOrder,
      listCount: group.listCount,
      isYearGroup: group.isYearGroup,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    };
  });
  window.groups = groups;
}
// Export for future use in realtime sync
window.updateGroupsFromServer = updateGroupsFromServer;

/**
 * Toggle main status for a list
 * @param {string} listName - The name of the list
 */
async function toggleMainStatus(listId) {
  const meta = getListMetadata(listId);
  if (!meta) return;

  const listName = meta.name || listId;

  // Check if list is in a year-group or has a year directly
  let isInYearGroup = false;
  if (meta.groupId) {
    const sortedGroups = getSortedGroups();
    const group = sortedGroups.find((g) => g._id === meta.groupId);
    isInYearGroup = group?.isYearGroup || false;
  }

  // List must have a year (either directly or via year-group) to be marked as main
  if (!meta.year && !isInYearGroup) {
    showToast('List must be in a year category to be marked as main', 'error');
    return;
  }

  const newMainStatus = !meta.isMain;

  try {
    const response = await apiCall(
      `/api/lists/${encodeURIComponent(listId)}/main`,
      {
        method: 'POST',
        body: JSON.stringify({ isMain: newMainStatus }),
      }
    );

    // Update local metadata
    updateListMetadata(listId, { isMain: newMainStatus });

    // If another list lost its main status, update it too
    if (response.previousMainListId) {
      updateListMetadata(response.previousMainListId, { isMain: false });
    }

    // Refresh sidebar to show updated star icons
    updateListNav();

    // If this is the currently displayed list, re-render to show/hide position numbers
    // Position numbers only appear on main lists (they have semantic meaning for rankings)
    if (listId === currentListId) {
      const albums = getListData(currentListId);
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

  const recommendationContextMenu = document.getElementById(
    'recommendationContextMenu'
  );
  if (recommendationContextMenu) {
    recommendationContextMenu.classList.add('hidden');
  }

  const recommendationAddSubmenu = document.getElementById(
    'recommendationAddSubmenu'
  );
  if (recommendationAddSubmenu) {
    recommendationAddSubmenu.classList.add('hidden');
  }

  const recommendationAddListsSubmenu = document.getElementById(
    'recommendationAddListsSubmenu'
  );
  if (recommendationAddListsSubmenu) {
    recommendationAddListsSubmenu.classList.add('hidden');
  }

  // Remove highlights from submenu parent options
  const moveOption = document.getElementById('moveAlbumOption');
  const playOption = document.getElementById('playAlbumOption');
  const addToListOption = document.getElementById('addToListOption');
  moveOption?.classList.remove('bg-gray-700', 'text-white');
  playOption?.classList.remove('bg-gray-700', 'text-white');
  addToListOption?.classList.remove('bg-gray-700', 'text-white');

  // Restore FAB visibility if a list or recommendations is selected
  const fab = document.getElementById('addAlbumFAB');
  if (fab && (currentListId || currentRecommendationsYear)) {
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

async function updatePlaylist(listId, listData = null) {
  if (!musicServicesModule) {
    showToast('Loading playlist integration...', 'info', 1000);
    musicServicesModule = await import('./modules/music-services.js');
  }
  // If listData not provided, get it from global lists
  const data = listData !== null ? listData : getListData(listId) || [];
  // Get list name for display in music service
  const meta = getListMetadata(listId);
  const listName = meta?.name || listId;
  return musicServicesModule.updatePlaylist(listName, data);
}
window.updatePlaylist = updatePlaylist;

// Make showToast globally available
window.showToast = showToast;

// Make reasoning modal available globally (for musicbrainz.js and context menus)
window.showReasoningModal = showReasoningModal;

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
      // Try to parse error response body for additional details
      let errorData = null;
      try {
        errorData = await response.json();
      } catch (_parseErr) {
        // Response body wasn't JSON, continue with generic error
      }

      const error = new Error(
        errorData?.error || `HTTP error! status: ${response.status}`
      );
      error.response = response;
      error.status = response.status;
      // Spread error data onto the error object for easy access
      if (errorData) {
        Object.assign(error, errorData);
      }
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
    // OPTIMIZATION: Determine which list to load (now by ID)
    const localLastListId = localStorage.getItem('lastSelectedList');
    const serverLastListId = window.lastSelectedList;
    const targetListId = localLastListId || serverLastListId;

    // OPTIMIZATION: Parallel execution - fetch metadata, groups, and target list simultaneously
    // This dramatically improves page refresh performance by:
    // 1. Loading only metadata (tiny payload) for the sidebar
    // 2. Loading groups (tiny payload) for sidebar organization
    // 3. Loading the target list data in parallel (only what's needed)
    const metadataPromise = apiCall('/api/lists'); // Metadata only (default)
    const groupsPromise = apiCall('/api/groups'); // Groups for sidebar
    const listDataPromise = targetListId
      ? apiCall(`/api/lists/${encodeURIComponent(targetListId)}`)
      : null;

    // Wait for metadata and groups (fast - small payloads)
    const [fetchedLists, fetchedGroups] = await Promise.all([
      metadataPromise,
      groupsPromise,
    ]);

    // Initialize groups object
    // Structure: { _id, name, year, sortOrder, listCount, isYearGroup }
    groups = {};
    fetchedGroups.forEach((group) => {
      groups[group._id] = {
        _id: group._id,
        name: group.name,
        year: group.year,
        sortOrder: group.sortOrder,
        listCount: group.listCount,
        isYearGroup: group.isYearGroup,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
      };
    });
    window.groups = groups;

    // Initialize lists object with metadata objects (keyed by _id, not name)
    // Structure: { _id, name, year, isMain, count, groupId, sortOrder, _data, updatedAt, createdAt }
    lists = {};
    Object.keys(fetchedLists).forEach((listId) => {
      const meta = fetchedLists[listId];
      lists[listId] = {
        _id: listId,
        name: meta.name || 'Unknown',
        year: meta.year || null,
        isMain: meta.isMain || false,
        count: meta.count || 0,
        groupId: meta.groupId || null,
        sortOrder: meta.sortOrder || 0,
        _data: null, // Data not loaded yet (lazy load)
        updatedAt: meta.updatedAt || null,
        createdAt: meta.createdAt || null,
      };
    });
    window.lists = lists;

    // Load snapshots from localStorage for all lists (enables PATCH on first save after page load)
    Object.keys(lists).forEach((listId) => {
      const snapshot = loadSnapshotFromStorage(listId);
      if (snapshot && snapshot.length > 0) {
        lastSavedSnapshots.set(listId, snapshot);
      }
    });

    // Update navigation immediately - sidebar appears right away
    updateListNav();

    // If we're loading a specific list, wait for it and display
    if (listDataPromise && targetListId) {
      try {
        const listData = await listDataPromise;
        // Store the actual data in the metadata object
        setListData(targetListId, listData);

        // Only auto-select if no list is currently selected
        if (!currentListId) {
          selectList(targetListId);
          // Sync localStorage if we used server preference
          if (!localLastListId && serverLastListId) {
            try {
              localStorage.setItem('lastSelectedList', serverLastListId);
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

// Import list with full data support (track picks, summaries, metadata)
// @param {string} name - List name
// @param {Array} albums - Album array
// @param {Object|null} metadata - Optional metadata from export (year, groupId, groupName)
// @returns {string} - The created list ID
async function importList(name, albums, metadata = null) {
  try {
    // Extract year and groupId from metadata
    let year = undefined;
    let groupId = null;

    if (metadata) {
      // Prefer year from metadata, or derive from group if it's a year-group
      if (metadata.year !== null && metadata.year !== undefined) {
        year = metadata.year;
      }
      // groupId will be resolved on the server side based on group_id or year
      if (metadata.group_id) {
        groupId = metadata.group_id;
      }
    }

    // Clean albums data (remove rank/points, keep everything else)
    const cleanedAlbums = albums.map((album) => {
      const cleaned = { ...album };
      delete cleaned.points;
      delete cleaned.rank;
      delete cleaned._id; // Remove list item ID (will be regenerated)
      return cleaned;
    });

    // Create the list using the new POST /api/lists endpoint
    const body = { name, data: cleanedAlbums };
    if (year !== undefined) {
      body.year = year;
    }
    if (groupId) {
      body.groupId = groupId;
    }

    const createResult = await apiCall('/api/lists', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const listId = createResult._id;

    // Fetch the saved list to get list item IDs (needed for track picks API)
    const savedList = await apiCall(`/api/lists/${encodeURIComponent(listId)}`);

    // Add the new list to in-memory lists object
    lists[listId] = {
      _id: listId,
      name: name,
      year: year || null,
      isMain: false,
      count: savedList.length,
      groupId: groupId,
      sortOrder: 0,
      _data: savedList,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    window.lists = lists;

    // Build a map from album_id to list_item_id for track picks
    const albumToListItemMap = new Map();
    for (const item of savedList) {
      if (item.album_id && item._id) {
        albumToListItemMap.set(item.album_id, item._id);
      }
    }

    // Import track picks and summaries for each album
    let trackPicksImported = 0;
    let summariesImported = 0;

    for (const album of albums) {
      const albumId = album.album_id;
      if (!albumId) continue;

      // Import track picks (primary_track, secondary_track)
      // Track picks now use list item ID, not album ID
      const listItemId = albumToListItemMap.get(albumId);
      if (listItemId && (album.primary_track || album.secondary_track)) {
        try {
          // Set primary track if present
          if (album.primary_track) {
            await apiCall(`/api/track-picks/${listItemId}`, {
              method: 'POST',
              body: JSON.stringify({
                trackIdentifier: album.primary_track,
                priority: 1,
              }),
            });
            trackPicksImported++;
          }
          // Set secondary track if present
          if (album.secondary_track) {
            await apiCall(`/api/track-picks/${listItemId}`, {
              method: 'POST',
              body: JSON.stringify({
                trackIdentifier: album.secondary_track,
                priority: 2,
              }),
            });
            trackPicksImported++;
          }
        } catch (err) {
          console.warn(
            'Failed to import track picks for list item',
            listItemId,
            err
          );
        }
      }

      // Import summary fields if present (still uses album_id)
      if (album.summary || album.summary_source) {
        try {
          await apiCall(`/api/albums/${albumId}/summary`, {
            method: 'PUT',
            body: JSON.stringify({
              summary: album.summary || '',
              summary_source: album.summary_source || '',
            }),
          });
          summariesImported++;
        } catch (err) {
          console.warn('Failed to import summary for album', albumId, err);
        }
      }
    }

    // Refresh mobile bar visibility if this is the current list
    if (listId === currentListId && window.refreshMobileBarVisibility) {
      window.refreshMobileBarVisibility();
    }

    if (trackPicksImported > 0 || summariesImported > 0) {
      console.log(
        `Imported ${trackPicksImported} track picks and ${summariesImported} summaries`
      );
    }

    return listId;
  } catch (error) {
    showToast('Error importing list', 'error');
    throw error;
  }
}

// Store snapshots of last saved state for diff-based saves
// Key: listId, Value: Array of album_ids in order
const lastSavedSnapshots = new Map();

/**
 * Create a lightweight snapshot of album IDs for diff comparison
 * @param {Array} albums - Album array
 * @returns {Array} Array of album_id strings
 */
function createListSnapshot(albums) {
  if (!albums || !Array.isArray(albums)) return [];
  return albums.map((a) => a.album_id || a.albumId || null).filter(Boolean);
}

/**
 * Save snapshot to localStorage for persistence across page reloads
 * @param {string} listId - The list ID
 * @param {Array} snapshot - Array of album IDs
 */
function saveSnapshotToStorage(listId, snapshot) {
  if (!listId || !snapshot) return;
  try {
    const key = `list-snapshot-${listId}`;
    localStorage.setItem(key, JSON.stringify(snapshot));
  } catch (_e) {
    // Silently fail if localStorage is full or unavailable
    console.warn('Failed to save snapshot to localStorage:', _e.message);
  }
}

/**
 * Load snapshot from localStorage
 * @param {string} listId - The list ID
 * @returns {Array|null} Array of album IDs or null if not found
 */
function loadSnapshotFromStorage(listId) {
  if (!listId) return null;
  try {
    const key = `list-snapshot-${listId}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      const snapshot = JSON.parse(stored);
      return Array.isArray(snapshot) ? snapshot : null;
    }
  } catch (_e) {
    // Silently fail if localStorage is unavailable or data is corrupted
    console.warn('Failed to load snapshot from localStorage:', _e.message);
  }
  return null;
}

/**
 * Clear snapshot from localStorage (e.g., when list is deleted)
 * @param {string} listId - The list ID
 */
function clearSnapshotFromStorage(listId) {
  if (!listId) return;
  try {
    const key = `list-snapshot-${listId}`;
    localStorage.removeItem(key);
  } catch (_e) {
    // Silently fail
  }
}

/**
 * Compute diff between old and new list states
 * Returns null if diff is too complex for incremental update
 * @param {Array} oldSnapshot - Previous album_id array
 * @param {Array} newData - New album array
 * @returns {Object|null} Diff object with added/removed/updated arrays, or null
 */
function computeListDiff(oldSnapshot, newData) {
  if (!oldSnapshot || oldSnapshot.length === 0) {
    // No previous snapshot - can't compute diff
    return null;
  }

  const newSnapshot = createListSnapshot(newData);
  const oldSet = new Set(oldSnapshot);
  const newSet = new Set(newSnapshot);

  // Find removed albums (in old but not in new)
  const removed = oldSnapshot.filter((id) => !newSet.has(id));

  // Find added albums (in new but not in old)
  const added = newData.filter((album) => {
    const id = album.album_id || album.albumId;
    return id && !oldSet.has(id);
  });

  // Find position changes for existing albums
  const updated = [];
  newData.forEach((album, newIndex) => {
    const id = album.album_id || album.albumId;
    if (id && oldSet.has(id)) {
      const oldIndex = oldSnapshot.indexOf(id);
      if (oldIndex !== newIndex) {
        updated.push({
          album_id: id,
          position: newIndex + 1,
        });
      }
    }
  });

  // Calculate total changes
  const totalChanges = removed.length + added.length + updated.length;

  // If too many changes, fall back to full save
  // Threshold: more than 50% of list changed or more than 20 individual changes
  const threshold = Math.max(20, Math.floor(oldSnapshot.length * 0.5));
  if (totalChanges > threshold) {
    return null;
  }

  // Prepare added items with position
  const addedWithPosition = added.map((album) => {
    const newIndex = newData.findIndex(
      (a) => (a.album_id || a.albumId) === (album.album_id || album.albumId)
    );
    return {
      ...album,
      position: newIndex + 1,
    };
  });

  return {
    added: addedWithPosition,
    removed,
    updated,
    totalChanges,
  };
}

// Save list to server
// @param {string} listId - List ID
// @param {Array} data - Album array
// @param {number|null} year - Optional year for the list (required for new lists)
async function saveList(listId, data, year = undefined) {
  try {
    const cleanedData = data.map((album) => {
      const cleaned = { ...album };
      delete cleaned.points;
      delete cleaned.rank;
      return cleaned;
    });

    // Mark this as a local save BEFORE the API call to prevent race condition
    // The WebSocket broadcast can arrive before the HTTP response
    markLocalSave(listId);

    // Try incremental save if we have a previous snapshot
    const oldSnapshot = lastSavedSnapshots.get(listId);
    const diff = computeListDiff(oldSnapshot, cleanedData);

    if (diff && diff.totalChanges > 0) {
      // Use incremental endpoint (now ID-based)
      const result = await apiCall(
        `/api/lists/${encodeURIComponent(listId)}/items`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            added: diff.added,
            removed: diff.removed,
            updated: diff.updated,
          }),
        }
      );

      // Update local items with server-generated IDs for newly added items
      if (result.addedItems && result.addedItems.length > 0) {
        for (const added of result.addedItems) {
          const localItem = cleanedData.find(
            (a) => a.album_id === added.album_id
          );
          if (localItem && !localItem._id) {
            localItem._id = added._id;
          }
        }
      }

      const listName = lists[listId]?.name || listId;
      console.log(
        `List "${listName}" saved incrementally: +${diff.added.length} -${diff.removed.length} ~${diff.updated.length}`
      );
    } else {
      // Fall back to full save using PUT (update items only)
      const body = { data: cleanedData };

      await apiCall(`/api/lists/${encodeURIComponent(listId)}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
    }

    // Update snapshot after successful save (persist to localStorage)
    const snapshot = createListSnapshot(cleanedData);
    lastSavedSnapshots.set(listId, snapshot);
    saveSnapshotToStorage(listId, snapshot);

    // Update in-memory list data using helper (preserves metadata)
    setListData(listId, cleanedData);

    // Update year in metadata if provided
    if (year !== undefined) {
      updateListMetadata(listId, { year: year });
    }

    // Refresh mobile bar visibility if this is the current list
    // (albums may have been added/removed, affecting whether current track is in list)
    if (listId === currentListId && window.refreshMobileBarVisibility) {
      window.refreshMobileBarVisibility();
    }
  } catch (error) {
    showToast('Error saving list', 'error');
    throw error;
  }
}
// Expose saveList for other modules
window.saveList = saveList;

// Expose snapshot management functions for other modules
window.clearSnapshotFromStorage = clearSnapshotFromStorage;

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

// formatTrackTime is imported from ./modules/time-utils.js

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

function updateMobileHeader() {
  const headerContainer = document.getElementById('dynamicHeader');
  if (headerContainer && window.currentUser) {
    headerContainer.innerHTML = window.headerComponent(
      window.currentUser,
      'home',
      currentListId || ''
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
    const albumsForEdit = getListData(currentListId);
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
    const albumsForRemove = getListData(currentListId);
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
          const albumsToModify = getListData(currentListId);
          if (!albumsToModify) {
            showToast('Error: List data not found', 'error');
            return;
          }
          albumsToModify.splice(indexToRemove, 1);

          // Save to server
          await saveList(currentListId, albumsToModify);

          // Update display
          selectList(currentListId);

          showToast(`Removed "${album.album}" from the list`);
        } catch (error) {
          console.error('Error removing album:', error);
          showToast('Error removing album', 'error');

          // Reload the list to ensure consistency
          await loadLists();
          selectList(currentListId);
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

  // Handle recommend option click
  const recommendOption = document.getElementById('recommendAlbumOption');
  if (recommendOption) {
    recommendOption.onclick = async () => {
      contextMenu.classList.add('hidden');

      // Get the album from the currently selected context
      const albumsData = getListData(currentListId);
      let album = albumsData && albumsData[currentContextAlbum];

      if (album && currentContextAlbumId) {
        const expectedId =
          `${album.artist}::${album.album}::${album.release_date || ''}`.toLowerCase();
        if (expectedId !== currentContextAlbumId) {
          const result = findAlbumByIdentity(currentContextAlbumId);
          if (result) album = result.album;
        }
      }

      if (!album || !album.artist || !album.album) {
        showToast('Could not find album data', 'error');
        currentContextAlbum = null;
        currentContextAlbumId = null;
        return;
      }

      // Get the year from the current list metadata
      const listMeta = lists[currentListId];
      const year = listMeta?.year;

      if (!year) {
        showToast('Cannot recommend from a list without a year', 'error');
        currentContextAlbum = null;
        currentContextAlbumId = null;
        return;
      }

      // Show reasoning modal
      const reasoning = await showReasoningModal(album, year);
      if (!reasoning) {
        // User cancelled
        currentContextAlbum = null;
        currentContextAlbumId = null;
        return;
      }

      try {
        const response = await apiCall(`/api/recommendations/${year}`, {
          method: 'POST',
          body: JSON.stringify({ album, reasoning }),
        });

        if (response.error) {
          showToast(response.error, 'info');
        } else {
          showToast(
            `Recommended "${album.album}" by ${album.artist}`,
            'success'
          );
        }
      } catch (err) {
        // Check if it's an "already recommended" error
        if (err.status === 409) {
          const data = (await err.json?.()) || {};
          showToast(data.error || 'This album was already recommended', 'info');
        } else if (err.status === 403) {
          showToast('Recommendations are locked for this year', 'error');
        } else {
          showToast('Error adding recommendation', 'error');
        }
      }

      currentContextAlbum = null;
      currentContextAlbumId = null;
    };
  }

  // Handle Last.fm discovery options
  const similarOption = document.getElementById('similarArtistsOption');

  if (similarOption) {
    similarOption.onclick = () => {
      contextMenu.classList.add('hidden');

      // Get the artist name from the currently selected album
      const albumsData = getListData(currentListId);
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

  // Handle re-identify album option (admin only)
  const reidentifyOption = document.getElementById('reidentifyAlbumOption');

  if (reidentifyOption) {
    reidentifyOption.onclick = async () => {
      contextMenu.classList.add('hidden');

      // Get the album from the currently selected context
      const albumsData = getListData(currentListId);
      let album = albumsData && albumsData[currentContextAlbum];

      if (album && currentContextAlbumId) {
        const expectedId =
          `${album.artist}::${album.album}::${album.release_date || ''}`.toLowerCase();
        if (expectedId !== currentContextAlbumId) {
          const result = findAlbumByIdentity(currentContextAlbumId);
          if (result) album = result.album;
        }
      }

      if (!album || !album.artist || !album.album) {
        showToast('Could not find album data', 'error');
        currentContextAlbum = null;
        currentContextAlbumId = null;
        return;
      }

      // Show release selection modal
      showReleaseSelectionModal(album);

      currentContextAlbum = null;
      currentContextAlbumId = null;
    };
  }
}

// Show release selection modal for admin re-identification
async function showReleaseSelectionModal(album) {
  const modal = document.getElementById('releaseSelectionModal');
  const subtitle = document.getElementById('releaseSelectionSubtitle');
  const loading = document.getElementById('releaseSelectionLoading');
  const candidatesContainer = document.getElementById(
    'releaseSelectionCandidates'
  );
  const errorContainer = document.getElementById('releaseSelectionError');
  const confirmBtn = document.getElementById('releaseSelectionConfirmBtn');
  const cancelBtn = document.getElementById('releaseSelectionCancelBtn');

  if (!modal) return;

  // Reset state
  subtitle.textContent = `${album.album} by ${album.artist}`;
  loading.classList.remove('hidden');
  candidatesContainer.classList.add('hidden');
  candidatesContainer.innerHTML = '';
  errorContainer.classList.add('hidden');
  confirmBtn.disabled = true;

  let selectedReleaseId = null;
  let cleanup = null;

  // Show modal
  modal.classList.remove('hidden');

  // Setup event handlers
  const handleCancel = () => {
    modal.classList.add('hidden');
    if (cleanup) cleanup();
  };

  const handleBackdropClick = (e) => {
    if (e.target === modal) handleCancel();
  };

  const handleEscKey = (e) => {
    if (e.key === 'Escape') handleCancel();
  };

  const handleConfirm = async () => {
    if (!selectedReleaseId) return;

    confirmBtn.disabled = true;
    confirmBtn.innerHTML =
      '<i class="fas fa-spinner fa-spin mr-2"></i>Applying...';

    try {
      const response = await fetch('/api/admin/album/reidentify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          artist: album.artist,
          album: album.album,
          currentAlbumId: album.album_id,
          newAlbumId: selectedReleaseId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Re-identification failed');
      }

      modal.classList.add('hidden');
      if (cleanup) cleanup();

      if (data.changed) {
        showToast(`Updated with ${data.trackCount} tracks`, 'success');
        // Reload the list to get updated track data
        await loadLists();
        selectList(currentListId);
      } else {
        showToast(data.message || 'No changes made');
      }
    } catch (error) {
      console.error('Error applying re-identification:', error);
      showToast(`Error: ${error.message}`, 'error');
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Apply Selection';
    }
  };

  cleanup = () => {
    cancelBtn.removeEventListener('click', handleCancel);
    confirmBtn.removeEventListener('click', handleConfirm);
    modal.removeEventListener('click', handleBackdropClick);
    document.removeEventListener('keydown', handleEscKey);
  };

  cancelBtn.addEventListener('click', handleCancel);
  confirmBtn.addEventListener('click', handleConfirm);
  modal.addEventListener('click', handleBackdropClick);
  document.addEventListener('keydown', handleEscKey);

  // Fetch candidates
  try {
    const response = await fetch('/api/admin/album/reidentify/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        artist: album.artist,
        album: album.album,
        currentAlbumId: album.album_id,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Search failed');
    }

    loading.classList.add('hidden');

    if (!data.candidates || data.candidates.length === 0) {
      errorContainer.querySelector('p').textContent =
        'No matching releases found on MusicBrainz';
      errorContainer.classList.remove('hidden');
      return;
    }

    // Render candidates
    candidatesContainer.innerHTML = data.candidates
      .map(
        (candidate) => `
      <label class="release-candidate flex items-center gap-4 p-3 bg-gray-800 rounded-lg cursor-pointer hover:bg-gray-750 border-2 ${candidate.isCurrent ? 'border-yellow-500' : 'border-transparent'} transition-colors">
        <input type="radio" name="releaseCandidate" value="${candidate.id}" class="hidden" ${candidate.isCurrent ? 'checked' : ''}>
        <div class="flex-shrink-0 w-16 h-16 bg-gray-700 rounded overflow-hidden">
          ${
            candidate.coverUrl
              ? `<img src="${candidate.coverUrl}" alt="" class="w-full h-full object-cover" onerror="this.parentElement.innerHTML='<div class=\\'w-full h-full flex items-center justify-center text-gray-500\\'><i class=\\'fas fa-compact-disc text-2xl\\'></i></div>'">`
              : `<div class="w-full h-full flex items-center justify-center text-gray-500"><i class="fas fa-compact-disc text-2xl"></i></div>`
          }
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="font-medium text-white truncate">${candidate.title}</span>
            ${candidate.isCurrent ? '<span class="text-xs bg-yellow-500 text-black px-1.5 py-0.5 rounded">Current</span>' : ''}
          </div>
          <div class="text-sm text-gray-400 truncate">${candidate.artist}</div>
          <div class="flex items-center gap-3 mt-1 text-xs text-gray-500">
            <span class="inline-flex items-center gap-1">
              <i class="fas fa-tag"></i>${candidate.type}${candidate.secondaryTypes?.length ? ' + ' + candidate.secondaryTypes.join(', ') : ''}
            </span>
            ${candidate.trackCount ? `<span class="inline-flex items-center gap-1"><i class="fas fa-music"></i>${candidate.trackCount} tracks</span>` : ''}
            ${candidate.releaseDate ? `<span class="inline-flex items-center gap-1"><i class="fas fa-calendar"></i>${candidate.releaseDate}</span>` : ''}
          </div>
        </div>
        <div class="flex-shrink-0 w-6 h-6 rounded-full border-2 border-gray-600 flex items-center justify-center release-radio">
          <div class="w-3 h-3 rounded-full bg-yellow-500 hidden"></div>
        </div>
      </label>
    `
      )
      .join('');

    candidatesContainer.classList.remove('hidden');

    // Handle selection
    const radioInputs = candidatesContainer.querySelectorAll(
      'input[name="releaseCandidate"]'
    );
    const updateSelection = () => {
      radioInputs.forEach((input) => {
        const label = input.closest('label');
        const radioIndicator = label.querySelector('.release-radio div');
        if (input.checked) {
          label.classList.add('border-yellow-500');
          radioIndicator.classList.remove('hidden');
          selectedReleaseId = input.value;
        } else {
          label.classList.remove('border-yellow-500');
          radioIndicator.classList.add('hidden');
        }
      });
      confirmBtn.disabled = !selectedReleaseId;
      confirmBtn.textContent = 'Apply Selection';
    };

    radioInputs.forEach((input) => {
      input.addEventListener('change', updateSelection);
    });

    // Initialize with current selection
    const currentlySelected = candidatesContainer.querySelector(
      'input[name="releaseCandidate"]:checked'
    );
    if (currentlySelected) {
      selectedReleaseId = currentlySelected.value;
      updateSelection();
    }
  } catch (error) {
    console.error('Error fetching release candidates:', error);
    loading.classList.add('hidden');
    errorContainer.querySelector('p').textContent = error.message;
    errorContainer.classList.remove('hidden');
  }
}

// Initialize category (group) context menu
function initializeCategoryContextMenu() {
  const contextMenu = document.getElementById('categoryContextMenu');
  const renameOption = document.getElementById('renameCategoryOption');
  const deleteOption = document.getElementById('deleteCategoryOption');

  if (!contextMenu || !renameOption || !deleteOption) return;

  // Handle rename option click
  renameOption.onclick = () => {
    contextMenu.classList.add('hidden');

    if (!currentContextGroup) return;

    const { id, name, isYearGroup } = currentContextGroup;

    // Virtual "Uncategorized" group (orphaned lists) can't be renamed
    if (id === 'orphaned') {
      showToast('The "Uncategorized" section cannot be renamed', 'info');
      return;
    }

    // Year groups can't be renamed (name must match year)
    if (isYearGroup) {
      showToast(
        'Year groups cannot be renamed. The name matches the year.',
        'info'
      );
      return;
    }

    openRenameCategoryModal(id, name);
  };

  // Handle delete option click
  deleteOption.onclick = async () => {
    contextMenu.classList.add('hidden');

    if (!currentContextGroup) return;

    const { id, name, isYearGroup } = currentContextGroup;

    // Year groups can't be deleted manually
    if (isYearGroup) {
      showToast('Year groups are removed automatically when empty', 'info');
      currentContextGroup = null;
      return;
    }

    // Virtual "Uncategorized" group (orphaned lists) can't be deleted
    if (id === 'orphaned') {
      showToast('The "Uncategorized" section cannot be deleted', 'info');
      currentContextGroup = null;
      return;
    }

    try {
      // First try to delete - API will return 409 if collection has lists
      await apiCall(`/api/groups/${id}`, { method: 'DELETE' });
      showToast(`Collection "${name}" deleted`);
      await refreshGroupsAndLists();
    } catch (error) {
      // Check if this is a "has lists" conflict that needs confirmation
      if (error.requiresConfirmation && error.listCount > 0) {
        const listWord = error.listCount === 1 ? 'list' : 'lists';
        const confirmed = await showConfirmation(
          'Delete Collection',
          `The collection "${name}" contains ${error.listCount} ${listWord}.`,
          `Deleting this collection will move the ${listWord} to "Uncategorized". This action cannot be undone.`,
          'Delete Collection',
          null,
          {
            checkboxLabel: `I understand that ${error.listCount} ${listWord} will be moved to "Uncategorized"`,
          }
        );

        if (confirmed) {
          try {
            // Force delete with confirmation
            await apiCall(`/api/groups/${id}?force=true`, { method: 'DELETE' });
            showToast(`Collection "${name}" deleted`);
            await refreshGroupsAndLists();
          } catch (forceError) {
            console.error('Error force-deleting collection:', forceError);
            showToast(
              forceError.message || 'Failed to delete collection',
              'error'
            );
          }
        }
      } else {
        console.error('Error deleting collection:', error);
        showToast(error.message || 'Failed to delete collection', 'error');
      }
    }

    currentContextGroup = null;
  };

  // Hide context menu when clicking outside
  document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target)) {
      contextMenu.classList.add('hidden');
    }
  });
}

// Open rename category modal
function openRenameCategoryModal(groupId, currentName) {
  // Escape HTML for safe insertion
  const escapedName = currentName
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  // Use the existing confirmation modal pattern with an input
  const modal = document.createElement('div');
  modal.className =
    'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 safe-area-modal';
  modal.id = 'renameCategoryModal';
  modal.innerHTML = `
    <div class="bg-gray-900 border border-gray-800 rounded-lg shadow-2xl w-full max-w-md">
      <div class="p-6 border-b border-gray-800">
        <h3 class="text-xl font-bold text-white">Rename Category</h3>
      </div>
      <div class="p-6">
        <label class="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">
          New Name
        </label>
        <input 
          type="text" 
          id="newCategoryName" 
          value="${escapedName}"
          class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-sm text-white placeholder-gray-500 focus:outline-hidden focus:border-gray-500 transition duration-200"
          maxlength="50"
          autofocus
        >
        <p id="renameCategoryError" class="text-xs text-red-500 mt-2 hidden"></p>
      </div>
      <div class="p-6 border-t border-gray-800 flex gap-3 justify-end">
        <button id="cancelRenameCategoryBtn" class="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-sm transition duration-200">
          Cancel
        </button>
        <button id="confirmRenameCategoryBtn" class="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-sm transition duration-200">
          Rename
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const input = modal.querySelector('#newCategoryName');
  const errorEl = modal.querySelector('#renameCategoryError');
  const cancelBtn = modal.querySelector('#cancelRenameCategoryBtn');
  const confirmBtn = modal.querySelector('#confirmRenameCategoryBtn');

  // Focus and select all text
  setTimeout(() => {
    input.focus();
    input.select();
  }, 50);

  const closeModal = () => {
    modal.remove();
  };

  const doRename = async () => {
    const newName = input.value.trim();

    if (!newName) {
      errorEl.textContent = 'Name is required';
      errorEl.classList.remove('hidden');
      return;
    }

    if (newName === currentName) {
      closeModal();
      return;
    }

    try {
      await apiCall(`/api/groups/${groupId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: newName }),
      });

      showToast(`Category renamed to "${newName}"`);
      closeModal();

      // Refresh groups and lists
      await refreshGroupsAndLists();
    } catch (error) {
      console.error('Error renaming category:', error);
      errorEl.textContent = error.message || 'Failed to rename category';
      errorEl.classList.remove('hidden');
    }
  };

  cancelBtn.onclick = closeModal;
  confirmBtn.onclick = doRename;

  // Handle enter key
  input.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doRename();
    } else if (e.key === 'Escape') {
      closeModal();
    }
  };

  // Close on backdrop click
  modal.onclick = (e) => {
    if (e.target === modal) {
      closeModal();
    }
  };
}

// Expose openRenameCategoryModal to window for mobile-ui.js access
window.openRenameCategoryModal = openRenameCategoryModal;

// Track the currently highlighted year in the move submenu
let currentHighlightedYear = null;
let moveListsHideTimeout = null;

// Group lists by year for the move submenu (only lists with years, excluding current list)
function groupListsForMove() {
  const listsByYear = {};

  Object.keys(lists).forEach((listName) => {
    // Skip current list
    if (listName === currentListId) return;

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

// Group user's lists by year for add-to-list from recommendations
function groupUserListsForAdd() {
  const listsByYear = {};

  Object.keys(lists).forEach((listId) => {
    const meta = lists[listId];
    const year = meta?.year;

    // Only include lists that have a year (no collections)
    if (year) {
      if (!listsByYear[year]) {
        listsByYear[year] = [];
      }
      listsByYear[year].push(listId);
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
      (listId) => `
      <button class="block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap w-full" data-target-list="${listId}">
        <span class="mr-2">•</span>${lists[listId]?.name || listId}
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

  const albumsForPlay = getListData(currentListId);
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
  const albumsForPlay = getListData(currentListId);
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
  const albums = getListData(currentListId);
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
  const albums = getListData(currentListId);
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
  const albums = getListData(currentListId);
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
  const categorySelect = document.getElementById('newListCategory');
  const cancelBtn = document.getElementById('cancelCreateBtn');
  const confirmBtn = document.getElementById('confirmCreateBtn');
  const categoryError = document.getElementById('createCategoryError');

  // Dynamic input containers
  const newYearContainer = document.getElementById('newYearInputContainer');
  const newYearInput = document.getElementById('newYearInput');
  const newCollectionContainer = document.getElementById(
    'newCollectionInputContainer'
  );
  const newCollectionInput = document.getElementById('newCollectionInput');

  if (!createBtn || !modal) return;

  /**
   * Populate the category dropdown with years and collections
   */
  function populateCategoryDropdown() {
    const sortedGroups = getSortedGroups();

    // Separate into years and collections
    const yearGroups = sortedGroups.filter((g) => g.isYearGroup);
    const collections = sortedGroups.filter((g) => !g.isYearGroup);

    // Sort years descending (most recent first)
    yearGroups.sort((a, b) => (b.year || 0) - (a.year || 0));

    // Build dropdown HTML
    let html =
      '<option value="" disabled selected>Select a category...</option>';

    // Years section
    html += '<optgroup label="Years">';
    for (const group of yearGroups) {
      html += `<option value="year:${group._id}">${group.name}</option>`;
    }
    html += '<option value="new-year">+ New year...</option>';
    html += '</optgroup>';

    // Collections section
    html += '<optgroup label="Collections">';
    for (const group of collections) {
      html += `<option value="collection:${group._id}">${group.name}</option>`;
    }
    html += '<option value="new-collection">+ New collection...</option>';
    html += '</optgroup>';

    categorySelect.innerHTML = html;
  }

  /**
   * Handle category selection change
   */
  function handleCategoryChange() {
    const value = categorySelect.value;

    // Hide both dynamic inputs
    newYearContainer.classList.add('hidden');
    newCollectionContainer.classList.add('hidden');
    if (categoryError) categoryError.classList.add('hidden');

    if (value === 'new-year') {
      newYearContainer.classList.remove('hidden');
      newYearInput.value = '';
      newYearInput.focus();
    } else if (value === 'new-collection') {
      newCollectionContainer.classList.remove('hidden');
      newCollectionInput.value = '';
      newCollectionInput.focus();
    }
  }

  categorySelect.addEventListener('change', handleCategoryChange);

  // Open modal
  createBtn.onclick = () => {
    populateCategoryDropdown();
    modal.classList.remove('hidden');
    nameInput.value = '';
    categorySelect.value = '';
    newYearInput.value = '';
    newCollectionInput.value = '';
    newYearContainer.classList.add('hidden');
    newCollectionContainer.classList.add('hidden');
    if (categoryError) categoryError.classList.add('hidden');
    nameInput.focus();
  };

  // Close modal
  const closeModal = () => {
    modal.classList.add('hidden');
    nameInput.value = '';
    categorySelect.value = '';
    newYearInput.value = '';
    newCollectionInput.value = '';
    newYearContainer.classList.add('hidden');
    newCollectionContainer.classList.add('hidden');
    if (categoryError) categoryError.classList.add('hidden');
  };

  cancelBtn.onclick = closeModal;

  // Click outside to close
  modal.onclick = (e) => {
    if (e.target === modal) {
      closeModal();
    }
  };

  /**
   * Validate a year value
   */
  function validateYear(yearValue) {
    if (!yearValue || yearValue === '') {
      return { valid: false, error: 'Year is required' };
    }
    const year = parseInt(yearValue, 10);
    if (!Number.isInteger(year) || year < 1000 || year > 9999) {
      return { valid: false, error: 'Year must be between 1000 and 9999' };
    }
    return { valid: true, value: year };
  }

  /**
   * Show error message
   */
  function showError(message) {
    if (categoryError) {
      categoryError.textContent = message;
      categoryError.classList.remove('hidden');
    }
    showToast(message, 'error');
  }

  // Create list
  const createList = async () => {
    const listName = nameInput.value.trim();
    const categoryValue = categorySelect.value;

    // Validate list name
    if (!listName) {
      showToast('Please enter a list name', 'error');
      nameInput.focus();
      return;
    }

    // Note: Duplicate name checking is now done server-side per group
    // The new unique constraint is (user_id, name, group_id)

    // Validate category selection
    if (!categoryValue) {
      showError('Please select a category');
      categorySelect.focus();
      return;
    }

    if (categoryError) categoryError.classList.add('hidden');

    let year = null;
    let groupId = null;

    try {
      if (categoryValue === 'new-year') {
        // Creating a new year
        const yearValidation = validateYear(newYearInput.value.trim());
        if (!yearValidation.valid) {
          showError(yearValidation.error);
          newYearInput.focus();
          return;
        }
        year = yearValidation.value;
        // Year-group will be auto-created by the backend
      } else if (categoryValue === 'new-collection') {
        // Creating a new collection
        const collectionName = newCollectionInput.value.trim();
        if (!collectionName) {
          showError('Please enter a collection name');
          newCollectionInput.focus();
          return;
        }
        if (/^\d{4}$/.test(collectionName)) {
          showError('Collection name cannot be a year');
          newCollectionInput.focus();
          return;
        }

        // Create the collection first
        const newGroup = await apiCall('/api/groups', {
          method: 'POST',
          body: JSON.stringify({ name: collectionName }),
        });
        groupId = newGroup._id;
      } else if (categoryValue.startsWith('year:')) {
        // Existing year-group selected
        const selectedGroupId = categoryValue.replace('year:', '');
        const group = getGroup(selectedGroupId);
        if (group) {
          year = group.year;
        }
      } else if (categoryValue.startsWith('collection:')) {
        // Existing collection selected
        groupId = categoryValue.replace('collection:', '');
      }

      // Create the list using the new POST /api/lists endpoint
      const createBody = { name: listName, data: [] };
      if (groupId) {
        createBody.groupId = groupId;
      } else if (year) {
        createBody.year = year;
      } else {
        showError('Invalid category selection');
        return;
      }

      const result = await apiCall('/api/lists', {
        method: 'POST',
        body: JSON.stringify(createBody),
      });

      const newListId = result._id;

      // Refresh groups and lists, update navigation
      await refreshGroupsAndLists();
      updateListNav();

      // Select the new list by ID
      selectList(newListId);

      // Close modal
      closeModal();

      const categoryLabel = year ? `${year}` : 'collection';
      showToast(`Created list "${listName}" in ${categoryLabel}`);
    } catch (err) {
      showError(err.message || 'Error creating list');
    }
  };

  confirmBtn.onclick = createList;

  // Enter key handling
  nameInput.onkeypress = (e) => {
    if (e.key === 'Enter') {
      if (!categorySelect.value) {
        categorySelect.focus();
      } else {
        createList();
      }
    }
  };

  newYearInput.onkeypress = (e) => {
    if (e.key === 'Enter') {
      createList();
    }
  };

  newCollectionInput.onkeypress = (e) => {
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

// Create collection functionality
function initializeCreateCollection() {
  const createBtn = document.getElementById('createCollectionBtn');
  const modal = document.getElementById('createCollectionModal');
  const nameInput = document.getElementById('newCollectionName');
  const cancelBtn = document.getElementById('cancelCreateCollectionBtn');
  const confirmBtn = document.getElementById('confirmCreateCollectionBtn');
  const errorEl = document.getElementById('createCollectionError');

  if (!createBtn || !modal) return;

  // Open modal
  createBtn.onclick = () => {
    modal.classList.remove('hidden');
    nameInput.value = '';
    if (errorEl) errorEl.classList.add('hidden');
    nameInput.focus();
  };

  // Close modal
  const closeModal = () => {
    modal.classList.add('hidden');
    nameInput.value = '';
    if (errorEl) errorEl.classList.add('hidden');
  };

  cancelBtn.onclick = closeModal;

  // Click outside to close
  modal.onclick = (e) => {
    if (e.target === modal) {
      closeModal();
    }
  };

  // Create collection
  const createCollection = async () => {
    const collectionName = nameInput.value.trim();

    if (!collectionName) {
      showToast('Please enter a collection name', 'error');
      nameInput.focus();
      return;
    }

    // Check if name looks like a year
    if (/^\d{4}$/.test(collectionName)) {
      const error = 'Collection name cannot be a year';
      if (errorEl) {
        errorEl.textContent = error;
        errorEl.classList.remove('hidden');
      }
      showToast(error, 'error');
      nameInput.focus();
      return;
    }

    try {
      await apiCall('/api/groups', {
        method: 'POST',
        body: JSON.stringify({ name: collectionName }),
      });

      // Refresh groups and update navigation
      await refreshGroupsAndLists();
      updateListNav();

      closeModal();
      showToast(`Created collection "${collectionName}"`);
    } catch (err) {
      const errorMsg = err.message || 'Error creating collection';
      if (errorEl) {
        errorEl.textContent = errorMsg;
        errorEl.classList.remove('hidden');
      }
      showToast(errorMsg, 'error');
    }
  };

  confirmBtn.onclick = createCollection;

  // Enter key to create
  nameInput.onkeypress = (e) => {
    if (e.key === 'Enter') {
      createCollection();
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
  const _currentNameSpan = document.getElementById('currentListIdName'); // Used in openRenameModal
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
    // Get the list ID from the modal's dataset (set by openRenameModal)
    const listId = modal.dataset.listId;
    if (!listId) {
      showToast('No list selected', 'error');
      return;
    }

    const oldMeta = getListMetadata(listId);
    const oldName = oldMeta?.name || '';
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

    // Check if new name already exists in the same group (only if renaming)
    // The server will do the actual duplicate check, but we can do a quick client-side check
    if (newName !== oldName) {
      const existingWithSameName = findListByName(newName, oldMeta?.groupId);
      if (existingWithSameName && existingWithSameName._id !== listId) {
        showToast(
          'A list with this name already exists in this category',
          'error'
        );
        nameInput.focus();
        return;
      }
    }

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
      if (nameChanged) patchData.name = newName;
      if (yearChanged) patchData.year = yearValidation.value;

      await apiCall(`/api/lists/${encodeURIComponent(listId)}`, {
        method: 'PATCH',
        body: JSON.stringify(patchData),
      });

      // Update local state (lists remain keyed by ID)
      if (lists[listId]) {
        if (nameChanged) {
          lists[listId].name = newName;
        }
        if (yearChanged) {
          lists[listId].year = yearValidation.value;
        }
      }

      updateListNav();

      // Refresh display if current list was modified
      if (currentListId === listId) {
        // Re-select to update any displayed name
        selectList(listId);
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
function openRenameModal(listId) {
  const modal = document.getElementById('renameListModal');
  const currentNameSpan = document.getElementById('currentListIdName');
  const nameInput = document.getElementById('newListNameInput');
  const yearInput = document.getElementById('editListYear');
  const yearError = document.getElementById('editYearError');

  if (!modal || !currentNameSpan || !nameInput) return;

  // Get metadata to display the list name
  const meta = getListMetadata(listId);
  const listName = meta?.name || listId;

  currentNameSpan.textContent = listName;
  nameInput.value = listName;

  // Store the list ID for the save handler
  modal.dataset.listId = listId;

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

// Select and display a list by ID
async function selectList(listId) {
  try {
    // Track previous list for realtime sync unsubscription
    const previousListId = currentListId;

    currentListId = listId;
    // Clear recommendations state when selecting a regular list
    currentRecommendationsYear = null;
    window.currentRecommendationsYear = null;

    // Update realtime sync subscriptions
    if (realtimeSyncModule) {
      if (previousListId && previousListId !== listId) {
        realtimeSyncModule.unsubscribeFromList(previousListId);
      }
      if (listId) {
        realtimeSyncModule.subscribeToList(listId);
      }
    }

    // Clear playcount cache when switching lists (playcounts are list-item specific)
    clearPlaycountCache();

    // Get the list name for display purposes
    const listName = lists[listId]?.name || '';

    // === IMMEDIATE UI UPDATES (before network call) ===
    // Update active state in sidebar immediately (optimized - no full rebuild)
    updateListNavActiveState(listId);

    // Update the header title immediately
    updateHeaderTitle(listName);

    // Update the header with current list name (moved here - doesn't depend on fetched data)
    updateMobileHeader();

    // Show/hide FAB based on whether a list is selected (mobile only)
    const fab = document.getElementById('addAlbumFAB');
    if (fab) {
      fab.style.display = listId ? 'flex' : 'none';
    }

    // Show loading spinner immediately to provide instant visual feedback
    const container = document.getElementById('albumContainer');
    if (container && listId) {
      showLoadingSpinner(container);
    }

    // Save to localStorage immediately (synchronous) - now stores ID
    if (listId) {
      try {
        localStorage.setItem('lastSelectedList', listId);
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
    if (listId) {
      try {
        // Use helper to check if data is loaded
        let data = getListData(listId);

        // OPTIMIZATION: Only fetch if data is missing or not loaded
        // This avoids duplicate fetches when loadLists() already loaded the data
        const needsFetch = !isListDataLoaded(listId);

        if (needsFetch) {
          data = await apiCall(`/api/lists/${encodeURIComponent(listId)}`);
          // Use helper to store data (preserves metadata)
          setListData(listId, data);
        }

        // Display the fetched data with images (single render)
        // Pass forceFullRebuild flag to skip incremental update checks when switching lists
        if (currentListId === listId) {
          displayAlbums(data, { forceFullRebuild: true });
          // Fetch Last.fm playcounts in background (non-blocking)
          if (listId) {
            fetchAndDisplayPlaycounts(listId).catch((err) => {
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

    // Tracks are fetched only when: (1) adding an album, (2) opening the track
    // cell / mobile fetch when tracks are missing. No list-wide pre-fetch.

    // Persist the selection without blocking UI if changed (now by ID)
    if (listId && listId !== window.lastSelectedList) {
      apiCall('/api/user/last-list', {
        method: 'POST',
        body: JSON.stringify({ listId }),
      })
        .then(() => {
          window.lastSelectedList = listId;
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

/**
 * Select and display recommendations for a year
 * @param {number} year - The year to show recommendations for
 */
async function selectRecommendations(year) {
  try {
    // Track previous state
    const previousListId = currentListId;
    const _previousRecommendationsYear = currentRecommendationsYear;

    // Update state
    currentListId = ''; // Clear regular list selection
    currentRecommendationsYear = year;
    window.currentRecommendationsYear = year; // Expose for sidebar active state

    // Update realtime sync subscriptions (unsubscribe from previous list)
    if (realtimeSyncModule && previousListId) {
      realtimeSyncModule.unsubscribeFromList(previousListId);
    }

    // Clear playcount cache when switching
    clearPlaycountCache();

    // === IMMEDIATE UI UPDATES ===
    // Update active state in sidebar
    updateListNavActiveState('', year);

    // Update the header title
    updateHeaderTitle(`${year} Recommendations`);
    updateMobileHeader();

    // Show FAB for adding albums
    const fab = document.getElementById('addAlbumFAB');
    if (fab) {
      fab.style.display = 'flex';
    }

    // Show loading spinner
    const container = document.getElementById('albumContainer');
    if (container) {
      showLoadingSpinner(container);
    }

    // === FETCH AND RENDER DATA ===
    try {
      const response = await apiCall(`/api/recommendations/${year}`);

      // Only update if still viewing this year's recommendations
      if (currentRecommendationsYear === year) {
        displayRecommendations(response.recommendations, year, response.locked);
      }
    } catch (err) {
      console.warn('Failed to fetch recommendations:', err);
      showToast('Error loading recommendations', 'error');
    }
  } catch (_error) {
    showToast('Error loading recommendations', 'error');
  }
}

// Expose selectRecommendations to window
window.selectRecommendations = selectRecommendations;

/**
 * Create mobile recommendation card
 * @param {Object} rec - Recommendation object
 * @param {number} year - Year
 * @param {boolean} locked - Whether recommendations are locked
 * @param {number} index - Index in recommendations array
 * @returns {HTMLElement} Card wrapper element
 */
function createRecommendationCard(rec, year, locked, index) {
  const cardWrapper = document.createElement('div');
  cardWrapper.className = 'album-card-wrapper h-[150px]';

  const card = document.createElement('div');
  card.className = 'album-card album-row relative h-[150px] bg-gray-900';
  card.dataset.albumId = rec.album_id;
  card.dataset.recIndex = index;

  // Format date
  const date = new Date(rec.created_at);
  const formattedDate = date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  // Check if user is owner or admin (used in menu handler)
  const _isOwner = window.currentUser?._id === rec.recommender_id;
  const _isAdmin = window.currentUser?.role === 'admin';
  const hasReasoning = rec.reasoning && rec.reasoning.trim().length > 0;

  card.innerHTML = `
    <div class="flex items-stretch h-full">
      
      <!-- COVER SECTION -->
      <div class="shrink-0 w-[88px] flex flex-col items-center pt-2 pl-1">
        <!-- Album cover -->
        <div class="mobile-album-cover relative w-20 h-20 flex items-center justify-center bg-gray-800 rounded-lg">
          <img src="/api/albums/${encodeURIComponent(rec.album_id)}/cover" 
               alt="${escapeHtml(rec.album)}"
               class="album-cover-blur w-[75px] h-[75px] rounded-lg object-cover"
               loading="lazy" decoding="async"
               onerror="this.parentElement.innerHTML='<div class=\\'w-[75px] h-[75px] rounded-lg bg-gray-800 flex items-center justify-center\\'><i class=\\'fas fa-compact-disc text-xl text-gray-600\\'></i></div>'">
        </div>
        <!-- Date -->
        <div class="flex-1 flex items-center mt-1">
          <span class="text-xs whitespace-nowrap text-gray-500">
            ${formattedDate}
          </span>
        </div>
      </div>
      
      <!-- INFO SECTION -->
      <div class="flex-1 min-w-0 py-1 pl-2 pr-1 flex flex-col justify-between h-[142px]">
        <!-- Album name -->
        <div class="flex items-center">
          <h3 class="font-semibold text-gray-200 text-sm leading-tight truncate">
            <i class="fas fa-compact-disc fa-xs mr-2"></i>${escapeHtml(rec.album)}
          </h3>
        </div>
        <!-- Artist -->
        <div class="flex items-center">
          <p class="text-[13px] text-gray-500 truncate">
            <i class="fas fa-user fa-xs mr-2"></i>
            <span data-field="artist-mobile-text">${escapeHtml(rec.artist)}</span>
          </p>
        </div>
        <!-- Genre -->
        <div class="flex items-center">
          <p class="text-[13px] text-gray-400 truncate">
            <i class="fas fa-tag fa-xs mr-2"></i>
            ${rec.genre_1 ? escapeHtml(rec.genre_1) : ''}${rec.genre_1 && rec.genre_2 ? ', ' : ''}${rec.genre_2 ? escapeHtml(rec.genre_2) : ''}${!rec.genre_1 && !rec.genre_2 ? '<span class="text-gray-600 italic">No genre</span>' : ''}
          </p>
        </div>
        <!-- Recommended by -->
        <div class="flex items-center">
          <span class="text-[13px] text-blue-400 truncate">
            <i class="fas fa-thumbs-up fa-xs mr-2"></i>
            ${escapeHtml(rec.recommended_by)}
          </span>
        </div>
        <!-- View reasoning button -->
        ${
          hasReasoning
            ? `<div class="flex items-center">
            <button class="view-reasoning-mobile-btn text-[13px] text-purple-400 hover:text-purple-300 active:opacity-70 flex items-center gap-1 no-drag">
              <i class="fas fa-comment-alt fa-xs"></i>
              <span>Reason for recommendation</span>
            </button>
          </div>`
            : `<div class="flex items-center">
            <span class="text-[13px] text-gray-600 italic">
              <i class="fas fa-comment-alt fa-xs mr-1"></i>No reason provided
            </span>
          </div>`
        }
        <!-- Spacer -->
        <div class="flex-1"></div>
      </div>
      
      <!-- MENU SECTION -->
      <div class="shrink-0 w-[25px] border-l border-gray-800/50" style="display: flex; align-items: center; justify-content: center;">
        <button data-rec-menu-btn class="no-drag text-gray-400 active:text-gray-200" style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; transform: translateX(7px);">
          <i class="fas fa-ellipsis-v fa-fw"></i>
        </button>
      </div>
      
    </div>
  `;

  cardWrapper.appendChild(card);
  attachRecommendationCardHandlers(card, rec, year, locked);
  return cardWrapper;
}

/**
 * Attach event handlers to mobile recommendation card
 * @param {HTMLElement} card - Card element
 * @param {Object} rec - Recommendation object
 * @param {number} year - Year
 * @param {boolean} locked - Whether recommendations are locked
 */
function attachRecommendationCardHandlers(card, rec, year, locked) {
  // View reasoning button handler
  const viewReasoningBtn = card.querySelector('.view-reasoning-mobile-btn');
  if (viewReasoningBtn) {
    viewReasoningBtn.addEventListener(
      'touchstart',
      (e) => {
        e.stopPropagation();
      },
      { passive: true }
    );

    viewReasoningBtn.addEventListener(
      'touchend',
      (e) => {
        e.stopPropagation();
      },
      { passive: true }
    );

    viewReasoningBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      showViewReasoningModal(rec);
    });
  }

  // Three-dot menu button handler
  const menuBtn = card.querySelector('[data-rec-menu-btn]');
  if (menuBtn) {
    menuBtn.addEventListener(
      'touchstart',
      (e) => {
        e.stopPropagation();
      },
      { passive: true }
    );

    menuBtn.addEventListener(
      'touchend',
      (e) => {
        e.stopPropagation();
      },
      { passive: true }
    );

    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      showMobileRecommendationMenu(rec, year, locked);
    });
  }
}

/**
 * Show mobile bottom sheet menu for recommendation actions
 * @param {Object} rec - Recommendation object
 * @param {number} year - Year
 * @param {boolean} locked - Whether recommendations are locked
 */
function showMobileRecommendationMenu(rec, year, locked) {
  const isOwner = window.currentUser?._id === rec.recommender_id;
  const isAdmin = window.currentUser?.role === 'admin';
  const hasAnyService =
    window.currentUser?.spotifyAuth || window.currentUser?.tidalAuth;
  const hasReasoning = rec.reasoning && rec.reasoning.trim().length > 0;

  const contentHtml = `
        <h3 class="font-semibold text-white mb-1 truncate">${escapeHtml(rec.album)}</h3>
        <p class="text-sm text-gray-400 mb-4 truncate">${escapeHtml(rec.artist)}</p>
        
        ${
          hasAnyService
            ? `
        <button data-action="play"
                class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm">
          <i class="fas fa-play mr-3 text-green-400"></i>Play Album
        </button>
        `
            : ''
        }
        
        ${
          hasReasoning
            ? `
        <button data-action="view-reasoning"
                class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm">
          <i class="fas fa-comment-alt mr-3 text-purple-400"></i>Reason for recommendation
        </button>
        `
            : ''
        }
        
        ${
          isOwner && !locked
            ? `
        <button data-action="edit-reasoning"
                class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm">
          <i class="fas fa-edit mr-3 text-blue-400"></i>${hasReasoning ? 'Edit' : 'Add'} Reason
        </button>
        `
            : ''
        }
        
        <button data-action="add-to-list"
                class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm">
          <i class="fas fa-plus mr-3 text-gray-400"></i>Add to List...
        </button>
        
        ${
          (isOwner || isAdmin) && !locked
            ? `
        <div class="border-t border-gray-700 my-2"></div>
        <button data-action="remove"
                class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm text-red-500">
          <i class="fas fa-trash mr-3"></i>Remove Recommendation
        </button>
        `
            : ''
        }
        
        <button data-action="cancel"
                class="w-full text-center py-3 px-4 mt-2 bg-gray-800 rounded-sm">
          Cancel
        </button>`;

  const { sheet, close } = createActionSheet({
    contentHtml,
    checkCurrentList: false,
  });

  const playBtn = sheet.querySelector('[data-action="play"]');
  const viewReasoningBtn = sheet.querySelector(
    '[data-action="view-reasoning"]'
  );
  const editReasoningBtn = sheet.querySelector(
    '[data-action="edit-reasoning"]'
  );
  const addToListBtn = sheet.querySelector('[data-action="add-to-list"]');
  const removeBtn = sheet.querySelector('[data-action="remove"]');

  if (playBtn) {
    playBtn.addEventListener('click', (e) => {
      e.preventDefault();
      close();
      if (window.playAlbumSafe) {
        window.playAlbumSafe(rec.album_id);
      }
    });
  }

  if (viewReasoningBtn) {
    viewReasoningBtn.addEventListener('click', (e) => {
      e.preventDefault();
      close();
      showViewReasoningModal(rec);
    });
  }

  if (editReasoningBtn) {
    editReasoningBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      close();
      const newReasoning = await showReasoningModal(
        rec,
        year,
        rec.reasoning || '',
        true // isEditMode
      );

      if (newReasoning !== null) {
        try {
          await apiCall(
            `/api/recommendations/${year}/${encodeURIComponent(rec.album_id)}/reasoning`,
            {
              method: 'PATCH',
              body: JSON.stringify({ reasoning: newReasoning }),
            }
          );
          showToast('Reasoning updated', 'success');
          selectRecommendations(year);
        } catch (_err) {
          showToast('Failed to update reasoning', 'error');
        }
      }
    });
  }

  if (addToListBtn) {
    addToListBtn.addEventListener('click', (e) => {
      e.preventDefault();
      close();
      showMobileAddRecommendationToListSheet(rec, year);
    });
  }

  if (removeBtn) {
    removeBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      close();

      const confirmed = await showConfirmation(
        'Remove Recommendation',
        `Remove "${rec.album}" by ${rec.artist} from recommendations?`,
        "This will remove the album from this year's recommendations.",
        'Remove'
      );

      if (confirmed) {
        try {
          await apiCall(
            `/api/recommendations/${year}/${encodeURIComponent(rec.album_id)}`,
            { method: 'DELETE' }
          );
          showToast('Recommendation removed', 'success');
          selectRecommendations(year);
        } catch (_err) {
          showToast('Failed to remove recommendation', 'error');
        }
      }
    });
  }
}

/**
 * Show mobile sheet to select list for adding recommendation
 * @param {Object} rec - Recommendation object
 * @param {number} year - Year
 */
function showMobileAddRecommendationToListSheet(rec, year) {
  // Get user's lists grouped by year
  const listsByYear = {};
  const listsWithoutYear = [];

  Object.keys(lists).forEach((listId) => {
    const meta = lists[listId];
    const listName = meta?.name || 'Unknown';
    const listYear = meta?.year;

    if (listYear) {
      if (!listsByYear[listYear]) {
        listsByYear[listYear] = [];
      }
      listsByYear[listYear].push({ id: listId, name: listName });
    } else {
      listsWithoutYear.push({ id: listId, name: listName });
    }
  });

  // Sort years descending
  const sortedYears = Object.keys(listsByYear).sort(
    (a, b) => parseInt(b) - parseInt(a)
  );

  const hasAnyLists = sortedYears.length > 0 || listsWithoutYear.length > 0;

  let contentHtml;
  let panelClasses = '';

  if (!hasAnyLists) {
    contentHtml = `
          <h3 class="font-semibold text-white mb-1">Add to List</h3>
          <p class="text-sm text-gray-400 mb-4">${escapeHtml(rec.album)} by ${escapeHtml(rec.artist)}</p>
          
          <div class="py-8 text-center text-gray-500">
            No lists available
          </div>
          
          <button data-action="cancel"
                  class="w-full text-center py-3 px-4 mt-2 bg-gray-800 rounded-sm">
            Cancel
          </button>`;
  } else {
    panelClasses = 'max-h-[80vh] overflow-y-auto';

    // Build year accordion sections
    const yearSections = sortedYears
      .map(
        (yr, idx) => `
        <div class="year-section" data-year="${yr}">
          <button data-action="toggle-year" data-year="${yr}"
                  class="w-full flex items-center justify-between py-3 px-4 hover:bg-gray-800 rounded-sm">
            <span class="font-medium text-white">${yr}</span>
            <div class="flex items-center gap-2">
              <span class="text-xs text-gray-500">${listsByYear[yr].length} list${listsByYear[yr].length !== 1 ? 's' : ''}</span>
              <i class="fas fa-chevron-down text-gray-500 text-xs transition-transform duration-200" data-year-chevron="${yr}"></i>
            </div>
          </button>
          <div data-year-lists="${yr}" class="${idx === 0 ? '' : 'hidden'} overflow-hidden transition-all duration-200 ease-out" style="${idx === 0 ? '' : 'max-height: 0;'}">
            <div class="ml-4 border-l-2 border-gray-700 pl-2">
              ${listsByYear[yr]
                .map(
                  (list) => `
                <button data-target-list="${list.id}"
                        class="w-full text-left py-2.5 px-3 hover:bg-gray-800 rounded-sm text-gray-300">
                  ${escapeHtml(list.name)}
                </button>
              `
                )
                .join('')}
            </div>
          </div>
        </div>
      `
      )
      .join('');

    // Build "Other" section
    const otherSection =
      listsWithoutYear.length > 0
        ? `
        <div class="year-section" data-year="other">
          <button data-action="toggle-year" data-year="other"
                  class="w-full flex items-center justify-between py-3 px-4 hover:bg-gray-800 rounded-sm">
            <span class="font-medium text-white">Other</span>
            <div class="flex items-center gap-2">
              <span class="text-xs text-gray-500">${listsWithoutYear.length} list${listsWithoutYear.length !== 1 ? 's' : ''}</span>
              <i class="fas fa-chevron-down text-gray-500 text-xs transition-transform duration-200" data-year-chevron="other"></i>
            </div>
          </button>
          <div data-year-lists="other" class="hidden overflow-hidden transition-all duration-200 ease-out" style="max-height: 0;">
            <div class="ml-4 border-l-2 border-gray-700 pl-2">
              ${listsWithoutYear
                .map(
                  (list) => `
                <button data-target-list="${list.id}"
                        class="w-full text-left py-2.5 px-3 hover:bg-gray-800 rounded-sm text-gray-300">
                  ${escapeHtml(list.name)}
                </button>
              `
                )
                .join('')}
            </div>
          </div>
        </div>
      `
        : '';

    contentHtml = `
          <h3 class="font-semibold text-white mb-1">Add to List</h3>
          <p class="text-sm text-gray-400 mb-4 truncate">${escapeHtml(rec.album)} by ${escapeHtml(rec.artist)}</p>
          
          ${yearSections}
          ${otherSection}
          
          <button data-action="cancel"
                  class="w-full text-center py-3 px-4 mt-2 bg-gray-800 rounded-sm">
            Cancel
          </button>`;
  }

  const { sheet, close } = createActionSheet({
    contentHtml,
    panelClasses,
    hideFAB: false,
    restoreFAB: false,
  });

  // Track expanded years
  const expandedYears = new Set();
  if (sortedYears.length > 0) {
    expandedYears.add(sortedYears[0]);
    const firstChevron = sheet.querySelector(
      `[data-year-chevron="${sortedYears[0]}"]`
    );
    if (firstChevron) {
      firstChevron.style.transform = 'rotate(180deg)';
    }
  }

  // Attach toggle handlers
  sheet.querySelectorAll('[data-action="toggle-year"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const yr = btn.dataset.year;
      const listContainer = sheet.querySelector(`[data-year-lists="${yr}"]`);
      const chevron = sheet.querySelector(`[data-year-chevron="${yr}"]`);

      if (!listContainer) return;

      const isExpanded = expandedYears.has(yr);

      if (isExpanded) {
        listContainer.style.maxHeight = '0';
        if (chevron) chevron.style.transform = 'rotate(0deg)';
        setTimeout(() => {
          listContainer.classList.add('hidden');
        }, 200);
        expandedYears.delete(yr);
      } else {
        listContainer.classList.remove('hidden');
        void listContainer.offsetHeight;
        listContainer.style.maxHeight = listContainer.scrollHeight + 'px';
        if (chevron) chevron.style.transform = 'rotate(180deg)';
        expandedYears.add(yr);
      }
    });
  });

  // Attach list selection handlers
  sheet.querySelectorAll('[data-target-list]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const targetList = btn.dataset.targetList;
      close();

      try {
        await addRecommendationToListMobile(rec, targetList, year);
      } catch (err) {
        console.error('Error adding recommendation to list:', err);
      }
    });
  });
}

/**
 * Add recommendation album to a user's list (mobile version)
 * Sets the context and calls existing addRecommendationToList
 * @param {Object} rec - Recommendation object
 * @param {string} targetListId - Target list ID
 * @param {number} year - Year
 */
async function addRecommendationToListMobile(rec, targetListId, year) {
  // Set context for the existing function
  currentRecommendationContext = { rec, year };

  // Call existing function
  await addRecommendationToList(targetListId);

  // Clear context
  currentRecommendationContext = null;
}

/**
 * Display recommendations in the album container
 * @param {Array} recommendations - Array of recommendation objects
 * @param {number} year - The year
 * @param {boolean} locked - Whether recommendations are locked
 */
function displayRecommendations(recommendations, year, locked) {
  const container = document.getElementById('albumContainer');
  if (!container) return;

  const isMobile = window.innerWidth < 1024;

  container.innerHTML = '';

  // Add locked banner if applicable
  if (locked) {
    const banner = document.createElement('div');
    banner.className =
      'bg-yellow-900/50 border border-yellow-700 text-yellow-200 px-4 py-3 rounded-lg mb-4 flex items-center gap-2';
    banner.innerHTML = `
      <i class="fas fa-lock"></i>
      <span>Recommendations for ${year} are locked. No new albums can be added.</span>
    `;
    container.appendChild(banner);
  }

  if (isMobile) {
    // Mobile: Card layout
    const cardContainer = document.createElement('div');
    cardContainer.className = 'mobile-album-list';

    if (recommendations.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'text-center text-gray-500 mt-20 px-4';
      emptyDiv.innerHTML = `
        <i class="fas fa-thumbs-up text-4xl mb-4 block opacity-50"></i>
        <p class="text-xl mb-2">No recommendations yet for ${year}</p>
        <p class="text-sm">Click the + button to recommend an album</p>
      `;
      container.appendChild(emptyDiv);
    } else {
      recommendations.forEach((rec, index) => {
        const card = createRecommendationCard(rec, year, locked, index);
        cardContainer.appendChild(card);
      });
      container.appendChild(cardContainer);
    }
  } else {
    // Desktop: Table layout (unchanged)
    const table = document.createElement('table');
    table.className = 'w-full album-table recommendations-table';
    table.innerHTML = `
      <thead>
        <tr class="text-left text-gray-400 text-xs uppercase tracking-wider border-b border-gray-700">
          <th class="py-3 px-2 w-12"></th>
          <th class="py-3 px-2">Artist</th>
          <th class="py-3 px-2">Album</th>
          <th class="py-3 px-2">Genre</th>
          <th class="py-3 px-2">Recommended By</th>
          <th class="py-3 px-2">Date Added</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;

    const tbody = table.querySelector('tbody');

    if (recommendations.length === 0) {
      const emptyRow = document.createElement('tr');
      emptyRow.innerHTML = `
        <td colspan="6" class="py-12 text-center text-gray-500">
          <i class="fas fa-thumbs-up text-4xl mb-4 block opacity-50"></i>
          <p>No recommendations yet for ${year}</p>
          <p class="text-sm mt-2">Click the + button to recommend an album</p>
        </td>
      `;
      tbody.appendChild(emptyRow);
    } else {
      recommendations.forEach((rec) => {
        const row = document.createElement('tr');
        row.className =
          'album-row hover:bg-gray-800/50 border-b border-gray-800 cursor-pointer';
        row.dataset.albumId = rec.album_id;

        // Format date
        const date = new Date(rec.created_at);
        const formattedDate = date.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        });

        row.innerHTML = `
          <td class="py-2 px-2">
            <div class="w-10 h-10 bg-gray-700 rounded overflow-hidden">
              <img src="/api/albums/${encodeURIComponent(rec.album_id)}/cover" 
                   alt="${rec.album}" 
                   class="w-full h-full object-cover"
                   loading="lazy"
                   onerror="this.parentElement.innerHTML='<div class=\\'flex items-center justify-center w-full h-full text-gray-500\\'><i class=\\'fas fa-compact-disc\\'></i></div>'">
            </div>
          </td>
          <td class="py-2 px-2 text-white">${escapeHtml(rec.artist)}</td>
          <td class="py-2 px-2 text-gray-300">${escapeHtml(rec.album)}</td>
          <td class="py-2 px-2 text-gray-400 text-sm">${rec.genre_1 ? escapeHtml(rec.genre_1) : ''}${rec.genre_1 && rec.genre_2 ? ', ' : ''}${rec.genre_2 ? escapeHtml(rec.genre_2) : ''}</td>
          <td class="py-2 px-2 text-blue-400">
            <span class="flex items-center gap-1">
              ${escapeHtml(rec.recommended_by)}
              <button class="view-reasoning-btn text-gray-500 hover:text-blue-400 p-1 transition-colors" 
                      title="View reasoning"
                      data-rec-index="${recommendations.indexOf(rec)}">
                <i class="fas fa-comment-alt text-xs"></i>
              </button>
            </span>
          </td>
          <td class="py-2 px-2 text-gray-500 text-sm">${formattedDate}</td>
        `;

        // Click to play album
        row.addEventListener('click', (e) => {
          if (e.target.closest('.view-reasoning-btn')) return;
          // Could open album details or play in music service
        });

        // Right-click context menu
        row.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          showRecommendationContextMenu(e, rec, year);
        });

        // View reasoning button click
        const viewReasoningBtn = row.querySelector('.view-reasoning-btn');
        if (viewReasoningBtn) {
          viewReasoningBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showViewReasoningModal(rec);
          });
        }

        tbody.appendChild(row);
      });
    }

    container.appendChild(table);
  }
}

/**
 * Check if currently viewing recommendations
 * @returns {boolean}
 */
function isViewingRecommendations() {
  return currentRecommendationsYear !== null;
}

/**
 * Get current recommendations year
 * @returns {number|null}
 */
function getCurrentRecommendationsYear() {
  return currentRecommendationsYear;
}

// Track current recommendation context for context menu
let currentRecommendationContext = null;

/**
 * Show context menu for a recommendation album
 * @param {MouseEvent} e - Mouse event
 * @param {Object} rec - Recommendation object
 * @param {number} year - Year of the recommendation
 */
function showRecommendationContextMenu(e, rec, year) {
  // Hide other context menus
  hideAllContextMenus();

  // Store context
  currentRecommendationContext = { rec, year };

  const contextMenu = document.getElementById('recommendationContextMenu');
  if (!contextMenu) return;

  // Show/hide owner options (edit reasoning - only for the recommender)
  const isOwner = window.currentUser?._id === rec.recommender_id;
  const ownerDivider = contextMenu.querySelector(
    '.recommendation-owner-divider'
  );
  const editReasoningOption = document.getElementById('editReasoningOption');

  if (ownerDivider) ownerDivider.classList.toggle('hidden', !isOwner);
  if (editReasoningOption)
    editReasoningOption.classList.toggle('hidden', !isOwner);

  // Show/hide admin options
  const isAdmin = window.currentUser?.role === 'admin';
  const adminDivider = contextMenu.querySelector(
    '.recommendation-admin-divider'
  );
  const removeOption = document.getElementById('removeRecommendationOption');

  if (adminDivider) adminDivider.classList.toggle('hidden', !isAdmin);
  if (removeOption) removeOption.classList.toggle('hidden', !isAdmin);

  // Position the menu
  positionContextMenu(contextMenu, e.clientX, e.clientY);
}

/**
 * Initialize recommendation context menu handlers
 */
function initializeRecommendationContextMenu() {
  const contextMenu = document.getElementById('recommendationContextMenu');
  const playOption = document.getElementById('playRecommendationOption');
  const removeOption = document.getElementById('removeRecommendationOption');

  if (!contextMenu) return;

  // Handle play option - show play submenu
  if (playOption) {
    playOption.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (!currentRecommendationContext) return;
      const { rec } = currentRecommendationContext;

      // Use existing play functionality
      if (window.playAlbumSafe) {
        window.playAlbumSafe(rec.album_id);
      }

      contextMenu.classList.add('hidden');
      currentRecommendationContext = null;
    });
  }

  // Handle remove option (admin only)
  if (removeOption) {
    removeOption.addEventListener('click', async () => {
      contextMenu.classList.add('hidden');

      if (!currentRecommendationContext) return;
      const { rec, year } = currentRecommendationContext;

      const confirmed = await showConfirmation(
        'Remove Recommendation',
        `Remove "${rec.album}" by ${rec.artist} from recommendations?`,
        "This will remove the album from this year's recommendations.",
        'Remove'
      );

      if (confirmed) {
        try {
          await apiCall(
            `/api/recommendations/${year}/${encodeURIComponent(rec.album_id)}`,
            { method: 'DELETE' }
          );
          showToast('Recommendation removed', 'success');
          // Refresh recommendations
          selectRecommendations(year);
        } catch (_err) {
          showToast('Failed to remove recommendation', 'error');
        }
      }

      currentRecommendationContext = null;
    });
  }

  // Handle edit reasoning option (owner only)
  const editReasoningOption = document.getElementById('editReasoningOption');
  if (editReasoningOption) {
    editReasoningOption.addEventListener('click', async () => {
      contextMenu.classList.add('hidden');

      if (!currentRecommendationContext) return;
      const { rec, year } = currentRecommendationContext;

      // Show reasoning modal in edit mode with existing reasoning
      const newReasoning = await showReasoningModal(
        rec,
        year,
        rec.reasoning || '',
        true // isEditMode
      );

      if (newReasoning) {
        try {
          await apiCall(
            `/api/recommendations/${year}/${encodeURIComponent(rec.album_id)}/reasoning`,
            {
              method: 'PATCH',
              body: JSON.stringify({ reasoning: newReasoning }),
            }
          );
          showToast('Reasoning updated', 'success');
          // Refresh recommendations
          selectRecommendations(year);
        } catch (_err) {
          showToast('Failed to update reasoning', 'error');
        }
      }

      currentRecommendationContext = null;
    });
  }

  // Handle add to list option - show submenu with years
  const addToListOption = document.getElementById('addToListOption');
  if (addToListOption) {
    let addHideTimeout;

    addToListOption.addEventListener('mouseenter', () => {
      if (addHideTimeout) clearTimeout(addHideTimeout);
      showRecommendationAddSubmenu();
    });

    addToListOption.addEventListener('mouseleave', (e) => {
      const submenu = document.getElementById('recommendationAddSubmenu');
      const toSubmenu =
        submenu &&
        (e.relatedTarget === submenu || submenu.contains(e.relatedTarget));

      if (!toSubmenu) {
        addHideTimeout = setTimeout(() => {
          if (submenu) submenu.classList.add('hidden');
          addToListOption.classList.remove('bg-gray-700', 'text-white');
          currentRecommendationAddHighlightedYear = null;
        }, 100);
      }
    });

    addToListOption.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showRecommendationAddSubmenu();
    });
  }
}

// Track highlighted year in add-to-list submenu
let currentRecommendationAddHighlightedYear = null;
let recommendationAddListsHideTimeout = null;

/**
 * Show the add-to-list submenu with years
 */
function showRecommendationAddSubmenu() {
  const submenu = document.getElementById('recommendationAddSubmenu');
  const listsSubmenu = document.getElementById('recommendationAddListsSubmenu');
  const addToListOption = document.getElementById('addToListOption');
  const contextMenu = document.getElementById('recommendationContextMenu');

  if (!submenu || !addToListOption || !contextMenu) return;

  // Hide lists submenu first
  if (listsSubmenu) {
    listsSubmenu.classList.add('hidden');
  }

  // Reset highlighted year
  currentRecommendationAddHighlightedYear = null;

  // Highlight the parent menu item
  addToListOption.classList.add('bg-gray-700', 'text-white');

  // Group lists by year
  const { listsByYear, sortedYears } = groupUserListsForAdd();

  if (sortedYears.length === 0) {
    submenu.innerHTML =
      '<div class="px-4 py-2 text-sm text-gray-500">No lists available</div>';
  } else {
    submenu.innerHTML = sortedYears
      .map(
        (year) => `
        <button class="flex items-center justify-between w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap" data-add-year="${year}">
          <span>${year}</span>
          <i class="fas fa-chevron-right text-xs ml-3 text-gray-500"></i>
        </button>
      `
      )
      .join('');

    // Add hover handlers to each year option
    submenu.querySelectorAll('[data-add-year]').forEach((btn) => {
      btn.addEventListener('mouseenter', () => {
        if (recommendationAddListsHideTimeout) {
          clearTimeout(recommendationAddListsHideTimeout);
          recommendationAddListsHideTimeout = null;
        }
        const year = btn.dataset.addYear;
        showRecommendationAddListsSubmenu(year, btn, listsByYear);
      });

      btn.addEventListener('mouseleave', (e) => {
        const listsMenu = document.getElementById(
          'recommendationAddListsSubmenu'
        );
        const toListsSubmenu =
          listsMenu &&
          (e.relatedTarget === listsMenu ||
            listsMenu.contains(e.relatedTarget));

        if (!toListsSubmenu) {
          recommendationAddListsHideTimeout = setTimeout(() => {
            if (listsMenu) listsMenu.classList.add('hidden');
            btn.classList.remove('bg-gray-700', 'text-white');
            currentRecommendationAddHighlightedYear = null;
          }, 100);
        }
      });
    });
  }

  // Position submenu next to the add-to-list option
  const optionRect = addToListOption.getBoundingClientRect();
  const menuRect = contextMenu.getBoundingClientRect();

  submenu.style.left = `${menuRect.right}px`;
  submenu.style.top = `${optionRect.top}px`;
  submenu.classList.remove('hidden');
}

/**
 * Show the lists submenu for a specific year
 */
function showRecommendationAddListsSubmenu(year, yearButton, listsByYear) {
  const listsSubmenu = document.getElementById('recommendationAddListsSubmenu');
  const yearSubmenu = document.getElementById('recommendationAddSubmenu');

  if (!listsSubmenu || !yearSubmenu) return;

  // Remove highlight from previously highlighted year
  if (
    currentRecommendationAddHighlightedYear &&
    currentRecommendationAddHighlightedYear !== year
  ) {
    const prevBtn = yearSubmenu.querySelector(
      `[data-add-year="${currentRecommendationAddHighlightedYear}"]`
    );
    if (prevBtn) {
      prevBtn.classList.remove('bg-gray-700', 'text-white');
    }
  }

  // Highlight the current year button
  yearButton.classList.add('bg-gray-700', 'text-white');
  currentRecommendationAddHighlightedYear = year;

  // Get lists for this year
  const yearLists = listsByYear[year] || [];

  if (yearLists.length === 0) {
    listsSubmenu.classList.add('hidden');
    return;
  }

  // Populate the lists submenu
  listsSubmenu.innerHTML = yearLists
    .map(
      (listId) => `
      <button class="block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap w-full" data-add-target-list="${listId}">
        <span class="mr-2">•</span>${lists[listId]?.name || listId}
      </button>
    `
    )
    .join('');

  // Add click handlers to each list option
  listsSubmenu.querySelectorAll('[data-add-target-list]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const targetListId = btn.dataset.addTargetList;

      // Hide all menus
      document
        .getElementById('recommendationContextMenu')
        ?.classList.add('hidden');
      yearSubmenu.classList.add('hidden');
      listsSubmenu.classList.add('hidden');

      // Add album to list
      await addRecommendationToList(targetListId);
    });
  });

  // Handle mouse leaving the lists submenu
  listsSubmenu.onmouseenter = () => {
    if (recommendationAddListsHideTimeout) {
      clearTimeout(recommendationAddListsHideTimeout);
      recommendationAddListsHideTimeout = null;
    }
  };

  listsSubmenu.onmouseleave = (e) => {
    const yearMenu = document.getElementById('recommendationAddSubmenu');
    const toYearSubmenu =
      yearMenu &&
      (e.relatedTarget === yearMenu || yearMenu.contains(e.relatedTarget));

    if (!toYearSubmenu) {
      recommendationAddListsHideTimeout = setTimeout(() => {
        listsSubmenu.classList.add('hidden');
        if (currentRecommendationAddHighlightedYear) {
          const yearBtn = yearMenu?.querySelector(
            `[data-add-year="${currentRecommendationAddHighlightedYear}"]`
          );
          if (yearBtn) {
            yearBtn.classList.remove('bg-gray-700', 'text-white');
          }
          currentRecommendationAddHighlightedYear = null;
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

/**
 * Add a recommendation album to a user's list
 */
async function addRecommendationToList(targetListId) {
  if (!currentRecommendationContext) {
    showToast('No album selected', 'error');
    return;
  }

  const { rec } = currentRecommendationContext;
  const targetMeta = lists[targetListId];
  const targetListName = targetMeta?.name || 'Unknown';

  // Get target list data
  let targetAlbums = getListData(targetListId);

  // If list data not loaded, fetch it
  if (!targetAlbums) {
    try {
      const data = await apiCall(
        `/api/lists/${encodeURIComponent(targetListId)}`
      );
      setListData(targetListId, data);
      targetAlbums = data;
    } catch (_err) {
      showToast('Failed to load list data', 'error');
      currentRecommendationContext = null;
      return;
    }
  }

  // Check for duplicate
  const key = `${rec.artist}::${rec.album}`.toLowerCase();
  const isDuplicate = targetAlbums?.some(
    (a) => `${a.artist}::${a.album}`.toLowerCase() === key
  );

  if (isDuplicate) {
    showToast(`"${rec.album}" is already in "${targetListName}"`, 'info');
    currentRecommendationContext = null;
    return;
  }

  // Build album object to add
  const albumToAdd = {
    album_id: rec.album_id,
    artist: rec.artist,
    album: rec.album,
    release_date: rec.release_date || null,
    country: rec.country || null,
    genre_1: rec.genre_1 || null,
    genre_2: rec.genre_2 || null,
  };

  try {
    // Add to list via API
    await apiCall(`/api/lists/${encodeURIComponent(targetListId)}/items`, {
      method: 'PATCH',
      body: JSON.stringify({ added: [albumToAdd] }),
    });

    showToast(`Added "${rec.album}" to "${targetListName}"`, 'success');

    // Invalidate cached list data so it refetches
    const listMetadata = lists[targetListId];
    if (listMetadata) {
      listMetadata._data = null;
    }
  } catch (_err) {
    showToast('Failed to add album to list', 'error');
  }

  currentRecommendationContext = null;
}

// Expose helper functions
window.isViewingRecommendations = isViewingRecommendations;
window.getCurrentRecommendationsYear = getCurrentRecommendationsYear;
window.loadLists = loadLists;
// Helper to get current list name (for display)
window.getCurrentListName = getCurrentListName;
// Helper to find list by name
window.findListByName = findListByName;

/**
 * Refresh the locked year status for the current list
 * Called after locking/unlocking a year in admin settings
 * @param {number} year - Year that was locked/unlocked
 */
window.refreshLockedYearStatus = async function (year) {
  // Invalidate the cache so we fetch fresh status
  invalidateLockedYearsCache();

  // Get the current list's year and main status
  const currentMeta = getListMetadata(currentListId);
  const currentYear = currentMeta?.year;
  const currentIsMain = currentMeta?.isMain || false;

  // If the current list belongs to the year that was locked/unlocked
  // and the list is the main list for that year
  if (currentYear && currentYear === year && currentIsMain) {
    const isLocked = await isListLocked(currentYear, currentIsMain);

    // Get the album container
    const container = document.getElementById('albumContainer');
    if (!container) return;

    // Get the sorting module
    const sorting = getSortingModule();
    if (!sorting) return;

    if (isLocked) {
      // Main list is now locked - disable sorting and show banner
      sorting.destroySorting(container);

      // Add lock banner if not already present
      const existingBanner = container.querySelector('.year-locked-banner');
      if (!existingBanner) {
        const banner = document.createElement('div');
        banner.className =
          'year-locked-banner bg-yellow-900 bg-opacity-20 border border-yellow-700 rounded-lg p-3 mb-4 flex items-center gap-3 text-yellow-200';
        banner.innerHTML = `
          <i class="fas fa-lock text-yellow-500"></i>
          <span class="text-sm">
            Year ${currentYear} is locked. You cannot reorder, add, or edit albums in this main list.
          </span>
        `;
        container.insertBefore(banner, container.firstChild);
      }
    } else {
      // Main list is now unlocked - enable sorting and remove banner
      const isMobile = window.innerWidth < 1024;
      sorting.initializeUnifiedSorting(container, isMobile);

      // Remove lock banner if present
      const banner = container.querySelector('.year-locked-banner');
      if (banner) {
        banner.remove();
      }
    }
  }
};

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
    const albumsForTrack = getListData(currentListId);
    const album = albumsForTrack && albumsForTrack[currentIndex];
    if (!album) return;
    if (!album.tracks || album.tracks.length === 0) {
      showToast('Fetching tracks...', 'info');
      try {
        await fetchTracksForAlbum(album);
        await saveList(currentListId, albumsForTrack);
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
    const albumsForTrack = getListData(currentListId);
    const album = albumsForTrack && albumsForTrack[currentIndex];
    if (!album) return;
    if (!album.tracks || album.tracks.length === 0) {
      showToast('Fetching tracks...', 'info');
      try {
        await fetchTracksForAlbum(album);
        await saveList(currentListId, albumsForTrack);
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

    const albumsForMenu = getListData(currentListId);
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

    // Track current selections for UI updates
    let currentPrimaryTrack =
      currentAlbum?.primary_track || currentAlbum?.track_pick || '';
    let currentSecondaryTrack = currentAlbum?.secondary_track || '';

    // Function to update menu UI after selection changes
    function updateMenuUI() {
      menu.querySelectorAll('.track-menu-option').forEach((item) => {
        const trackValue = item.dataset.trackValue;
        if (item.dataset.action === 'clear') {
          // Update "clear" option
          const hasNoSelection = !currentPrimaryTrack && !currentSecondaryTrack;
          const span = item.querySelector('span');
          if (span) {
            span.className = hasNoSelection ? 'text-red-500' : 'text-gray-400';
            span.innerHTML = `${hasNoSelection ? '<i class="fas fa-check mr-2"></i>' : ''}Clear all selections`;
          }
          return;
        }

        const isPrimary = trackValue === currentPrimaryTrack;
        const isSecondary = trackValue === currentSecondaryTrack;

        // Update data attributes
        item.dataset.isPrimary = isPrimary;
        item.dataset.isSecondary = isSecondary;

        // Update visual appearance
        item.classList.remove('bg-yellow-900/20', 'bg-gray-700/30');
        if (isPrimary) {
          item.classList.add('bg-yellow-900/20');
        } else if (isSecondary) {
          item.classList.add('bg-gray-700/30');
        }

        // Update the span content with indicator
        const span = item.querySelector('span');
        if (span) {
          const match = trackValue.match(/^(\d+)[.\s-]?\s*(.*)$/);
          const trackNum = match ? match[1] : '';
          const displayName = match ? match[2] : trackValue;
          const trackObj = sortedTracks.find(
            (t) => getTrackName(t) === trackValue
          );
          const trackLength = trackObj
            ? formatTrackTime(getTrackLength(trackObj))
            : '';

          let indicator = '';
          let textClass = 'text-gray-300';
          if (isPrimary) {
            indicator = '<span class="text-yellow-400 mr-2">★</span>';
            textClass = 'text-yellow-400';
          } else if (isSecondary) {
            indicator = '<span class="text-yellow-400 mr-2">☆</span>';
            textClass = 'text-gray-300';
          }

          span.className = textClass;
          span.innerHTML = `${indicator}<span class="font-medium">${trackNum}.</span> ${displayName}${trackLength ? ` <span class="text-gray-500 text-xs ml-2">${trackLength}</span>` : ''}`;
        }
      });
    }

    // Add click handlers with new dual-track logic
    menu.querySelectorAll('.track-menu-option').forEach((option) => {
      option.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const trackValue = option.dataset.trackValue;
        const action = option.dataset.action;
        const listItemId = album._id; // Use list item ID for track picks API

        if (!listItemId) {
          showToast(
            'Cannot save track selection - missing list item ID',
            'error'
          );
          menu.remove();
          return;
        }

        try {
          if (action === 'clear') {
            // Clear all track picks
            const result = await apiCall(`/api/track-picks/${listItemId}`, {
              method: 'DELETE',
            });

            // Update local data
            const albumsForSelection = getListData(currentListId);
            const freshAlbum =
              albumsForSelection && albumsForSelection[albumIndex];
            if (freshAlbum) {
              freshAlbum.primary_track = null;
              freshAlbum.secondary_track = null;
              freshAlbum.track_pick = ''; // Legacy field
            }

            // Update tracking variables and menu UI
            currentPrimaryTrack = '';
            currentSecondaryTrack = '';
            updateMenuUI();

            updateTrackCellDisplayDual(albumIndex, result, album.tracks);
            showToast('Track selections cleared');
          } else {
            // Determine target priority based on current state
            const isPrimary = option.dataset.isPrimary === 'true';
            const isSecondary = option.dataset.isSecondary === 'true';

            let targetPriority;
            if (isPrimary) {
              // Already primary - deselect by removing
              const result = await apiCall(`/api/track-picks/${listItemId}`, {
                method: 'DELETE',
                body: JSON.stringify({ trackIdentifier: trackValue }),
              });

              const albumsForSelection = getListData(currentListId);
              const freshAlbum =
                albumsForSelection && albumsForSelection[albumIndex];
              if (freshAlbum) {
                freshAlbum.primary_track = result.primary_track;
                freshAlbum.secondary_track = result.secondary_track;
                freshAlbum.track_pick = result.primary_track || '';
              }

              // Update tracking variables and menu UI
              currentPrimaryTrack = result.primary_track || '';
              currentSecondaryTrack = result.secondary_track || '';
              updateMenuUI();

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

            const result = await apiCall(`/api/track-picks/${listItemId}`, {
              method: 'POST',
              body: JSON.stringify({
                trackIdentifier: trackValue,
                priority: targetPriority,
              }),
            });

            // Update local data
            const albumsForSelection = getListData(currentListId);
            const freshAlbum =
              albumsForSelection && albumsForSelection[albumIndex];
            if (freshAlbum) {
              freshAlbum.primary_track = result.primary_track;
              freshAlbum.secondary_track = result.secondary_track;
              freshAlbum.track_pick = result.primary_track || ''; // Legacy field
            }

            // Update tracking variables and menu UI
            currentPrimaryTrack = result.primary_track || '';
            currentSecondaryTrack = result.secondary_track || '';
            updateMenuUI();

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

  // PERFORMANCE: Start loading list data immediately - this is the critical path
  // Other UI initializations run in parallel while data is fetched
  const listLoadPromise = loadLists();

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
  // musicbrainz.js is loaded on-demand (not in the initial bundle) to reduce
  // initial JS payload from ~533 KB to ~25 KB. The first click loads the chunk.
  const fab = document.getElementById('addAlbumFAB');
  if (fab) {
    fab.addEventListener('click', async () => {
      if (!window.openAddAlbumModal) {
        try {
          await import('./musicbrainz.js');
        } catch (err) {
          console.error('Failed to load album editor:', err);
          showToast('Error loading album editor. Please try again.', 'error');
          return;
        }
      }
      if (window.openAddAlbumModal) {
        window.openAddAlbumModal();
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

  // Initialize features after list data is loaded
  // Note: loadLists() was started immediately after auth check for faster loading
  listLoadPromise
    .then(() => {
      initializeContextMenu();
      initializeAlbumContextMenu();
      initializeRecommendationContextMenu();
      initializeCategoryContextMenu();
      hideSubmenuOnLeave();
      initializeCreateList();
      initializeCreateCollection();
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

          // Force refresh from server to get merged album data (e.g., genres from canonical albums table)
          // Clear the local cache so selectList will refetch
          const listMetadata = lists[listName];
          if (listMetadata) {
            listMetadata._data = null;
          }

          // Refresh if viewing the same list
          if (currentListId === listName) {
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
                const parsed = JSON.parse(e.target.result);

                // Handle both old format (array) and new format (wrapped with metadata)
                let albums, metadata, fileName;
                if (Array.isArray(parsed)) {
                  // Old format: just an array of albums
                  albums = parsed;
                  metadata = null;
                  fileName = file.name.replace(/\.json$/, '');
                } else if (parsed.albums && Array.isArray(parsed.albums)) {
                  // New format: wrapped with metadata
                  albums = parsed.albums;
                  metadata = parsed._metadata || null;
                  fileName =
                    metadata?.list_name || file.name.replace(/\.json$/, '');
                } else {
                  throw new Error(
                    'Invalid JSON format: expected array or object with albums array'
                  );
                }

                // Check for existing list
                if (lists[fileName]) {
                  // Show import conflict modal
                  pendingImportData = { albums, metadata };
                  pendingImportFilename = fileName;
                  document.getElementById('conflictListName').textContent =
                    fileName;
                  document
                    .getElementById('importConflictModal')
                    .classList.remove('hidden');
                } else {
                  // Import directly
                  await importList(fileName, albums, metadata);
                  updateListNav();
                  selectList(fileName);
                  showToast(`Successfully imported ${albums.length} albums`);
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
  if (currentListId) {
    try {
      localStorage.setItem('lastSelectedList', currentListId);
    } catch (e) {
      // Silently fail - not critical during page unload
      console.warn('Failed to save last selected list on unload:', e.name);
    }
  }
});

// Expose playAlbum for inline handlers
window.playAlbum = playAlbum;
