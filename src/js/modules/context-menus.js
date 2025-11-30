/**
 * Context Menus Module
 *
 * Handles context menu positioning, submenu management, and mobile action sheets.
 * Uses dependency injection for testability and decoupling from global state.
 *
 * @module context-menus
 */

/**
 * Factory function to create the context menus module with injected dependencies
 *
 * @param {Object} deps - Dependencies
 * @param {Function} deps.getListData - Get album array for a list
 * @param {Function} deps.getListMetadata - Get metadata for a list
 * @param {Function} deps.getCurrentList - Get current list name
 * @param {Function} deps.getLists - Get all lists
 * @param {Function} deps.saveList - Save list to server
 * @param {Function} deps.selectList - Select a list
 * @param {Function} deps.showToast - Show toast notification
 * @param {Function} deps.showConfirmation - Show confirmation dialog
 * @param {Function} deps.apiCall - Make API call
 * @param {Function} deps.findAlbumByIdentity - Find album by identity string
 * @param {Function} deps.downloadListAsJSON - Download list as JSON
 * @param {Function} deps.updatePlaylist - Update playlist on music service
 * @param {Function} deps.openRenameModal - Open rename modal
 * @param {Function} deps.updateListNav - Update list navigation
 * @param {Function} deps.showMobileEditForm - Show mobile edit form
 * @param {Function} deps.playAlbum - Play album
 * @param {Function} deps.playAlbumSafe - Play album safely by ID
 * @param {Function} deps.loadLists - Reload lists
 * @param {Function} deps.getContextState - Get context menu state
 * @param {Function} deps.setContextState - Set context menu state
 * @param {Function} deps.toggleOfficialStatus - Toggle official status
 * @returns {Object} Context menus module API
 */
export function createContextMenus(deps = {}) {
  const {
    getListData,
    getListMetadata,
    getCurrentList,
    getLists,
    saveList,
    selectList,
    showToast,
    showConfirmation,
    apiCall,
    findAlbumByIdentity,
    // These dependencies are available for future use when more functions are moved here
    downloadListAsJSON: _downloadListAsJSON,
    updatePlaylist: _updatePlaylist,
    openRenameModal: _openRenameModal,
    updateListNav: _updateListNav,
    showMobileEditForm: _showMobileEditForm,
    playAlbum: _playAlbum,
    playAlbumSafe: _playAlbumSafe,
    loadLists: _loadLists,
    getContextState,
    setContextState,
    toggleOfficialStatus: _toggleOfficialStatus,
  } = deps;

  // Track loading performance optimization
  let trackAbortController = null;

  /**
   * Position a context menu, adjusting if it would overflow viewport
   * @param {HTMLElement} menu - Menu element
   * @param {number} x - X position
   * @param {number} y - Y position
   */
  function positionContextMenu(menu, x, y) {
    // Hide FAB when context menu is shown
    const fab = document.getElementById('addAlbumFAB');
    if (fab) {
      fab.style.display = 'none';
    }

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.classList.remove('hidden');

    requestAnimationFrame(() => {
      const rect = menu.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let adjustedX = x;
      let adjustedY = y;

      if (rect.right > viewportWidth) {
        adjustedX = x - rect.width;
      }
      if (rect.bottom > viewportHeight) {
        adjustedY = y - rect.height;
      }

      if (adjustedX !== x || adjustedY !== y) {
        menu.style.left = `${adjustedX}px`;
        menu.style.top = `${adjustedY}px`;
      }
    });
  }

  /**
   * Hide all context menus and restore FAB visibility
   */
  function hideAllContextMenus() {
    const currentList = getCurrentList();

    const contextMenu = document.getElementById('contextMenu');
    if (contextMenu) {
      contextMenu.classList.add('hidden');
    }

    const albumContextMenu = document.getElementById('albumContextMenu');
    if (albumContextMenu) {
      albumContextMenu.classList.add('hidden');
      // Clear context state
      setContextState({ album: null, albumId: null });

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

  /**
   * Get device icon for Spotify device type
   * @param {string} type - Device type
   * @returns {string} Font Awesome icon class
   */
  function getDeviceIcon(type) {
    const icons = {
      computer: 'fas fa-laptop',
      smartphone: 'fas fa-mobile-alt',
      speaker: 'fas fa-volume-up',
      tv: 'fas fa-tv',
      avr: 'fas fa-broadcast-tower',
      stb: 'fas fa-satellite-dish',
      audiodongle: 'fas fa-headphones',
      gameconsole: 'fas fa-gamepad',
      castvideo: 'fas fa-chromecast',
      castaudio: 'fas fa-podcast',
      automobile: 'fas fa-car',
      tablet: 'fas fa-tablet-alt',
    };
    return icons[type?.toLowerCase()] || 'fas fa-music';
  }

  /**
   * Get configuration for list context menu
   * @param {string} listName - List name
   * @returns {Object} Menu configuration
   */
  function getListMenuConfig(listName) {
    const meta = getListMetadata(listName);
    const hasSpotify = window.currentUser?.spotifyAuth;
    const hasTidal = window.currentUser?.tidalAuth;
    const musicService = window.currentUser?.musicService;

    let musicServiceText = 'Send to Music Service';
    if (musicService === 'spotify' && hasSpotify) {
      musicServiceText = 'Send to Spotify';
    } else if (musicService === 'tidal' && hasTidal) {
      musicServiceText = 'Send to Tidal';
    } else if (hasSpotify && !hasTidal) {
      musicServiceText = 'Send to Spotify';
    } else if (hasTidal && !hasSpotify) {
      musicServiceText = 'Send to Tidal';
    }

    return {
      hasYear: !!meta?.year,
      isOfficial: !!meta?.isOfficial,
      officialToggleText: meta?.isOfficial
        ? 'Remove Official Status'
        : 'Mark as Official',
      officialIconClass: meta?.isOfficial ? 'fa-star' : 'fa-star',
      musicServiceText,
      hasSpotify,
      hasTidal,
    };
  }

  /**
   * Show move to list submenu for desktop
   */
  function showMoveToListSubmenu() {
    const currentList = getCurrentList();
    const lists = getLists();
    const { albumId } = getContextState();

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
          showMoveConfirmation(albumId, targetList);
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
    const isAlbumInList = (albumToCheck, list) => {
      const key = `${albumToCheck.artist}::${albumToCheck.album}`.toLowerCase();
      return list.some((a) => `${a.artist}::${a.album}`.toLowerCase() === key);
    };

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
   * Hide submenus when mouse leaves the context menu area
   */
  function setupSubmenuHideOnLeave() {
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

  /**
   * Position the play submenu next to the play option
   */
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

  /**
   * Show the play album submenu with device options
   */
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

    // Always add "Open in app" option first
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

    // Add click handlers - these will be attached by the caller
    positionPlaySubmenu();
    submenu.classList.remove('hidden');

    return submenu;
  }

  // Return public API
  return {
    positionContextMenu,
    hideAllContextMenus,
    getDeviceIcon,
    getListMenuConfig,
    showMoveToListSubmenu,
    showMoveConfirmation,
    moveAlbumToList,
    setupSubmenuHideOnLeave,
    positionPlaySubmenu,
    showPlayAlbumSubmenu,
  };
}
