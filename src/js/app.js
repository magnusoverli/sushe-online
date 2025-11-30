// Import static data at build time
import genresText from '../data/genres.txt?raw';
import countriesText from '../data/countries.txt?raw';
import { getAlbumKey, isAlbumInList } from './modules/utils.js';
import { createAlbumDisplay } from './modules/album-display.js';
import { createContextMenus } from './modules/context-menus.js';

// Lazy loading module cache
let musicServicesModule = null;
let importExportModule = null;

// Album display module instance (initialized lazily when first needed)
let albumDisplayModule = null;

// Context menus module instance (initialized lazily when first needed)
let contextMenusModule = null;

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
      formatReleaseDate,
      isYearMismatch,
      extractYearFromDate,
      fetchTracksForAlbum,
      makeCountryEditable,
      makeGenreEditable,
      makeCommentEditable,
      attachLinkPreview,
      showTrackSelectionMenu,
      showMobileEditForm,
      showMobileAlbumMenu: (el) => window.showMobileAlbumMenu(el),
      playTrackSafe: (albumId) => window.playTrackSafe(albumId),
      reapplyNowPlayingBorder,
      initializeUnifiedSorting,
    });
  }
  return albumDisplayModule;
}

// Wrapper functions that delegate to the module
function displayAlbums(albums, options = {}) {
  return getAlbumDisplayModule().displayAlbums(albums, options);
}

function fetchAndApplyCovers(albums) {
  return getAlbumDisplayModule().fetchAndApplyCovers(albums);
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
      updatePlaylist,
      openRenameModal,
      updateListNav,
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
      toggleOfficialStatus,
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

// Global variables
let lists = {};
let currentList = '';
let currentContextAlbum = null;
let currentContextAlbumId = null; // Store album identity as backup
let currentContextList = null;

// Now-playing feature state
let currentNowPlayingElements = [];
let lastKnownPlayback = null; // Cache for re-applying after list render

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
let confirmationCallback = null;

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
      isOfficial: false,
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
      isOfficial: false,
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
      isOfficial: false,
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
      isOfficial: false,
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
 * Toggle official status for a list
 * @param {string} listName - The name of the list
 */
async function toggleOfficialStatus(listName) {
  const meta = getListMetadata(listName);
  if (!meta) return;

  // Check if list has a year assigned
  if (!meta.year) {
    showToast('List must have a year to be marked as official', 'error');
    return;
  }

  const newOfficialStatus = !meta.isOfficial;

  try {
    const response = await apiCall(
      `/api/lists/${encodeURIComponent(listName)}/official`,
      {
        method: 'POST',
        body: JSON.stringify({ isOfficial: newOfficialStatus }),
      }
    );

    // Update local metadata
    updateListMetadata(listName, { isOfficial: newOfficialStatus });

    // If another list lost its official status, update it too
    if (response.previousOfficialList) {
      updateListMetadata(response.previousOfficialList, { isOfficial: false });
    }

    // Refresh sidebar to show updated star icons
    updateListNav();

    // Show appropriate message
    if (newOfficialStatus) {
      if (response.previousOfficialList) {
        showToast(
          `"${listName}" is now your official ${meta.year} list (replaced "${response.previousOfficialList}")`
        );
      } else {
        showToast(`"${listName}" is now your official ${meta.year} list`);
      }
    } else {
      showToast(`"${listName}" is no longer marked as official`);
    }
  } catch (error) {
    console.error('Error toggling official status:', error);
    showToast('Error updating official status', 'error');
  }
}

// Expose helpers to window for other modules
window.getListData = getListData;
window.setListData = setListData;
window.getListMetadata = getListMetadata;
window.updateListMetadata = updateListMetadata;
window.isListDataLoaded = isListDataLoaded;
window.toggleOfficialStatus = toggleOfficialStatus;

// ============ NOW PLAYING ALBUM HIGHLIGHT ============
// Shows an animated border on album covers matching the currently playing Spotify track

/**
 * Normalize a string for fuzzy matching (remove diacritics, punctuation, lowercase)
 */
function normalizeForMatch(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/[^a-z0-9\s]/g, '') // Remove non-alphanumeric (keep spaces)
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

/**
 * Check if a list album matches the currently playing Spotify track
 */
function isAlbumMatchingPlayback(
  listAlbum,
  playingAlbumName,
  playingArtistName
) {
  if (!listAlbum || !playingAlbumName || !playingArtistName) return false;

  const albumMatch =
    normalizeForMatch(listAlbum.album) === normalizeForMatch(playingAlbumName);
  const artistMatch =
    normalizeForMatch(listAlbum.artist) ===
    normalizeForMatch(playingArtistName);

  return albumMatch && artistMatch;
}

/**
 * Find the album cover DOM element for a given album index
 */
function findAlbumCoverElement(index) {
  const isMobile = window.innerWidth < 1024;

  if (isMobile) {
    // Mobile: album-card has data-index (not the wrapper)
    const card = document.querySelector(`.album-card[data-index="${index}"]`);
    // The cover wrapper div (not the img, since img can't have ::before)
    return card?.querySelector('.mobile-album-cover');
  } else {
    // Desktop: album rows have data-index
    const row = document.querySelector(`.album-row[data-index="${index}"]`);
    return row?.querySelector('.album-cover-container');
  }
}

/**
 * Update now-playing border based on playback state
 * Called when playback changes or when list is rendered
 */
function updateNowPlayingBorder(playbackDetail) {
  // Remove existing borders from all previously marked elements
  currentNowPlayingElements.forEach((el) => {
    if (el) el.classList.remove('now-playing');
  });
  currentNowPlayingElements = [];

  // Cache the playback detail for re-application after list renders
  lastKnownPlayback = playbackDetail;

  // Exit if no playback or playback stopped (not paused)
  if (!playbackDetail || !playbackDetail.hasPlayback) {
    console.log('[Now Playing] No playback or stopped');
    return;
  }

  console.log('[Now Playing] Looking for:', {
    album: playbackDetail.albumName,
    artist: playbackDetail.artistName,
    currentList,
  });

  // Get current list albums
  const albums = getListData(currentList);
  if (!albums || !Array.isArray(albums)) {
    console.log('[Now Playing] No albums in current list');
    return;
  }

  // Find matching album(s) and apply the now-playing class
  let matchCount = 0;
  albums.forEach((album, index) => {
    if (
      isAlbumMatchingPlayback(
        album,
        playbackDetail.albumName,
        playbackDetail.artistName
      )
    ) {
      matchCount++;
      const coverEl = findAlbumCoverElement(index);
      console.log(
        '[Now Playing] Match found at index',
        index,
        '- element:',
        coverEl
      );
      if (coverEl) {
        coverEl.classList.add('now-playing');
        currentNowPlayingElements.push(coverEl);
      }
    }
  });

  if (matchCount === 0) {
    console.log(
      '[Now Playing] No matches in',
      albums.length,
      'albums. Sample album:',
      albums[0]
    );
  }
}

/**
 * Re-apply now-playing border after list render
 * Called from displayAlbums after DOM is updated
 */
function reapplyNowPlayingBorder() {
  if (lastKnownPlayback) {
    // Small delay to ensure DOM is fully rendered
    requestAnimationFrame(() => {
      updateNowPlayingBorder(lastKnownPlayback);
    });
  }
}

// Listen for playback changes from Spotify player module
window.addEventListener('spotify-playback-change', (e) => {
  updateNowPlayingBorder(e.detail);
});

// Expose for manual triggering if needed
window.updateNowPlayingBorder = updateNowPlayingBorder;
window.reapplyNowPlayingBorder = reapplyNowPlayingBorder;

// Performance optimization: Batch DOM style reads/writes to prevent layout thrashing
// Positions a menu element and adjusts if it would overflow the viewport
function positionContextMenu(menu, x, y) {
  // Hide FAB when context menu is shown to avoid overlap on mobile
  const fab = document.getElementById('addAlbumFAB');
  if (fab) {
    fab.style.display = 'none';
  }

  // Initial position
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.classList.remove('hidden');

  // Use requestAnimationFrame to batch the read phase after paint
  requestAnimationFrame(() => {
    // Read phase - measure menu dimensions and viewport
    const rect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Calculate phase - determine adjustments needed
    let adjustedX = x;
    let adjustedY = y;

    if (rect.right > viewportWidth) {
      adjustedX = x - rect.width;
    }
    if (rect.bottom > viewportHeight) {
      adjustedY = y - rect.height;
    }

    // Write phase - apply adjustments if needed
    if (adjustedX !== x || adjustedY !== y) {
      menu.style.left = `${adjustedX}px`;
      menu.style.top = `${adjustedY}px`;
    }
  });
}

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

export function showConfirmation(
  title,
  message,
  subMessage,
  confirmText = 'Confirm',
  onConfirm = null
) {
  const modal = document.getElementById('confirmationModal');
  const titleEl = document.getElementById('confirmationTitle');
  const messageEl = document.getElementById('confirmationMessage');
  const subMessageEl = document.getElementById('confirmationSubMessage');
  const confirmBtn = document.getElementById('confirmationConfirmBtn');
  const cancelBtn = document.getElementById('confirmationCancelBtn');

  titleEl.textContent = title;
  messageEl.textContent = message;
  subMessageEl.textContent = subMessage || '';
  confirmBtn.textContent = confirmText;

  // If onConfirm is provided, use callback style
  if (onConfirm) {
    confirmationCallback = onConfirm;

    const handleConfirm = () => {
      modal.classList.add('hidden');
      confirmBtn.removeEventListener('click', handleConfirm);
      cancelBtn.removeEventListener('click', handleCancel);
      modal.removeEventListener('click', handleBackdropClick);
      document.removeEventListener('keydown', handleEscKey);
      if (confirmationCallback) {
        confirmationCallback();
        confirmationCallback = null;
      }
    };

    const handleCancel = () => {
      modal.classList.add('hidden');
      confirmBtn.removeEventListener('click', handleConfirm);
      cancelBtn.removeEventListener('click', handleCancel);
      modal.removeEventListener('click', handleBackdropClick);
      document.removeEventListener('keydown', handleEscKey);
      confirmationCallback = null;
    };

    const handleBackdropClick = (e) => {
      if (e.target === modal) {
        handleCancel();
      }
    };

    const handleEscKey = (e) => {
      if (e.key === 'Escape') {
        handleCancel();
      }
    };

    confirmBtn.addEventListener('click', handleConfirm);
    cancelBtn.addEventListener('click', handleCancel);
    modal.addEventListener('click', handleBackdropClick);
    document.addEventListener('keydown', handleEscKey);

    modal.classList.remove('hidden');
    setTimeout(() => confirmBtn.focus(), 100);
    return;
  }

  // Otherwise return a promise for async/await style
  return new Promise((resolve) => {
    const handleConfirm = () => {
      modal.classList.add('hidden');
      confirmBtn.removeEventListener('click', handleConfirm);
      cancelBtn.removeEventListener('click', handleCancel);
      modal.removeEventListener('click', handleBackdropClick);
      document.removeEventListener('keydown', handleEscKey);
      resolve(true);
    };

    const handleCancel = () => {
      modal.classList.add('hidden');
      confirmBtn.removeEventListener('click', handleConfirm);
      cancelBtn.removeEventListener('click', handleCancel);
      modal.removeEventListener('click', handleBackdropClick);
      document.removeEventListener('keydown', handleEscKey);
      resolve(false);
    };

    const handleBackdropClick = (e) => {
      if (e.target === modal) {
        handleCancel();
      }
    };

    const handleEscKey = (e) => {
      if (e.key === 'Escape') {
        handleCancel();
      }
    };

    confirmBtn.addEventListener('click', handleConfirm);
    cancelBtn.addEventListener('click', handleCancel);
    modal.addEventListener('click', handleBackdropClick);
    document.addEventListener('keydown', handleEscKey);

    modal.classList.remove('hidden');
    setTimeout(() => confirmBtn.focus(), 100);
  });
}

function hideConfirmation() {
  const modal = document.getElementById('confirmationModal');
  modal.classList.add('hidden');
  confirmationCallback = null;
}

// Show modal to choose a music service
async function showServicePicker(hasSpotify, hasTidal) {
  if (!musicServicesModule) {
    musicServicesModule = await import('./modules/music-services.js');
  }
  return musicServicesModule.showServicePicker(hasSpotify, hasTidal);
}

// Extract year from a release date string (various formats)
function extractYearFromDate(dateStr) {
  if (!dateStr) return null;

  // Year only (e.g., "2024")
  if (/^\d{4}$/.test(dateStr)) {
    return parseInt(dateStr, 10);
  }

  // ISO format: YYYY-MM-DD or YYYY-MM
  if (/^\d{4}-/.test(dateStr)) {
    return parseInt(dateStr.substring(0, 4), 10);
  }

  // MM/DD/YYYY or DD/MM/YYYY format
  const slashMatch = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    return parseInt(slashMatch[3], 10);
  }

  // MM/YYYY format (month/year)
  const monthYearMatch = dateStr.match(/(\d{1,2})\/(\d{4})/);
  if (monthYearMatch) {
    return parseInt(monthYearMatch[2], 10);
  }

  return null;
}

// Check if release date year matches list year
function isYearMismatch(releaseDate, listYear) {
  if (!listYear) return false; // No list year set, no mismatch possible
  if (!releaseDate) return false; // No release date, no mismatch

  const releaseYear = extractYearFromDate(releaseDate);
  if (!releaseYear) return false; // Couldn't parse year

  return releaseYear !== listYear;
}

// Standardize date formats for release dates
function formatReleaseDate(dateStr) {
  if (!dateStr) return '';

  const userFormat = window.currentUser?.dateFormat || 'MM/DD/YYYY';

  // Year only
  if (/^\d{4}$/.test(dateStr)) {
    return dateStr;
  }

  // Year-month
  if (/^\d{4}-\d{2}$/.test(dateStr)) {
    const [year, month] = dateStr.split('-');
    return `${month}/${year}`;
  }

  const iso = normalizeDateForInput(dateStr);
  if (!iso) return dateStr;

  const [year, month, day] = iso.split('-');

  if (userFormat === 'DD/MM/YYYY') {
    return `${day}/${month}/${year}`;
  }
  return `${month}/${day}/${year}`;
}

// Convert various date formats to ISO YYYY-MM-DD for date input fields
function normalizeDateForInput(dateStr) {
  if (!dateStr) return '';

  const userFormat = window.currentUser?.dateFormat;

  // Year only
  if (/^\d{4}$/.test(dateStr)) {
    return `${dateStr}-01-01`;
  }

  // Year-month
  if (/^\d{4}-\d{2}$/.test(dateStr)) {
    return `${dateStr}-01`;
  }

  // ISO already
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }

  // Formats like DD/MM/YYYY or MM/DD/YYYY or with dashes
  const parts = dateStr.split(/[/-]/);
  if (
    parts.length === 3 &&
    /^\d{1,2}$/.test(parts[0]) &&
    /^\d{1,2}$/.test(parts[1]) &&
    /^\d{4}$/.test(parts[2])
  ) {
    const first = parseInt(parts[0], 10);
    const second = parseInt(parts[1], 10);
    const year = parts[2];
    let day, month;
    if (first > 12) {
      day = first;
      month = second;
    } else if (second > 12) {
      month = first;
      day = second;
    } else if (userFormat === 'DD/MM/YYYY') {
      day = first;
      month = second;
    } else {
      month = first;
      day = second;
    }
    return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
  }

  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split('T')[0];
  }

  return '';
}

// Convert YYYY-MM-DD to the user's preferred format
function formatDateForStorage(isoDate) {
  if (!isoDate) return '';
  const userFormat = window.currentUser?.dateFormat || 'MM/DD/YYYY';
  const [year, month, day] = isoDate.split('-');
  if (userFormat === 'DD/MM/YYYY') {
    return `${day}/${month}/${year}`;
  }
  return `${month}/${day}/${year}`;
}

// Load available countries

async function downloadListAsJSON(listName) {
  if (!importExportModule) {
    showToast('Loading export module...', 'info', 1000);
    importExportModule = await import('./modules/import-export.js');
  }
  return importExportModule.downloadListAsJSON(listName);
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

// Initialize import conflict handling
function initializeImportConflictHandling() {
  const conflictModal = document.getElementById('importConflictModal');
  const renameModal = document.getElementById('importRenameModal');
  const originalImportNameSpan = document.getElementById('originalImportName');
  const importNewNameInput = document.getElementById('importNewName');

  // Check if elements exist before setting handlers
  const importOverwriteBtn = document.getElementById('importOverwriteBtn');
  const importRenameBtn = document.getElementById('importRenameBtn');
  const importMergeBtn = document.getElementById('importMergeBtn');
  const importCancelBtn = document.getElementById('importCancelBtn');
  const confirmImportRenameBtn = document.getElementById(
    'confirmImportRenameBtn'
  );
  const cancelImportRenameBtn = document.getElementById(
    'cancelImportRenameBtn'
  );

  if (
    !importOverwriteBtn ||
    !importRenameBtn ||
    !importMergeBtn ||
    !importCancelBtn
  ) {
    // Elements don't exist on this page, skip initialization
    return;
  }

  // Overwrite option
  importOverwriteBtn.onclick = async () => {
    if (!pendingImportData || !pendingImportFilename) return;

    conflictModal.classList.add('hidden');

    try {
      await saveList(pendingImportFilename, pendingImportData);
      updateListNav();
      selectList(pendingImportFilename);
      showToast(
        `Overwritten "${pendingImportFilename}" with ${pendingImportData.length} albums`
      );
    } catch (err) {
      console.error('Import overwrite error:', err);
      showToast('Error overwriting list', 'error');
    }

    pendingImportData = null;
    pendingImportFilename = null;
  };

  // Rename option
  importRenameBtn.onclick = () => {
    conflictModal.classList.add('hidden');
    originalImportNameSpan.textContent = pendingImportFilename;

    // Suggest a new name
    let suggestedName = pendingImportFilename;
    let counter = 1;
    while (lists[suggestedName]) {
      suggestedName = `${pendingImportFilename} (${counter})`;
      counter++;
    }
    importNewNameInput.value = suggestedName;

    renameModal.classList.remove('hidden');

    setTimeout(() => {
      importNewNameInput.focus();
      importNewNameInput.select();
    }, 100);
  };

  // Merge option
  importMergeBtn.onclick = async () => {
    if (!pendingImportData || !pendingImportFilename) return;

    conflictModal.classList.add('hidden');

    try {
      // Get existing list data using helper function
      const existingList = getListData(pendingImportFilename) || [];

      // Merge the lists (avoiding duplicates based on artist + album)
      const existingKeys = new Set(existingList.map(getAlbumKey));

      const newAlbums = pendingImportData.filter(
        (album) => !existingKeys.has(getAlbumKey(album))
      );

      const mergedList = [...existingList, ...newAlbums];

      await saveList(pendingImportFilename, mergedList);
      updateListNav();
      selectList(pendingImportFilename);

      const addedCount = newAlbums.length;
      const skippedCount = pendingImportData.length - addedCount;

      if (skippedCount > 0) {
        showToast(
          `Added ${addedCount} new albums, skipped ${skippedCount} duplicates`
        );
      } else {
        showToast(`Added ${addedCount} albums to "${pendingImportFilename}"`);
      }
    } catch (err) {
      console.error('Import merge error:', err);
      showToast('Error merging lists', 'error');
    }

    pendingImportData = null;
    pendingImportFilename = null;
  };

  // Cancel import
  importCancelBtn.onclick = () => {
    conflictModal.classList.add('hidden');
    pendingImportData = null;
    pendingImportFilename = null;
    showToast('Import cancelled');
  };

  // Rename modal handlers
  if (confirmImportRenameBtn) {
    confirmImportRenameBtn.onclick = async () => {
      const newName = importNewNameInput.value.trim();

      if (!newName) {
        showToast('Please enter a new name', 'error');
        return;
      }

      if (lists[newName]) {
        showToast('A list with this name already exists', 'error');
        return;
      }

      renameModal.classList.add('hidden');

      try {
        await saveList(newName, pendingImportData);
        updateListNav();
        selectList(newName);
        showToast(
          `Imported as "${newName}" with ${pendingImportData.length} albums`
        );
      } catch (err) {
        console.error('Import with rename error:', err);
        showToast('Error importing list', 'error');
      }

      pendingImportData = null;
      pendingImportFilename = null;
    };
  }

  if (cancelImportRenameBtn) {
    cancelImportRenameBtn.onclick = () => {
      renameModal.classList.add('hidden');
      // Go back to conflict modal
      document.getElementById('conflictListName').textContent =
        pendingImportFilename;
      conflictModal.classList.remove('hidden');
    };
  }

  // Enter key in rename input
  if (importNewNameInput) {
    importNewNameInput.onkeypress = (e) => {
      if (e.key === 'Enter' && confirmImportRenameBtn) {
        confirmImportRenameBtn.click();
      }
    };
  }
}

// Make country editable with datalist
function makeCountryEditable(countryDiv, albumIndex) {
  // Check if we're already editing
  if (countryDiv.querySelector('input')) {
    return;
  }

  // Get current country from the live data
  const albums = getListData(currentList);
  if (!albums || !albums[albumIndex]) return;
  const currentCountry = albums[albumIndex].country || '';

  // Create input with datalist
  const input = document.createElement('input');
  input.type = 'text';
  input.className =
    'w-full bg-gray-800 text-gray-300 text-sm p-1 rounded border border-gray-700 focus:outline-none focus:border-gray-500';
  input.value = currentCountry;
  input.placeholder = 'Type to search countries...';
  input.setAttribute('list', `country-list-${currentList}-${albumIndex}`);

  // Create datalist
  const datalist = document.createElement('datalist');
  datalist.id = `country-list-${currentList}-${albumIndex}`;

  // Add all available countries
  availableCountries.forEach((country) => {
    const option = document.createElement('option');
    option.value = country;
    datalist.appendChild(option);
  });

  // Store the original onclick handler
  const originalOnClick = countryDiv.onclick;
  countryDiv.onclick = null; // Temporarily remove click handler

  // Replace content with input and datalist
  countryDiv.innerHTML = '';
  countryDiv.appendChild(input);
  countryDiv.appendChild(datalist);
  input.focus();
  input.select();

  // Create handleClickOutside function so we can reference it for removal
  let handleClickOutside;

  const restoreDisplay = (valueToDisplay) => {
    // Remove the click outside listener if it exists
    if (handleClickOutside) {
      document.removeEventListener('click', handleClickOutside);
      handleClickOutside = null;
    }

    // Show placeholder if empty
    const displayValue = valueToDisplay || 'Country';
    const displayClass = valueToDisplay
      ? 'text-gray-300'
      : 'text-gray-500 italic';

    countryDiv.innerHTML = `<span class="text-sm ${displayClass} truncate cursor-pointer hover:text-gray-100">${displayValue}</span>`;

    // Restore the original click handler
    countryDiv.onclick = originalOnClick;
  };

  const saveCountry = async (newCountry) => {
    // Trim the input
    newCountry = newCountry.trim();

    // Check if value actually changed
    if (newCountry === currentCountry) {
      restoreDisplay(currentCountry);
      return;
    }

    // VALIDATION: Only allow empty string or values from availableCountries
    if (newCountry !== '') {
      const isValid = availableCountries.some(
        (country) => country.toLowerCase() === newCountry.toLowerCase()
      );

      if (!isValid) {
        // Invalid country entered - revert to original
        restoreDisplay(currentCountry);
        return;
      }

      // Find the exact case-matched country from the list
      const matchedCountry = availableCountries.find(
        (country) => country.toLowerCase() === newCountry.toLowerCase()
      );
      newCountry = matchedCountry; // Use the properly cased version
    }

    // Update the data
    const albumsToUpdate = getListData(currentList);
    if (!albumsToUpdate || !albumsToUpdate[albumIndex]) return;
    albumsToUpdate[albumIndex].country = newCountry;

    // Close the dropdown immediately for better UX
    restoreDisplay(newCountry);

    try {
      await saveList(currentList, albumsToUpdate);
      showToast(newCountry === '' ? 'Country cleared' : 'Country updated');
    } catch (_error) {
      showToast('Error saving country', 'error');
      // Revert on error
      albumsToUpdate[albumIndex].country = currentCountry;
      restoreDisplay(currentCountry);
    }
  };

  // Handle input change (when selecting from datalist)
  input.addEventListener('change', (e) => {
    saveCountry(e.target.value);
  });

  // Handle blur (when clicking away)
  input.addEventListener('blur', () => {
    saveCountry(input.value);
  });

  // Handle keyboard
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveCountry(input.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      restoreDisplay(currentCountry);
    }
  });

  // Define handleClickOutside
  handleClickOutside = (e) => {
    if (!countryDiv.contains(e.target)) {
      saveCountry(input.value);
    }
  };

  // Small delay to prevent immediate trigger
  setTimeout(() => {
    document.addEventListener('click', handleClickOutside);
  }, 100);
}

// Toast notification management
let toastTimer = null;

// Show toast notification with configurable duration
export function showToast(message, type = 'success', duration = null) {
  const toast = document.getElementById('toast');

  // Clear any existing timer
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }

  // Remove 'show' class immediately to reset animation
  toast.classList.remove('show');

  toast.textContent = message;
  toast.className = 'toast ' + type;

  // Show the toast
  setTimeout(() => toast.classList.add('show'), 10);

  // Determine duration based on type and content
  if (duration === null) {
    // Default durations
    if (type === 'success' && message.includes('successfully')) {
      duration = 5000; // 5 seconds for success messages
    } else if (type === 'error') {
      duration = 5000; // 5 seconds for errors
    } else if (message.includes('...')) {
      duration = 10000; // 10 seconds for "loading" messages
    } else {
      duration = 3000; // 3 seconds for other messages
    }
  }

  // Set timer to hide the toast
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
    toastTimer = null;
  }, duration);
}

// Make showToast globally available immediately
window.showToast = showToast;

// API helper functions
export async function apiCall(url, options = {}) {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
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

// Fetch link preview metadata
async function fetchLinkPreview(url) {
  try {
    return await apiCall(`/api/unfurl?url=${encodeURIComponent(url)}`);
  } catch (err) {
    console.error('Link preview error:', err);
    return null;
  }
}

function attachLinkPreview(container, comment) {
  const urlMatch = comment && comment.match(/https?:\/\/\S+/);
  if (!urlMatch) return;
  const url = urlMatch[0];
  const previewEl = document.createElement('div');
  previewEl.className = 'mt-2 text-xs bg-gray-800 rounded';
  previewEl.textContent = 'Loading preview...';
  container.appendChild(previewEl);
  fetchLinkPreview(url)
    .then((data) => {
      if (!data) {
        previewEl.remove();
        return;
      }
      const img = data.image
        ? `<img src="${data.image}" class="w-12 h-12 object-cover rounded flex-shrink-0" alt="">`
        : '';
      const desc = data.description
        ? `<div class="text-gray-400 truncate">${data.description}</div>`
        : '';
      previewEl.innerHTML = `<a href="${url}" target="_blank" class="flex gap-2 p-2 items-center">${img}<div class="min-w-0"><div class="font-semibold text-gray-100 truncate">${data.title || url}</div>${desc}</div></a>`;
    })
    .catch(() => previewEl.remove());
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
    // Structure: { name, year, isOfficial, count, _data, updatedAt, createdAt }
    lists = {};
    Object.keys(fetchedLists).forEach((name) => {
      const meta = fetchedLists[name];
      lists[name] = {
        name: meta.name || name,
        year: meta.year || null,
        isOfficial: meta.isOfficial || false,
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

  const toFetch = list.filter(
    (album) => !Array.isArray(album.tracks) || album.tracks.length === 0
  );
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

// Initialize context menu
function initializeContextMenu() {
  const contextMenu = document.getElementById('contextMenu');
  const downloadOption = document.getElementById('downloadListOption');
  const renameOption = document.getElementById('renameListOption');
  const toggleOfficialOption = document.getElementById('toggleOfficialOption');
  const updatePlaylistOption = document.getElementById('updatePlaylistOption');
  const deleteOption = document.getElementById('deleteListOption');

  if (
    !contextMenu ||
    !deleteOption ||
    !renameOption ||
    !downloadOption ||
    !updatePlaylistOption ||
    !toggleOfficialOption
  )
    return;

  // Update the playlist option text based on user's music service
  const updatePlaylistText = document.getElementById('updatePlaylistText');
  if (updatePlaylistText) {
    const musicService = window.currentUser?.musicService;
    const hasSpotify = window.currentUser?.spotifyAuth;
    const hasTidal = window.currentUser?.tidalAuth;

    if (musicService === 'spotify' && hasSpotify) {
      updatePlaylistText.textContent = 'Send to Spotify';
    } else if (musicService === 'tidal' && hasTidal) {
      updatePlaylistText.textContent = 'Send to Tidal';
    } else if (hasSpotify && !hasTidal) {
      updatePlaylistText.textContent = 'Send to Spotify';
    } else if (hasTidal && !hasSpotify) {
      updatePlaylistText.textContent = 'Send to Tidal';
    } else {
      updatePlaylistText.textContent = 'Send to Music Service';
    }
  }

  // Handle download option click
  downloadOption.onclick = () => {
    contextMenu.classList.add('hidden');

    if (!currentContextList) return;

    downloadListAsJSON(currentContextList);

    currentContextList = null;
  };

  // Handle rename option click
  renameOption.onclick = () => {
    contextMenu.classList.add('hidden');

    if (!currentContextList) return;

    openRenameModal(currentContextList);
  };

  // Handle toggle official option click
  toggleOfficialOption.onclick = async () => {
    contextMenu.classList.add('hidden');

    if (!currentContextList) return;

    const meta = getListMetadata(currentContextList);
    if (!meta) return;

    // Check if list has a year assigned
    if (!meta.year) {
      showToast('List must have a year to be marked as official', 'error');
      currentContextList = null;
      return;
    }

    const newOfficialStatus = !meta.isOfficial;

    try {
      const response = await apiCall(
        `/api/lists/${encodeURIComponent(currentContextList)}/official`,
        {
          method: 'POST',
          body: JSON.stringify({ isOfficial: newOfficialStatus }),
        }
      );

      // Update local metadata
      updateListMetadata(currentContextList, { isOfficial: newOfficialStatus });

      // If another list lost its official status, update it too
      if (response.previousOfficialList) {
        updateListMetadata(response.previousOfficialList, {
          isOfficial: false,
        });
      }

      // Refresh sidebar to show updated star icons
      updateListNav();

      // Show appropriate message
      if (newOfficialStatus) {
        if (response.previousOfficialList) {
          showToast(
            `"${currentContextList}" is now your official ${meta.year} list (replaced "${response.previousOfficialList}")`
          );
        } else {
          showToast(
            `"${currentContextList}" is now your official ${meta.year} list`
          );
        }
      } else {
        showToast(`"${currentContextList}" is no longer marked as official`);
      }
    } catch (error) {
      console.error('Error toggling official status:', error);
      showToast('Error updating official status', 'error');
    }

    currentContextList = null;
  };

  // Handle update playlist option click
  updatePlaylistOption.onclick = async () => {
    contextMenu.classList.add('hidden');

    if (!currentContextList) return;

    try {
      // Pass both list name and list data for track validation
      const listData = getListData(currentContextList) || [];
      await updatePlaylist(currentContextList, listData);
    } catch (err) {
      console.error('Update playlist failed', err);
    }

    currentContextList = null;
  };

  // Handle delete option click
  deleteOption.onclick = async () => {
    contextMenu.classList.add('hidden');

    if (!currentContextList) return;

    // Confirm deletion using custom modal
    const confirmed = await showConfirmation(
      'Delete List',
      `Are you sure you want to delete the list "${currentContextList}"?`,
      'This action cannot be undone.',
      'Delete'
    );

    if (confirmed) {
      try {
        await apiCall(`/api/lists/${encodeURIComponent(currentContextList)}`, {
          method: 'DELETE',
        });

        delete lists[currentContextList];

        if (currentList === currentContextList) {
          const remainingLists = Object.keys(lists);
          if (remainingLists.length > 0) {
            // Select the first list in the sidebar
            selectList(remainingLists[0]);
          } else {
            // No lists remain - show empty state
            currentList = null;
            window.currentList = currentList;
            // Refresh mobile bar visibility when list is cleared
            if (window.refreshMobileBarVisibility) {
              window.refreshMobileBarVisibility();
            }

            const headerAddAlbumBtn =
              document.getElementById('headerAddAlbumBtn');

            if (headerAddAlbumBtn) headerAddAlbumBtn.classList.add('hidden');

            document.getElementById('albumContainer').innerHTML = `
              <div class="text-center text-gray-500 mt-20">
                <p class="text-xl mb-2">No list selected</p>
                <p class="text-sm">Create or import a list to get started</p>
              </div>
            `;
          }
        }

        updateListNav();

        showToast(`List "${currentContextList}" deleted`);
      } catch (_error) {
        showToast('Error deleting list', 'error');
      }
    }

    currentContextList = null;
  };
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
      }, 200);
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
      // Check if moving to submenu
      const toSubmenu =
        submenu &&
        (e.relatedTarget === submenu || submenu.contains(e.relatedTarget));

      if (!toSubmenu) {
        hideTimeout = setTimeout(() => {
          if (submenu) submenu.classList.add('hidden');
        }, 200);
      }
    });

    moveOption.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showMoveToListSubmenu();
    });
  }
}

// Show the move to list submenu for desktop
function showMoveToListSubmenu() {
  const submenu = document.getElementById('albumMoveSubmenu');
  const moveOption = document.getElementById('moveAlbumOption');
  const playSubmenu = document.getElementById('playAlbumSubmenu');
  const playOption = document.getElementById('playAlbumOption');

  if (!submenu || !moveOption) return;

  // Hide the other submenu first
  if (playSubmenu) {
    playSubmenu.classList.add('hidden');
    playOption?.classList.remove('bg-gray-700', 'text-white');
  }

  // Highlight the parent menu item
  moveOption.classList.add('bg-gray-700', 'text-white');

  // Get all list names except the current one
  const listNames = Object.keys(lists).filter((name) => name !== currentList);

  if (listNames.length === 0) {
    submenu.innerHTML =
      '<div class="px-4 py-2 text-sm text-gray-500">No other lists available</div>';
  } else {
    submenu.innerHTML = listNames
      .map(
        (listName) => `
        <button class="block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap w-full" data-target-list="${listName}">
          <span class="mr-2">•</span>${listName}
        </button>
      `
      )
      .join('');

    // Add click handlers to each list option
    submenu.querySelectorAll('[data-target-list]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const targetList = btn.dataset.targetList;

        // Hide both menus and remove highlight
        document.getElementById('albumContextMenu')?.classList.add('hidden');
        submenu.classList.add('hidden');
        moveOption?.classList.remove('bg-gray-700', 'text-white');

        // Show confirmation modal
        showMoveConfirmation(currentContextAlbumId, targetList);
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

// Hide submenus when mouse leaves the context menu area
function hideSubmenuOnLeave() {
  const contextMenu = document.getElementById('albumContextMenu');
  const moveSubmenu = document.getElementById('albumMoveSubmenu');
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
    }, 200);
  };

  const cancelHide = () => {
    if (submenuTimeout) clearTimeout(submenuTimeout);
  };

  contextMenu.addEventListener('mouseleave', (e) => {
    // Check if moving to either submenu
    const toMoveSubmenu =
      moveSubmenu &&
      (e.relatedTarget === moveSubmenu ||
        moveSubmenu.contains(e.relatedTarget));
    const toPlaySubmenu =
      playSubmenu &&
      (e.relatedTarget === playSubmenu ||
        playSubmenu.contains(e.relatedTarget));

    if (!toMoveSubmenu && !toPlaySubmenu) {
      hideSubmenus();
    }
  });

  if (moveSubmenu) {
    moveSubmenu.addEventListener('mouseenter', cancelHide);
    moveSubmenu.addEventListener('mouseleave', hideSubmenus);
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

  // Build menu items
  let menuItems = [];

  // Always add "Open in app" option first (current behavior)
  if (hasSpotify || hasTidal) {
    menuItems.push(`
      <button class="w-full block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap" data-play-action="open-app">
        <i class="fas fa-external-link-alt mr-2 w-4 text-center text-green-500"></i>Open in app
      </button>
    `);
  }

  // If Spotify is connected, fetch available devices
  if (hasSpotify) {
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

// Update only the active state in sidebar (optimized - no DOM rebuild)
function updateListNavActiveState(activeListName) {
  const nav = document.getElementById('listNav');
  const mobileNav = document.getElementById('mobileListNav');

  const updateActiveState = (container) => {
    if (!container) return;

    // Find only list buttons inside .year-lists containers (not year header buttons)
    const buttons = container.querySelectorAll('.year-lists button');
    buttons.forEach((button) => {
      const listName = button.querySelector('span')?.textContent;
      if (!listName) return;

      const isActive = listName === activeListName;

      // Toggle active class - background is handled by ::before pseudo-element in CSS
      if (isActive) {
        button.classList.add('active');
      } else {
        button.classList.remove('active');
      }
    });
  };

  updateActiveState(nav);
  updateActiveState(mobileNav);
}

// Get expand/collapse state from localStorage
function getYearExpandState() {
  try {
    const state = localStorage.getItem('yearExpandState');
    return state ? JSON.parse(state) : {};
  } catch (_e) {
    return {};
  }
}

// Save expand/collapse state to localStorage
function saveYearExpandState(state) {
  try {
    localStorage.setItem('yearExpandState', JSON.stringify(state));
  } catch (_e) {
    // Silently fail if localStorage is full
  }
}

// Toggle year section expand/collapse
function toggleYearSection(year, container) {
  const state = getYearExpandState();
  const isExpanded = state[year] !== false; // Default to expanded
  state[year] = !isExpanded;
  saveYearExpandState(state);

  // Update UI
  const section = container.querySelector(`[data-year-section="${year}"]`);
  if (section) {
    const listsContainer = section.querySelector('.year-lists');
    const chevron = section.querySelector('.year-chevron');
    if (listsContainer) {
      listsContainer.classList.toggle('hidden', isExpanded);
    }
    if (chevron) {
      chevron.classList.toggle('fa-chevron-right', isExpanded);
      chevron.classList.toggle('fa-chevron-down', !isExpanded);
    }
  }
}

// Generate HTML for year section header (shared between desktop and mobile)
function createYearHeaderHTML(year, count, isExpanded) {
  const chevronClass = isExpanded ? 'fa-chevron-down' : 'fa-chevron-right';
  return `
    <div class="flex items-center">
      <i class="fas ${chevronClass} mr-2 text-xs year-chevron"></i>
      <span>${year}</span>
    </div>
    <span class="text-xs text-gray-400 bg-gray-800 px-1 py-px rounded font-normal">${count}</span>
  `;
}

// Generate HTML for list button (shared between desktop and mobile)
function createListButtonHTML(listName, isActive, isOfficial, isMobile) {
  const paddingClass = isMobile ? 'py-3' : 'py-2';
  const widthClass = isMobile ? 'flex-1' : 'w-full';
  const activeClass = isActive ? 'active' : '';
  const officialBadge = isOfficial
    ? '<i class="fas fa-star text-yellow-500 ml-1 flex-shrink-0 text-xs" title="Official list"></i>'
    : '';

  const buttonHTML = `
    <button data-list-name="${listName}" class="sidebar-list-btn ${widthClass} text-left px-3 ${paddingClass} rounded text-sm transition duration-200 text-gray-300 ${activeClass} flex items-center">
      <i class="fas fa-list mr-2 flex-shrink-0"></i>
      <span class="truncate flex-1">${listName}</span>
      ${officialBadge}
    </button>
  `;

  if (isMobile) {
    return `
      ${buttonHTML}
      <button data-list-menu-btn="${listName}" class="p-2 text-gray-400 active:text-gray-200 no-drag flex-shrink-0" aria-label="List options">
        <i class="fas fa-ellipsis-v"></i>
      </button>
    `;
  }

  return buttonHTML;
}

// Update sidebar navigation with year tree view
function updateListNav() {
  const nav = document.getElementById('listNav');
  const mobileNav = document.getElementById('mobileListNav');

  const createListItems = (container, isMobile = false) => {
    container.innerHTML = '';

    // Group lists by year
    const listsByYear = {};
    const uncategorized = [];

    Object.keys(lists).forEach((listName) => {
      const meta = getListMetadata(listName);
      const year = meta?.year;

      if (year) {
        if (!listsByYear[year]) {
          listsByYear[year] = [];
        }
        listsByYear[year].push({ name: listName, meta });
      } else {
        uncategorized.push({ name: listName, meta });
      }
    });

    // Sort years descending
    const sortedYears = Object.keys(listsByYear).sort(
      (a, b) => parseInt(b) - parseInt(a)
    );

    // Get expand state
    const expandState = getYearExpandState();

    // Create year sections
    sortedYears.forEach((year) => {
      const yearLists = listsByYear[year];
      const isExpanded = expandState[year] !== false; // Default to expanded

      const section = document.createElement('div');
      section.className = 'year-section mb-1';
      section.setAttribute('data-year-section', year);

      // Year header
      const header = document.createElement('button');
      const paddingClass = isMobile ? 'py-2' : 'py-1.5';
      header.className = `w-full text-left px-3 ${paddingClass} rounded text-sm hover:bg-gray-800 transition duration-200 text-white flex items-center justify-between font-bold`;
      header.innerHTML = createYearHeaderHTML(
        year,
        yearLists.length,
        isExpanded
      );
      header.onclick = (e) => {
        e.preventDefault();
        toggleYearSection(year, container);
      };
      header.oncontextmenu = (e) => e.preventDefault();

      section.appendChild(header);

      // Lists container
      const listsContainer = document.createElement('ul');
      listsContainer.className = `year-lists pl-4 ${isExpanded ? '' : 'hidden'}`;

      yearLists.forEach(({ name: listName }) => {
        const li = createListButton(listName, isMobile, container);
        listsContainer.appendChild(li);
      });

      section.appendChild(listsContainer);
      container.appendChild(section);
    });

    // Add uncategorized section if there are any
    if (uncategorized.length > 0) {
      const section = document.createElement('div');
      section.className = 'year-section mb-1';
      section.setAttribute('data-year-section', 'uncategorized');

      const isExpanded = expandState['uncategorized'] !== false;

      // Header for uncategorized
      const header = document.createElement('button');
      const paddingClass = isMobile ? 'py-2' : 'py-1.5';
      header.className = `w-full text-left px-3 ${paddingClass} rounded text-sm hover:bg-gray-800 transition duration-200 text-white flex items-center justify-between font-bold`;
      header.innerHTML = createYearHeaderHTML(
        'Uncategorized',
        uncategorized.length,
        isExpanded
      );
      header.onclick = (e) => {
        e.preventDefault();
        toggleYearSection('uncategorized', container);
      };
      header.oncontextmenu = (e) => e.preventDefault();

      section.appendChild(header);

      // Lists container
      const listsContainer = document.createElement('ul');
      listsContainer.className = `year-lists pl-4 ${isExpanded ? '' : 'hidden'}`;

      uncategorized.forEach(({ name: listName }) => {
        const li = createListButton(listName, isMobile, container);
        listsContainer.appendChild(li);
      });

      section.appendChild(listsContainer);
      container.appendChild(section);
    }
  };

  // Helper to create a list button
  const createListButton = (listName, isMobile, _container) => {
    const meta = getListMetadata(listName);
    const isOfficial = meta?.isOfficial || false;
    const isActive = currentList === listName;
    const li = document.createElement('li');

    if (isMobile) {
      li.className = 'flex items-center';
    }
    li.innerHTML = createListButtonHTML(
      listName,
      isActive,
      isOfficial,
      isMobile
    );

    const button = li.querySelector('[data-list-name]');
    const menuButton = li.querySelector('[data-list-menu-btn]');

    if (!isMobile) {
      // Desktop: keep right-click
      button.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Hide any open context menus first
        hideAllContextMenus();

        currentContextList = listName;

        const contextMenu = document.getElementById('contextMenu');
        if (!contextMenu) return;

        // Get shared menu configuration
        const menuConfig = getListMenuConfig(listName);

        // Update the playlist option text based on user's music service
        const updatePlaylistText =
          document.getElementById('updatePlaylistText');
        if (updatePlaylistText) {
          updatePlaylistText.textContent = menuConfig.musicServiceText;
        }

        // Update the toggle official option text based on current status
        const toggleOfficialText =
          document.getElementById('toggleOfficialText');
        const toggleOfficialOption = document.getElementById(
          'toggleOfficialOption'
        );
        if (toggleOfficialText && toggleOfficialOption) {
          toggleOfficialText.textContent = menuConfig.officialToggleText;
          const icon = toggleOfficialOption.querySelector('i');
          icon.classList.remove('fa-star', 'fa-star-half-alt');
          icon.classList.add(menuConfig.officialIconClass);

          // Hide option if list has no year (can't be official)
          if (!menuConfig.hasYear) {
            toggleOfficialOption.classList.add('hidden');
          } else {
            toggleOfficialOption.classList.remove('hidden');
          }
        }

        // Position the menu at cursor (using batched style operations)
        positionContextMenu(contextMenu, e.clientX, e.clientY);
      });
    } else {
      // Mobile: attach click handler to three-dot menu button
      if (menuButton) {
        // Prevent touch events from bubbling to parent (similar to album menu button)
        menuButton.addEventListener(
          'touchstart',
          (e) => {
            e.stopPropagation();
          },
          { passive: true }
        );

        menuButton.addEventListener(
          'touchend',
          (e) => {
            e.stopPropagation();
          },
          { passive: true }
        );

        menuButton.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          if (window.showMobileListMenu) {
            window.showMobileListMenu(listName);
          }
        });
      }
    }

    button.onclick = () => {
      selectList(listName);
      if (isMobile) toggleMobileLists();
    };

    return li;
  };

  createListItems(nav);
  if (mobileNav) createListItems(mobileNav, true);

  // Cache list names locally for faster startup
  try {
    localStorage.setItem('cachedListNames', JSON.stringify(Object.keys(lists)));
  } catch (e) {
    // Handle quota exceeded error gracefully
    if (e.name === 'QuotaExceededError') {
      console.warn('LocalStorage quota exceeded, skipping cache');
      // Attempt to free up space by removing old cache entries
      try {
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          // Remove old cache keys (from previous implementations)
          if (
            key &&
            (key.startsWith('lists_cache') ||
              key.startsWith('lastSelectedListData_'))
          ) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach((key) => localStorage.removeItem(key));
      } catch (cleanupErr) {
        console.warn('Failed to cleanup localStorage:', cleanupErr);
      }
    } else {
      console.warn('Failed to cache list names', e);
    }
  }
}
window.updateListNav = updateListNav;

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
    currentList = listName;
    window.currentList = currentList;

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
          // Batch fetch all album covers in a single request (non-blocking)
          fetchAndApplyCovers(data).catch((err) => {
            console.warn('Background cover fetch failed:', err);
          });
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

function updateHeaderTitle(listName) {
  const headerAddAlbumBtn = document.getElementById('headerAddAlbumBtn');

  if (listName) {
    // Show the add album button in header if it exists
    if (headerAddAlbumBtn) {
      headerAddAlbumBtn.classList.remove('hidden');
    }
  }
}

// Make genre editable with datalist
function makeGenreEditable(genreDiv, albumIndex, genreField) {
  // Check if we're already editing
  if (genreDiv.querySelector('input')) {
    return;
  }

  // Get current genre from the live data
  const albumsForGenre = getListData(currentList);
  if (!albumsForGenre || !albumsForGenre[albumIndex]) return;
  const currentGenre = albumsForGenre[albumIndex][genreField] || '';

  // Create input with datalist
  const input = document.createElement('input');
  input.type = 'text';
  input.className =
    'w-full bg-gray-800 text-gray-300 text-sm p-1 rounded border border-gray-700 focus:outline-none focus:border-gray-500';
  input.value = currentGenre;
  input.placeholder = `Type to search ${genreField === 'genre_1' ? 'primary' : 'secondary'} genre...`;
  input.setAttribute(
    'list',
    `genre-list-${currentList}-${albumIndex}-${genreField}`
  );

  // Create datalist
  const datalist = document.createElement('datalist');
  datalist.id = `genre-list-${currentList}-${albumIndex}-${genreField}`;

  // Add all available genres
  availableGenres.forEach((genre) => {
    const option = document.createElement('option');
    option.value = genre;
    datalist.appendChild(option);
  });

  // Store the original onclick handler
  const originalOnClick = genreDiv.onclick;
  genreDiv.onclick = null; // Temporarily remove click handler

  // Replace content with input and datalist
  genreDiv.innerHTML = '';
  genreDiv.appendChild(input);
  genreDiv.appendChild(datalist);
  input.focus();
  input.select();

  // Create handleClickOutside function so we can reference it for removal
  let handleClickOutside;

  const restoreDisplay = (valueToDisplay) => {
    // Remove the click outside listener if it exists
    if (handleClickOutside) {
      document.removeEventListener('click', handleClickOutside);
      handleClickOutside = null;
    }

    // Determine what to display based on value and field
    let displayValue = valueToDisplay;
    let displayClass;

    if (genreField === 'genre_1') {
      // For Genre 1: show placeholder if empty
      displayValue = valueToDisplay || 'Genre 1';
      displayClass = valueToDisplay ? 'text-gray-300' : 'text-gray-500 italic';
    } else {
      // For Genre 2: show placeholder if empty, but treat 'Genre 2' and '-' as empty
      if (
        !valueToDisplay ||
        valueToDisplay === 'Genre 2' ||
        valueToDisplay === '-'
      ) {
        displayValue = 'Genre 2';
        displayClass = 'text-gray-500 italic';
      } else {
        displayValue = valueToDisplay;
        displayClass = 'text-gray-400';
      }
    }

    genreDiv.innerHTML = `<span class="text-sm ${displayClass} truncate cursor-pointer hover:text-gray-100">${displayValue}</span>`;

    // Restore the original click handler
    genreDiv.onclick = originalOnClick;
  };

  const saveGenre = async (newGenre) => {
    // Trim the input
    newGenre = newGenre.trim();

    // Check if value actually changed
    if (newGenre === currentGenre) {
      restoreDisplay(currentGenre);
      return;
    }

    // VALIDATION: Only allow empty string or values from availableGenres
    if (newGenre !== '') {
      const isValid = availableGenres.some(
        (genre) => genre.toLowerCase() === newGenre.toLowerCase()
      );

      if (!isValid) {
        // Invalid genre entered - revert to original
        restoreDisplay(currentGenre);
        return;
      }

      // Find the exact case-matched genre from the list
      const matchedGenre = availableGenres.find(
        (genre) => genre.toLowerCase() === newGenre.toLowerCase()
      );
      newGenre = matchedGenre; // Use the properly cased version
    }

    // Update the data
    const albumsToUpdate = getListData(currentList);
    if (!albumsToUpdate || !albumsToUpdate[albumIndex]) return;
    albumsToUpdate[albumIndex][genreField] = newGenre;

    // Close the dropdown immediately for better UX
    restoreDisplay(newGenre);

    try {
      await saveList(currentList, albumsToUpdate);
      showToast(newGenre === '' ? 'Genre cleared' : 'Genre updated');
    } catch (_error) {
      showToast('Error saving genre', 'error');
      // Revert on error
      albumsToUpdate[albumIndex][genreField] = currentGenre;
      restoreDisplay(currentGenre);
    }
  };

  // Handle input change (when selecting from datalist)
  input.addEventListener('change', (e) => {
    saveGenre(e.target.value);
  });

  // Handle blur (when clicking away)
  input.addEventListener('blur', () => {
    saveGenre(input.value);
  });

  // Handle keyboard
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveGenre(input.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      restoreDisplay(currentGenre);
    }
  });

  // Define handleClickOutside
  handleClickOutside = (e) => {
    if (!genreDiv.contains(e.target)) {
      saveGenre(input.value);
    }
  };

  // Small delay to prevent immediate trigger
  setTimeout(() => {
    document.addEventListener('click', handleClickOutside);
  }, 100);
}

// Make comment editable
function makeCommentEditable(commentDiv, albumIndex) {
  const albumsForComment = getListData(currentList);
  if (!albumsForComment || !albumsForComment[albumIndex]) return;

  const currentComment =
    albumsForComment[albumIndex].comments ||
    albumsForComment[albumIndex].comment ||
    '';

  // Create textarea
  const textarea = document.createElement('textarea');
  textarea.className =
    'w-full bg-gray-800 text-gray-300 text-sm p-2 rounded border border-gray-700 focus:outline-none focus:border-gray-500 resize-none';
  textarea.value = currentComment;
  textarea.rows = 2;

  // Replace div content with textarea
  commentDiv.innerHTML = '';
  commentDiv.appendChild(textarea);
  textarea.focus();
  textarea.select();

  // Save on blur or enter
  const saveComment = async () => {
    const albumsToUpdate = getListData(currentList);
    if (!albumsToUpdate || !albumsToUpdate[albumIndex]) return;

    const newComment = textarea.value.trim();
    albumsToUpdate[albumIndex].comments = newComment;
    albumsToUpdate[albumIndex].comment = newComment;

    try {
      await saveList(currentList, albumsToUpdate);

      // Update display without re-rendering everything
      let displayComment = newComment;
      let displayClass = 'text-gray-300';

      // If comment is empty, show placeholder
      if (!displayComment) {
        displayComment = 'Comment';
        displayClass = 'text-gray-500';
      }

      commentDiv.innerHTML = `<span class="text-sm ${displayClass} line-clamp-2 cursor-pointer hover:text-gray-100 comment-text">${displayComment}</span>`;

      // Re-add click handler
      commentDiv.onclick = () => makeCommentEditable(commentDiv, albumIndex);

      // Add tooltip only if comment is truncated
      const commentTextEl = commentDiv.querySelector('.comment-text');
      if (commentTextEl && newComment) {
        setTimeout(() => {
          if (isTextTruncated(commentTextEl)) {
            commentTextEl.setAttribute('data-comment', newComment);
          }
        }, 0);
      }

      if (newComment !== currentComment) {
        showToast('Comment updated');
      }
    } catch (_error) {
      showToast('Error saving comment', 'error');
      // Revert on error - also handle placeholder for empty comments
      let revertDisplay = currentComment;
      let revertClass = 'text-gray-300';
      if (!revertDisplay) {
        revertDisplay = 'Comment';
        revertClass = 'text-gray-500';
      }
      commentDiv.innerHTML = `<span class="text-sm ${revertClass} italic line-clamp-2 cursor-pointer hover:text-gray-100 comment-text">${revertDisplay}</span>`;
      commentDiv.onclick = () => makeCommentEditable(commentDiv, albumIndex);

      // Add tooltip only if comment is truncated
      const revertTextEl = commentDiv.querySelector('.comment-text');
      if (revertTextEl && currentComment) {
        setTimeout(() => {
          if (isTextTruncated(revertTextEl)) {
            revertTextEl.setAttribute('data-comment', currentComment);
          }
        }, 0);
      }
    }
  };

  textarea.addEventListener('blur', saveComment);
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      textarea.blur();
    }
    if (e.key === 'Escape') {
      // Cancel editing
      let displayComment = currentComment;
      let displayClass = 'text-gray-300';

      // If comment is empty, show placeholder
      if (!displayComment) {
        displayComment = 'Comment';
        displayClass = 'text-gray-500';
      }

      commentDiv.innerHTML = `<span class="text-sm ${displayClass} line-clamp-2 cursor-pointer hover:text-gray-100 comment-text">${displayComment}</span>`;
      commentDiv.onclick = () => makeCommentEditable(commentDiv, albumIndex);

      // Add tooltip only if comment is truncated
      const cancelTextEl = commentDiv.querySelector('.comment-text');
      if (cancelTextEl && currentComment) {
        setTimeout(() => {
          if (isTextTruncated(cancelTextEl)) {
            cancelTextEl.setAttribute('data-comment', currentComment);
          }
        }, 0);
      }
    }
  });
}

// Update track cell display without re-rendering entire list
function updateTrackCellDisplay(albumIndex, trackValue, tracks) {
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

  if (trackValue && tracks && Array.isArray(tracks)) {
    const trackMatch = tracks.find((t) => t === trackValue);
    if (trackMatch) {
      const match = trackMatch.match(/^(\d+)[.\s-]?\s*(.*)$/);
      if (match) {
        const trackNum = match[1];
        const trackName = match[2] || '';
        trackPickDisplay = trackName
          ? `${trackNum}. ${trackName}`
          : `Track ${trackNum}`;
        trackPickClass = 'text-gray-300';
      } else {
        trackPickDisplay = trackMatch;
        trackPickClass = 'text-gray-300';
      }
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
  trackCell.innerHTML = `<span class="text-sm ${trackPickClass} truncate cursor-pointer hover:text-gray-100" title="${trackValue || 'Click to select track'}">${trackPickDisplay}</span>`;

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
  menu.style.minWidth = '250px';

  if (!album.tracks || album.tracks.length === 0) {
    menu.innerHTML =
      '<div class="px-4 py-2 text-sm text-gray-500">No tracks available</div>';
  } else {
    // Sort tracks by track number
    const sortedTracks = [...album.tracks].sort((a, b) => {
      const numA = parseInt(a.match(/^(\d+)[.\s-]/) ? a.match(/^(\d+)/)[1] : 0);
      const numB = parseInt(b.match(/^(\d+)[.\s-]/) ? b.match(/^(\d+)/)[1] : 0);
      return numA && numB ? numA - numB : 0;
    });

    const albumsForMenu = getListData(currentList);
    const currentAlbum = albumsForMenu && albumsForMenu[albumIndex];
    const hasNoSelection = !currentAlbum || !currentAlbum.track_pick;

    let menuHTML = `
      <div class="track-menu-option px-4 py-2 hover:bg-gray-700 cursor-pointer text-sm" data-track-value="">
        <span class="${hasNoSelection ? 'text-red-500' : 'text-gray-400'}">
          ${hasNoSelection ? '<i class="fas fa-check mr-2"></i>' : ''}None (clear selection)
        </span>
      </div>
      <div class="border-t border-gray-700"></div>
    `;

    sortedTracks.forEach((track, idx) => {
      const isSelected =
        currentAlbum &&
        (currentAlbum.track_pick === track ||
          currentAlbum.track_pick === (idx + 1).toString());
      const match = track.match(/^(\d+)[.\s-]?\s*(.*)$/);
      const trackNum = match ? match[1] : idx + 1;
      const trackName = match ? match[2] : track;

      menuHTML += `
        <div class="track-menu-option px-4 py-2 hover:bg-gray-700 cursor-pointer text-sm ${isSelected ? 'bg-gray-700/50' : ''}" 
             data-track-value="${track}">
          <span class="${isSelected ? 'text-red-500' : 'text-gray-300'}">
            ${isSelected ? '<i class="fas fa-check mr-2"></i>' : ''}
            <span class="font-medium">${trackNum}.</span> ${trackName}
          </span>
        </div>
      `;
    });

    menu.innerHTML = menuHTML;

    // Add click handlers
    menu.querySelectorAll('.track-menu-option').forEach((option) => {
      option.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const trackValue = option.dataset.trackValue;

        const albumsForSelection = getListData(currentList);
        const freshAlbum = albumsForSelection && albumsForSelection[albumIndex];
        if (!freshAlbum) {
          showToast('Album not found - list may have been updated', 'error');
          menu.remove();
          return;
        }

        const previousValue = freshAlbum.track_pick;

        freshAlbum.track_pick = trackValue;

        menu.remove();

        updateTrackCellDisplay(albumIndex, trackValue, freshAlbum.tracks);

        showToast(
          trackValue
            ? `Selected track: ${trackValue.substring(0, 50)}...`
            : 'Track selection cleared'
        );

        try {
          await saveList(currentList, albumsForSelection);
        } catch (_error) {
          freshAlbum.track_pick = previousValue;
          updateTrackCellDisplay(albumIndex, previousValue, freshAlbum.tracks);
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

// Custom autoscroll removed - now using SortableJS built-in autoscroll for mobile

// Clear cache when list changes - use rebuildPositionCache instead
// Unified sorting function using SortableJS for both desktop and mobile
function initializeUnifiedSorting(container, isMobile) {
  if (!window.Sortable) {
    console.error('SortableJS not loaded');
    return;
  }

  // Clean up any existing sortable instance
  if (container._sortable) {
    container._sortable.destroy();
  }

  // Find the sortable container
  const sortableContainer = isMobile
    ? container.querySelector('.mobile-album-list') || container
    : container.querySelector('.album-rows-container') || container;

  if (!sortableContainer) {
    console.error('Sortable container not found');
    return;
  }

  // Find the actual scrollable element (the parent with overflow-y-auto)
  const scrollElement = isMobile
    ? sortableContainer.closest('.overflow-y-auto')
    : sortableContainer;

  // Configure SortableJS options
  const sortableOptions = {
    animation: 200,
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    dragClass: 'sortable-drag',

    // Touch-and-hold configuration for mobile
    ...(isMobile && {
      delay: 300, // 300ms touch-and-hold delay
      delayOnTouchOnly: true,
      touchStartThreshold: 10, // Allow 10px movement before cancelling drag
      forceFallback: true,
      fallbackTolerance: 5,
    }),

    // Filter to prevent dragging on interactive elements
    filter: 'button, input, textarea, select, .no-drag',
    preventOnFilter: false,

    // Configure scrolling - use SortableJS built-in autoscroll for both desktop and mobile
    scroll: scrollElement, // Scroll the correct scrollable element
    scrollSensitivity: isMobile ? 100 : 30, // Larger zone for mobile
    scrollSpeed: isMobile ? 25 : 15, // Faster scroll for mobile
    bubbleScroll: false, // Disable parent container scrolling to prevent double-scroll

    // Enhanced event handlers
    onStart: function (evt) {
      // Visual feedback
      if (!isMobile) {
        document.body.classList.add('desktop-dragging');
      } else {
        // Mobile-specific feedback
        evt.item.classList.add('dragging-mobile');

        // Haptic feedback if available
        if (navigator.vibrate) {
          navigator.vibrate(50);
        }
      }
    },
    onEnd: async function (evt) {
      // Clean up visual feedback
      if (!isMobile) {
        document.body.classList.remove('desktop-dragging');
      } else {
        evt.item.classList.remove('dragging-mobile');
      }

      const oldIndex = evt.oldIndex;
      const newIndex = evt.newIndex;

      if (oldIndex !== newIndex) {
        try {
          // Update the data
          const list = getListData(currentList);
          if (!list) {
            console.error('List data not found');
            return;
          }
          const [movedItem] = list.splice(oldIndex, 1);
          list.splice(newIndex, 0, movedItem);

          // Immediate optimistic UI update
          updatePositionNumbers(sortableContainer, isMobile);

          // Debounced server save to batch rapid changes
          debouncedSaveList(currentList, list);
        } catch (error) {
          console.error('Error saving reorder:', error);
          if (window.showToast) {
            window.showToast('Error saving changes', 'error');
          }
          // Revert the change on error
          const items = Array.from(evt.to.children);
          const itemToMove = items[newIndex];
          if (oldIndex < items.length) {
            evt.to.insertBefore(itemToMove, items[oldIndex]);
          } else {
            evt.to.appendChild(itemToMove);
          }
          updatePositionNumbers(sortableContainer, isMobile);
        }
      }
    },
  };
  // Initialize SortableJS
  const sortable = new Sortable(sortableContainer, sortableOptions);

  // Store reference for cleanup
  container._sortable = sortable;

  // Mobile: Allow scroll initially, then block it after a delay.
  // - 0-200ms: Scroll is ALLOWED (user can start scrolling naturally)
  // - 200ms+: Scroll is BLOCKED (user committed to holding for drag)
  // - 300ms: SortableJS starts the drag
  if (isMobile) {
    const SCROLL_GRACE_PERIOD = 200; // ms - allow scroll during this initial period
    let touchState = null;

    const onTouchStart = (e) => {
      const wrapper = e.target.closest('.album-card-wrapper');
      if (!wrapper || e.target.closest('button, .no-drag')) return;

      touchState = {
        startTime: Date.now(),
      };
    };

    const onTouchMove = (e) => {
      if (!touchState) return;

      const elapsed = Date.now() - touchState.startTime;

      // Allow scroll during grace period, block after
      if (elapsed >= SCROLL_GRACE_PERIOD) {
        e.preventDefault();
      }
    };

    const onTouchEnd = () => {
      touchState = null;
    };

    // Use non-passive listeners to allow preventDefault
    sortableContainer.addEventListener('touchstart', onTouchStart, {
      passive: true,
    });
    sortableContainer.addEventListener('touchmove', onTouchMove, {
      passive: false,
    });
    sortableContainer.addEventListener('touchend', onTouchEnd, {
      passive: true,
    });
  }
}

// Add this function to handle mobile album actions
window.showMobileAlbumMenu = function (indexOrElement) {
  let index = indexOrElement;
  if (typeof indexOrElement !== 'number') {
    const card = indexOrElement.closest('.album-card');
    if (!card) return;
    index = parseInt(card.dataset.index);
    console.log(
      '[DEBUG] showMobileAlbumMenu: card.dataset.index =',
      card.dataset.index,
      'parsed index =',
      index
    );
  }

  // Validate index
  const albumsForSheet = getListData(currentList);
  console.log(
    '[DEBUG] showMobileAlbumMenu: data array length =',
    albumsForSheet?.length,
    'first 3 albums:',
    albumsForSheet?.slice(0, 3).map((a) => a.album)
  );
  if (
    isNaN(index) ||
    index < 0 ||
    !albumsForSheet ||
    index >= albumsForSheet.length
  ) {
    console.error('Invalid album index:', index);
    return;
  }

  const album = albumsForSheet[index];
  console.log(
    '[DEBUG] showMobileAlbumMenu: selected album at index',
    index,
    '=',
    album.album,
    'by',
    album.artist
  );
  if (!album) {
    console.error('Album not found at index:', index);
    return;
  }

  // Create a unique identifier for this album to prevent stale index issues
  const albumId =
    `${album.artist}::${album.album}::${album.release_date || ''}`.toLowerCase();

  // Remove any existing action sheets first
  const existingSheet = document.querySelector(
    '.fixed.inset-0.z-50.lg\\:hidden'
  );
  if (existingSheet) {
    existingSheet.remove();
  }

  // Hide FAB when mobile action sheet is shown to avoid overlap
  const fab = document.getElementById('addAlbumFAB');
  if (fab) {
    fab.style.display = 'none';
  }

  const hasSpotify = window.currentUser?.spotifyAuth;
  const hasTidal = window.currentUser?.tidalAuth;
  const hasAnyService = hasSpotify || hasTidal;

  const actionSheet = document.createElement('div');
  actionSheet.className = 'fixed inset-0 z-50 lg:hidden';
  actionSheet.innerHTML = `
    <div class="absolute inset-0 bg-black bg-opacity-50" data-backdrop></div>
    <div class="absolute bottom-0 left-0 right-0 bg-gray-900 rounded-t-2xl safe-area-bottom">
      <div class="p-4">
        <div class="w-12 h-1 bg-gray-600 rounded-full mx-auto mb-4"></div>
        <h3 class="font-semibold text-white mb-1 truncate">${album.album}</h3>
        <p class="text-sm text-gray-400 mb-4 truncate">${album.artist}</p>
        
        <button data-action="edit"
                class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded">
          <i class="fas fa-edit mr-3 text-gray-400"></i>Edit Details
        </button>

        <!-- Expandable Play Section -->
        <div class="play-section">
          <button data-action="play-toggle"
                  class="w-full flex items-center justify-between py-3 px-4 hover:bg-gray-800 rounded ${!hasAnyService ? 'opacity-50' : ''}">
            <span>
              <i class="fas fa-play mr-3 text-gray-400"></i>Play Album
            </span>
            ${hasSpotify ? '<i class="fas fa-chevron-down text-gray-500 text-xs transition-transform duration-200" data-chevron></i>' : ''}
          </button>
          
          <!-- Expandable device list (hidden by default) -->
          <div data-play-options class="hidden overflow-hidden transition-all duration-200 ease-out" style="max-height: 0;">
            <div class="ml-4 border-l-2 border-gray-700 pl-4 py-1">
              <!-- Open in app option -->
              <button data-action="open-app"
                      class="w-full text-left py-2.5 px-3 hover:bg-gray-800 rounded flex items-center">
                <i class="fas fa-external-link-alt mr-3 text-green-500 text-sm"></i>
                <span class="text-sm">Open in ${hasSpotify ? 'Spotify' : 'Tidal'}</span>
              </button>
              
              ${
                hasSpotify
                  ? `
              <!-- Spotify Connect devices section -->
              <div class="mt-1 pt-1 border-t border-gray-800">
                <div class="px-3 py-1.5 text-xs text-gray-500 uppercase tracking-wide">Spotify Connect</div>
                <div data-device-list>
                  <div class="px-3 py-2 text-sm text-gray-400">
                    <i class="fas fa-spinner fa-spin mr-2"></i>Loading devices...
                  </div>
                </div>
              </div>
              `
                  : ''
              }
            </div>
          </div>
        </div>

        <button data-action="move"
                class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded">
          <i class="fas fa-arrow-right mr-3 text-gray-400"></i>Move to List...
        </button>

        <button data-action="remove"
                class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded text-red-500">
          <i class="fas fa-trash mr-3"></i>Remove from List
        </button>
        
        <button data-action="cancel"
                class="w-full text-center py-3 px-4 mt-2 bg-gray-800 rounded">
          Cancel
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(actionSheet);

  // Attach event listeners to buttons
  const backdrop = actionSheet.querySelector('[data-backdrop]');
  const editBtn = actionSheet.querySelector('[data-action="edit"]');
  const playToggleBtn = actionSheet.querySelector(
    '[data-action="play-toggle"]'
  );
  const playOptions = actionSheet.querySelector('[data-play-options]');
  const chevron = actionSheet.querySelector('[data-chevron]');
  const openAppBtn = actionSheet.querySelector('[data-action="open-app"]');
  const deviceList = actionSheet.querySelector('[data-device-list]');
  const moveBtn = actionSheet.querySelector('[data-action="move"]');
  const removeBtn = actionSheet.querySelector('[data-action="remove"]');
  const cancelBtn = actionSheet.querySelector('[data-action="cancel"]');

  let isPlayExpanded = false;
  let devicesLoaded = false;

  const closeSheet = () => {
    actionSheet.remove();
    // Restore FAB visibility if a list is selected
    const fabElement = document.getElementById('addAlbumFAB');
    if (fabElement && currentList) {
      fabElement.style.display = 'flex';
    }
  };

  // Toggle play options expansion
  const togglePlayOptions = async () => {
    if (!hasAnyService) {
      showToast('No music service connected', 'error');
      return;
    }

    // If no Spotify (only Tidal), just play directly
    if (!hasSpotify) {
      closeSheet();
      window.playAlbumSafe(albumId);
      return;
    }

    isPlayExpanded = !isPlayExpanded;

    if (isPlayExpanded) {
      playOptions.classList.remove('hidden');
      // Trigger reflow for animation
      void playOptions.offsetHeight;
      playOptions.style.maxHeight = playOptions.scrollHeight + 'px';
      if (chevron) chevron.style.transform = 'rotate(180deg)';

      // Load devices if not already loaded
      if (!devicesLoaded && hasSpotify) {
        await loadMobileDevices();
      }
    } else {
      playOptions.style.maxHeight = '0';
      if (chevron) chevron.style.transform = 'rotate(0deg)';
      setTimeout(() => {
        if (!isPlayExpanded) playOptions.classList.add('hidden');
      }, 200);
    }
  };

  // Load Spotify devices for mobile
  const loadMobileDevices = async () => {
    try {
      const response = await fetch('/api/spotify/devices', {
        credentials: 'include',
      });
      const data = await response.json();

      if (response.ok && data.devices && data.devices.length > 0) {
        const deviceItems = data.devices
          .map((device) => {
            const icon = getDeviceIcon(device.type);
            const activeClass = device.is_active
              ? 'text-green-500'
              : 'text-gray-400';
            const activeBadge = device.is_active
              ? '<span class="ml-auto text-xs text-green-500">(active)</span>'
              : '';
            return `
              <button data-action="play-device" data-device-id="${device.id}"
                      class="w-full text-left py-2.5 px-3 hover:bg-gray-800 rounded flex items-center">
                <i class="${icon} mr-3 ${activeClass} text-sm"></i>
                <span class="text-sm truncate">${device.name}</span>
                ${activeBadge}
              </button>
            `;
          })
          .join('');
        deviceList.innerHTML = deviceItems;

        // Attach device click handlers
        deviceList
          .querySelectorAll('[data-action="play-device"]')
          .forEach((btn) => {
            btn.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              const deviceId = btn.dataset.deviceId;
              closeSheet();
              playAlbumOnDeviceMobile(albumId, deviceId);
            });
          });

        // Update max-height for animation
        playOptions.style.maxHeight = playOptions.scrollHeight + 'px';
      } else {
        deviceList.innerHTML = `
          <div class="px-3 py-2 text-sm text-gray-500">No devices found</div>
          <div class="px-3 py-1 text-xs text-gray-600">Open Spotify on a device</div>
        `;
        playOptions.style.maxHeight = playOptions.scrollHeight + 'px';
      }
      devicesLoaded = true;
    } catch (err) {
      console.error('Failed to load devices:', err);
      deviceList.innerHTML = `
        <div class="px-3 py-2 text-sm text-red-400">Failed to load devices</div>
      `;
      playOptions.style.maxHeight = playOptions.scrollHeight + 'px';
    }
  };

  backdrop.addEventListener('click', closeSheet);
  cancelBtn.addEventListener('click', closeSheet);

  editBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeSheet();
    window.showMobileEditFormSafe(albumId);
  });

  playToggleBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    togglePlayOptions();
  });

  if (openAppBtn) {
    openAppBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeSheet();
      window.playAlbumSafe(albumId);
    });
  }

  moveBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeSheet();
    window.showMobileMoveToListSheet(index, albumId);
  });

  removeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeSheet();
    window.removeAlbumSafe(albumId);
  });
};

// Move album from current list to target list
async function moveAlbumToList(index, albumId, targetList) {
  if (
    !currentList ||
    !lists[currentList] ||
    !targetList ||
    !lists[targetList]
  ) {
    throw new Error('Invalid source or target list');
  }

  // Get source list data using helper
  const sourceAlbums = getListData(currentList);
  if (!sourceAlbums) throw new Error('Source list data not loaded');

  let album = sourceAlbums[index];
  let indexToMove = index;

  if (album && albumId) {
    const expectedId =
      `${album.artist}::${album.album}::${album.release_date || ''}`.toLowerCase();
    if (expectedId !== albumId) {
      // Index is stale, search by identity
      const result = findAlbumByIdentity(albumId);
      if (result) {
        album = result.album;
        indexToMove = result.index;
      } else {
        throw new Error('Album not found');
      }
    }
  } else if (!album) {
    throw new Error('Album not found');
  }

  // Clone the album data to preserve all metadata
  const albumToMove = { ...album };

  // Check for duplicate in target list
  const targetAlbums = getListData(targetList);
  if (isAlbumInList(albumToMove, targetAlbums || [])) {
    showToast(
      `"${albumToMove.album}" already exists in "${targetList}"`,
      'error'
    );
    return;
  }

  // Remove from source list
  sourceAlbums.splice(indexToMove, 1);

  // Add to target list (may need to load it first)
  let targetData = targetAlbums;
  if (!targetData) {
    // Target list data not loaded, fetch it first
    targetData = await apiCall(`/api/lists/${encodeURIComponent(targetList)}`);
    setListData(targetList, targetData);
  }
  targetData.push(albumToMove);

  try {
    // Save both lists to the server
    await Promise.all([
      saveList(currentList, sourceAlbums),
      saveList(targetList, targetData),
    ]);

    // Update the current view
    selectList(currentList);

    showToast(`Moved "${album.album}" to "${targetList}"`);
  } catch (error) {
    console.error('Error saving lists after move:', error);

    // Rollback: add back to source, remove from target
    sourceAlbums.splice(indexToMove, 0, albumToMove);
    targetData.pop();

    throw error;
  }
}

// Show confirmation modal for moving album to another list
function showMoveConfirmation(albumId, targetList) {
  if (!albumId || !targetList) {
    console.error('Invalid albumId or targetList');
    return;
  }

  // Find the album by identity
  const result = findAlbumByIdentity(albumId);
  if (!result) {
    showToast('Album not found - it may have been moved or removed', 'error');
    return;
  }

  const { album, index } = result;

  showConfirmation(
    'Move Album',
    `Move "${album.album}" by ${album.artist} to "${targetList}"?`,
    `This will remove the album from "${currentList}" and add it to "${targetList}".`,
    'Move',
    async () => {
      try {
        await moveAlbumToList(index, albumId, targetList);
      } catch (error) {
        console.error('Error moving album:', error);
        showToast('Error moving album', 'error');
      }
    }
  );
}

// Show mobile sheet to select target list for moving album
window.showMobileMoveToListSheet = function (index, albumId) {
  // Validate index
  const albumsForMove = getListData(currentList);
  if (
    isNaN(index) ||
    index < 0 ||
    !albumsForMove ||
    index >= albumsForMove.length
  ) {
    console.error('Invalid album index:', index);
    return;
  }

  const album = albumsForMove[index];

  // Get all list names except the current one
  const listNames = Object.keys(lists).filter((name) => name !== currentList);

  // Remove any existing sheets
  const existingSheet = document.querySelector(
    '.fixed.inset-0.z-50.lg\\:hidden'
  );
  if (existingSheet) {
    existingSheet.remove();
  }

  const actionSheet = document.createElement('div');
  actionSheet.className = 'fixed inset-0 z-50 lg:hidden';

  if (listNames.length === 0) {
    actionSheet.innerHTML = `
      <div class="absolute inset-0 bg-black bg-opacity-50" data-backdrop></div>
      <div class="absolute bottom-0 left-0 right-0 bg-gray-900 rounded-t-2xl safe-area-bottom">
        <div class="p-4">
          <div class="w-12 h-1 bg-gray-600 rounded-full mx-auto mb-4"></div>
          <h3 class="font-semibold text-white mb-1">Move to List</h3>
          <p class="text-sm text-gray-400 mb-4">${album.album} by ${album.artist}</p>
          
          <div class="py-8 text-center text-gray-500">
            No other lists available
          </div>
          
          <button data-action="cancel"
                  class="w-full text-center py-3 px-4 mt-2 bg-gray-800 rounded">
            Cancel
          </button>
        </div>
      </div>
    `;
  } else {
    const listButtons = listNames
      .map(
        (listName) => `
        <button data-target-list="${listName}"
                class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded">
          <i class="fas fa-list mr-3 text-gray-400"></i>${listName}
        </button>
      `
      )
      .join('');

    actionSheet.innerHTML = `
      <div class="absolute inset-0 bg-black bg-opacity-50" data-backdrop></div>
      <div class="absolute bottom-0 left-0 right-0 bg-gray-900 rounded-t-2xl safe-area-bottom max-h-[80vh] overflow-y-auto">
        <div class="p-4">
          <div class="w-12 h-1 bg-gray-600 rounded-full mx-auto mb-4"></div>
          <h3 class="font-semibold text-white mb-1">Move to List</h3>
          <p class="text-sm text-gray-400 mb-4 truncate">${album.album} by ${album.artist}</p>
          
          ${listButtons}
          
          <button data-action="cancel"
                  class="w-full text-center py-3 px-4 mt-2 bg-gray-800 rounded">
            Cancel
          </button>
        </div>
      </div>
    `;
  }

  document.body.appendChild(actionSheet);

  const backdrop = actionSheet.querySelector('[data-backdrop]');
  const cancelBtn = actionSheet.querySelector('[data-action="cancel"]');

  const closeSheet = () => {
    actionSheet.remove();
  };

  backdrop.addEventListener('click', closeSheet);
  cancelBtn.addEventListener('click', closeSheet);

  // Attach click handlers to list buttons
  actionSheet.querySelectorAll('[data-target-list]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const targetList = btn.dataset.targetList;
      closeSheet();
      showMoveConfirmation(albumId, targetList);
    });
  });
};

// Show mobile action sheet for list context menu
window.showMobileListMenu = function (listName) {
  // Get shared menu configuration
  const menuConfig = getListMenuConfig(listName);

  // Remove any existing action sheets first
  const existingSheet = document.querySelector('.fixed.inset-0.z-\\[60\\]');
  if (existingSheet) {
    existingSheet.remove();
  }

  // Hide FAB when mobile action sheet is shown
  const fab = document.getElementById('addAlbumFAB');
  if (fab) {
    fab.style.display = 'none';
  }

  const actionSheet = document.createElement('div');
  actionSheet.className = 'fixed inset-0 z-[60]';
  actionSheet.innerHTML = `
    <div class="absolute inset-0 bg-black bg-opacity-50" data-backdrop></div>
    <div class="absolute bottom-0 left-0 right-0 bg-gray-900 rounded-t-2xl safe-area-bottom">
      <div class="p-4">
        <div class="w-12 h-1 bg-gray-600 rounded-full mx-auto mb-4"></div>
        <h3 class="font-semibold text-white mb-4">${listName}</h3>
        
        <button data-action="download"
                class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded">
          <i class="fas fa-download mr-3 text-gray-400"></i>Download List
        </button>
        
        <button data-action="edit"
                class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded">
          <i class="fas fa-edit mr-3 text-gray-400"></i>Edit Details
        </button>
        
        ${
          menuConfig.hasYear
            ? `
        <button data-action="toggle-official"
                class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded">
          <i class="fas ${menuConfig.officialIconClass} mr-3 text-yellow-500"></i>${menuConfig.officialToggleText}
        </button>
        `
            : ''
        }
        
        <button data-action="send-to-service"
                class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded">
          <i class="fas fa-paper-plane mr-3 text-gray-400"></i>${menuConfig.musicServiceText}
        </button>
        
        <button data-action="delete"
                class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded text-red-500">
          <i class="fas fa-trash mr-3"></i>Delete List
        </button>
        
        <button data-action="cancel"
                class="w-full text-center py-3 px-4 mt-2 bg-gray-800 rounded">
          Cancel
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(actionSheet);

  // Attach event listeners
  const backdrop = actionSheet.querySelector('[data-backdrop]');
  const downloadBtn = actionSheet.querySelector('[data-action="download"]');
  const editBtn = actionSheet.querySelector('[data-action="edit"]');
  const toggleOfficialBtn = actionSheet.querySelector(
    '[data-action="toggle-official"]'
  );
  const sendToServiceBtn = actionSheet.querySelector(
    '[data-action="send-to-service"]'
  );
  const deleteBtn = actionSheet.querySelector('[data-action="delete"]');
  const cancelBtn = actionSheet.querySelector('[data-action="cancel"]');

  const closeSheet = () => {
    actionSheet.remove();
    // Restore FAB visibility if a list is selected
    const fabElement = document.getElementById('addAlbumFAB');
    if (fabElement && currentList) {
      fabElement.style.display = 'flex';
    }
  };

  backdrop.addEventListener('click', closeSheet);
  cancelBtn.addEventListener('click', closeSheet);

  downloadBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeSheet();
    downloadListAsJSON(listName);
  });

  editBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeSheet();
    openRenameModal(listName);
  });

  if (toggleOfficialBtn) {
    toggleOfficialBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeSheet();
      toggleOfficialStatus(listName);
    });
  }

  sendToServiceBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeSheet();
    try {
      const listData = getListData(listName) || [];
      await updatePlaylist(listName, listData);
    } catch (err) {
      console.error('Update playlist failed', err);
    }
  });

  deleteBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeSheet();

    const confirmed = await showConfirmation(
      'Delete List',
      `Are you sure you want to delete the list "${listName}"?`,
      'This action cannot be undone.',
      'Delete'
    );

    if (confirmed) {
      try {
        await apiCall(`/api/lists/${encodeURIComponent(listName)}`, {
          method: 'DELETE',
        });

        delete lists[listName];

        if (currentList === listName) {
          const remainingLists = Object.keys(lists);
          if (remainingLists.length > 0) {
            selectList(remainingLists[0]);
          } else {
            currentList = null;
            window.currentList = currentList;
            // Refresh mobile bar visibility when list is cleared
            if (window.refreshMobileBarVisibility) {
              window.refreshMobileBarVisibility();
            }

            const headerAddAlbumBtn =
              document.getElementById('headerAddAlbumBtn');
            if (headerAddAlbumBtn) headerAddAlbumBtn.classList.add('hidden');

            document.getElementById('albumContainer').innerHTML = `
              <div class="text-center text-gray-500 mt-20">
                <p class="text-xl mb-2">No list selected</p>
                <p class="text-sm">Create or import a list to get started</p>
              </div>
            `;
          }
        }

        updateListNav();
        showToast(`List "${listName}" deleted`);
      } catch (_error) {
        showToast('Error deleting list', 'error');
      }
    }
  });
};

// Helper function to find album by identity instead of index
function findAlbumByIdentity(albumId) {
  const albums = getListData(currentList);
  if (!currentList || !albums) return null;

  for (let i = 0; i < albums.length; i++) {
    const album = albums[i];
    const currentId =
      `${album.artist}::${album.album}::${album.release_date || ''}`.toLowerCase();
    if (currentId === albumId) {
      return { album, index: i };
    }
  }
  return null;
}

// Safe wrapper for mobile edit form that uses album identity
window.showMobileEditFormSafe = function (albumId) {
  const result = findAlbumByIdentity(albumId);
  if (!result) {
    showToast('Album not found - it may have been moved or removed', 'error');
    return;
  }
  showMobileEditForm(result.index);
};

// Safe wrapper for play album that uses album identity
window.playAlbumSafe = function (albumId) {
  const result = findAlbumByIdentity(albumId);
  if (!result) {
    showToast('Album not found - it may have been moved or removed', 'error');
    return;
  }
  playAlbum(result.index);
};

// Safe wrapper for remove album that uses album identity
window.removeAlbumSafe = function (albumId) {
  const result = findAlbumByIdentity(albumId);
  if (!result) {
    showToast('Album not found - it may have been moved or removed', 'error');
    return;
  }

  // Use the existing remove logic but with the current index
  currentContextAlbum = result.index;
  document.getElementById('removeAlbumOption').click();
};

// Mobile edit form (basic implementation)
window.showMobileEditForm = function (index) {
  // Validate inputs
  const albumsForEdit = getListData(currentList);
  if (!currentList || !albumsForEdit) {
    showToast('No list selected', 'error');
    return;
  }

  if (isNaN(index) || index < 0 || index >= albumsForEdit.length) {
    showToast('Invalid album selected', 'error');
    return;
  }

  const album = albumsForEdit[index];
  if (!album) {
    showToast('Album not found', 'error');
    return;
  }
  const originalReleaseDate = album.release_date || '';
  const inputReleaseDate = originalReleaseDate
    ? normalizeDateForInput(originalReleaseDate) ||
      new Date().toISOString().split('T')[0]
    : new Date().toISOString().split('T')[0];

  // Remove any existing edit modals first to prevent overlays
  const existingModals = document.querySelectorAll(
    '.fixed.inset-0.z-50.bg-gray-900'
  );
  existingModals.forEach((modal) => modal.remove());

  // Create the edit modal
  const editModal = document.createElement('div');
  editModal.className =
    'fixed inset-0 z-50 bg-gray-900 flex flex-col overflow-hidden lg:max-w-2xl lg:max-h-[85vh] lg:mx-auto lg:mt-20 lg:mb-8 lg:rounded-lg lg:shadow-2xl';
  editModal.innerHTML = `
    <!-- Header -->
    <div class="flex items-center justify-between p-4 border-b border-gray-800 flex-shrink-0">
      <button data-close-editor class="p-2 -m-2 text-gray-400 hover:text-white">
        <i class="fas fa-times text-xl"></i>
      </button>
      <h3 class="text-lg font-semibold text-white flex-1 text-center px-4">Edit Album</h3>
      <button id="mobileEditSaveBtn" class="text-red-500 font-semibold whitespace-nowrap">Save</button>
    </div>
    
    <!-- Form Content -->
    <div class="flex-1 overflow-y-auto overflow-x-hidden -webkit-overflow-scrolling-touch">
      <form id="mobileEditForm" class="p-4 space-y-4 max-w-full">
        <!-- Album Cover Preview -->
        ${
          album.cover_image
            ? `
          <div class="flex justify-center mb-4">
            <img src="data:image/${album.cover_image_format || 'PNG'};base64,${album.cover_image}" 
                 alt="${album.album}" 
                 class="w-32 h-32 rounded-lg object-cover shadow-md">
          </div>
        `
            : ''
        }
        
        <!-- Artist Name -->
        <div class="w-full">
          <label class="block text-gray-400 text-sm mb-2">Artist</label>
          <input 
            type="text" 
            id="editArtist" 
            value="${album.artist || ''}"
            class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 transition duration-200"
            placeholder="Artist name"
          >
        </div>
        
        <!-- Album Title -->
        <div class="w-full">
          <label class="block text-gray-400 text-sm mb-2">Album</label>
          <input 
            type="text" 
            id="editAlbum" 
            value="${album.album || ''}"
            class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 transition duration-200"
            placeholder="Album title"
          >
        </div>
        
        <!-- Release Date -->
        <div class="w-full">
          <label class="block text-gray-400 text-sm mb-2">Release Date</label>
          <input
            type="date"
            id="editReleaseDate"
            value="${inputReleaseDate}"
            class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 transition duration-200"
            style="display: block; width: 100%; min-height: 48px; -webkit-appearance: none;"
          >
          ${!album.release_date ? '<p class="text-xs text-gray-500 mt-1">No date set - defaulting to today</p>' : ''}
        </div>
        
        <!-- Country - Native Select -->
        <div class="w-full">
          <label class="block text-gray-400 text-sm mb-2">Country</label>
          <div class="relative">
            <select 
              id="editCountry" 
              class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-gray-500 transition duration-200 appearance-none pr-10"
            >
              <option value="">Select a country...</option>
              ${availableCountries
                .map(
                  (country) =>
                    `<option value="${country}" ${country === album.country ? 'selected' : ''}>${country}</option>`
                )
                .join('')}
            </select>
            <div class="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
              <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
              </svg>
            </div>
          </div>
        </div>
        
        <!-- Genre 1 - Native Select -->
        <div class="w-full">
          <label class="block text-gray-400 text-sm mb-2">Primary Genre</label>
          <div class="relative">
            <select 
              id="editGenre1" 
              class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-gray-500 transition duration-200 appearance-none pr-10"
            >
              <option value="">Select a genre...</option>
              ${availableGenres
                .map(
                  (genre) =>
                    `<option value="${genre}" ${genre === (album.genre_1 || album.genre) ? 'selected' : ''}>${genre}</option>`
                )
                .join('')}
            </select>
            <div class="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
              <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
              </svg>
            </div>
          </div>
        </div>
        
        <!-- Genre 2 - Native Select -->
        <div class="w-full">
          <label class="block text-gray-400 text-sm mb-2">Secondary Genre</label>
          <div class="relative">
            <select 
              id="editGenre2" 
              class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-gray-500 transition duration-200 appearance-none pr-10"
            >
              <option value="">None (optional)</option>
              ${availableGenres
                .map((genre) => {
                  const currentGenre2 =
                    album.genre_2 &&
                    album.genre_2 !== 'Genre 2' &&
                    album.genre_2 !== '-'
                      ? album.genre_2
                      : '';
                  return `<option value="${genre}" ${genre === currentGenre2 ? 'selected' : ''}>${genre}</option>`;
                })
                .join('')}
            </select>
            <div class="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
              <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
              </svg>
            </div>
          </div>
        </div>
        
        <!-- Comments -->
        <div class="w-full">
          <label class="block text-gray-400 text-sm mb-2">Comments</label>
          <textarea
            id="editComments"
            rows="3"
            class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 transition duration-200 resize-none"
            placeholder="Add your notes..."
          >${album.comments || album.comment || ''}</textarea>
        </div>

        <!-- Track Selection -->
        <div class="w-full" id="trackPickWrapper">
          <div class="flex items-center justify-between">
            <label class="block text-gray-400 text-sm mb-2">Selected Track</label>
            <button type="button" id="fetchTracksBtn" class="text-xs text-red-500 hover:underline">Get</button>
          </div>
          <div id="trackPickContainer">
          ${
            Array.isArray(album.tracks) && album.tracks.length > 0
              ? `
            <ul class="space-y-2">
              ${album.tracks
                .map(
                  (t, _idx) => `
                <li>
                  <label class="flex items-center space-x-2">
                    <input type="checkbox" class="track-pick-checkbox" value="${t}" ${t === (album.track_pick || '') ? 'checked' : ''}>
                    <span>${t}</span>
                  </label>
                </li>`
                )
                .join('')}
            </ul>
          `
              : `
            <input type="number" id="editTrackPickNumber" value="${album.track_pick || ''}"
                   class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 transition duration-200"
                   placeholder="Enter track number">
          `
          }
          </div>
        </div>

        <!-- Spacer for bottom padding -->
        <div class="h-4"></div>
      </form>
    </div>
  `;

  document.body.appendChild(editModal);

  // Attach close button handler
  const closeBtn = editModal.querySelector('[data-close-editor]');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      editModal.remove();
      // Force scroll to top and trigger reflow to fix iOS keyboard issues
      window.scrollTo(0, 0);
      document.body.scrollTop = 0;
    });
  }

  function setupTrackPickCheckboxes() {
    if (!trackPickContainer) return;
    const boxes = trackPickContainer.querySelectorAll(
      'input.track-pick-checkbox'
    );
    boxes.forEach((box) => {
      box.onchange = () => {
        if (box.checked) {
          boxes.forEach((other) => {
            if (other !== box) other.checked = false;
          });
        }
      };
    });
  }

  // Fetch track list when button is clicked
  const fetchBtn = document.getElementById('fetchTracksBtn');
  const trackPickContainer = document.getElementById('trackPickContainer');
  setupTrackPickCheckboxes();
  if (fetchBtn) {
    fetchBtn.onclick = async () => {
      if (!album.album_id) return;
      fetchBtn.textContent = '...';
      fetchBtn.disabled = true;
      try {
        const tracks = await fetchTracksForAlbum(album);
        album.tracks = tracks;
        if (trackPickContainer) {
          trackPickContainer.innerHTML =
            tracks.length > 0
              ? `<ul class="space-y-2">${tracks
                  .map(
                    (t) => `
                <li>
                  <label class="flex items-center space-x-2">
                    <input type="checkbox" class="track-pick-checkbox" value="${t}">
                    <span>${t}</span>
                  </label>
                </li>`
                  )
                  .join('')}</ul>`
              : `<input type="number" id="editTrackPickNumber" value="${album.track_pick || ''}"
                   class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 transition duration-200"
                   placeholder="Enter track number">`;
          setupTrackPickCheckboxes();
        }
        showToast('Tracks loaded');
      } catch (err) {
        console.error('Track fetch error:', err);
        showToast('Error fetching tracks', 'error');
      } finally {
        fetchBtn.textContent = 'Get';
        fetchBtn.disabled = false;
      }
    };
  }

  // Handle save (rest of the code remains the same)
  document.getElementById('mobileEditSaveBtn').onclick = async function () {
    // Gather all the values
    const newDateValue = document.getElementById('editReleaseDate').value;
    const normalizedOriginal = normalizeDateForInput(originalReleaseDate);
    const finalReleaseDate =
      originalReleaseDate && newDateValue === normalizedOriginal
        ? originalReleaseDate
        : formatDateForStorage(newDateValue);

    const updatedAlbum = {
      ...album,
      artist: document.getElementById('editArtist').value.trim(),
      album: document.getElementById('editAlbum').value.trim(),
      release_date: finalReleaseDate,
      country: document.getElementById('editCountry').value,
      genre_1: document.getElementById('editGenre1').value,
      genre: document.getElementById('editGenre1').value, // Keep both for compatibility
      genre_2: document.getElementById('editGenre2').value,
      // Persist tracks that may have been fetched while editing
      tracks: Array.isArray(album.tracks) ? album.tracks : undefined,
      track_pick: (() => {
        if (Array.isArray(album.tracks) && album.tracks.length > 0) {
          const checked = document.querySelector(
            '#trackPickContainer input[type="checkbox"]:checked'
          );
          return checked ? checked.value.trim() : '';
        }
        const numInput = document.getElementById('editTrackPickNumber');
        return numInput ? numInput.value.trim() : '';
      })(),
      comments: document.getElementById('editComments').value.trim(),
      comment: document.getElementById('editComments').value.trim(), // Keep both for compatibility
    };

    // Validate required fields
    if (!updatedAlbum.artist || !updatedAlbum.album) {
      showToast('Artist and Album are required', 'error');
      return;
    }

    // Update the album in the list
    const albumsToSave = getListData(currentList);
    if (!albumsToSave) {
      showToast('Error: List data not found', 'error');
      return;
    }
    albumsToSave[index] = updatedAlbum;

    // Close the modal immediately for better UX
    editModal.remove();

    // Force scroll to top and trigger reflow to fix iOS keyboard issues
    window.scrollTo(0, 0);
    document.body.scrollTop = 0;

    // Force refresh the display to show changes immediately
    displayAlbums(albumsToSave);
    fetchAndApplyCovers(albumsToSave);

    // Save to server in the background
    try {
      await saveList(currentList, albumsToSave);
      showToast('Album updated successfully');
    } catch (error) {
      console.error('Error saving album:', error);
      showToast('Error saving changes', 'error');

      // Revert changes on error
      albumsToSave[index] = album;

      // Refresh display to show reverted state
      displayAlbums(albumsToSave);
      fetchAndApplyCovers(albumsToSave);
    }
  };

  // Focus on first input
  setTimeout(() => {
    document.getElementById('editArtist').focus();
  }, 100);
};

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
            isOfficial: false,
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
