/**
 * Context Menus Module
 *
 * Handles context menu positioning, submenu management, and mobile action sheets.
 * Uses dependency injection for testability and decoupling from global state.
 *
 * @module context-menus
 */

import { createTransferHelpers } from './album-transfer.js';
import {
  positionContextMenu,
  hideAllContextMenus as hideAllMenusBase,
} from './context-menu.js';
import { getDeviceIcon } from '../utils/device-icons.js';

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
 * @param {Function} deps.downloadListAsPDF - Download list as PDF
 * @param {Function} deps.downloadListAsCSV - Download list as CSV
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
 * @param {Function} deps.getSortedGroups - Get groups sorted by sort_order
 * @param {Function} deps.refreshGroupsAndLists - Refresh groups and lists after changes
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
    downloadListAsPDF,
    downloadListAsCSV,
    updatePlaylist,
    openRenameModal,
    updateListNav,
    updateListMetadata: _updateListMetadata,
    showMobileEditForm: _showMobileEditForm,
    playAlbum: _playAlbum,
    playAlbumSafe: _playAlbumSafe,
    loadLists: _loadLists,
    getContextState,
    setContextState,
    setCurrentList,
    refreshMobileBarVisibility,
    getSortedGroups,
    refreshGroupsAndLists,
    toggleMainStatus,
  } = deps;

  // Track loading performance optimization
  let trackAbortController = null;

  /**
   * Hide all context menus and perform module-specific cleanup.
   * Delegates to shared hideAllMenusBase() then clears local state.
   */
  function hideAllContextMenus() {
    hideAllMenusBase();

    // Module-specific cleanup: clear context state and cancel track fetches
    setContextState({ album: null, albumId: null });
    if (trackAbortController) {
      trackAbortController.abort();
      trackAbortController = null;
    }

    // Only show FAB when a list is actually selected
    const currentList = getCurrentList();
    if (!currentList) {
      const fab = document.getElementById('addAlbumFAB');
      if (fab) fab.style.display = 'none';
    }
  }

  // getDeviceIcon is imported from utils/device-icons.js (shared module)

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

    // Determine if list is in a collection (not a year-group)
    // Lists in collections (or orphaned/uncategorized) can be moved to other collections
    // Lists in year-groups cannot be moved via this menu (they're organized by year)
    const groupId = meta?.groupId;
    let isInCollection = false;
    let isInYearGroup = false;

    if (!groupId) {
      // Orphaned/uncategorized lists can be moved
      isInCollection = true;
    } else if (getSortedGroups) {
      // Check if the group is a collection (not a year-group)
      const groups = getSortedGroups();
      const group = groups.find((g) => g._id === groupId);
      if (group) {
        isInCollection = !group.isYearGroup;
        isInYearGroup = group.isYearGroup;
      }
    }

    // A list can have main status only if it's in a year-group or has a year directly
    // Lists in collections cannot have main status
    const hasYear = !!meta?.year || isInYearGroup;

    return {
      hasYear,
      isMain: !!meta?.isMain,
      mainToggleText: meta?.isMain ? 'Remove Main Status' : 'Set as Main',
      mainIconClass: meta?.isMain ? 'fa-star' : 'fa-star',
      musicServiceText,
      hasSpotify,
      hasTidal,
      isInCollection,
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
    const copySubmenu = document.getElementById('albumCopySubmenu');
    const copyOption = document.getElementById('copyAlbumOption');

    if (!submenu || !moveOption) return;

    // Hide the other submenus first
    if (playSubmenu) {
      playSubmenu.classList.add('hidden');
      playOption?.classList.remove('bg-gray-700', 'text-white');
    }
    if (copySubmenu) {
      copySubmenu.classList.add('hidden');
      copyOption?.classList.remove('bg-gray-700', 'text-white');
    }

    // Highlight the parent menu item
    moveOption.classList.add('bg-gray-700', 'text-white');

    // Get all list IDs except the current one
    const listIds = Object.keys(lists).filter((id) => id !== currentList);

    if (listIds.length === 0) {
      submenu.innerHTML =
        '<div class="px-4 py-2 text-sm text-gray-500">No other lists available</div>';
    } else {
      submenu.innerHTML = listIds
        .map((listId) => {
          const meta = getListMetadata(listId);
          const listName = meta?.name || 'Unknown';
          return `
          <button class="block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap w-full" data-target-list="${listId}">
            <span class="mr-2">•</span>${listName}
          </button>
        `;
        })
        .join('');

      // Add click handlers to each list option
      submenu.querySelectorAll('[data-target-list]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const targetListId = btn.dataset.targetList;

          // Hide both menus and remove highlight
          document.getElementById('albumContextMenu')?.classList.add('hidden');
          submenu.classList.add('hidden');
          moveOption?.classList.remove('bg-gray-700', 'text-white');

          // Show confirmation modal
          showMoveConfirmation(albumId, targetListId);
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
   * Show copy to list submenu for desktop
   */
  function showCopyToListSubmenu() {
    const currentList = getCurrentList();
    const lists = getLists();
    const { albumId } = getContextState();

    const submenu = document.getElementById('albumCopySubmenu');
    const copyOption = document.getElementById('copyAlbumOption');
    const playSubmenu = document.getElementById('playAlbumSubmenu');
    const playOption = document.getElementById('playAlbumOption');
    const moveSubmenu = document.getElementById('albumMoveSubmenu');
    const moveOption = document.getElementById('moveAlbumOption');

    if (!submenu || !copyOption) return;

    // Hide other submenus first
    if (playSubmenu) {
      playSubmenu.classList.add('hidden');
      playOption?.classList.remove('bg-gray-700', 'text-white');
    }
    if (moveSubmenu) {
      moveSubmenu.classList.add('hidden');
      moveOption?.classList.remove('bg-gray-700', 'text-white');
    }

    // Highlight the parent menu item
    copyOption.classList.add('bg-gray-700', 'text-white');

    // Get all list IDs except the current one
    const listIds = Object.keys(lists).filter((id) => id !== currentList);

    if (listIds.length === 0) {
      submenu.innerHTML =
        '<div class="px-4 py-2 text-sm text-gray-500">No other lists available</div>';
    } else {
      submenu.innerHTML = listIds
        .map((listId) => {
          const meta = getListMetadata(listId);
          const listName = meta?.name || 'Unknown';
          return `
          <button class="block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap w-full" data-target-list="${listId}">
            <span class="mr-2">&bull;</span>${listName}
          </button>
        `;
        })
        .join('');

      // Add click handlers to each list option
      submenu.querySelectorAll('[data-target-list]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const targetListId = btn.dataset.targetList;

          // Hide both menus and remove highlight
          document.getElementById('albumContextMenu')?.classList.add('hidden');
          submenu.classList.add('hidden');
          copyOption?.classList.remove('bg-gray-700', 'text-white');

          // Show confirmation modal
          showCopyConfirmation(albumId, targetListId);
        });
      });
    }

    // Position submenu next to the copy option
    const copyRect = copyOption.getBoundingClientRect();
    const contextMenu = document.getElementById('albumContextMenu');
    const menuRect = contextMenu.getBoundingClientRect();

    submenu.style.left = `${menuRect.right}px`;
    submenu.style.top = `${copyRect.top}px`;
    submenu.classList.remove('hidden');
  }

  /**
   * Show download list submenu for desktop
   */
  function showDownloadListSubmenu() {
    const { list: currentContextList } = getContextState();
    const submenu = document.getElementById('downloadListSubmenu');
    const downloadOption = document.getElementById('downloadListOption');

    if (!submenu || !downloadOption || !currentContextList) return;

    // Highlight the parent menu item
    downloadOption.classList.add('bg-gray-700', 'text-white');

    // Build submenu with download options
    submenu.innerHTML = `
      <button class="w-full block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap" data-download-action="json">
        <i class="fas fa-file-code mr-2 w-4 text-center"></i>Download as JSON
      </button>
      <button class="w-full block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap" data-download-action="pdf">
        <i class="fas fa-file-pdf mr-2 w-4 text-center"></i>Download as PDF
      </button>
      <button class="w-full block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap" data-download-action="csv">
        <i class="fas fa-file-csv mr-2 w-4 text-center"></i>Download as CSV
      </button>
    `;

    // Add click handler for JSON download
    const jsonOption = submenu.querySelector('[data-download-action="json"]');
    if (jsonOption) {
      jsonOption.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Hide both menus and remove highlight
        document.getElementById('contextMenu')?.classList.add('hidden');
        submenu.classList.add('hidden');
        downloadOption.classList.remove('bg-gray-700', 'text-white');

        // Download the list
        downloadListAsJSON(currentContextList);
        setContextState({ list: null });
      });
    }

    // Add click handler for PDF download
    const pdfOption = submenu.querySelector('[data-download-action="pdf"]');
    if (pdfOption) {
      pdfOption.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Hide both menus and remove highlight
        document.getElementById('contextMenu')?.classList.add('hidden');
        submenu.classList.add('hidden');
        downloadOption.classList.remove('bg-gray-700', 'text-white');

        // Download the list
        downloadListAsPDF(currentContextList);
        setContextState({ list: null });
      });
    }

    // Add click handler for CSV download
    const csvOption = submenu.querySelector('[data-download-action="csv"]');
    if (csvOption) {
      csvOption.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Hide both menus and remove highlight
        document.getElementById('contextMenu')?.classList.add('hidden');
        submenu.classList.add('hidden');
        downloadOption.classList.remove('bg-gray-700', 'text-white');

        // Download the list
        downloadListAsCSV(currentContextList);
        setContextState({ list: null });
      });
    }

    // Position submenu next to the download option
    const downloadRect = downloadOption.getBoundingClientRect();
    const contextMenu = document.getElementById('contextMenu');
    const menuRect = contextMenu.getBoundingClientRect();

    submenu.style.left = `${menuRect.right}px`;
    submenu.style.top = `${downloadRect.top}px`;
    submenu.classList.remove('hidden');
  }

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

  /**
   * Hide submenus when mouse leaves the context menu area
   */
  function setupSubmenuHideOnLeave() {
    const contextMenu = document.getElementById('albumContextMenu');
    const moveSubmenu = document.getElementById('albumMoveSubmenu');
    const copySubmenu = document.getElementById('albumCopySubmenu');
    const playSubmenu = document.getElementById('playAlbumSubmenu');
    const moveOption = document.getElementById('moveAlbumOption');
    const copyOption = document.getElementById('copyAlbumOption');
    const playOption = document.getElementById('playAlbumOption');

    if (!contextMenu) return;

    let submenuTimeout;

    const hideSubmenus = () => {
      submenuTimeout = setTimeout(() => {
        if (moveSubmenu) {
          moveSubmenu.classList.add('hidden');
          moveOption?.classList.remove('bg-gray-700', 'text-white');
        }
        if (copySubmenu) {
          copySubmenu.classList.add('hidden');
          copyOption?.classList.remove('bg-gray-700', 'text-white');
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
      const toCopySubmenu =
        copySubmenu &&
        (e.relatedTarget === copySubmenu ||
          copySubmenu.contains(e.relatedTarget));
      const toPlaySubmenu =
        playSubmenu &&
        (e.relatedTarget === playSubmenu ||
          playSubmenu.contains(e.relatedTarget));

      if (!toMoveSubmenu && !toCopySubmenu && !toPlaySubmenu) {
        hideSubmenus();
      }
    });

    if (moveSubmenu) {
      moveSubmenu.addEventListener('mouseenter', cancelHide);
      moveSubmenu.addEventListener('mouseleave', hideSubmenus);
    }

    if (copySubmenu) {
      copySubmenu.addEventListener('mouseenter', cancelHide);
      copySubmenu.addEventListener('mouseleave', hideSubmenus);
    }

    if (playSubmenu) {
      playSubmenu.addEventListener('mouseenter', cancelHide);
      playSubmenu.addEventListener('mouseleave', hideSubmenus);
    }
  }

  /**
   * Initialize list context menu (right-click menu for lists)
   */
  function initializeContextMenu() {
    const lists = getLists();
    const contextMenu = document.getElementById('contextMenu');
    const downloadOption = document.getElementById('downloadListOption');
    const renameOption = document.getElementById('renameListOption');
    const toggleMainOption = document.getElementById('toggleMainOption');
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

    // Handle download option click - show submenu
    downloadOption.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      showDownloadListSubmenu();
    };

    // Handle rename option click
    renameOption.onclick = () => {
      const { list: currentContextList } = getContextState();
      contextMenu.classList.add('hidden');

      if (!currentContextList) return;

      openRenameModal(currentContextList);
    };

    // Handle toggle main option click
    toggleMainOption.onclick = () => {
      const { list: currentContextList } = getContextState();
      contextMenu.classList.add('hidden');
      setContextState({ list: null });

      if (currentContextList) {
        toggleMainStatus(currentContextList);
      }
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

      // Get list name from metadata for display
      const listMeta = getListMetadata(currentContextList);
      const listName = listMeta?.name || currentContextList;

      // Confirm deletion using custom modal
      const confirmed = await showConfirmation(
        'Delete List',
        `Are you sure you want to delete the list "${listName}"?`,
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

          // Clean up snapshot from localStorage and memory
          if (window.clearSnapshotFromStorage) {
            window.clearSnapshotFromStorage(currentContextList);
          }

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

          // Refresh groups and lists to update sidebar (groups may have been auto-deleted)
          if (refreshGroupsAndLists) {
            await refreshGroupsAndLists();
          } else {
            updateListNav();
          }

          showToast(`List "${listName}" deleted`);
        } catch (_error) {
          showToast('Error deleting list', 'error');
        }
      }

      setContextState({ list: null });
    };

    // Get submenu elements
    const moveListOption = document.getElementById('moveListOption');
    const moveListSubmenu = document.getElementById('moveListSubmenu');
    const downloadSubmenu = document.getElementById('downloadListSubmenu');

    // Define all submenu timeout variables and helper functions FIRST
    // (before they're used in event handlers)
    let downloadSubmenuTimeout;
    let moveListSubmenuTimeout;

    const hideDownloadSubmenu = () => {
      downloadSubmenuTimeout = setTimeout(() => {
        if (downloadSubmenu) {
          downloadSubmenu.classList.add('hidden');
          downloadOption.classList.remove('bg-gray-700', 'text-white');
        }
      }, 100);
    };

    const cancelHideDownloadSubmenu = () => {
      if (downloadSubmenuTimeout) clearTimeout(downloadSubmenuTimeout);
    };

    const hideMoveListSubmenu = () => {
      moveListSubmenuTimeout = setTimeout(() => {
        if (moveListSubmenu) {
          moveListSubmenu.classList.add('hidden');
          if (moveListOption) {
            moveListOption.classList.remove('bg-gray-700', 'text-white');
          }
        }
      }, 100);
    };

    const cancelHideMoveListSubmenu = () => {
      if (moveListSubmenuTimeout) clearTimeout(moveListSubmenuTimeout);
    };

    // Now set up event handlers that use these functions

    // Handle move list option - show collection submenu
    if (moveListOption && moveListSubmenu) {
      moveListOption.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        showMoveListSubmenu();
      };

      // Show submenu on mouse enter
      moveListOption.addEventListener('mouseenter', () => {
        cancelHideMoveListSubmenu();
        // Also hide download submenu when entering move option
        hideDownloadSubmenu();
        const { list: currentContextList } = getContextState();
        if (currentContextList) {
          showMoveListSubmenu();
        }
      });

      // Hide submenu when mouse leaves the option (unless moving to submenu)
      moveListOption.addEventListener('mouseleave', (e) => {
        const toSubmenu =
          moveListSubmenu &&
          (e.relatedTarget === moveListSubmenu ||
            moveListSubmenu.contains(e.relatedTarget));
        if (!toSubmenu) {
          hideMoveListSubmenu();
        }
      });

      // Submenu mouse handlers
      moveListSubmenu.addEventListener('mouseenter', cancelHideMoveListSubmenu);
      moveListSubmenu.addEventListener('mouseleave', hideMoveListSubmenu);
    }

    // Handle download option submenu
    if (downloadSubmenu) {
      // Show submenu on mouse enter
      downloadOption.addEventListener('mouseenter', () => {
        cancelHideDownloadSubmenu();
        // Also hide move list submenu when entering download option
        hideMoveListSubmenu();
        const { list: currentContextList } = getContextState();
        if (currentContextList) {
          showDownloadListSubmenu();
        }
      });

      // Hide submenu when mouse leaves the option (unless moving to submenu)
      downloadOption.addEventListener('mouseleave', (e) => {
        const toSubmenu =
          downloadSubmenu &&
          (e.relatedTarget === downloadSubmenu ||
            downloadSubmenu.contains(e.relatedTarget));
        if (!toSubmenu) {
          hideDownloadSubmenu();
        }
      });

      // Submenu mouse handlers
      downloadSubmenu.addEventListener('mouseenter', cancelHideDownloadSubmenu);
      downloadSubmenu.addEventListener('mouseleave', hideDownloadSubmenu);
    }

    // Hide all submenus when mouse leaves context menu entirely
    contextMenu.addEventListener('mouseleave', (e) => {
      const toDownloadSubmenu =
        downloadSubmenu &&
        (e.relatedTarget === downloadSubmenu ||
          downloadSubmenu.contains(e.relatedTarget));
      const toMoveListSubmenu =
        moveListSubmenu &&
        (e.relatedTarget === moveListSubmenu ||
          moveListSubmenu.contains(e.relatedTarget));

      if (!toDownloadSubmenu) {
        hideDownloadSubmenu();
      }
      if (!toMoveListSubmenu) {
        hideMoveListSubmenu();
      }
    });
  }

  /**
   * Show the move list to collection submenu
   */
  function showMoveListSubmenu() {
    const moveListOption = document.getElementById('moveListOption');
    const moveListSubmenu = document.getElementById('moveListSubmenu');
    const { list: currentContextList } = getContextState();

    if (!moveListSubmenu || !moveListOption || !currentContextList) return;

    // Get the current list's metadata to know which collection it's in
    const currentMeta = getListMetadata(currentContextList);
    const currentGroupId = currentMeta?.groupId;

    // Get all collections (groups without years) - exclude year-groups
    const groups = getSortedGroups ? getSortedGroups() : [];
    const collections = groups.filter((g) => !g.isYearGroup);

    // Build submenu content
    let html = '';

    if (collections.length === 0) {
      html = `
        <div class="px-4 py-2 text-sm text-gray-500">
          No collections available
        </div>
      `;
    } else {
      collections.forEach((collection) => {
        const isCurrentGroup = collection._id === currentGroupId;
        const checkmark = isCurrentGroup
          ? '<i class="fas fa-check text-green-500 ml-2"></i>'
          : '';
        const disabledClass = isCurrentGroup
          ? 'opacity-50 cursor-not-allowed'
          : 'hover:bg-gray-700 cursor-pointer';

        html += `
          <button 
            class="w-full text-left px-4 py-2 text-sm text-gray-300 hover:text-white transition-colors whitespace-nowrap ${disabledClass}"
            data-group-id="${collection._id}"
            data-group-name="${collection.name}"
            ${isCurrentGroup ? 'disabled' : ''}
          >
            <i class="fas fa-folder mr-2 w-4 text-center text-gray-500"></i>
            ${collection.name}
            ${checkmark}
          </button>
        `;
      });
    }

    moveListSubmenu.innerHTML = html;

    // Add click handlers for each collection option
    moveListSubmenu
      .querySelectorAll('button:not([disabled])')
      .forEach((btn) => {
        btn.onclick = async () => {
          const groupId = btn.dataset.groupId;
          const groupName = btn.dataset.groupName;
          await moveListToCollection(currentContextList, groupId, groupName);
        };
      });

    // Position the submenu next to the option
    const optionRect = moveListOption.getBoundingClientRect();
    moveListSubmenu.style.left = `${optionRect.right}px`;
    moveListSubmenu.style.top = `${optionRect.top}px`;
    moveListSubmenu.classList.remove('hidden');
    moveListOption.classList.add('bg-gray-700', 'text-white');

    // Adjust if off-screen
    requestAnimationFrame(() => {
      const submenuRect = moveListSubmenu.getBoundingClientRect();
      if (submenuRect.right > window.innerWidth) {
        moveListSubmenu.style.left = `${optionRect.left - submenuRect.width}px`;
      }
      if (submenuRect.bottom > window.innerHeight) {
        moveListSubmenu.style.top = `${window.innerHeight - submenuRect.height - 10}px`;
      }
    });
  }

  /**
   * Move a list to a different collection
   * @param {string} listName - Name of the list to move
   * @param {string} groupId - Target group ID
   * @param {string} groupName - Target group name (for toast message)
   */
  async function moveListToCollection(listName, groupId, groupName) {
    const contextMenu = document.getElementById('contextMenu');
    const moveListSubmenu = document.getElementById('moveListSubmenu');

    // Hide menus
    if (contextMenu) contextMenu.classList.add('hidden');
    if (moveListSubmenu) moveListSubmenu.classList.add('hidden');

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

    setContextState({ list: null });
  }

  // Return public API
  return {
    positionContextMenu,
    hideAllContextMenus,
    getDeviceIcon,
    getListMenuConfig,
    showMoveToListSubmenu,
    showCopyToListSubmenu,
    showMoveConfirmation,
    showCopyConfirmation,
    moveAlbumToList,
    copyAlbumToList,
    setupSubmenuHideOnLeave,
    showDownloadListSubmenu,
    initializeContextMenu,
  };
}
