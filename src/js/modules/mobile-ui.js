/**
 * Mobile UI Module
 *
 * Handles mobile-specific UI components including bottom sheets, action menus,
 * and full-screen edit forms. Uses dependency injection for testability.
 *
 * @module mobile-ui
 */

import { normalizeDateForInput, formatDateForStorage } from './date-utils.js';
import { escapeHtmlAttr as escapeHtml } from './html-utils.js';
import { createActionSheet } from './ui-factories.js';
import { createTransferHelpers } from './album-transfer.js';
import { fetchSpotifyDevices } from '../utils/playback-service.js';
import { createMobileAlbumActions } from './mobile-ui/album-actions.js';
import { createTrackPickService } from './track-pick-service.js';
import { createAlbumIdentityFinder } from './mobile-ui/album-identity.js';
import { createListMenuActions } from './list-menu-shared.js';
import { createMobileListMenus } from './mobile-ui/list-menus.js';

/**
 * Factory function to create the mobile UI module with injected dependencies
 *
 * @param {Object} deps - Dependencies
 * @param {Function} deps.getListData - Get album array for a list
 * @param {Function} deps.getListMetadata - Get metadata for a list
 * @param {Function} deps.getCurrentList - Get current list name
 * @param {Function} deps.getLists - Get all lists
 * @param {Function} deps.setListData - Set list data in cache
 * @param {Function} deps.saveList - Save list to server
 * @param {Function} deps.selectList - Select a list
 * @param {Function} deps.showToast - Show toast notification
 * @param {Function} deps.showConfirmation - Show confirmation dialog
 * @param {Function} deps.apiCall - Make API call
 * @param {Function} deps.displayAlbums - Display albums in container
 * @param {Function} deps.updateListNav - Update list navigation
 * @param {Function} deps.fetchTracksForAlbum - Fetch tracks for an album
 * @param {Function} deps.playAlbum - Play album by index
 * @param {Function} deps.playAlbumOnDeviceMobile - Play album on specific Spotify device
 * @param {Function} deps.openRenameModal - Open rename modal
 * @param {Function} deps.downloadListAsJSON - Download list as JSON
 * @param {Function} deps.downloadListAsPDF - Download list as PDF
 * @param {Function} deps.downloadListAsCSV - Download list as CSV
 * @param {Function} deps.updatePlaylist - Update playlist on music service
 * @param {Function} deps.toggleMainStatus - Toggle main status
 * @param {Function} deps.getDeviceIcon - Get icon for device type
 * @param {Function} deps.getAvailableCountries - Get available countries list
 * @param {Function} deps.getAvailableGenres - Get available genres list
 * @param {Function} deps.setCurrentContextAlbum - Set current context album index
 * @param {Function} deps.refreshMobileBarVisibility - Refresh mobile bar visibility
 * @param {Function} deps.showDiscoveryModal - Show discovery modal for Last.fm features
 * @param {Function} deps.playSpecificTrack - Play a specific track by name
 * @param {Function} deps.getSortedGroups - Get groups sorted by sort_order
 * @param {Function} deps.refreshGroupsAndLists - Refresh groups and lists after changes
 * @param {Function} deps.isViewingRecommendations - Check if currently viewing recommendations
 * @param {Function} deps.recommendAlbum - Shared recommendation flow (reasoning modal + API)
 * @param {Function} deps.openRenameCategoryModal - Open category rename modal
 * @param {Function} deps.getCurrentUser - Get authenticated frontend user
 * @returns {Object} Mobile UI module API
 */
export function createMobileUI(deps = {}) {
  const {
    getListData,
    getListMetadata,
    getCurrentList,
    getLists,
    setListData,
    saveList,
    selectList,
    showToast,
    showConfirmation,
    apiCall,
    displayAlbums,
    updateListNav,
    fetchTracksForAlbum,
    getTrackName,
    getTrackLength,
    formatTrackTime,
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
    setCurrentContextAlbum,
    refreshMobileBarVisibility,
    showDiscoveryModal,
    playSpecificTrack,
    getSortedGroups,
    refreshGroupsAndLists,
    isViewingRecommendations,
    recommendAlbum,
    openRenameCategoryModal,
    getCurrentUser = () => window.currentUser || {},
  } = deps;
  const trackPickService = createTrackPickService({ apiCall });
  const findAlbumByIdentity = createAlbumIdentityFinder({
    getCurrentList,
    getListData,
  });
  const listMenuActions = createListMenuActions({
    getListData,
    updatePlaylist,
    downloadListAsJSON,
    downloadListAsPDF,
    downloadListAsCSV,
    openRenameModal,
    toggleMainStatus,
    logger: console,
  });

  // Create transfer helpers (move/copy with confirmation dialogs)
  const {
    moveAlbumToList,
    copyAlbumToList,
    showMoveConfirmation,
    showCopyConfirmation,
  } = createTransferHelpers(
    {
      getCurrentList,
      getLists,
      getListData,
      setListData,
      getListMetadata,
      saveList,
      selectList,
      showToast,
      apiCall,
      findAlbumByIdentity,
    },
    {
      showConfirmation,
      showToast,
      findAlbumByIdentity,
      getCurrentList,
      getListMetadata,
    }
  );

  const {
    showMobileAlbumMenu,
    showMobileMoveToListSheet,
    showMobileCopyToListSheet,
  } = createMobileAlbumActions({
    createActionSheet,
    fetchSpotifyDevices,
    getCurrentList,
    getListData,
    getLists,
    getListMetadata,
    showToast,
    getDeviceIcon,
    playAlbumOnDeviceMobile,
    isViewingRecommendations,
    recommendAlbum,
    showDiscoveryModal,
    showMoveConfirmation,
    showCopyConfirmation,
    onEditAlbum: showMobileEditFormSafe,
    onPlayAlbum: playAlbumSafe,
    onRemoveAlbum: removeAlbumSafe,
  });

  const { showMobileListMenu, showMobileCategoryMenu } = createMobileListMenus({
    createActionSheet,
    getCurrentList,
    getLists,
    getListMetadata,
    getSortedGroups,
    getCurrentUser,
    listMenuActions,
    showConfirmation,
    apiCall,
    selectList,
    refreshMobileBarVisibility,
    refreshGroupsAndLists,
    updateListNav,
    showToast,
    openRenameCategoryModal,
  });

  /**
   * Initialize a searchable genre select component
   * Features: search/filter with highlight, matches float to top, non-matches dimmed but visible
   * @param {string} containerId - ID of the container element
   * @param {string[]} options - Array of genre options
   * @param {string} initialValue - Initial selected value
   * @param {string} placeholder - Placeholder text when no value selected
   */
  function initSearchableGenreSelect(
    containerId,
    options,
    initialValue,
    placeholder
  ) {
    const container = document.getElementById(containerId);
    if (!container) return;

    let currentValue = initialValue || '';

    // Create the button that shows current selection
    const button = document.createElement('button');
    button.type = 'button';
    button.className =
      'w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-left focus:outline-hidden focus:border-gray-500 transition duration-200 flex items-center justify-between';
    button.innerHTML = `
      <span class="genre-select-text ${currentValue ? 'text-white' : 'text-gray-500'}">${currentValue || placeholder}</span>
      <svg class="w-5 h-5 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
      </svg>
    `;

    // Create hidden input for form value
    const hiddenInput = document.createElement('input');
    hiddenInput.type = 'hidden';
    hiddenInput.id = containerId.replace('Container', '');
    hiddenInput.value = currentValue;

    // Create the dropdown overlay
    const overlay = document.createElement('div');
    overlay.className =
      'fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm hidden';
    overlay.style.display = 'none';

    // Create the dropdown panel
    const panel = document.createElement('div');
    panel.className =
      'fixed inset-x-4 top-1/2 -translate-y-1/2 z-[61] bg-gray-800 rounded-xl shadow-2xl max-h-[70vh] flex flex-col overflow-hidden';
    panel.innerHTML = `
      <div class="p-4 border-b border-gray-700 shrink-0">
        <div class="flex items-center justify-between mb-3">
          <h4 class="text-white font-medium">Select Genre</h4>
          <button type="button" class="genre-select-close p-2 -m-2 text-gray-400 hover:text-white">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
        <input type="text" class="genre-search-input w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-hidden focus:border-gray-500" placeholder="Search genres...">
      </div>
      <div class="genre-options-list flex-1 overflow-y-auto overscroll-contain"></div>
    `;

    const searchInput = panel.querySelector('.genre-search-input');
    const optionsList = panel.querySelector('.genre-options-list');
    const closeBtn = panel.querySelector('.genre-select-close');

    /**
     * Render options list with filtering and highlighting
     */
    const renderOptions = (searchTerm = '') => {
      const term = searchTerm.toLowerCase().trim();
      optionsList.innerHTML = '';

      // Add "Clear" option if there's a current value
      if (currentValue) {
        const clearItem = document.createElement('div');
        clearItem.className =
          'px-4 py-3 text-gray-500 border-b border-gray-700 cursor-pointer active:bg-gray-700 italic';
        clearItem.textContent = 'Clear selection';
        clearItem.onclick = () => {
          currentValue = '';
          hiddenInput.value = '';
          button.querySelector('.genre-select-text').textContent = placeholder;
          button.querySelector('.genre-select-text').className =
            'genre-select-text text-gray-500';
          closeDropdown();
        };
        optionsList.appendChild(clearItem);
      }

      // Separate matches and non-matches
      const matches = [];
      const nonMatches = [];

      options.forEach((genre) => {
        const lowerGenre = genre.toLowerCase();
        if (term === '' || lowerGenre.includes(term)) {
          matches.push({ genre, isMatch: true });
        } else {
          nonMatches.push({ genre, isMatch: false });
        }
      });

      // Sort matches: exact matches first, then starts-with, then contains
      if (term) {
        matches.sort((a, b) => {
          const aLower = a.genre.toLowerCase();
          const bLower = b.genre.toLowerCase();
          const aExact = aLower === term;
          const bExact = bLower === term;
          const aStarts = aLower.startsWith(term);
          const bStarts = bLower.startsWith(term);

          if (aExact && !bExact) return -1;
          if (!aExact && bExact) return 1;
          if (aStarts && !bStarts) return -1;
          if (!aStarts && bStarts) return 1;
          return a.genre.localeCompare(b.genre);
        });
      }

      // Combine: matches first, then non-matches
      const allOptions = [...matches, ...nonMatches];

      // Add separator if we have both matches and non-matches
      let separatorAdded = false;

      allOptions.forEach((item) => {
        // Add separator between matches and non-matches
        if (!separatorAdded && !item.isMatch && matches.length > 0 && term) {
          const separator = document.createElement('div');
          separator.className =
            'px-4 py-2 text-xs text-gray-600 bg-gray-900 border-t border-gray-700';
          separator.textContent = 'Other genres';
          optionsList.appendChild(separator);
          separatorAdded = true;
        }

        const optionItem = document.createElement('div');
        optionItem.className = item.isMatch
          ? 'px-4 py-3 cursor-pointer active:bg-gray-600'
          : 'px-4 py-3 cursor-pointer active:bg-gray-600 text-gray-600';

        // Highlight matching text
        let displayText = item.genre;
        if (term && item.isMatch) {
          const matchIndex = item.genre.toLowerCase().indexOf(term);
          if (matchIndex !== -1) {
            const before = item.genre.slice(0, matchIndex);
            const match = item.genre.slice(
              matchIndex,
              matchIndex + term.length
            );
            const after = item.genre.slice(matchIndex + term.length);
            displayText = `${before}<span class="text-green-400 font-medium">${match}</span>${after}`;
          }
        }

        // Mark current selection
        if (item.genre === currentValue) {
          optionItem.className += ' bg-gray-700/50';
          displayText +=
            ' <span class="text-green-500 text-sm ml-2">&#x2713;</span>';
        }

        optionItem.innerHTML = `<span class="${item.isMatch ? 'text-white' : ''}">${displayText}</span>`;

        optionItem.onclick = () => {
          currentValue = item.genre;
          hiddenInput.value = item.genre;
          button.querySelector('.genre-select-text').textContent = item.genre;
          button.querySelector('.genre-select-text').className =
            'genre-select-text text-white';
          closeDropdown();
        };

        optionsList.appendChild(optionItem);
      });
    };

    const openDropdown = () => {
      overlay.style.display = 'block';
      document.body.appendChild(panel);
      searchInput.value = '';
      renderOptions();
      // Focus search input after a small delay for mobile
      setTimeout(() => searchInput.focus(), 100);
    };

    const closeDropdown = () => {
      overlay.style.display = 'none';
      if (panel.parentNode) {
        panel.parentNode.removeChild(panel);
      }
    };

    // Event handlers
    button.onclick = (e) => {
      e.preventDefault();
      openDropdown();
    };

    overlay.onclick = () => closeDropdown();
    closeBtn.onclick = () => closeDropdown();

    searchInput.addEventListener('input', (e) => {
      renderOptions(e.target.value);
    });

    // Keyboard support
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeDropdown();
      }
    });

    // Assemble
    container.appendChild(button);
    container.appendChild(hiddenInput);
    document.body.appendChild(overlay);

    // Store value getter on container for external access
    container.getValue = () => currentValue;
  }

  /**
   * Show mobile edit form for an album
   * @param {number} index - Album index in list
   */
  function showMobileEditForm(index) {
    const currentList = getCurrentList();
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

    // Remove any existing edit modals first
    const existingModals = document.querySelectorAll(
      '.fixed.inset-0.z-50.bg-gray-900'
    );
    existingModals.forEach((modal) => modal.remove());

    const availableCountries = getAvailableCountries();
    const availableGenres = getAvailableGenres();

    // Create the edit modal
    const editModal = document.createElement('div');
    editModal.className =
      'fixed inset-0 z-50 bg-gray-900 flex flex-col overflow-hidden pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] lg:max-w-2xl lg:max-h-[85vh] lg:mx-auto lg:mt-20 lg:mb-8 lg:rounded-lg lg:shadow-2xl';
    editModal.innerHTML = `
      <!-- Header -->
      <div class="flex items-center justify-between p-4 border-b border-gray-800 shrink-0">
        <button data-close-editor class="p-2 -m-2 text-gray-400 hover:text-white">
          <i class="fas fa-times text-xl"></i>
        </button>
        <h3 class="text-lg font-semibold text-white flex-1 text-center px-4">Edit Album</h3>
        <button id="mobileEditSaveBtn" class="text-red-500 font-semibold whitespace-nowrap">Save</button>
      </div>
      
      <!-- Form Content -->
      <div class="flex-1 overflow-y-auto overflow-x-hidden -webkit-overflow-scrolling-touch">
        <form id="mobileEditForm" class="p-4 space-y-4 max-w-full">
          <!-- Album Cover - Editable -->
          <div class="w-full">
            <label class="block text-gray-400 text-sm mb-2">Cover Art</label>
            <div class="flex items-start gap-4">
              <div id="editCoverPreview" class="w-24 h-24 bg-gray-800 rounded-lg flex items-center justify-center border border-gray-700 shrink-0 overflow-hidden">
                ${
                  album.cover_image
                    ? `<img src="data:image/${album.cover_image_format || 'PNG'};base64,${album.cover_image}" 
                           alt="${album.album}" 
                           class="w-full h-full object-cover">`
                    : album.cover_image_url
                      ? `<img src="${album.cover_image_url}" 
                             alt="${album.album}" 
                             class="w-full h-full object-cover">`
                      : `<i class="fas fa-image text-2xl text-gray-600"></i>`
                }
              </div>
              <div class="flex-1">
                <input 
                  type="file" 
                  id="editCoverArt" 
                  accept="image/*"
                  class="hidden"
                >
                <button 
                  type="button"
                  id="editCoverBtn"
                  class="w-full px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition duration-200"
                >
                  <i class="fas fa-camera mr-2"></i>${album.cover_image ? 'Change Image' : 'Add Image'}
                </button>
                <p class="text-xs text-gray-500 mt-1">Max 5MB</p>
              </div>
            </div>
          </div>
          
          <!-- Artist Name -->
          <div class="w-full">
            <label class="block text-gray-400 text-sm mb-2">Artist</label>
            <input 
              type="text" 
              id="editArtist" 
              value="${album.artist || ''}"
              class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-hidden focus:border-gray-500 transition duration-200"
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
              class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-hidden focus:border-gray-500 transition duration-200"
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
              class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-hidden focus:border-gray-500 transition duration-200"
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
                class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-hidden focus:border-gray-500 transition duration-200 appearance-none pr-10"
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
          
          <!-- Genre 1 - Searchable Select -->
          <div class="w-full">
            <label class="block text-gray-400 text-sm mb-2">Primary Genre</label>
            <div id="editGenre1Container" class="searchable-genre-select" data-value="${album.genre_1 || ''}" data-placeholder="Select a genre..."></div>
          </div>
          
          <!-- Genre 2 - Searchable Select -->
          <div class="w-full">
            <label class="block text-gray-400 text-sm mb-2">Secondary Genre</label>
            <div id="editGenre2Container" class="searchable-genre-select" data-value="${album.genre_2 && album.genre_2 !== 'Genre 2' && album.genre_2 !== '-' ? album.genre_2 : ''}" data-placeholder="None (optional)"></div>
          </div>
          
          <!-- Comments -->
          <div class="w-full">
            <label class="block text-gray-400 text-sm mb-2">Comments</label>
            <textarea
              id="editComments"
              rows="3"
              class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-hidden focus:border-gray-500 transition duration-200 resize-none"
              placeholder="Add your notes..."
            >${album.comments || ''}</textarea>
          </div>

          <!-- Comments 2 -->
          <div class="w-full">
            <label class="block text-gray-400 text-sm mb-2">Comments 2</label>
            <textarea
              id="editComments2"
              rows="3"
              class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-hidden focus:border-gray-500 transition duration-200 resize-none"
              placeholder="Add your notes..."
            >${album.comments_2 || ''}</textarea>
          </div>

          <!-- Track Selection (Dual: Primary + Secondary) -->
          <div class="w-full" id="trackPickWrapper">
            <div class="flex items-center justify-between">
              <label class="block text-gray-400 text-sm mb-2">Track Selection</label>
              <button type="button" id="fetchTracksBtn" class="text-xs text-red-500 hover:underline">Get</button>
            </div>
            <div class="text-xs text-gray-500 mb-2">Click once = secondary (☆) | Click again = primary (★)</div>
            <div id="trackPickContainer" data-album-index="${index}" data-list-item-id="${album._id || ''}">
            ${
              Array.isArray(album.tracks) && album.tracks.length > 0
                ? `
              <ul class="space-y-2">
                ${album.tracks
                  .map((t) => {
                    const trackName = getTrackName(t);
                    const trackLength = formatTrackTime(getTrackLength(t));
                    const isPrimary = trackName === (album.primary_track || '');
                    const isSecondary =
                      trackName === (album.secondary_track || '');
                    const indicator = isPrimary
                      ? '<span class="text-yellow-400 mr-1">★</span>'
                      : isSecondary
                        ? '<span class="text-yellow-400 mr-1">☆</span>'
                        : '';
                    const bgClass = isPrimary
                      ? 'bg-yellow-900/20'
                      : isSecondary
                        ? 'bg-gray-700/30'
                        : '';
                    return `
                  <li class="flex items-center space-x-2 p-1.5 rounded ${bgClass} track-pick-item cursor-pointer active:bg-gray-700/50" 
                      data-track="${trackName.replace(/"/g, '&quot;')}"
                      data-is-primary="${isPrimary}"
                      data-is-secondary="${isSecondary}">
                    ${indicator}
                    <span class="text-gray-300 flex-1 min-w-0 truncate">${trackName}</span>
                    ${trackLength ? `<span class="text-gray-500 text-xs shrink-0">${trackLength}</span>` : ''}
                    <button type="button" class="track-play-btn shrink-0 w-7 h-7 flex items-center justify-center text-green-400 hover:text-green-300 active:scale-95" data-track="${trackName.replace(/"/g, '&quot;')}" title="Play track">
                      <i class="fas fa-play text-xs"></i>
                    </button>
                  </li>`;
                  })
                  .join('')}
              </ul>
            `
                : `
              <input type="number" id="editTrackPickNumber" value="${album.primary_track || ''}"
                     class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-hidden focus:border-gray-500 transition duration-200"
                     placeholder="Enter track number (primary)">
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
        window.scrollTo(0, 0);
        document.body.scrollTop = 0;
      });
    }

    // Cover art editing state
    let pendingCoverData = null; // { base64: string, format: string }

    // Cover art button click handler
    const editCoverBtn = document.getElementById('editCoverBtn');
    const editCoverInput = document.getElementById('editCoverArt');
    const editCoverPreview = document.getElementById('editCoverPreview');

    if (editCoverBtn && editCoverInput) {
      editCoverBtn.addEventListener('click', () => {
        editCoverInput.click();
      });

      editCoverInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Validate file size (5MB max)
        if (file.size > 5 * 1024 * 1024) {
          showToast('Image file size must be less than 5MB', 'error');
          e.target.value = '';
          return;
        }

        // Validate file type
        if (!file.type.startsWith('image/')) {
          showToast('Please select a valid image file', 'error');
          e.target.value = '';
          return;
        }

        // Read and preview the file
        const reader = new FileReader();
        reader.onload = function (event) {
          // Show preview immediately
          if (editCoverPreview) {
            editCoverPreview.innerHTML = `<img src="${event.target.result}" alt="Cover preview" class="w-full h-full object-cover">`;
          }

          // Process and resize to 512x512
          const img = new Image();
          img.onload = function () {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            // Calculate dimensions to maintain aspect ratio (fit inside 512x512)
            let width = img.width;
            let height = img.height;
            const maxSize = 512;

            if (width > height) {
              if (width > maxSize) {
                height = (height * maxSize) / width;
                width = maxSize;
              }
            } else {
              if (height > maxSize) {
                width = (width * maxSize) / height;
                height = maxSize;
              }
            }

            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);

            // Convert to base64 JPEG
            const resizedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
            pendingCoverData = {
              base64: resizedDataUrl.split(',')[1],
              format: 'JPEG',
            };

            // Update button text
            if (editCoverBtn) {
              editCoverBtn.innerHTML =
                '<i class="fas fa-check mr-2"></i>Image Selected';
            }
          };

          img.onerror = function () {
            showToast('Error processing image', 'error');
          };

          img.src = event.target.result;
        };

        reader.onerror = function () {
          showToast('Error reading image file', 'error');
        };

        reader.readAsDataURL(file);
      });
    }

    // Initialize searchable genre selects
    initSearchableGenreSelect(
      'editGenre1Container',
      availableGenres,
      album.genre_1 || '',
      'Select a genre...'
    );
    initSearchableGenreSelect(
      'editGenre2Container',
      availableGenres,
      album.genre_2 && album.genre_2 !== 'Genre 2' && album.genre_2 !== '-'
        ? album.genre_2
        : '',
      'None (optional)'
    );

    const trackPickContainer = document.getElementById('trackPickContainer');

    // Track current selections (will be synced with server)
    let currentPrimaryTrack = album.primary_track || '';
    let currentSecondaryTrack = album.secondary_track || '';

    function updateTrackPickUI() {
      if (!trackPickContainer) return;
      const items = trackPickContainer.querySelectorAll('.track-pick-item');
      items.forEach((item) => {
        const trackName = item.dataset.track;
        const isPrimary = trackName === currentPrimaryTrack;
        const isSecondary = trackName === currentSecondaryTrack;

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

        // Update indicator
        const existingIndicator = item.querySelector(
          '.text-yellow-400, .text-gray-400'
        );
        if (existingIndicator) {
          existingIndicator.remove();
        }

        if (isPrimary) {
          const indicator = document.createElement('span');
          indicator.className = 'text-yellow-400 mr-1';
          indicator.textContent = '★';
          item.insertBefore(indicator, item.firstChild);
        } else if (isSecondary) {
          const indicator = document.createElement('span');
          indicator.className = 'text-yellow-400 mr-1';
          indicator.textContent = '☆';
          item.insertBefore(indicator, item.firstChild);
        }
      });
    }

    function setupTrackPickItems() {
      if (!trackPickContainer) return;
      const items = trackPickContainer.querySelectorAll('.track-pick-item');
      items.forEach((item) => {
        item.onclick = async (e) => {
          // Don't trigger if clicking the play button
          if (
            e.target.closest('.track-play-btn') ||
            e.target.classList.contains('track-play-btn')
          )
            return;

          const trackName = item.dataset.track;
          const listItemId = trackPickContainer.dataset.listItemId;

          if (!listItemId) {
            showToast('Cannot save - missing list item ID', 'error');
            return;
          }

          try {
            const result = await trackPickService.updateTrackPick(
              listItemId,
              trackName,
              {
                primaryTrack: currentPrimaryTrack,
                secondaryTrack: currentSecondaryTrack,
              }
            );
            currentPrimaryTrack = result.primaryTrack;
            currentSecondaryTrack = result.secondaryTrack;

            // Update UI immediately
            updateTrackPickUI();

            // Update local album data for save
            album.primary_track = currentPrimaryTrack;
            album.secondary_track = currentSecondaryTrack;
          } catch (err) {
            console.error('Track pick error:', err);
            showToast('Error updating track selection', 'error');
          }
        };
      });
    }

    function setupTrackPlayButtons() {
      if (!trackPickContainer || !playSpecificTrack) return;
      const albumIndex = parseInt(trackPickContainer.dataset.albumIndex, 10);
      const buttons = trackPickContainer.querySelectorAll('.track-play-btn');
      buttons.forEach((btn) => {
        btn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const trackName = btn.dataset.track;
          if (trackName) {
            playSpecificTrack(albumIndex, trackName);
          }
        };
      });
    }

    // Fetch track list when button is clicked
    const fetchBtn = document.getElementById('fetchTracksBtn');
    setupTrackPickItems();
    setupTrackPlayButtons();

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
                    .map((t) => {
                      const trackName = getTrackName(t);
                      const trackLength = formatTrackTime(getTrackLength(t));
                      const isPrimary = trackName === currentPrimaryTrack;
                      const isSecondary = trackName === currentSecondaryTrack;
                      const indicator = isPrimary
                        ? '<span class="text-yellow-400 mr-1">★</span>'
                        : isSecondary
                          ? '<span class="text-yellow-400 mr-1">☆</span>'
                          : '';
                      const bgClass = isPrimary
                        ? 'bg-yellow-900/20'
                        : isSecondary
                          ? 'bg-gray-700/30'
                          : '';
                      return `
                  <li class="flex items-center space-x-2 p-1.5 rounded ${bgClass} track-pick-item cursor-pointer active:bg-gray-700/50" 
                      data-track="${trackName.replace(/"/g, '&quot;')}"
                      data-is-primary="${isPrimary}"
                      data-is-secondary="${isSecondary}">
                    ${indicator}
                    <span class="text-gray-300 flex-1 min-w-0 truncate">${trackName}</span>
                    ${trackLength ? `<span class="text-gray-500 text-xs shrink-0">${trackLength}</span>` : ''}
                    <button type="button" class="track-play-btn shrink-0 w-7 h-7 flex items-center justify-center text-green-400 hover:text-green-300 active:scale-95" data-track="${trackName.replace(/"/g, '&quot;')}" title="Play track">
                      <i class="fas fa-play text-xs"></i>
                    </button>
                  </li>`;
                    })
                    .join('')}</ul>`
                : `<input type="number" id="editTrackPickNumber" value="${currentPrimaryTrack}"
                     class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-hidden focus:border-gray-500 transition duration-200"
                     placeholder="Enter track number (primary)">`;
            setupTrackPickItems();
            setupTrackPlayButtons();
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

    // Handle save
    document.getElementById('mobileEditSaveBtn').onclick = async function () {
      const newDateValue = document.getElementById('editReleaseDate').value;
      const normalizedOriginal = normalizeDateForInput(originalReleaseDate);
      const finalReleaseDate =
        originalReleaseDate && newDateValue === normalizedOriginal
          ? originalReleaseDate
          : formatDateForStorage(newDateValue);

      const primaryTrackForSave =
        currentPrimaryTrack ||
        (() => {
          const numInput = document.getElementById('editTrackPickNumber');
          return numInput ? numInput.value.trim() : '';
        })();

      const updatedAlbum = {
        ...album,
        artist: document.getElementById('editArtist').value.trim(),
        album: document.getElementById('editAlbum').value.trim(),
        release_date: finalReleaseDate,
        country: document.getElementById('editCountry').value,
        genre_1: document.getElementById('editGenre1').value,
        genre_2: document.getElementById('editGenre2').value,
        tracks: Array.isArray(album.tracks) ? album.tracks : undefined,
        primary_track: primaryTrackForSave,
        secondary_track: currentSecondaryTrack,
        comments: document.getElementById('editComments').value.trim(),
        comments_2: document.getElementById('editComments2').value.trim(),
      };

      // Apply pending cover image if user selected a new one
      if (pendingCoverData) {
        updatedAlbum.cover_image = pendingCoverData.base64;
        updatedAlbum.cover_image_format = pendingCoverData.format;
        // Clear the URL to ensure base64 takes priority
        delete updatedAlbum.cover_image_url;
      }

      if (!updatedAlbum.artist || !updatedAlbum.album) {
        showToast('Artist and Album are required', 'error');
        return;
      }

      const albumsToSave = getListData(currentList);
      if (!albumsToSave) {
        showToast('Error: List data not found', 'error');
        return;
      }
      albumsToSave[index] = updatedAlbum;

      editModal.remove();
      window.scrollTo(0, 0);
      document.body.scrollTop = 0;

      // Force full rebuild to ensure cover image changes are displayed
      // (incremental updates don't update cover images)
      displayAlbums(albumsToSave, { forceFullRebuild: true });

      try {
        await saveList(currentList, albumsToSave);
        showToast('Album updated successfully');
      } catch (error) {
        console.error('Error saving album:', error);
        showToast('Error saving changes', 'error');
        albumsToSave[index] = album;
        displayAlbums(albumsToSave);
      }
    };

    setTimeout(() => {
      document.getElementById('editArtist').focus();
    }, 100);
  }

  /**
   * Safe wrapper for mobile edit form that uses album identity
   * @param {string} albumId - Album identity string
   */
  function showMobileEditFormSafe(albumId) {
    const result = findAlbumByIdentity(albumId);
    if (!result) {
      showToast('Album not found - it may have been moved or removed', 'error');
      return;
    }
    showMobileEditForm(result.index);
  }

  /**
   * Safe wrapper for play album that uses album identity
   * @param {string} albumId - Album identity string
   */
  function playAlbumSafe(albumId) {
    const result = findAlbumByIdentity(albumId);
    if (!result) {
      showToast('Album not found - it may have been moved or removed', 'error');
      return;
    }
    playAlbum(result.index);
  }

  /**
   * Safe wrapper for remove album that uses album identity
   * @param {string} albumId - Album identity string
   */
  function removeAlbumSafe(albumId) {
    const result = findAlbumByIdentity(albumId);
    if (!result) {
      showToast('Album not found - it may have been moved or removed', 'error');
      return;
    }

    // Use the existing remove logic with the current index
    setCurrentContextAlbum(result.index);
    document.getElementById('removeAlbumOption').click();
  }

  /**
   * Show mobile summary modal
   * @param {string} summary - Album summary text
   * @param {string} albumName - Album name
   * @param {string} artist - Artist name
   */
  function showMobileSummarySheet(summary, albumName, artist) {
    if (!summary) {
      showToast('No summary available', 'error');
      return;
    }

    // Remove any existing modals first
    const existingModals = document.querySelectorAll(
      '.fixed.inset-0.z-50.bg-gray-900'
    );
    existingModals.forEach((modal) => modal.remove());

    // Hide FAB when modal is shown
    const fab = document.getElementById('addAlbumFAB');
    if (fab) {
      fab.style.display = 'none';
    }

    const summaryModal = document.createElement('div');
    summaryModal.className =
      'fixed inset-0 z-50 flex items-center justify-center p-4 safe-area-modal';
    summaryModal.innerHTML = `
      <!-- Backdrop -->
      <div class="absolute inset-0 bg-black bg-opacity-50" data-backdrop></div>
      
      <!-- Modal Content -->
      <div class="relative bg-gray-900 rounded-lg shadow-2xl flex flex-col w-full max-w-lg max-h-[85vh] overflow-hidden">
        <!-- Header -->
        <div class="flex items-center justify-between p-4 border-b border-gray-800 shrink-0">
          <button data-close-summary class="p-2 -m-2 text-gray-400 hover:text-white active:text-white">
            <i class="fas fa-times text-xl"></i>
          </button>
          <div class="flex-1 text-center px-4">
            <div class="flex items-center justify-center gap-2 mb-1">
              <i class="fas fa-robot text-[#d97706]"></i>
              <h3 class="text-lg font-semibold text-white truncate">${escapeHtml(albumName)}</h3>
            </div>
            <p class="text-sm text-gray-400 truncate">${escapeHtml(artist)}</p>
          </div>
          <div class="w-10"></div>
        </div>
        
        <!-- Summary Content -->
        <div class="flex-1 overflow-y-auto overflow-x-hidden -webkit-overflow-scrolling-touch p-4">
          <div class="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">${escapeHtml(summary)}</div>
        </div>
      </div>
    `;
    document.body.appendChild(summaryModal);

    // Attach close handlers
    const backdrop = summaryModal.querySelector('[data-backdrop]');
    const closeBtn = summaryModal.querySelector('[data-close-summary]');

    const closeModal = () => {
      summaryModal.remove();
      const fabElement = document.getElementById('addAlbumFAB');
      if (fabElement && getCurrentList()) {
        fabElement.style.display = 'flex';
      }
    };

    if (backdrop) {
      backdrop.addEventListener('click', closeModal);
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeModal();
      });
    }
  }

  // Return public API
  return {
    findAlbumByIdentity,
    showMobileAlbumMenu,
    showMobileMoveToListSheet,
    showMobileCopyToListSheet,
    showMobileListMenu,
    showMobileCategoryMenu,
    showMobileEditForm,
    showMobileEditFormSafe,
    playAlbumSafe,
    removeAlbumSafe,
    moveAlbumToList,
    copyAlbumToList,
    showMoveConfirmation,
    showCopyConfirmation,
    showMobileSummarySheet,
  };
}
