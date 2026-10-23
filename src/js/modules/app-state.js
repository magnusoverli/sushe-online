/**
 * Centralized Application State Store
 *
 * All mutable application state and its accessors/mutators live here.
 * Other modules import state directly instead of receiving getters/setters
 * via dependency injection.
 *
 * State is module-private; access is through exported functions.
 */

import {
  createDefaultListEntry,
  normalizeAlbumRecords,
  normalizeListsMap,
} from './list-data-normalization.js';
import { rememberListItems, rememberListRevision } from './list-revisions.js';
import { stateEvents } from './state-events.js';
import { liveAlbumPatches } from './realtime-album-patches.js';
import { createListSnapshot, saveSnapshotToStorage } from './list-snapshots.js';
export {
  createListSnapshot,
  saveSnapshotToStorage,
  loadSnapshotFromStorage,
  clearSnapshotFromStorage,
} from './list-snapshots.js';

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
  const previous = lists;
  lists = normalizeListsMap(newLists);
  for (const id of new Set([...Object.keys(previous), ...Object.keys(lists)])) {
    if (previous[id]?._data !== lists[id]?._data)
      stateEvents.publish(`list:${id}`);
    if (lists[id]?._data) rememberListItems(id, lists[id]._data);
  }
  stateEvents.publish('lists');
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

  return lists[listId]._data || null;
}

/**
 * Set the album array for a list, preserving metadata
 * Also updates the snapshot for diff-based saves
 * @param {string} listId - The ID of the list
 * @param {Array} albums - The album array to set
 * @param {boolean} updateSnapshot - Whether to update the saved snapshot (default: true)
 */
export function setListData(
  listId,
  albums,
  updateSnapshot = true,
  options = {}
) {
  if (!listId) return;

  const previous = getListData(listId) || [];
  const normalizedAlbums = normalizeAlbumRecords(albums || []);
  const profile = options.profile || 'full';

  if (!lists[listId]) {
    lists[listId] = createDefaultListEntry(listId, normalizedAlbums);
  } else {
    lists[listId]._data = normalizedAlbums;
    lists[listId].count = normalizedAlbums.length;
  }
  lists[listId]._dataProfile = profile;
  rememberListItems(listId, normalizedAlbums);

  // Update snapshot for diff-based saves (when data is fetched from server)
  if (updateSnapshot && albums) {
    rememberListRevision(listId, albums._listRevision);
    const snapshot = createListSnapshot(normalizedAlbums);
    lastSavedSnapshots.set(listId, snapshot);
    saveSnapshotToStorage(listId, snapshot);
  }
  stateEvents.publish(`list:${listId}`);
  const oldItems = new Map(previous.map((item) => [item._id, item]));
  for (const item of normalizedAlbums) {
    if (item._id && oldItems.get(item._id) !== item)
      stateEvents.publish(`item:${item._id}`);
    oldItems.delete(item._id);
  }
  for (const id of oldItems.keys()) if (id) stateEvents.publish(`item:${id}`);
  stateEvents.publish('library');
}

export function patchListItem(listId, itemId, patch) {
  const items = getListData(listId);
  if (!items) return null;
  const index = items.findIndex((item) => item._id === itemId);
  if (index < 0) return null;
  const next = [...items];
  next[index] = { ...items[index], ...patch };
  setListData(listId, next, false, { profile: getListDataProfile(listId) });
  stateEvents.publish(`item:${itemId}`);
  return next[index];
}

export function patchAlbumCopies(
  albumId,
  patch,
  requestGeneration = liveAlbumPatches.generation
) {
  patch = liveAlbumPatches.reconcile(albumId, patch, requestGeneration);
  liveAlbumPatches.remember(albumId, patch);
  for (const [listId, list] of Object.entries(lists)) {
    if (!list._data?.some((item) => item.album_id === albumId)) continue;
    setListData(
      listId,
      list._data.map((item) =>
        item.album_id === albumId ? { ...item, ...patch } : item
      ),
      false,
      { profile: list._dataProfile }
    );
  }
  stateEvents.publish(`album:${albumId}`);
  stateEvents.publish('albums');
  return patch;
}

/**
 * Get the loaded data profile for a list.
 * @param {string} listId - The ID of the list
 * @returns {string|null} - 'core', 'full', or null when not loaded
 */
export function getListDataProfile(listId) {
  if (!listId || !lists[listId] || !Array.isArray(lists[listId]._data)) {
    return null;
  }
  return lists[listId]._dataProfile || 'full';
}

/**
 * Check if a list has full detail data loaded.
 * @param {string} listId - The ID of the list
 * @returns {boolean}
 */
export function isListDataFullyLoaded(listId) {
  return isListDataLoaded(listId) && getListDataProfile(listId) === 'full';
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

  return lists[listId];
}

/**
 * Update metadata for a list (year, name, etc.)
 * @param {string} listId - The ID of the list
 * @param {Object} updates - The metadata fields to update
 */
export function updateListMetadata(listId, updates) {
  if (!listId || !lists[listId]) return;

  // Apply updates
  Object.assign(lists[listId], updates);
  stateEvents.publish(`list:${listId}`);
  stateEvents.publish('lists');
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

  return (
    Array.isArray(listEntry._data) &&
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
  stateEvents.publish('view');
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
  stateEvents.publish('view');
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

// ============ WINDOW GLOBALS (compat bridge) ============
// Consolidated window.* assignments for consumers not yet migrated.
// These are set up once by initWindowGlobals() called from app.js.

export function initWindowGlobals() {
  Object.defineProperty(window, 'currentListId', {
    get: () => currentListId,
    set: (val) => {
      currentListId = val;
    },
    configurable: true,
  });
}
