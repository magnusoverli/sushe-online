/**
 * Mobile UI Module
 *
 * Handles mobile-specific UI components including bottom sheets, action menus,
 * and full-screen edit forms. Uses dependency injection for testability.
 *
 * @module mobile-ui
 */

import { normalizeDateForInput, formatDateForStorage } from './date-utils.js';

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
 * @param {Function} deps.fetchAndApplyCovers - Fetch and apply album covers
 * @param {Function} deps.updateListNav - Update list navigation
 * @param {Function} deps.fetchTracksForAlbum - Fetch tracks for an album
 * @param {Function} deps.playAlbum - Play album by index
 * @param {Function} deps.playAlbumOnDeviceMobile - Play album on specific Spotify device
 * @param {Function} deps.openRenameModal - Open rename modal
 * @param {Function} deps.downloadListAsJSON - Download list as JSON
 * @param {Function} deps.updatePlaylist - Update playlist on music service
 * @param {Function} deps.toggleOfficialStatus - Toggle official status
 * @param {Function} deps.getDeviceIcon - Get icon for device type
 * @param {Function} deps.getListMenuConfig - Get list menu configuration
 * @param {Function} deps.getAvailableCountries - Get available countries list
 * @param {Function} deps.getAvailableGenres - Get available genres list
 * @param {Function} deps.setCurrentContextAlbum - Set current context album index
 * @param {Function} deps.refreshMobileBarVisibility - Refresh mobile bar visibility
 * @param {Function} deps.showDiscoveryModal - Show discovery modal for Last.fm features
 * @returns {Object} Mobile UI module API
 */
export function createMobileUI(deps = {}) {
  const {
    getListData,
    getListMetadata: _getListMetadata,
    getCurrentList,
    getLists,
    setListData,
    saveList,
    selectList,
    showToast,
    showConfirmation,
    apiCall,
    displayAlbums,
    fetchAndApplyCovers,
    updateListNav,
    fetchTracksForAlbum,
    playAlbum,
    playAlbumOnDeviceMobile,
    openRenameModal,
    downloadListAsJSON,
    updatePlaylist,
    toggleOfficialStatus,
    getDeviceIcon,
    getListMenuConfig,
    getAvailableCountries,
    getAvailableGenres,
    setCurrentContextAlbum,
    refreshMobileBarVisibility,
    showDiscoveryModal,
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

          ${
            hasLastfm
              ? `
          <!-- Last.fm Discovery Options -->
          <div class="border-t border-gray-700 my-2"></div>
          <button data-action="similar-artists"
                  class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded">
            <i class="fas fa-users mr-3 text-purple-400"></i>Show Similar Artists
          </button>
          <button data-action="recommendations"
                  class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded">
            <i class="fas fa-lightbulb mr-3 text-yellow-400"></i>Personal Recommendations
          </button>
          <div class="border-t border-gray-700 my-2"></div>
          `
              : ''
          }

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
    const recommendationsBtn = actionSheet.querySelector(
      '[data-action="recommendations"]'
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

    if (recommendationsBtn) {
      recommendationsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeSheet();
        if (showDiscoveryModal) {
          showDiscoveryModal('recommendations');
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
   * Show mobile sheet to select target list for moving album
   * @param {number} index - Album index
   * @param {string} albumId - Album identity string
   */
  function showMobileMoveToListSheet(index, albumId) {
    const currentList = getCurrentList();
    const lists = getLists();

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
   * Show mobile edit form (full-screen modal)
   * @param {number} index - Album index
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
                    (t) => `
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
        window.scrollTo(0, 0);
        document.body.scrollTop = 0;
      });
    }

    const trackPickContainer = document.getElementById('trackPickContainer');

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
        comment: document.getElementById('editComments').value.trim(),
      };

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

      displayAlbums(albumsToSave);
      fetchAndApplyCovers(albumsToSave);

      try {
        await saveList(currentList, albumsToSave);
        showToast('Album updated successfully');
      } catch (error) {
        console.error('Error saving album:', error);
        showToast('Error saving changes', 'error');
        albumsToSave[index] = album;
        displayAlbums(albumsToSave);
        fetchAndApplyCovers(albumsToSave);
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

  // Return public API
  return {
    findAlbumByIdentity,
    showMobileAlbumMenu,
    showMobileMoveToListSheet,
    showMobileListMenu,
    showMobileEditForm,
    showMobileEditFormSafe,
    playAlbumSafe,
    removeAlbumSafe,
    moveAlbumToList,
    showMoveConfirmation,
  };
}
