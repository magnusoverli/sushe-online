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
 * @param {Function} deps.updateListMetadata - Update list metadata
 * @param {Function} deps.showMobileEditForm - Show mobile edit form
 * @param {Function} deps.playAlbum - Play album
 * @param {Function} deps.playAlbumSafe - Play album safely by ID
 * @param {Function} deps.loadLists - Reload lists
 * @param {Function} deps.getContextState - Get context menu state
 * @param {Function} deps.setContextState - Set context menu state
 * @param {Function} deps.setCurrentList - Set current list (for delete)
 * @param {Function} deps.refreshMobileBarVisibility - Refresh mobile bar visibility
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
    downloadListAsJSON,
    updatePlaylist,
    openRenameModal,
    updateListNav,
    updateListMetadata,
    showMobileEditForm: _showMobileEditForm,
    playAlbum: _playAlbum,
    playAlbumSafe: _playAlbumSafe,
    loadLists: _loadLists,
    getContextState,
    setContextState,
    setCurrentList,
    refreshMobileBarVisibility,
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
      isMain: !!meta?.isMain,
      mainToggleText: meta?.isMain
        ? 'Remove Main Status'
        : 'Set as Main',
      mainIconClass: meta?.isMain ? 'fa-star' : 'fa-star',
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

    // Add click handlers - these will be attached by the caller
    positionPlaySubmenu();
    submenu.classList.remove('hidden');

    return submenu;
  }

  /**
   * Initialize list context menu (right-click menu for lists)
   */
  function initializeContextMenu() {
    const lists = getLists();
    const contextMenu = document.getElementById('contextMenu');
    const downloadOption = document.getElementById('downloadListOption');
    const renameOption = document.getElementById('renameListOption');
    const toggleMainOption = document.getElementById(
      'toggleMainOption'
    );
    const updatePlaylistOption = document.getElementById(
      'updatePlaylistOption'
    );
    const deleteOption = document.getElementById('deleteListOption');

    if (
      !contextMenu ||
      !deleteOption ||
      !renameOption ||
      !downloadOption ||
      !updatePlaylistOption ||
      !toggleMainOption
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
      const { list: currentContextList } = getContextState();
      contextMenu.classList.add('hidden');

      if (!currentContextList) return;

      downloadListAsJSON(currentContextList);

      setContextState({ list: null });
    };

    // Handle rename option click
    renameOption.onclick = () => {
      const { list: currentContextList } = getContextState();
      contextMenu.classList.add('hidden');

      if (!currentContextList) return;

      openRenameModal(currentContextList);
    };

    // Handle toggle main option click
    toggleMainOption.onclick = async () => {
      const { list: currentContextList } = getContextState();
      contextMenu.classList.add('hidden');

      if (!currentContextList) return;

      const meta = getListMetadata(currentContextList);
      if (!meta) return;

      // Check if list has a year assigned
      if (!meta.year) {
        showToast('List must have a year to be marked as main', 'error');
        setContextState({ list: null });
        return;
      }

      const newMainStatus = !meta.isMain;

      try {
        const response = await apiCall(
          `/api/lists/${encodeURIComponent(currentContextList)}/main`,
          {
            method: 'POST',
            body: JSON.stringify({ isMain: newMainStatus }),
          }
        );

        // Update local metadata
        updateListMetadata(currentContextList, {
          isMain: newMainStatus,
        });

        // If another list lost its main status, update it too
        if (response.previousMainList) {
          updateListMetadata(response.previousMainList, {
            isMain: false,
          });
        }

        // Refresh sidebar to show updated star icons
        updateListNav();

        // Show appropriate message
        if (newMainStatus) {
          if (response.previousMainList) {
            showToast(
              `"${currentContextList}" is now your main ${meta.year} list (replaced "${response.previousMainList}")`
            );
          } else {
            showToast(
              `"${currentContextList}" is now your main ${meta.year} list`
            );
          }
        } else {
          showToast(`"${currentContextList}" is no longer marked as main`);
        }
      } catch (error) {
        console.error('Error toggling main status:', error);
        showToast('Error updating main status', 'error');
      }

      setContextState({ list: null });
    };

    // Handle update playlist option click
    updatePlaylistOption.onclick = async () => {
      const { list: currentContextList } = getContextState();
      contextMenu.classList.add('hidden');

      if (!currentContextList) return;

      try {
        // Pass both list name and list data for track validation
        const listData = getListData(currentContextList) || [];
        await updatePlaylist(currentContextList, listData);
      } catch (err) {
        console.error('Update playlist failed', err);
      }

      setContextState({ list: null });
    };

    // Handle delete option click
    deleteOption.onclick = async () => {
      const { list: currentContextList } = getContextState();
      const currentList = getCurrentList();
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
          await apiCall(
            `/api/lists/${encodeURIComponent(currentContextList)}`,
            {
              method: 'DELETE',
            }
          );

          delete lists[currentContextList];

          if (currentList === currentContextList) {
            const remainingLists = Object.keys(lists);
            if (remainingLists.length > 0) {
              // Select the first list in the sidebar
              selectList(remainingLists[0]);
            } else {
              // No lists remain - show empty state
              setCurrentList(null);

              // Refresh mobile bar visibility when list is cleared
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

          showToast(`List "${currentContextList}" deleted`);
        } catch (_error) {
          showToast('Error deleting list', 'error');
        }
      }

      setContextState({ list: null });
    };
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
    initializeContextMenu,
  };
}
