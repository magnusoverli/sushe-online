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
import { showToast } from './modules/toast.js';
import {
  showConfirmation,
  showReasoningModal,
  hideReasoningModal,
  showViewReasoningModal,
} from './modules/modals.js';
import { positionContextMenu } from './modules/context-menu.js';
import { escapeHtml } from './modules/html-utils.js';
import { checkListSetupStatus } from './modules/list-setup-wizard.js';
import { createSettingsDrawer } from './modules/settings-drawer.js';
import { initAboutModal } from './modules/about-modal.js';
import { createActionSheet } from './modules/ui-factories.js';
import {
  invalidateLockedYearsCache,
  invalidateLockedRecommendationYearsCache,
  isListLocked,
  showYearLockUI,
  clearYearLockUI,
} from './modules/year-lock.js';
import { formatTrackTime } from './modules/time-utils.js';
import { parseStaticList } from './utils/static-data.js';
import { groupListsByYear } from './utils/list-grouping.js';
import {
  editRecommendationReasoning,
  removeRecommendation,
} from './utils/recommendation-actions.js';
import { setupSubmenuHover } from './utils/submenu-behavior.js';
import { createLazyModule } from './utils/lazy-module.js';
import {
  computeListDiff,
  createDebouncedSave,
} from './utils/save-optimizer.js';
import { createLinkPreview } from './modules/link-preview.js';
import { createRecommendations } from './modules/recommendations.js';
import { createTrackSelection } from './modules/track-selection.js';
import { createListCrud } from './modules/list-crud.js';
import { createPlayback } from './modules/playback.js';
import { createAlbumContextMenu } from './modules/album-context-menu.js';

// Centralized state store
import {
  getLists,
  setLists,
  getListData,
  setListData,
  getListMetadata,
  updateListMetadata,
  findListByName,
  getCurrentListName,
  isListDataLoaded,
  getGroups,
  getGroup,
  getSortedGroups,
  updateGroupsFromServer,
  getCurrentListId,
  setCurrentListId,
  isViewingRecommendations,
  getCurrentRecommendationsYear,
  setCurrentRecommendationsYear,
  getMusicServicesModule,
  setMusicServicesModule,
  getImportExportModule,
  setImportExportModule,
  getRealtimeSyncModule as getRealtimeSyncModuleInstance,
  setRealtimeSyncModule as setRealtimeSyncModuleInstance,
  markLocalSave,
  wasRecentLocalSave,
  getLastSavedSnapshots,
  createListSnapshot,
  saveSnapshotToStorage,
  loadSnapshotFromStorage,
  clearSnapshotFromStorage,
  getAvailableGenres,
  setAvailableGenres,
  getAvailableCountries,
  setAvailableCountries,
  initWindowGlobals,
  setRecommendationYears,
  yearHasRecommendations,
} from './modules/app-state.js';

// Early window global — needed by year-lock module before consolidated section
window.invalidateLockedRecommendationYearsCache =
  invalidateLockedRecommendationYearsCache;

// Re-export UI utilities for backward compatibility
export { showToast, showConfirmation, showReasoningModal, hideReasoningModal };

// Initialize centralized state: computed values and window globals
setAvailableGenres(parseStaticList(genresText));
setAvailableCountries(parseStaticList(countriesText));
initWindowGlobals();

// ============ LOCAL STATE ============
// State variables scoped to app.js — passed to extracted modules via DI getters/setters.
// The canonical shared state (lists, groups, currentListId, etc.) lives in app-state.js.

let currentContextAlbum = null;
let currentContextAlbumId = null;
let currentContextList = null;
let currentContextGroup = null;
let pendingImportData = null;
let pendingImportFilename = null;
let trackAbortController = null;
let currentHighlightedYear = null;
let moveListsHideTimeout = null;

/**
 * Get or initialize the link preview module
 * Uses lazy initialization since it depends on apiCall
 */
const getLinkPreviewModule = createLazyModule(() =>
  createLinkPreview({ apiCall })
);

/**
 * Refresh which years have recommendations and rebuild the sidebar.
 * Called after adding/removing recommendations to keep sidebar in sync.
 */
async function refreshRecommendationYears() {
  try {
    const data = await apiCall('/api/recommendations/years');
    setRecommendationYears(data.years || []);
    updateListNav();
  } catch (_err) {
    // Non-critical — sidebar just won't update until next page load
  }
}

/**
 * Get or initialize the recommendations module
 * Uses lazy initialization since it depends on many app.js functions
 */
const getRecommendationsModule = createLazyModule(() =>
  createRecommendations({
    apiCall,
    showToast,
    showConfirmation,
    showReasoningModal,
    showViewReasoningModal,
    escapeHtml,
    positionContextMenu,
    createActionSheet,
    groupListsByYear,
    editRecommendationReasoning,
    removeRecommendation,
    setupSubmenuHover,
    getListData,
    setListData,
    getLists,
    getCurrentListId,
    setCurrentListId,
    getCurrentRecommendationsYear,
    setCurrentRecommendationsYear,
    getRealtimeSyncModuleInstance,
    hideAllContextMenus,
    clearPlaycountCache,
    updateListNavActiveState,
    updateHeaderTitle,
    updateMobileHeader,
    showLoadingSpinner,
    refreshRecommendationYears,
  })
);

/**
 * Get or initialize the track selection module
 */
const getTrackSelectionModule = createLazyModule(() =>
  createTrackSelection({
    apiCall,
    showToast,
    getListData,
    getCurrentListId: () => getCurrentListId(),
    formatTrackTime,
    saveList,
  })
);

// Convenience wrappers for track utilities (used in DI bags and window globals)
function getTrackName(track) {
  return getTrackSelectionModule().getTrackName(track);
}
function getTrackLength(track) {
  return getTrackSelectionModule().getTrackLength(track);
}
function fetchTracksForAlbum(album, signal) {
  return getTrackSelectionModule().fetchTracksForAlbum(album, signal);
}
function showTrackSelectionMenu(album, albumIndex, x, y) {
  return getTrackSelectionModule().showTrackSelectionMenu(
    album,
    albumIndex,
    x,
    y
  );
}

/**
 * Get or initialize the list CRUD module
 * Uses lazy initialization to avoid dependency ordering issues
 */
const getListCrudModule = createLazyModule(() =>
  createListCrud({
    apiCall,
    showToast,
    showConfirmation,
    refreshGroupsAndLists,
    getSortedGroups,
    getGroup,
    getListMetadata,
    getLists,
    findListByName,
    getCurrentListId,
    updateListNav,
    selectList,
    getCurrentContextGroup: () => currentContextGroup,
    setCurrentContextGroup: (val) => {
      currentContextGroup = val;
    },
  })
);
// Wrapper functions for list-crud module
function openRenameCategoryModal(groupId, currentName) {
  return getListCrudModule().openRenameCategoryModal(groupId, currentName);
}
function openRenameModal(listId) {
  return getListCrudModule().openRenameModal(listId);
}

/**
 * Get or initialize the playback module
 * Uses lazy initialization to avoid dependency ordering issues
 */
const getPlaybackModule = createLazyModule(() =>
  createPlayback({
    getListData,
    getCurrentListId,
    getContextAlbum: () => currentContextAlbum,
    getContextAlbumId: () => currentContextAlbumId,
    findAlbumByIdentity,
    playAlbumSafe,
    showServicePicker,
    getDeviceIcon,
  })
);
// Wrapper functions for playback module
function playAlbum(index) {
  return getPlaybackModule().playAlbum(index);
}
function playTrack(index) {
  return getPlaybackModule().playTrack(index);
}
function playSpecificTrack(index, trackName) {
  return getPlaybackModule().playSpecificTrack(index, trackName);
}
function playAlbumOnDeviceMobile(albumId, deviceId) {
  return getPlaybackModule().playAlbumOnDeviceMobile(albumId, deviceId);
}
function showPlayAlbumSubmenu() {
  return getPlaybackModule().showPlayAlbumSubmenu();
}

/**
 * Get or initialize the album context menu module
 * Uses lazy initialization to avoid dependency ordering issues
 */
const getAlbumContextMenuModule = createLazyModule(() =>
  createAlbumContextMenu({
    getListData,
    getLists,
    getCurrentListId,
    getCurrentRecommendationsYear,
    getContextAlbum: () => currentContextAlbum,
    getContextAlbumId: () => currentContextAlbumId,
    setContextAlbum: (val) => {
      currentContextAlbum = val;
    },
    setContextAlbumId: (val) => {
      currentContextAlbumId = val;
    },
    getTrackAbortController: () => trackAbortController,
    setTrackAbortController: (val) => {
      trackAbortController = val;
    },
    getCurrentHighlightedYear: () => currentHighlightedYear,
    setCurrentHighlightedYear: (val) => {
      currentHighlightedYear = val;
    },
    getMoveListsHideTimeout: () => moveListsHideTimeout,
    setMoveListsHideTimeout: (val) => {
      moveListsHideTimeout = val;
    },
    findAlbumByIdentity,
    showMobileEditForm,
    showMobileEditFormSafe,
    showPlayAlbumSubmenu,
    showConfirmation,
    showToast,
    saveList,
    selectList,
    loadLists,
    getRecommendationsModule: () => getRecommendationsModule(),
    getMobileUIModule: () => getMobileUIModule(),
    getListMetadata,
  })
);
// Wrapper functions for album context menu module
function hideAllContextMenus() {
  return getAlbumContextMenuModule().hideAllContextMenus();
}
function initializeAlbumContextMenu() {
  return getAlbumContextMenuModule().initializeAlbumContextMenu();
}
function hideSubmenuOnLeave() {
  return getAlbumContextMenuModule().hideSubmenuOnLeave();
}

/**
 * Get or initialize the album display module
 * Uses lazy initialization to avoid dependency ordering issues
 */
const getAlbumDisplayModule = createLazyModule(() =>
  createAlbumDisplay({
    getListData,
    getListMetadata,
    getCurrentList: () => getCurrentListId(),
    saveList,
    showToast,
    apiCall,
    fetchTracksForAlbum,
    makeCountryEditable,
    makeGenreEditable,
    makeCommentEditable,
    makeComment2Editable,
    attachLinkPreview: (...args) =>
      getLinkPreviewModule().attachLinkPreview(...args),
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
  })
);

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

/**
 * Get or initialize the context menus module
 * Uses lazy initialization to avoid dependency ordering issues
 */
const getContextMenusModule = createLazyModule(() =>
  createContextMenus({
    getListData,
    getListMetadata,
    getCurrentList: () => getCurrentListId(),
    getLists,
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
      setCurrentListId(listName);
    },
    refreshMobileBarVisibility: () => {
      if (window.refreshMobileBarVisibility) {
        window.refreshMobileBarVisibility();
      }
    },
    toggleMainStatus,
    getSortedGroups,
    refreshGroupsAndLists,
  })
);

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
const getMobileUIModule = createLazyModule(() =>
  createMobileUI({
    getListData,
    getListMetadata,
    getCurrentList: () => getCurrentListId(),
    getLists,
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
    getAvailableCountries,
    getAvailableGenres,
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
    isViewingRecommendations,
    recommendAlbum: (...args) =>
      getRecommendationsModule().recommendAlbum(...args),
  })
);

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
    const currentLists = getLists();
    Object.keys(fetchedLists).forEach((listId) => {
      const meta = fetchedLists[listId];
      if (currentLists[listId]) {
        // Preserve existing _data if loaded, but update all metadata including name
        currentLists[listId] = {
          ...currentLists[listId],
          name: meta.name || currentLists[listId].name || 'Unknown',
          year: meta.year || null,
          isMain: meta.isMain || false,
          count: meta.count || 0,
          groupId: meta.groupId || null,
          sortOrder: meta.sortOrder || 0,
          updatedAt: meta.updatedAt || null,
        };
      } else {
        currentLists[listId] = {
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
    window.lists = currentLists;

    // Re-render the sidebar navigation
    updateListNav();
  } catch (err) {
    console.error('Failed to refresh groups and lists:', err);
  }
}

const getListNavModule = createLazyModule(() =>
  createListNav({
    getLists,
    getListMetadata,
    getGroups,
    getSortedGroups,
    getCurrentList: () => getCurrentListId(),
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
    yearHasRecommendations,
  })
);

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

/**
 * Get or initialize the editable fields module
 * Uses lazy initialization to avoid dependency ordering issues
 */
const getEditableFieldsModule = createLazyModule(() =>
  createEditableFields({
    getListData,
    getCurrentList: () => getCurrentListId(),
    apiCall,
    showToast,
    getAvailableCountries,
    getAvailableGenres,
    isTextTruncated,
  })
);

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

function makeComment2Editable(commentDiv, albumIndex) {
  return getEditableFieldsModule().makeComment2Editable(commentDiv, albumIndex);
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
const getSortingModule = createLazyModule(() =>
  createSorting({
    getListData,
    getCurrentList: () => getCurrentListId(),
    debouncedSaveList,
    saveReorder,
    updatePositionNumbers,
    showToast,
  })
);

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
const getImportConflictModule = createLazyModule(() =>
  createImportConflictHandler({
    getListData,
    getLists,
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
  })
);

// Wrapper function for import conflict handling
function initializeImportConflictHandling() {
  return getImportConflictModule().initializeImportConflictHandling();
}

/**
 * Get or initialize the now-playing module
 * Uses lazy initialization to avoid dependency ordering issues
 */
const getNowPlayingModule = createLazyModule(() => {
  const mod = createNowPlaying({
    getListData,
    getCurrentList: () => getCurrentListId(),
  });
  // Initialize event listeners
  mod.initialize();
  return mod;
});

// Wrapper function for now-playing module (reapplyNowPlayingBorder is passed to album-display)
function reapplyNowPlayingBorder() {
  return getNowPlayingModule().reapplyNowPlayingBorder();
}

/**
 * Get or initialize the realtime sync module
 * Uses lazy initialization to avoid dependency ordering issues
 */
function getRealtimeSyncModule() {
  let realtimeSyncModule = getRealtimeSyncModuleInstance();
  if (!realtimeSyncModule) {
    realtimeSyncModule = createRealtimeSync({
      getCurrentList: () => getCurrentListId(),
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
        if (getCurrentListId() === listName) {
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
        if (getCurrentListId() === listName) {
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
    setRealtimeSyncModuleInstance(realtimeSyncModule);
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
    if (listId === getCurrentListId()) {
      const albums = getListData(getCurrentListId());
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
  let mod = getMusicServicesModule();
  if (!mod) {
    mod = await import('./modules/music-services.js');
    setMusicServicesModule(mod);
  }
  return mod.showServicePicker(hasSpotify, hasTidal);
}

async function downloadListAsJSON(listName) {
  let mod = getImportExportModule();
  if (!mod) {
    showToast('Loading export module...', 'info', 1000);
    mod = await import('./modules/import-export.js');
    setImportExportModule(mod);
  }
  return mod.downloadListAsJSON(listName);
}

async function downloadListAsPDF(listName) {
  let mod = getImportExportModule();
  if (!mod) {
    showToast('Loading export module...', 'info', 1000);
    mod = await import('./modules/import-export.js');
    setImportExportModule(mod);
  }
  return mod.downloadListAsPDF(listName);
}

async function downloadListAsCSV(listName) {
  let mod = getImportExportModule();
  if (!mod) {
    showToast('Loading export module...', 'info', 1000);
    mod = await import('./modules/import-export.js');
    setImportExportModule(mod);
  }
  return mod.downloadListAsCSV(listName);
}

async function updatePlaylist(listId, listData = null) {
  let mod = getMusicServicesModule();
  if (!mod) {
    showToast('Loading playlist integration...', 'info', 1000);
    mod = await import('./modules/music-services.js');
    setMusicServicesModule(mod);
  }
  // If listData not provided, get it from global lists
  const data = listData !== null ? listData : getListData(listId) || [];
  // Get list name for display in music service
  const meta = getListMetadata(listId);
  const listName = meta?.name || listId;
  return mod.updatePlaylist(listName, data);
}

// API helper functions
export async function apiCall(url, options = {}) {
  try {
    // Get socket ID to exclude self from real-time broadcasts
    const socketId = getRealtimeSyncModuleInstance()?.getSocket()?.id;

    // Skip Content-Type for FormData (browser sets multipart boundary automatically)
    const isFormData =
      typeof FormData !== 'undefined' && options.body instanceof FormData;
    const headers = {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
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
    // Don't log AbortError — these are intentional cancellations
    if (error.name !== 'AbortError') {
      console.error('API call failed:', error);
    }
    throw error;
  }
}

// Load lists from server
async function loadLists() {
  try {
    // OPTIMIZATION: Determine which list to load (now by ID)
    const localLastListId = localStorage.getItem('lastSelectedList');
    const serverLastListId = window.lastSelectedList;
    const targetListId = localLastListId || serverLastListId;

    // OPTIMIZATION: Parallel execution - fetch metadata, groups, rec years, and target list simultaneously
    // This dramatically improves page refresh performance by:
    // 1. Loading only metadata (tiny payload) for the sidebar
    // 2. Loading groups (tiny payload) for sidebar organization
    // 3. Loading recommendation years (tiny payload) for sidebar visibility
    // 4. Loading the target list data in parallel (only what's needed)
    const metadataPromise = apiCall('/api/lists'); // Metadata only (default)
    const groupsPromise = apiCall('/api/groups'); // Groups for sidebar
    const recYearsPromise = apiCall('/api/recommendations/years').catch(() => ({
      years: [],
    })); // Non-critical
    const listDataPromise = targetListId
      ? apiCall(`/api/lists/${encodeURIComponent(targetListId)}`)
      : null;

    // Wait for metadata, groups, and rec years (fast - small payloads)
    const [fetchedLists, fetchedGroups, recYearsData] = await Promise.all([
      metadataPromise,
      groupsPromise,
      recYearsPromise,
    ]);

    // Store which years have recommendations (for sidebar visibility)
    setRecommendationYears(recYearsData.years || []);

    // Initialize groups via centralized state store
    updateGroupsFromServer(fetchedGroups);

    // Initialize lists object with metadata objects (keyed by _id, not name)
    const newLists = {};
    Object.keys(fetchedLists).forEach((listId) => {
      const meta = fetchedLists[listId];
      newLists[listId] = {
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
    setLists(newLists);

    // Load snapshots from localStorage for all lists (enables PATCH on first save after page load)
    const lists = getLists();
    Object.keys(lists).forEach((listId) => {
      const snapshot = loadSnapshotFromStorage(listId);
      if (snapshot && snapshot.length > 0) {
        getLastSavedSnapshots().set(listId, snapshot);
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
        if (!getCurrentListId()) {
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
    getLists()[listId] = {
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
    window.lists = getLists();

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
    if (listId === getCurrentListId() && window.refreshMobileBarVisibility) {
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
    const oldSnapshot = getLastSavedSnapshots().get(listId);
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

      const listName = getLists()[listId]?.name || listId;
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
    getLastSavedSnapshots().set(listId, snapshot);
    saveSnapshotToStorage(listId, snapshot);

    // Update in-memory list data using helper (preserves metadata)
    setListData(listId, cleanedData);

    // Update year in metadata if provided
    if (year !== undefined) {
      updateListMetadata(listId, { year: year });
    }

    // Refresh mobile bar visibility if this is the current list
    // (albums may have been added/removed, affecting whether current track is in list)
    if (listId === getCurrentListId() && window.refreshMobileBarVisibility) {
      window.refreshMobileBarVisibility();
    }
  } catch (error) {
    showToast('Error saving list', 'error');
    throw error;
  }
}

function updateMobileHeader() {
  const headerContainer = document.getElementById('dynamicHeader');
  if (headerContainer && window.currentUser) {
    headerContainer.innerHTML = window.headerComponent(
      window.currentUser,
      'home',
      getCurrentListId() || ''
    );
  }
}

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
    const previousListId = getCurrentListId();

    setCurrentListId(listId);
    // Clear recommendations state when selecting a regular list
    setCurrentRecommendationsYear(null);

    // Update realtime sync subscriptions
    const rtSync = getRealtimeSyncModuleInstance();
    if (rtSync) {
      if (previousListId && previousListId !== listId) {
        rtSync.unsubscribeFromList(previousListId);
      }
      if (listId) {
        rtSync.subscribeToList(listId);
      }
    }

    // Clear playcount cache when switching lists (playcounts are list-item specific)
    clearPlaycountCache();

    // Get the list name for display purposes
    const listName = getLists()[listId]?.name || '';

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
        if (getCurrentListId() === listId) {
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

// ============ RECOMMENDATIONS MODULE BRIDGE ============
// Thin wrapper for backward compatibility (called via window.selectRecommendations)

function selectRecommendations(year) {
  // Clear any stale lock indicator from a previously viewed locked main list
  clearYearLockUI();
  return getRecommendationsModule().selectRecommendations(year);
}

/**
 * Refresh the locked year status for the current list
 * Called after locking/unlocking a year in admin settings
 * @param {number} year - Year that was locked/unlocked
 */
window.refreshLockedYearStatus = async function (year) {
  // Invalidate the cache so we fetch fresh status
  invalidateLockedYearsCache();

  // Get the current list's year and main status
  const currentMeta = getListMetadata(getCurrentListId());
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
      // Main list is now locked - disable sorting and show lock UI
      sorting.destroySorting(container);
      showYearLockUI(container, currentYear);
    } else {
      // Main list is now unlocked - enable sorting and clear lock UI
      const isMobile = window.innerWidth < 1024;
      sorting.initializeUnifiedSorting(container, isMobile);
      clearYearLockUI(container);
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

// Helper function to check if text is truncated
function isTextTruncated(element) {
  // For elements with line-clamp, check if scrollHeight exceeds clientHeight
  return element.scrollHeight > element.clientHeight;
}

// Debounced save function (factory from utils/save-optimizer.js)
const debouncedSaveList = createDebouncedSave({ saveList, showToast });

// ============ WINDOW GLOBALS ============
// Consolidated window assignments for backward compatibility.
// Other modules (musicbrainz.js, list-nav.js, etc.) access these via window.*.

// Core API and data
window.apiCall = apiCall;
window.showToast = showToast;
window.showReasoningModal = showReasoningModal;

// List data accessors
window.getListData = getListData;
window.setListData = setListData;
window.getListMetadata = getListMetadata;
window.updateListMetadata = updateListMetadata;
window.isListDataLoaded = isListDataLoaded;

// List operations
window.saveList = saveList;
window.loadLists = loadLists;
window.selectList = selectList;
window.updateListNav = updateListNav;
window.updatePlaylist = updatePlaylist;
window.toggleMainStatus = toggleMainStatus;
window.displayAlbums = displayAlbums;

// Group helpers
window.getGroup = getGroup;
window.updateGroupsFromServer = updateGroupsFromServer;

// Navigation and state helpers
window.getCurrentListName = getCurrentListName;
window.findListByName = findListByName;
window.isViewingRecommendations = isViewingRecommendations;
window.getCurrentRecommendationsYear = getCurrentRecommendationsYear;
window.selectRecommendations = selectRecommendations;
window.clearSnapshotFromStorage = clearSnapshotFromStorage;

// Mobile UI
window.showMobileAlbumMenu = showMobileAlbumMenu;
window.showMobileMoveToListSheet = showMobileMoveToListSheet;
window.showMobileListMenu = showMobileListMenu;
window.showMobileCategoryMenu = showMobileCategoryMenu;
window.showMobileEditForm = showMobileEditForm;
window.showMobileEditFormSafe = showMobileEditFormSafe;
window.showMobileSummarySheet = showMobileSummarySheet;
window.openRenameCategoryModal = openRenameCategoryModal;

// Playback
window.playAlbum = playAlbum;
window.playTrack = playTrack;
window.playTrackSafe = function (albumId) {
  return getPlaybackModule().playTrackSafe(albumId);
};
window.playSpecificTrack = playSpecificTrack;
window.playAlbumSafe = playAlbumSafe;
window.removeAlbumSafe = removeAlbumSafe;

// Track utilities
window.fetchTracksForAlbum = fetchTracksForAlbum;
window.getTrackName = getTrackName;
window.getTrackLength = getTrackLength;
window.formatTrackTime = formatTrackTime;

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

  // Initialize about modal
  initAboutModal();

  // Sidebar collapse functionality
  function initializeSidebarCollapse() {
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebarToggle');
    const mainContent = document.querySelector('.main-content');

    if (!sidebar || !sidebarToggle || !mainContent) return;

    // Check localStorage for saved state
    const isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';

    // Apply initial state (the inline <head> script already handled the visual state
    // via .sidebar-is-collapsed on <html> to prevent flash — now apply the proper classes
    // and remove the pre-paint override so transitions work normally going forward)
    if (isCollapsed) {
      sidebar.classList.add('collapsed');
      mainContent.classList.add('sidebar-collapsed');
    }
    document.documentElement.classList.remove('sidebar-is-collapsed');

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
        if (!getLists()[name]) {
          // Initialize with metadata object structure (data loaded later)
          getLists()[name] = {
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
      getRecommendationsModule().initializeRecommendationContextMenu();
      getListCrudModule().initializeCategoryContextMenu();
      hideSubmenuOnLeave();
      getListCrudModule().initializeCreateList();
      getListCrudModule().initializeCreateCollection();
      getListCrudModule().initializeRenameList();
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
          const listMetadata = getLists()[listName];
          if (listMetadata) {
            listMetadata._data = null;
          }

          // Refresh if viewing the same list
          if (getCurrentListId() === listName) {
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
                if (getLists()[fileName]) {
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
  if (getCurrentListId()) {
    try {
      localStorage.setItem('lastSelectedList', getCurrentListId());
    } catch (e) {
      // Silently fail - not critical during page unload
      console.warn('Failed to save last selected list on unload:', e.name);
    }
  }
});
