/**
 * Centralized Application State Store
 *
 * All mutable application state and its accessors/mutators live here.
 * Other modules import state directly instead of receiving getters/setters
 * via dependency injection.
 *
 * State is module-private; access is through exported functions.
 */

// ============ CORE STATE VARIABLES ============

/** Lists keyed by _id. Structure: { _id, name, year, isMain, count, groupId, sortOrder, _data, updatedAt, createdAt } */
let lists = {};

/** Groups keyed by _id. Structure: { _id, name, year, sortOrder, listCount, isYearGroup, createdAt, updatedAt } */
let groups = {};

/** Currently selected list ID */
let currentListId = '';

/** Year if viewing recommendations, null otherwise */
let currentRecommendationsYear = null;

/** Set of years that have actual recommendations (for sidebar visibility) */
let recommendationYears = new Set();

// ============ CONTEXT MENU STATE ============

/** Currently right-clicked album index */
let currentContextAlbum = null;

/** Currently right-clicked album identity (album_id) */
let currentContextAlbumId = null;

/** Currently right-clicked list ID */
let currentContextList = null;

/** Currently right-clicked group: { id, name, isYearGroup } */
let currentContextGroup = null;

// ============ IMPORT STATE ============

/** Pending import data (for conflict resolution) */
let pendingImportData = null;

/** Pending import filename (for conflict resolution) */
let pendingImportFilename = null;

// ============ TRACK LOADING STATE ============

/** Abort controller for cancelling in-flight track fetches */
let trackAbortController = null;

// ============ MOVE SUBMENU STATE ============

/** Currently highlighted year in move-to-list submenu */
let currentHighlightedYear = null;

/** Timeout for hiding move-to-list submenu */
let moveListsHideTimeout = null;

// ============ RECOMMENDATION STATE ============

/** Current recommendation context for context menu: { rec, year } */
let currentRecommendationContext = null;

/** Currently highlighted year in add-to-list recommendation submenu */
let currentRecommendationAddHighlightedYear = null;

/** Timeout for hiding recommendation add-to-list submenu */
let recommendationAddListsHideTimeout = null;

// ============ LAZY MODULE INSTANCES ============

/** Music services module instance (lazy loaded) */
let musicServicesModule = null;

/** Import/export module instance (lazy loaded) */
let importExportModule = null;

/** Realtime sync module instance */
let realtimeSyncModule = null;

// ============ SAVE STATE ============

/** Debounce timeout for save operations */
let saveTimeout = null;

// ============ CONST MUTABLE CONTAINERS ============

/** Track recent local saves for realtime sync dedup */
const recentLocalSaves = new Map();
const LOCAL_SAVE_GRACE_PERIOD = 5000;

/** Store snapshots of last saved state for diff-based saves */
const lastSavedSnapshots = new Map();

// ============ COMPUTED VALUES ============
// availableGenres and availableCountries are set once at init and never change.
// They are stored here for central access.

let availableGenres = [];
let availableCountries = [];

// ============ LISTS STATE ACCESSORS ============

/**
 * Get the raw lists object
 * @returns {Object} Map of list ID to list metadata/data
 */
export function getLists() {
  return lists;
}

/**
 * Set the entire lists object (used during loadLists)
 * @param {Object} newLists - New lists object
 */
export function setLists(newLists) {
  lists = newLists;
  window.lists = lists;
}

/**
 * Get the album array for a list by ID
 * @param {string} listId - The ID of the list
 * @returns {Array|null} - The album array or null if not found/loaded
 */
export function getListData(listId) {
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
 * Set the album array for a list, preserving metadata
 * Also updates the snapshot for diff-based saves
 * @param {string} listId - The ID of the list
 * @param {Array} albums - The album array to set
 * @param {boolean} updateSnapshot - Whether to update the saved snapshot (default: true)
 */
export function setListData(listId, albums, updateSnapshot = true) {
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
export function getListMetadata(listId) {
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
export function updateListMetadata(listId, updates) {
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
 * Find a list by name (and optionally groupId for disambiguation)
 * @param {string} name - The name of the list
 * @param {string|null} groupId - Optional group ID for disambiguation
 * @returns {Object|null} - The list metadata or null if not found
 */
export function findListByName(name, groupId = null) {
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
export function getCurrentListName() {
  if (!currentListId || !lists[currentListId]) {
    return '';
  }
  return lists[currentListId].name || '';
}

/**
 * Check if list data has been loaded
 * @param {string} listId - The ID of the list
 * @returns {boolean}
 */
export function isListDataLoaded(listId) {
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

// ============ GROUPS STATE ACCESSORS ============

/**
 * Get all groups
 * @returns {Object} - Map of group ID to group data
 */
export function getGroups() {
  return groups;
}

/**
 * Get a group by ID
 * @param {string} groupId - The group ID
 * @returns {Object|null} - The group data or null
 */
export function getGroup(groupId) {
  return groups[groupId] || null;
}

/**
 * Get groups sorted by sort_order
 * @returns {Array} - Sorted array of groups
 */
export function getSortedGroups() {
  return Object.values(groups).sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Update groups from server data
 * @param {Array} groupsArray - Array of group objects from server
 */
export function updateGroupsFromServer(groupsArray) {
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

// ============ CURRENT LIST / RECOMMENDATIONS STATE ============

/**
 * Get the current list ID
 * @returns {string}
 */
export function getCurrentListId() {
  return currentListId;
}

/**
 * Set the current list ID
 * @param {string} listId
 */
export function setCurrentListId(listId) {
  currentListId = listId;
}

/**
 * Check if currently viewing recommendations
 * @returns {boolean}
 */
export function isViewingRecommendations() {
  return currentRecommendationsYear !== null;
}

/**
 * Get current recommendations year
 * @returns {number|null}
 */
export function getCurrentRecommendationsYear() {
  return currentRecommendationsYear;
}

/**
 * Set current recommendations year
 * @param {number|null} year
 */
export function setCurrentRecommendationsYear(year) {
  currentRecommendationsYear = year;
  window.currentRecommendationsYear = year;
}

/**
 * Get the set of years that have recommendations
 * @returns {Set<number>}
 */
export function getRecommendationYears() {
  return recommendationYears;
}

/**
 * Set the years that have recommendations (from API response)
 * @param {number[]} years - Array of years
 */
export function setRecommendationYears(years) {
  recommendationYears = new Set(years);
}

/**
 * Check if a specific year has recommendations
 * @param {number} year
 * @returns {boolean}
 */
export function yearHasRecommendations(year) {
  return recommendationYears.has(year);
}

// ============ CONTEXT MENU STATE ACCESSORS ============

/**
 * Get context album state
 * @returns {{ index: number|null, albumId: string|null }}
 */
export function getContextAlbum() {
  return { index: currentContextAlbum, albumId: currentContextAlbumId };
}

/**
 * Set context album state
 * @param {number|null} index
 * @param {string|null} albumId
 */
export function setContextAlbum(index, albumId) {
  currentContextAlbum = index;
  currentContextAlbumId = albumId;
}

/**
 * Get context list ID
 * @returns {string|null}
 */
export function getContextList() {
  return currentContextList;
}

/**
 * Set context list ID
 * @param {string|null} listId
 */
export function setContextList(listId) {
  currentContextList = listId;
}

/**
 * Get full context state (for DI compat)
 * @returns {{ album: number|null, albumId: string|null, list: string|null }}
 */
export function getContextState() {
  return {
    album: currentContextAlbum,
    albumId: currentContextAlbumId,
    list: currentContextList,
  };
}

/**
 * Set context state from object (for DI compat)
 * @param {Object} state
 */
export function setContextState(state) {
  if ('album' in state) currentContextAlbum = state.album;
  if ('albumId' in state) currentContextAlbumId = state.albumId;
  if ('list' in state) currentContextList = state.list;
}

/**
 * Get context group
 * @returns {Object|null}
 */
export function getContextGroup() {
  return currentContextGroup;
}

/**
 * Set context group
 * @param {Object|null} group - { id, name, isYearGroup }
 */
export function setContextGroup(group) {
  currentContextGroup = group;
}

// ============ IMPORT STATE ACCESSORS ============

/**
 * Get pending import data
 * @returns {{ data: Object|null, filename: string|null }}
 */
export function getPendingImport() {
  return { data: pendingImportData, filename: pendingImportFilename };
}

/**
 * Set pending import data
 * @param {Object|null} data
 * @param {string|null} filename
 */
export function setPendingImport(data, filename) {
  pendingImportData = data;
  pendingImportFilename = filename;
}

// ============ TRACK ABORT CONTROLLER ============

/**
 * Get the track abort controller
 * @returns {AbortController|null}
 */
export function getTrackAbortController() {
  return trackAbortController;
}

/**
 * Set the track abort controller
 * @param {AbortController|null} controller
 */
export function setTrackAbortController(controller) {
  trackAbortController = controller;
}

// ============ MOVE SUBMENU STATE ============

export function getCurrentHighlightedYear() {
  return currentHighlightedYear;
}

export function setCurrentHighlightedYear(year) {
  currentHighlightedYear = year;
}

export function getMoveListsHideTimeout() {
  return moveListsHideTimeout;
}

export function setMoveListsHideTimeout(timeout) {
  moveListsHideTimeout = timeout;
}

// ============ RECOMMENDATION CONTEXT STATE ============

export function getCurrentRecommendationContext() {
  return currentRecommendationContext;
}

export function setCurrentRecommendationContext(ctx) {
  currentRecommendationContext = ctx;
}

export function getRecommendationAddHighlightedYear() {
  return currentRecommendationAddHighlightedYear;
}

export function setRecommendationAddHighlightedYear(year) {
  currentRecommendationAddHighlightedYear = year;
}

export function getRecommendationAddListsHideTimeout() {
  return recommendationAddListsHideTimeout;
}

export function setRecommendationAddListsHideTimeout(timeout) {
  recommendationAddListsHideTimeout = timeout;
}

// ============ LAZY MODULE ACCESSORS ============

export function getMusicServicesModule() {
  return musicServicesModule;
}

export function setMusicServicesModule(mod) {
  musicServicesModule = mod;
}

export function getImportExportModule() {
  return importExportModule;
}

export function setImportExportModule(mod) {
  importExportModule = mod;
}

export function getRealtimeSyncModule() {
  return realtimeSyncModule;
}

export function setRealtimeSyncModule(mod) {
  realtimeSyncModule = mod;
}

// ============ SAVE STATE ============

export function getSaveTimeout() {
  return saveTimeout;
}

export function setSaveTimeout(timeout) {
  saveTimeout = timeout;
}

// ============ LOCAL SAVE TRACKING ============

/**
 * Mark a list as recently saved locally
 * @param {string} listName - Name of the list that was saved
 */
export function markLocalSave(listName) {
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
export function wasRecentLocalSave(listName) {
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

// ============ SNAPSHOT STATE ============

/**
 * Get the last saved snapshots map
 * @returns {Map}
 */
export function getLastSavedSnapshots() {
  return lastSavedSnapshots;
}

/**
 * Create a lightweight snapshot of album IDs for diff comparison
 * @param {Array} albums - Album array
 * @returns {Array} Array of album_id strings
 */
export function createListSnapshot(albums) {
  if (!albums || !Array.isArray(albums)) return [];
  return albums.map((a) => a.album_id || a.albumId || null).filter(Boolean);
}

/**
 * Save snapshot to localStorage for persistence across page reloads
 * @param {string} listId - The list ID
 * @param {Array} snapshot - Array of album IDs
 */
export function saveSnapshotToStorage(listId, snapshot) {
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
export function loadSnapshotFromStorage(listId) {
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
export function clearSnapshotFromStorage(listId) {
  if (!listId) return;
  try {
    const key = `list-snapshot-${listId}`;
    localStorage.removeItem(key);
  } catch (_e) {
    // Silently fail
  }
}

// ============ COMPUTED / STATIC DATA ============

export function getAvailableGenres() {
  return availableGenres;
}

export function setAvailableGenres(genres) {
  availableGenres = genres;
}

export function getAvailableCountries() {
  return availableCountries;
}

export function setAvailableCountries(countries) {
  availableCountries = countries;
  window.availableCountries = countries;
}

// ============ WINDOW GLOBALS (legacy bridge) ============
// Consolidated window.* assignments for consumers not yet migrated.
// These are set up once by initWindowGlobals() called from app.js.

export function initWindowGlobals() {
  // Legacy compatibility - expose currentList as alias for currentListId
  Object.defineProperty(window, 'currentList', {
    get: () => currentListId,
    set: (val) => {
      currentListId = val;
    },
    configurable: true,
  });

  Object.defineProperty(window, 'currentListId', {
    get: () => currentListId,
    set: (val) => {
      currentListId = val;
    },
    configurable: true,
  });
}
