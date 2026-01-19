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
 * @param {Function} deps.getListMenuConfig - Get list menu configuration
 * @param {Function} deps.getAvailableCountries - Get available countries list
 * @param {Function} deps.getAvailableGenres - Get available genres list
 * @param {Function} deps.setCurrentContextAlbum - Set current context album index
 * @param {Function} deps.refreshMobileBarVisibility - Refresh mobile bar visibility
 * @param {Function} deps.showDiscoveryModal - Show discovery modal for Last.fm features
 * @param {Function} deps.playSpecificTrack - Play a specific track by name
 * @param {Function} deps.getSortedGroups - Get groups sorted by sort_order
 * @param {Function} deps.refreshGroupsAndLists - Refresh groups and lists after changes
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
    getListMenuConfig,
    getAvailableCountries,
    getAvailableGenres,
    setCurrentContextAlbum,
    refreshMobileBarVisibility,
    showDiscoveryModal,
    playSpecificTrack,
    getSortedGroups,
    refreshGroupsAndLists,
  } = deps;

  /**
   * Find album by identity string instead of index
   * Prevents stale index issues when list order changes
   * @param {string} albumId - Album identity string (artist::album::release_date)
   * @returns {Object|null} { album, index } or null if not found
   */
  function findAlbumByIdentity(albumId) {
    const currentList = getCurrentList();
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

  /**
   * Check if album exists in a list
   * @param {Object} albumToCheck - Album to check
   * @param {Array} list - List to check against
   * @returns {boolean} True if album exists in list
   */
  function isAlbumInList(albumToCheck, list) {
    const key = `${albumToCheck.artist}::${albumToCheck.album}`.toLowerCase();
    return list.some((a) => `${a.artist}::${a.album}`.toLowerCase() === key);
  }

  /**
   * Move album from current list to target list
   * @param {number} index - Album index
   * @param {string} albumId - Album identity string
   * @param {string} targetList - Target list name
   */
  async function moveAlbumToList(index, albumId, targetList) {
    const currentList = getCurrentList();
    const lists = getLists();

    if (
      !currentList ||
      !lists[currentList] ||
      !targetList ||
      !lists[targetList]
    ) {
      throw new Error('Invalid source or target list');
    }

    const sourceAlbums = getListData(currentList);
    if (!sourceAlbums) throw new Error('Source list data not loaded');

    let album = sourceAlbums[index];
    let indexToMove = index;

    if (album && albumId) {
      const expectedId =
        `${album.artist}::${album.album}::${album.release_date || ''}`.toLowerCase();
      if (expectedId !== albumId) {
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

    // Add to target list
    let targetData = targetAlbums;
    if (!targetData) {
      targetData = await apiCall(
        `/api/lists/${encodeURIComponent(targetList)}`
      );
      setListData(targetList, targetData);
    }
    targetData.push(albumToMove);

    try {
      await Promise.all([
        saveList(currentList, sourceAlbums),
        saveList(targetList, targetData),
      ]);

      selectList(currentList);
      showToast(`Moved "${album.album}" to "${targetList}"`);
    } catch (error) {
      console.error('Error saving lists after move:', error);
      sourceAlbums.splice(indexToMove, 0, albumToMove);
      targetData.pop();
      throw error;
    }
  }

  /**
   * Show confirmation modal for moving album to another list
   * @param {string} albumId - Album identity string
   * @param {string} targetList - Target list name
   */
  function showMoveConfirmation(albumId, targetList) {
    if (!albumId || !targetList) {
      console.error('Invalid albumId or targetList');
      return;
    }

    const result = findAlbumByIdentity(albumId);
    if (!result) {
      showToast('Album not found - it may have been moved or removed', 'error');
      return;
    }

    const { album, index } = result;
    const currentList = getCurrentList();

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

  /**
   * Show mobile album action menu (bottom sheet)
   * @param {number|HTMLElement} indexOrElement - Album index or element that triggered the menu
   */
  function showMobileAlbumMenu(indexOrElement) {
    const currentList = getCurrentList();
    let index = indexOrElement;

    if (typeof indexOrElement !== 'number') {
      const card = indexOrElement.closest('.album-card');
      if (!card) return;
      index = parseInt(card.dataset.index);
    }

    // Validate index
    const albumsForSheet = getListData(currentList);
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
    if (!album) {
      console.error('Album not found at index:', index);
      return;
    }

    // Create a unique identifier for this album
    const albumId =
      `${album.artist}::${album.album}::${album.release_date || ''}`.toLowerCase();

    // Remove any existing action sheets first
    const existingSheet = document.querySelector(
      '.fixed.inset-0.z-50.lg\\:hidden'
    );
    if (existingSheet) {
      existingSheet.remove();
    }

    // Hide FAB when mobile action sheet is shown
    const fab = document.getElementById('addAlbumFAB');
    if (fab) {
      fab.style.display = 'none';
    }

    const hasSpotify = window.currentUser?.spotifyAuth;
    const hasTidal = window.currentUser?.tidalAuth;
    const hasAnyService = hasSpotify || hasTidal;
    const hasLastfm = !!window.currentUser?.lastfmUsername;
    const musicService = window.currentUser?.musicService;

    // Determine which service to show for "Open in..." based on preference
    // Priority: user preference > only connected service > Spotify (if both)
    let primaryServiceName = '';
    let showSpotifyConnect = false;
    if (musicService === 'tidal' && hasTidal) {
      primaryServiceName = 'Tidal';
      showSpotifyConnect = false; // User explicitly chose Tidal
    } else if (musicService === 'spotify' && hasSpotify) {
      primaryServiceName = 'Spotify';
      showSpotifyConnect = true;
    } else if (hasTidal && !hasSpotify) {
      primaryServiceName = 'Tidal';
      showSpotifyConnect = false;
    } else if (hasSpotify) {
      primaryServiceName = 'Spotify';
      showSpotifyConnect = true;
    }

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
                  class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm">
            <i class="fas fa-edit mr-3 text-gray-400"></i>Edit Details
          </button>

          <!-- Expandable Play Section -->
          <div class="play-section">
            <button data-action="play-toggle"
                    class="w-full flex items-center justify-between py-3 px-4 hover:bg-gray-800 rounded-sm ${!hasAnyService ? 'opacity-50' : ''}">
              <span>
                <i class="fas fa-play mr-3 text-gray-400"></i>Play Album
              </span>
              ${showSpotifyConnect ? '<i class="fas fa-chevron-down text-gray-500 text-xs transition-transform duration-200" data-chevron></i>' : ''}
            </button>
            
            <!-- Expandable device list (hidden by default) -->
            <div data-play-options class="hidden overflow-hidden transition-all duration-200 ease-out" style="max-height: 0;">
              <div class="ml-4 border-l-2 border-gray-700 pl-4 py-1">
                <!-- Open in app option -->
                <button data-action="open-app"
                        class="w-full text-left py-2.5 px-3 hover:bg-gray-800 rounded-sm flex items-center">
                  <i class="fas fa-external-link-alt mr-3 text-green-500 text-sm"></i>
                  <span class="text-sm">Open in ${primaryServiceName}</span>
                </button>
                
                ${
                  showSpotifyConnect
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
                  class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm">
            <i class="fas fa-arrow-right mr-3 text-gray-400"></i>Move to List...
          </button>

          ${
            hasLastfm
              ? `
          <!-- Last.fm Discovery Options -->
          <div class="border-t border-gray-700 my-2"></div>
          <button data-action="similar-artists"
                  class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm">
            <i class="fas fa-users mr-3 text-purple-400"></i>Show Similar Artists
          </button>
          <div class="border-t border-gray-700 my-2"></div>
          `
              : ''
          }

          <button data-action="remove"
                  class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm text-red-500">
            <i class="fas fa-trash mr-3"></i>Remove from List
          </button>
          
          <button data-action="cancel"
                  class="w-full text-center py-3 px-4 mt-2 bg-gray-800 rounded-sm">
            Cancel
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(actionSheet);

    // Attach event listeners
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
        playAlbumSafe(albumId);
        return;
      }

      isPlayExpanded = !isPlayExpanded;

      if (isPlayExpanded) {
        playOptions.classList.remove('hidden');
        void playOptions.offsetHeight;
        playOptions.style.maxHeight = playOptions.scrollHeight + 'px';
        if (chevron) chevron.style.transform = 'rotate(180deg)';

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
                        class="w-full text-left py-2.5 px-3 hover:bg-gray-800 rounded-sm flex items-center">
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
      showMobileEditFormSafe(albumId);
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
        playAlbumSafe(albumId);
      });
    }

    moveBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeSheet();
      showMobileMoveToListSheet(index, albumId);
    });

    // Last.fm discovery option handlers
    const similarArtistsBtn = actionSheet.querySelector(
      '[data-action="similar-artists"]'
    );

    if (similarArtistsBtn) {
      similarArtistsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeSheet();
        if (showDiscoveryModal && album.artist) {
          showDiscoveryModal('similar', { artist: album.artist });
        } else if (!album.artist) {
          showToast('Could not find album artist', 'error');
        }
      });
    }

    removeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeSheet();
      removeAlbumSafe(albumId);
    });
  }

  /**
   * Group lists by year for the move submenu (matches desktop logic)
   * @returns {Object} { listsByYear, sortedYears, listsWithoutYear }
   */
  function groupListsForMove() {
    const currentList = getCurrentList();
    const lists = getLists();
    const listsByYear = {};
    const listsWithoutYear = [];

    Object.keys(lists).forEach((listName) => {
      // Skip current list
      if (listName === currentList) return;

      const meta = lists[listName];
      const year = meta?.year;

      if (year) {
        if (!listsByYear[year]) {
          listsByYear[year] = [];
        }
        listsByYear[year].push(listName);
      } else {
        listsWithoutYear.push(listName);
      }
    });

    // Sort years descending (newest first)
    const sortedYears = Object.keys(listsByYear).sort(
      (a, b) => parseInt(b) - parseInt(a)
    );

    return { listsByYear, sortedYears, listsWithoutYear };
  }

  /**
   * Show mobile sheet to select target list for moving album
   * Uses year-based accordion grouping to match desktop behavior
   * @param {number} index - Album index
   * @param {string} albumId - Album identity string
   */
  function showMobileMoveToListSheet(index, albumId) {
    const currentList = getCurrentList();

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

    // Group lists by year
    const { listsByYear, sortedYears, listsWithoutYear } = groupListsForMove();
    const hasAnyLists = sortedYears.length > 0 || listsWithoutYear.length > 0;

    // Remove any existing sheets
    const existingSheet = document.querySelector(
      '.fixed.inset-0.z-50.lg\\:hidden'
    );
    if (existingSheet) {
      existingSheet.remove();
    }

    const actionSheet = document.createElement('div');
    actionSheet.className = 'fixed inset-0 z-50 lg:hidden';

    if (!hasAnyLists) {
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
                    class="w-full text-center py-3 px-4 mt-2 bg-gray-800 rounded-sm">
              Cancel
            </button>
          </div>
        </div>
      `;
    } else {
      // Build year accordion sections
      const yearSections = sortedYears
        .map(
          (year, idx) => `
          <div class="year-section" data-year="${year}">
            <button data-action="toggle-year" data-year="${year}"
                    class="w-full flex items-center justify-between py-3 px-4 hover:bg-gray-800 rounded-sm">
              <span class="font-medium text-white">${year}</span>
              <div class="flex items-center gap-2">
                <span class="text-xs text-gray-500">${listsByYear[year].length} list${listsByYear[year].length !== 1 ? 's' : ''}</span>
                <i class="fas fa-chevron-down text-gray-500 text-xs transition-transform duration-200" data-year-chevron="${year}"></i>
              </div>
            </button>
            <div data-year-lists="${year}" class="${idx === 0 ? '' : 'hidden'} overflow-hidden transition-all duration-200 ease-out" style="${idx === 0 ? '' : 'max-height: 0;'}">
              <div class="ml-4 border-l-2 border-gray-700 pl-2">
                ${listsByYear[year]
                  .map(
                    (listName) => `
                  <button data-target-list="${listName}"
                          class="w-full text-left py-2.5 px-3 hover:bg-gray-800 rounded-sm text-gray-300">
                    ${listName}
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

      // Build "Other" section for lists without year
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
                    (listName) => `
                  <button data-target-list="${listName}"
                          class="w-full text-left py-2.5 px-3 hover:bg-gray-800 rounded-sm text-gray-300">
                    ${listName}
                  </button>
                `
                  )
                  .join('')}
              </div>
            </div>
          </div>
        `
          : '';

      actionSheet.innerHTML = `
        <div class="absolute inset-0 bg-black bg-opacity-50" data-backdrop></div>
        <div class="absolute bottom-0 left-0 right-0 bg-gray-900 rounded-t-2xl safe-area-bottom max-h-[80vh] overflow-y-auto">
          <div class="p-4">
            <div class="w-12 h-1 bg-gray-600 rounded-full mx-auto mb-4"></div>
            <h3 class="font-semibold text-white mb-1">Move to List</h3>
            <p class="text-sm text-gray-400 mb-4 truncate">${album.album} by ${album.artist}</p>
            
            ${yearSections}
            ${otherSection}
            
            <button data-action="cancel"
                    class="w-full text-center py-3 px-4 mt-2 bg-gray-800 rounded-sm">
              Cancel
            </button>
          </div>
        </div>
      `;
    }

    document.body.appendChild(actionSheet);

    const backdrop = actionSheet.querySelector('[data-backdrop]');
    const cancelBtn = actionSheet.querySelector('[data-action="cancel"]');

    // Track expanded state for each year
    const expandedYears = new Set();
    // First year is expanded by default (if any years exist)
    if (sortedYears.length > 0) {
      expandedYears.add(sortedYears[0]);
      // Rotate chevron for first year since it's expanded
      const firstChevron = actionSheet.querySelector(
        `[data-year-chevron="${sortedYears[0]}"]`
      );
      if (firstChevron) {
        firstChevron.style.transform = 'rotate(180deg)';
      }
    }

    const closeSheet = () => {
      actionSheet.remove();
    };

    backdrop.addEventListener('click', closeSheet);
    cancelBtn.addEventListener('click', closeSheet);

    // Attach toggle handlers to year headers
    actionSheet
      .querySelectorAll('[data-action="toggle-year"]')
      .forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const year = btn.dataset.year;
          const listContainer = actionSheet.querySelector(
            `[data-year-lists="${year}"]`
          );
          const chevron = actionSheet.querySelector(
            `[data-year-chevron="${year}"]`
          );

          if (!listContainer) return;

          const isExpanded = expandedYears.has(year);

          if (isExpanded) {
            // Collapse
            listContainer.style.maxHeight = '0';
            if (chevron) chevron.style.transform = 'rotate(0deg)';
            setTimeout(() => {
              listContainer.classList.add('hidden');
            }, 200);
            expandedYears.delete(year);
          } else {
            // Expand
            listContainer.classList.remove('hidden');
            void listContainer.offsetHeight; // Force reflow
            listContainer.style.maxHeight = listContainer.scrollHeight + 'px';
            if (chevron) chevron.style.transform = 'rotate(180deg)';
            expandedYears.add(year);
          }
        });
      });

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
  }

  /**
   * Show mobile action sheet for list context menu
   * @param {string} listName - List name
   */
  function showMobileListMenu(listName) {
    const currentList = getCurrentList();
    const lists = getLists();
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
    actionSheet.className = 'fixed inset-0 z-60';
    actionSheet.innerHTML = `
      <div class="absolute inset-0 bg-black bg-opacity-50" data-backdrop></div>
      <div class="absolute bottom-0 left-0 right-0 bg-gray-900 rounded-t-2xl safe-area-bottom">
        <div class="p-4">
          <div class="w-12 h-1 bg-gray-600 rounded-full mx-auto mb-4"></div>
          <h3 class="font-semibold text-white mb-4">${listName}</h3>
          
          <!-- Expandable Download Section -->
          <div class="download-section">
            <button data-action="download-toggle"
                    class="w-full flex items-center justify-between py-3 px-4 hover:bg-gray-800 rounded-sm">
              <span>
                <i class="fas fa-download mr-3 text-gray-400"></i>Download List...
              </span>
              <i class="fas fa-chevron-down text-gray-500 text-xs transition-transform duration-200" data-download-chevron></i>
            </button>
            
            <!-- Expandable download options (hidden by default) -->
            <div data-download-options class="hidden overflow-hidden transition-all duration-200 ease-out" style="max-height: 0;">
              <div class="ml-4 border-l-2 border-gray-700 pl-4 py-1">
                <button data-action="download-json"
                        class="w-full text-left py-2.5 px-3 hover:bg-gray-800 rounded-sm flex items-center">
                  <i class="fas fa-file-code mr-3 text-gray-400 text-sm"></i>
                  <span class="text-sm">Download as JSON</span>
                </button>
                <button data-action="download-pdf"
                        class="w-full text-left py-2.5 px-3 hover:bg-gray-800 rounded-sm flex items-center">
                  <i class="fas fa-file-pdf mr-3 text-gray-400 text-sm"></i>
                  <span class="text-sm">Download as PDF</span>
                </button>
                <button data-action="download-csv"
                        class="w-full text-left py-2.5 px-3 hover:bg-gray-800 rounded-sm flex items-center">
                  <i class="fas fa-file-csv mr-3 text-gray-400 text-sm"></i>
                  <span class="text-sm">Download as CSV</span>
                </button>
              </div>
            </div>
          </div>
          
          <button data-action="edit"
                  class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm">
            <i class="fas fa-edit mr-3 text-gray-400"></i>Edit Details
          </button>
          
          ${
            menuConfig.hasYear
              ? `
          <button data-action="toggle-main"
                  class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm">
            <i class="fas ${menuConfig.mainIconClass} mr-3 text-yellow-500"></i>${menuConfig.mainToggleText}
          </button>
          `
              : ''
          }
          
          <button data-action="send-to-service"
                  class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm">
            <i class="fas fa-paper-plane mr-3 text-gray-400"></i>${menuConfig.musicServiceText}
          </button>
          
          ${
            menuConfig.isInCollection
              ? `
          <button data-action="move-to-collection"
                  class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm">
            <i class="fas fa-folder-open mr-3 text-gray-400"></i>Move to Collection
          </button>
          `
              : ''
          }
          
          <button data-action="delete"
                  class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm text-red-500">
            <i class="fas fa-trash mr-3"></i>Delete List
          </button>
          
          <button data-action="cancel"
                  class="w-full text-center py-3 px-4 mt-2 bg-gray-800 rounded-sm">
            Cancel
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(actionSheet);

    // Attach event listeners
    const backdrop = actionSheet.querySelector('[data-backdrop]');
    const downloadToggleBtn = actionSheet.querySelector(
      '[data-action="download-toggle"]'
    );
    const downloadOptions = actionSheet.querySelector(
      '[data-download-options]'
    );
    const downloadChevron = actionSheet.querySelector(
      '[data-download-chevron]'
    );
    const downloadJsonBtn = actionSheet.querySelector(
      '[data-action="download-json"]'
    );
    const downloadPdfBtn = actionSheet.querySelector(
      '[data-action="download-pdf"]'
    );
    const downloadCsvBtn = actionSheet.querySelector(
      '[data-action="download-csv"]'
    );
    const editBtn = actionSheet.querySelector('[data-action="edit"]');
    const toggleMainBtn = actionSheet.querySelector(
      '[data-action="toggle-main"]'
    );
    const sendToServiceBtn = actionSheet.querySelector(
      '[data-action="send-to-service"]'
    );
    const deleteBtn = actionSheet.querySelector('[data-action="delete"]');
    const cancelBtn = actionSheet.querySelector('[data-action="cancel"]');

    const closeSheet = () => {
      actionSheet.remove();
      const fabElement = document.getElementById('addAlbumFAB');
      if (fabElement && currentList) {
        fabElement.style.display = 'flex';
      }
    };

    backdrop.addEventListener('click', closeSheet);
    cancelBtn.addEventListener('click', closeSheet);

    // Toggle download options expansion
    let isDownloadExpanded = false;
    const toggleDownloadOptions = () => {
      isDownloadExpanded = !isDownloadExpanded;
      if (isDownloadExpanded) {
        downloadOptions.classList.remove('hidden');
        void downloadOptions.offsetHeight;
        downloadOptions.style.maxHeight = downloadOptions.scrollHeight + 'px';
        if (downloadChevron) downloadChevron.style.transform = 'rotate(180deg)';
      } else {
        downloadOptions.style.maxHeight = '0';
        if (downloadChevron) downloadChevron.style.transform = 'rotate(0deg)';
        setTimeout(() => {
          if (!isDownloadExpanded) {
            downloadOptions.classList.add('hidden');
          }
        }, 200);
      }
    };

    downloadToggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleDownloadOptions();
    });

    downloadJsonBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeSheet();
      downloadListAsJSON(listName);
    });

    downloadPdfBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeSheet();
      downloadListAsPDF(listName);
    });

    downloadCsvBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeSheet();
      downloadListAsCSV(listName);
    });

    editBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeSheet();
      openRenameModal(listName);
    });

    if (toggleMainBtn) {
      toggleMainBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeSheet();
        toggleMainStatus(listName);
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

    // Handle move to collection button
    const moveToCollectionBtn = actionSheet.querySelector(
      '[data-action="move-to-collection"]'
    );
    if (moveToCollectionBtn) {
      moveToCollectionBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeSheet();
        showMobileCollectionPicker(listName);
      });
    }

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
              // No lists remaining - handled by caller
              if (refreshMobileBarVisibility) {
                refreshMobileBarVisibility();
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
  }

  /**
   * Show mobile collection picker for moving a list
   * @param {string} listName - Name of the list to move
   */
  function showMobileCollectionPicker(listName) {
    const currentList = getCurrentList();

    // Get current list's group ID
    const listMeta = getListMetadata(listName);
    const currentGroupId = listMeta?.groupId;

    // Get all collections (groups without years)
    const groups = getSortedGroups ? getSortedGroups() : [];
    const collections = groups.filter((g) => !g.isYearGroup);

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

    let collectionsHtml = '';
    if (collections.length === 0) {
      collectionsHtml = `
        <div class="py-3 px-4 text-gray-500 text-sm">
          <i class="fas fa-info-circle mr-3"></i>No collections available
        </div>
      `;
    } else {
      collections.forEach((collection) => {
        const isCurrentGroup = collection._id === currentGroupId;
        const checkmark = isCurrentGroup
          ? '<i class="fas fa-check text-green-500 ml-2"></i>'
          : '';
        const disabledClass = isCurrentGroup ? 'opacity-50' : '';

        collectionsHtml += `
          <button data-action="select-collection" 
                  data-group-id="${collection._id}"
                  data-group-name="${collection.name}"
                  class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm flex items-center justify-between ${disabledClass}"
                  ${isCurrentGroup ? 'disabled' : ''}>
            <span>
              <i class="fas fa-folder mr-3 text-gray-400"></i>${collection.name}
            </span>
            ${checkmark}
          </button>
        `;
      });
    }

    const actionSheet = document.createElement('div');
    actionSheet.className = 'fixed inset-0 z-60';
    actionSheet.innerHTML = `
      <div class="absolute inset-0 bg-black bg-opacity-50" data-backdrop></div>
      <div class="absolute bottom-0 left-0 right-0 bg-gray-900 rounded-t-2xl safe-area-bottom max-h-[70vh] overflow-y-auto">
        <div class="p-4">
          <div class="w-12 h-1 bg-gray-600 rounded-full mx-auto mb-4"></div>
          <h3 class="font-semibold text-white mb-2">Move "${listName}"</h3>
          <p class="text-sm text-gray-500 mb-4">Select a collection</p>
          
          ${collectionsHtml}
          
          <button data-action="cancel"
                  class="w-full text-center py-3 px-4 mt-2 bg-gray-800 rounded-sm">
            Cancel
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(actionSheet);

    // Attach event listeners
    const backdrop = actionSheet.querySelector('[data-backdrop]');
    const cancelBtn = actionSheet.querySelector('[data-action="cancel"]');

    const closeSheet = () => {
      actionSheet.remove();
      const fabElement = document.getElementById('addAlbumFAB');
      if (fabElement && currentList) {
        fabElement.style.display = 'flex';
      }
    };

    backdrop.addEventListener('click', closeSheet);
    cancelBtn.addEventListener('click', closeSheet);

    // Handle collection selection
    actionSheet
      .querySelectorAll('[data-action="select-collection"]:not([disabled])')
      .forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const groupId = btn.dataset.groupId;
          const groupName = btn.dataset.groupName;
          closeSheet();

          try {
            await apiCall(`/api/lists/${encodeURIComponent(listName)}/move`, {
              method: 'POST',
              body: JSON.stringify({ groupId }),
            });

            showToast(`Moved "${listName}" to "${groupName}"`, 'success');

            // Refresh groups and lists to update sidebar
            if (refreshGroupsAndLists) {
              await refreshGroupsAndLists();
            } else {
              updateListNav();
            }
          } catch (err) {
            console.error('Failed to move list:', err);
            showToast('Failed to move list', 'error');
          }
        });
      });
  }

  /**
   * Show mobile action sheet for category (group) context menu
   * @param {string} groupId - Group ID
   * @param {string} groupName - Group name
   * @param {boolean} isYearGroup - Whether this is a year group
   */
  function showMobileCategoryMenu(groupId, groupName, isYearGroup) {
    // Don't show menu for virtual "Uncategorized" group (orphaned lists)
    if (groupId === 'orphaned') {
      return;
    }

    const currentList = getCurrentList();

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
    actionSheet.className = 'fixed inset-0 z-60';
    actionSheet.innerHTML = `
      <div class="absolute inset-0 bg-black bg-opacity-50" data-backdrop></div>
      <div class="absolute bottom-0 left-0 right-0 bg-gray-900 rounded-t-2xl safe-area-bottom">
        <div class="p-4">
          <div class="w-12 h-1 bg-gray-600 rounded-full mx-auto mb-4"></div>
          <h3 class="font-semibold text-white mb-4">${groupName}</h3>
          
          <button data-action="rename"
                  class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm">
            <i class="fas fa-edit mr-3 text-gray-400"></i>Rename
          </button>
          
          ${
            !isYearGroup
              ? `
          <button data-action="delete"
                  class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm text-red-500">
            <i class="fas fa-trash mr-3"></i>Delete
          </button>
          `
              : `
          <div class="py-3 px-4 text-gray-500 text-sm">
            <i class="fas fa-info-circle mr-3"></i>Year groups are removed automatically when empty
          </div>
          `
          }
          
          <button data-action="cancel"
                  class="w-full text-center py-3 px-4 mt-2 bg-gray-800 rounded-sm">
            Cancel
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(actionSheet);

    // Attach event listeners
    const backdrop = actionSheet.querySelector('[data-backdrop]');
    const renameBtn = actionSheet.querySelector('[data-action="rename"]');
    const deleteBtn = actionSheet.querySelector('[data-action="delete"]');
    const cancelBtn = actionSheet.querySelector('[data-action="cancel"]');

    const closeSheet = () => {
      actionSheet.remove();
      const fabElement = document.getElementById('addAlbumFAB');
      if (fabElement && currentList) {
        fabElement.style.display = 'flex';
      }
    };

    backdrop.addEventListener('click', closeSheet);
    cancelBtn.addEventListener('click', closeSheet);

    // Handle rename
    if (renameBtn) {
      renameBtn.addEventListener('click', () => {
        closeSheet();
        // Use the global function from app.js
        if (window.openRenameCategoryModal) {
          window.openRenameCategoryModal(groupId, groupName);
        }
      });
    }

    // Handle delete
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async () => {
        closeSheet();

        // Year groups can't be deleted manually (shouldn't reach here due to UI)
        if (isYearGroup) {
          showToast('Year groups are removed automatically when empty', 'info');
          return;
        }

        try {
          // First try to delete - API will return 409 if collection has lists
          await apiCall(`/api/groups/${groupId}`, { method: 'DELETE' });
          showToast(`Collection "${groupName}" deleted`);
          if (refreshGroupsAndLists) {
            await refreshGroupsAndLists();
          } else {
            updateListNav();
          }
        } catch (error) {
          // Check if this is a "has lists" conflict that needs confirmation
          if (error.requiresConfirmation && error.listCount > 0) {
            const listWord = error.listCount === 1 ? 'list' : 'lists';
            const confirmed = await showConfirmation(
              'Delete Collection',
              `The collection "${groupName}" contains ${error.listCount} ${listWord}.`,
              `Deleting this collection will move the ${listWord} to "Uncategorized". This cannot be undone.`,
              'Delete Anyway'
            );

            if (confirmed) {
              try {
                // Force delete with confirmation
                await apiCall(`/api/groups/${groupId}?force=true`, {
                  method: 'DELETE',
                });
                showToast(`Collection "${groupName}" deleted`);
                if (refreshGroupsAndLists) {
                  await refreshGroupsAndLists();
                } else {
                  updateListNav();
                }
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
      });
    }
  }

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
      'fixed inset-0 z-50 bg-gray-900 flex flex-col overflow-hidden lg:max-w-2xl lg:max-h-[85vh] lg:mx-auto lg:mt-20 lg:mb-8 lg:rounded-lg lg:shadow-2xl';
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
            <div id="editGenre1Container" class="searchable-genre-select" data-value="${album.genre_1 || album.genre || ''}" data-placeholder="Select a genre..."></div>
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
            >${album.comments || album.comment || ''}</textarea>
          </div>

          <!-- Track Selection (Dual: Primary + Secondary) -->
          <div class="w-full" id="trackPickWrapper">
            <div class="flex items-center justify-between">
              <label class="block text-gray-400 text-sm mb-2">Track Selection</label>
              <button type="button" id="fetchTracksBtn" class="text-xs text-red-500 hover:underline">Get</button>
            </div>
            <div class="text-xs text-gray-500 mb-2">Click once = secondary (☆) | Click again = primary (★)</div>
            <div id="trackPickContainer" data-album-index="${index}" data-album-id="${album.album_id || ''}">
            ${
              Array.isArray(album.tracks) && album.tracks.length > 0
                ? `
              <ul class="space-y-2">
                ${album.tracks
                  .map((t) => {
                    const trackName = getTrackName(t);
                    const trackLength = formatTrackTime(getTrackLength(t));
                    const isPrimary =
                      trackName ===
                      (album.primary_track || album.track_pick || '');
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
              <input type="number" id="editTrackPickNumber" value="${album.primary_track || album.track_pick || ''}"
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
      album.genre_1 || album.genre || '',
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
    let currentPrimaryTrack = album.primary_track || album.track_pick || '';
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
          const albumId = trackPickContainer.dataset.albumId;
          const isPrimary = item.dataset.isPrimary === 'true';
          const isSecondary = item.dataset.isSecondary === 'true';

          if (!albumId) {
            showToast('Cannot save - album has no ID', 'error');
            return;
          }

          try {
            if (isPrimary) {
              // Deselect primary
              const response = await fetch(`/api/track-picks/${albumId}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ trackIdentifier: trackName }),
              });
              if (!response.ok) throw new Error('Failed to remove track');
              const result = await response.json();
              currentPrimaryTrack = result.primary_track || '';
              currentSecondaryTrack = result.secondary_track || '';
              showToast('Primary track removed');
            } else if (isSecondary) {
              // Promote to primary
              const response = await fetch(`/api/track-picks/${albumId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                  trackIdentifier: trackName,
                  priority: 1,
                }),
              });
              if (!response.ok) throw new Error('Failed to promote track');
              const result = await response.json();
              currentPrimaryTrack = result.primary_track || '';
              currentSecondaryTrack = result.secondary_track || '';
              showToast(`★ Primary: ${trackName.substring(0, 30)}...`);
            } else {
              // New selection as secondary
              const response = await fetch(`/api/track-picks/${albumId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                  trackIdentifier: trackName,
                  priority: 2,
                }),
              });
              if (!response.ok) throw new Error('Failed to set track');
              const result = await response.json();
              currentPrimaryTrack = result.primary_track || '';
              currentSecondaryTrack = result.secondary_track || '';
              showToast(`☆ Secondary: ${trackName.substring(0, 30)}...`);
            }

            // Update UI immediately
            updateTrackPickUI();

            // Update local album data for save
            album.primary_track = currentPrimaryTrack;
            album.secondary_track = currentSecondaryTrack;
            album.track_pick = currentPrimaryTrack; // Legacy field
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

      const updatedAlbum = {
        ...album,
        artist: document.getElementById('editArtist').value.trim(),
        album: document.getElementById('editAlbum').value.trim(),
        release_date: finalReleaseDate,
        country: document.getElementById('editCountry').value,
        genre_1: document.getElementById('editGenre1').value,
        genre: document.getElementById('editGenre1').value,
        genre_2: document.getElementById('editGenre2').value,
        tracks: Array.isArray(album.tracks) ? album.tracks : undefined,
        // Track picks are now managed via API and stored in track_picks table
        // Keep the current values which were updated by the track pick handlers
        primary_track: currentPrimaryTrack,
        secondary_track: currentSecondaryTrack,
        track_pick:
          currentPrimaryTrack ||
          (() => {
            // Fallback for albums without album_id (can't use API)
            const numInput = document.getElementById('editTrackPickNumber');
            return numInput ? numInput.value.trim() : '';
          })(),
        comments: document.getElementById('editComments').value.trim(),
        comment: document.getElementById('editComments').value.trim(),
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
      'fixed inset-0 z-50 flex items-center justify-center p-4';
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
    showMobileListMenu,
    showMobileCategoryMenu,
    showMobileEditForm,
    showMobileEditFormSafe,
    playAlbumSafe,
    removeAlbumSafe,
    moveAlbumToList,
    showMoveConfirmation,
    showMobileSummarySheet,
  };
}
