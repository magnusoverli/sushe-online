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
import { createAppRealtimeSync } from './modules/app-realtime-sync.js';
import { showToast } from './modules/toast.js';
import {
  showConfirmation,
  showReasoningModal,
  hideReasoningModal,
  showViewReasoningModal,
} from './modules/modals.js';
import { positionContextMenu } from './modules/context-menu.js';
import { escapeHtml, escapeHtmlAttr } from './modules/html-utils.js';
import { checkListSetupStatus } from './modules/list-setup-wizard.js';
import { createSettingsDrawer } from './modules/settings-drawer.js';
import { initAboutModal } from './modules/about-modal.js';
import { createActionSheet } from './modules/ui-factories.js';
import {
  invalidateLockedYearsCache,
  invalidateLockedRecommendationYearsCache,
  isListLocked,
  isListLockedSync,
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
import { createContextSubmenuController } from './utils/context-submenu-controller.js';
import { createLazyModule } from './utils/lazy-module.js';
import {
  computeListDiff,
  createDebouncedSave,
} from './utils/save-optimizer.js';
import { createLinkPreview } from './modules/link-preview.js';
import { createRecommendations } from './modules/recommendations.js';
import { createTrackSelection } from './modules/track-selection.js';
import { createListCrud } from './modules/list-crud.js';
import { init as initColumnConfig } from './modules/column-config.js';
import { createPlayback } from './modules/playback.js';
import { createAlbumContextMenu } from './modules/album-context-menu.js';
import { createListReorder } from './modules/list-reorder.js';
import { createAppShellUi } from './modules/app-shell-ui.js';
import { createListSelection } from './modules/list-selection.js';
import { createYearLockStatusRefresh } from './modules/year-lock-status-refresh.js';
import { createAppStartupUi } from './modules/app-startup-ui.js';
import { createAppBootstrap } from './modules/app-bootstrap.js';
import { registerAppGlobalEvents } from './modules/app-global-events.js';
import { registerAppWindowGlobals } from './modules/app-window-globals.js';
import { createAppDiscoveryImport } from './modules/app-discovery-import.js';
import { createAppServiceIntegrations } from './modules/app-service-integrations.js';
import { createMainStatusToggler } from './modules/app-main-status.js';
import { createAppListOperations } from './modules/app-list-operations.js';
import { createAppApiClient } from './modules/app-api-client.js';

// Centralized state store
import {
  getLists,
  setLists,
  getListData,
  setListData,
  getListMetadata,
  updateListMetadata,
  findListByName,
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
  getContextAlbum as getContextAlbumState,
  setContextAlbum as setContextAlbumState,
  getContextList as getContextListState,
  setContextList as setContextListState,
  getContextGroup as getContextGroupState,
  setContextGroup as setContextGroupState,
  getPendingImport as getPendingImportState,
  setPendingImport as setPendingImportState,
  getTrackAbortController as getTrackAbortControllerState,
  setTrackAbortController as setTrackAbortControllerState,
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

function setPendingImportData(data) {
  const pending = getPendingImportState();
  setPendingImportState(data, pending.filename);
}

function setPendingImportFilenameValue(filename) {
  const pending = getPendingImportState();
  setPendingImportState(pending.data, filename);
}

const appApiClient = createAppApiClient({
  getRealtimeSyncModuleInstance,
  logger: console,
});

// ============ LOCAL STATE ============
// State variables scoped to app.js — passed to extracted modules via DI getters/setters.
// The canonical shared state (lists, groups, currentListId, etc.) lives in app-state.js.

const {
  updateMobileHeader,
  showLoadingSpinner,
  updateHeaderTitle,
  isTextTruncated,
} = createAppShellUi({ getCurrentListId });

const {
  convertFlashToToast,
  initializeSidebarCollapse,
  registerBeforeUnloadListSaver,
  cleanupLegacyListCache,
  hydrateSidebarFromCachedNames,
} = createAppStartupUi({ showToast, logger: console });

const { registerDiscoveryAddAlbumHandler, initializeFileImportHandlers } =
  createAppDiscoveryImport({
    showToast,
    getListData,
    apiCall,
    saveList,
    getLists,
    getCurrentListId,
    selectList,
    importList,
    updateListNav,
    setPendingImport: setPendingImportData,
    setPendingImportFilename: setPendingImportFilenameValue,
    logger: console,
  });

const appServiceIntegrations = createAppServiceIntegrations({
  getMusicServicesModule,
  setMusicServicesModule,
  getImportExportModule,
  setImportExportModule,
  showToast,
  getListData,
  getListMetadata,
});

const appListOperations = createAppListOperations({
  apiCall,
  showToast,
  getLists,
  setLists,
  setListData,
  updateListMetadata,
  updateGroupsFromServer,
  getCurrentListId,
  selectList,
  updateListNav,
  setRecommendationYears,
  loadSnapshotFromStorage,
  getLastSavedSnapshots,
  createListSnapshot,
  saveSnapshotToStorage,
  markLocalSave,
  computeListDiff,
  logger: console,
});

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
    escapeHtmlAttr,
    positionContextMenu,
    createActionSheet,
    groupListsByYear,
    editRecommendationReasoning,
    removeRecommendation,
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
    playAlbumByMetadata: (artist, album, options) =>
      getPlaybackModule().playAlbumByMetadata(artist, album, options),
    showPlayAlbumSubmenuForAlbum: (album, menuOptions) =>
      getPlaybackModule().showPlayAlbumSubmenuForAlbum(album, menuOptions),
    createContextSubmenuController,
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
export function fetchTracksForAlbum(album, signal) {
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
    getCurrentContextGroup: () => getContextGroupState(),
    setCurrentContextGroup: (val) => {
      setContextGroupState(val);
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
    getContextAlbum: () => getContextAlbumState(),
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
    apiCall,
    getListData,
    getLists,
    getCurrentListId,
    getCurrentRecommendationsYear,
    getContextAlbum: () => getContextAlbumState(),
    setContextAlbum: (index, albumId) => {
      setContextAlbumState(index, albumId);
    },
    getTrackAbortController: () => getTrackAbortControllerState(),
    setTrackAbortController: (val) => {
      setTrackAbortControllerState(val);
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
    createContextSubmenuController,
  })
);
// Wrapper functions for album context menu module
function hideAllContextMenus() {
  return getAlbumContextMenuModule().hideAllContextMenus();
}
function initializeAlbumContextMenu() {
  return getAlbumContextMenuModule().initializeAlbumContextMenu();
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
    showMobileAlbumMenu,
    showMobileSummarySheet,
    playAlbumByMetadata: (artist, album, options) =>
      getPlaybackModule().playAlbumByMetadata(artist, album, options),
    playTrackSafe: (albumId) => getPlaybackModule().playTrackSafe(albumId),
    playSpecificTrack,
    isViewingRecommendations,
    getTrackName,
    getTrackLength,
    formatTrackTime,
    reapplyNowPlayingBorder,
    initializeUnifiedSorting,
    destroySorting,
    setContextAlbum: (index, albumId) => {
      setContextAlbumState(index, albumId);
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
    selectList,
    showToast,
    showConfirmation,
    apiCall,
    downloadListAsJSON,
    downloadListAsPDF,
    downloadListAsCSV,
    updatePlaylist,
    openRenameModal,
    updateListNav,
    updateListMetadata,
    clearSnapshotFromStorage,
    getContextList: () => getContextListState(),
    setContextList: (listId) => {
      setContextListState(listId);
    },
    setCurrentList: (listName) => {
      setCurrentListId(listName);
    },
    refreshMobileBarVisibility: () => {
      if (window.refreshMobileBarVisibility) {
        window.refreshMobileBarVisibility();
      }
    },
    getCurrentUser: () => window.currentUser || {},
    toggleMainStatus,
    getSortedGroups,
    refreshGroupsAndLists,
  })
);

// Wrapper functions for context menus module
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
    getAvailableCountries,
    getAvailableGenres,
    setCurrentContextAlbum: (idx) => {
      setContextAlbumState(idx, getContextAlbumState().albumId);
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
    openRenameCategoryModal,
    getCurrentUser: () => window.currentUser || {},
  })
);

// Wrapper functions for mobile UI module
function showMobileAlbumMenu(indexOrElement) {
  return getMobileUIModule().showMobileAlbumMenu(indexOrElement);
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

function findAlbumByIdentity(albumId) {
  return getMobileUIModule().findAlbumByIdentity(albumId);
}

/**
 * Refresh groups and lists from server
 * Used after drag-and-drop reordering
 */
async function refreshGroupsAndLists() {
  return appListOperations.refreshGroupsAndLists();
}

const getListNavModule = createLazyModule(() =>
  createListNav({
    getLists,
    getListMetadata,
    getGroups,
    getSortedGroups,
    getCurrentList: () => getCurrentListId(),
    selectList,
    hideAllContextMenus,
    positionContextMenu,
    toggleMobileLists,
    setCurrentContextList: (listName) => {
      setContextListState(listName);
    },
    setCurrentContextGroup: (group) => {
      setContextGroupState(group);
    },
    apiCall,
    showToast,
    refreshGroupsAndLists,
    yearHasRecommendations,
    getCurrentUser: () => window.currentUser || {},
    showMobileListMenu,
    showMobileCategoryMenu,
    selectRecommendations,
    getCurrentRecommendationsYear,
  })
);

// Wrapper functions for list navigation module
function updateListNav() {
  return getListNavModule().updateListNav();
}

function collapseGroupsForActiveList() {
  return getListNavModule().collapseGroupsForActiveList();
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
    getListMetadata,
    isListLockedSync,
    refreshLockedYearStatus: () => refreshLockedYearStatus(),
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

const { saveReorder } = createListReorder({ apiCall, logger: console });

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
    getPendingImport: () => getPendingImportState(),
    setPendingImport: (data, filename) => {
      setPendingImportState(data, filename);
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

const { initializeRealtimeSync } = createAppRealtimeSync({
  getRealtimeSyncModuleInstance,
  setRealtimeSyncModuleInstance,
  getCurrentListId,
  getListData,
  apiCall,
  updateAlbumSummaryInPlace: (albumId, summaryData) =>
    getAlbumDisplayModule().updateAlbumSummaryInPlace(albumId, summaryData),
  wasRecentLocalSave,
  setListData,
  displayAlbums,
  loadLists,
  showToast,
  logger: console,
});

const toggleMainStatus = createMainStatusToggler({
  getListMetadata,
  getSortedGroups,
  showToast,
  apiCall,
  updateListMetadata,
  updateListNav,
  getCurrentListId,
  getListData,
  displayAlbums,
  logger: console,
});

registerAppGlobalEvents({ hideAllContextMenus });

// Show modal to choose a music service
async function showServicePicker(hasSpotify, hasTidal) {
  return appServiceIntegrations.showServicePicker(hasSpotify, hasTidal);
}

async function downloadListAsJSON(listName) {
  return appServiceIntegrations.downloadListAsJSON(listName);
}

async function downloadListAsPDF(listName) {
  return appServiceIntegrations.downloadListAsPDF(listName);
}

async function downloadListAsCSV(listName) {
  return appServiceIntegrations.downloadListAsCSV(listName);
}

async function updatePlaylist(listId, listData = null) {
  return appServiceIntegrations.updatePlaylist(listId, listData);
}

// API helper functions
export async function apiCall(url, options = {}) {
  return appApiClient.apiCall(url, options);
}

// Load lists from server
async function loadLists() {
  return appListOperations.loadLists();
}

// Import list with full data support (track picks, summaries, metadata)
// @param {string} name - List name
// @param {Array} albums - Album array
// @param {Object|null} metadata - Optional metadata from export (year, groupId, groupName)
// @returns {string} - The created list ID
async function importList(name, albums, metadata = null) {
  return appListOperations.importList(name, albums, metadata);
}

// Save list to server
// @param {string} listId - List ID
// @param {Array} data - Album array
// @param {number|null} year - Optional year for the list (required for new lists)
export async function saveList(listId, data, year = undefined) {
  return appListOperations.saveList(listId, data, year);
}

// Select and display a list by ID
const getListSelectionModule = createLazyModule(() =>
  createListSelection({
    setCurrentListId,
    setCurrentRecommendationsYear,
    getCurrentListId,
    getRealtimeSyncModuleInstance,
    clearPlaycountCache,
    getLists,
    updateListNavActiveState,
    updateHeaderTitle,
    updateMobileHeader,
    showLoadingSpinner,
    getListData,
    isListDataLoaded,
    apiCall,
    setListData,
    displayAlbums,
    fetchAndDisplayPlaycounts,
    showToast,
    logger: console,
  })
);

export async function selectList(listId) {
  return getListSelectionModule().selectList(listId);
}

// ============ RECOMMENDATIONS MODULE BRIDGE ============

export function selectRecommendations(year) {
  // Clear any stale lock indicator from a previously viewed locked main list
  clearYearLockUI();
  return getRecommendationsModule().selectRecommendations(year);
}

const { refreshLockedYearStatus } = createYearLockStatusRefresh({
  invalidateLockedYearsCache,
  getListMetadata,
  getCurrentListId,
  isListLocked,
  getSortingModule,
  showYearLockUI,
  clearYearLockUI,
});

// Debounced save function (factory from utils/save-optimizer.js)
const debouncedSaveList = createDebouncedSave({ saveList, showToast });

registerAppWindowGlobals({
  selectList,
  updateListNav,
  collapseGroupsForActiveList,
  displayAlbums,
});

function initializeSettingsDrawer() {
  const settingsDrawer = createSettingsDrawer({
    showToast,
    showConfirmation,
    apiCall,
    refreshLockedYearStatus,
  });

  settingsDrawer.initialize();

  window.openSettingsDrawer = () => {
    settingsDrawer.openDrawer();
  };
}

createAppBootstrap({
  logger: console,
  convertFlashToToast,
  initColumnConfig,
  loadLists,
  initializeSettingsDrawer,
  initAboutModal,
  initializeSidebarCollapse,
  cleanupLegacyListCache,
  hydrateSidebarFromCachedNames,
  getLists,
  updateListNav,
  initializeContextMenu,
  initializeAlbumContextMenu,
  getRecommendationsModule,
  getListCrudModule,
  initializeImportConflictHandling,
  initializeRealtimeSync,
  registerDiscoveryAddAlbumHandler,
  initializeFileImportHandlers,
  checkListSetupStatus,
  showToast,
  importMusicbrainz: () => import('./musicbrainz.js'),
}).initialize();

registerBeforeUnloadListSaver(getCurrentListId);
