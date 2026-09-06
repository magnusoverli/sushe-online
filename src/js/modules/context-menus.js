/**
 * Context Menus Module
 *
 * Handles context menu positioning, submenu management, and mobile action sheets.
 * Uses dependency injection for testability and decoupling from global state.
 *
 * @module context-menus
 */

import {
  positionContextMenu,
  hideAllContextMenus as hideAllMenusBase,
} from './context-menu.js';
import { getDeviceIcon } from '../utils/device-icons.js';
import { escapeHtml } from './html-utils.js';
import { createListMenuActions } from './list-menu-shared.js';

/**
 * Factory function to create the context menus module with injected dependencies
 *
 * @param {Object} deps - Dependencies
 * @param {Function} deps.getListData - Get album array for a list
 * @param {Function} deps.getListMetadata - Get metadata for a list
 * @param {Function} deps.getCurrentList - Get current list name
 * @param {Function} deps.getLists - Get all lists
 * @param {Function} deps.selectList - Select a list
 * @param {Function} deps.showToast - Show toast notification
 * @param {Function} deps.showConfirmation - Show confirmation dialog
 * @param {Function} deps.apiCall - Make API call
 * @param {Function} deps.downloadListAsJSON - Download list as JSON
 * @param {Function} deps.downloadListAsPDF - Download list as PDF
 * @param {Function} deps.downloadListAsCSV - Download list as CSV
 * @param {Function} deps.updatePlaylist - Update playlist on music service
 * @param {Function} deps.openRenameModal - Open rename modal
 * @param {Function} deps.updateListNav - Update list navigation
 * @param {Function} deps.getContextList - Get context menu list state
 * @param {Function} deps.setContextList - Set context menu list state
 * @param {Function} deps.setCurrentList - Set current list (for delete)
 * @param {Function} deps.getSortedGroups - Get groups sorted by sort_order
 * @param {Function} deps.refreshGroupsAndLists - Refresh groups and lists after changes
 * @param {Function} deps.clearSnapshotFromStorage - Clear local list snapshot cache
 * @returns {Object} Context menus module API
 */
export function createContextMenus(deps = {}) {
  const {
    getListData,
    getListMetadata,
    getCurrentList,
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
    getContextList,
    setContextList,
    setCurrentList,
    getSortedGroups,
    refreshGroupsAndLists,
    toggleMainStatus,
    clearSnapshotFromStorage,
  } = deps;

  const listMenuActions = createListMenuActions({
    getListData,
    getLists,
    getListMetadata,
    getCurrentList,
    setCurrentList,
    selectList,
    apiCall,
    showConfirmation,
    showToast,
    refreshGroupsAndLists,
    updateListNav,
    clearSnapshotFromStorage,
    updatePlaylist,
    downloadListAsJSON,
    downloadListAsPDF,
    downloadListAsCSV,
    openRenameModal,
    toggleMainStatus,
    logger: console,
  });

  /**
   * Hide all context menus and perform module-specific cleanup.
   * Delegates to shared hideAllMenusBase().
   */
  function hideAllContextMenus() {
    hideAllMenusBase();

    // Only show FAB when a list is actually selected
    const currentList = getCurrentList();
    if (!currentList) {
      const fab = document.getElementById('addAlbumFAB');
      if (fab) fab.style.display = 'none';
    }
  }

  // getDeviceIcon is imported from utils/device-icons.js (shared module)

  /**
   * Show download list submenu for desktop
   */
  function showDownloadListSubmenu() {
    const currentContextList = getContextList();
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

        listMenuActions.downloadList(currentContextList, 'json');
        setContextList(null);
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

        listMenuActions.downloadList(currentContextList, 'pdf');
        setContextList(null);
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

        listMenuActions.downloadList(currentContextList, 'csv');
        setContextList(null);
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

  /**
   * Initialize list context menu (right-click menu for lists)
   */
  function initializeContextMenu() {
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

    // Handle download option click - show submenu
    downloadOption.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      showDownloadListSubmenu();
    };

    // Handle rename option click
    renameOption.onclick = () => {
      const currentContextList = getContextList();
      contextMenu.classList.add('hidden');
      setContextList(null);

      if (!currentContextList) return;

      listMenuActions.renameList(currentContextList);
    };

    // Handle toggle main option click
    toggleMainOption.onclick = () => {
      const currentContextList = getContextList();
      contextMenu.classList.add('hidden');
      setContextList(null);

      if (currentContextList) {
        listMenuActions.toggleMainForList(currentContextList);
      }
    };

    // Handle update playlist option click
    updatePlaylistOption.onclick = async () => {
      const currentContextList = getContextList();
      contextMenu.classList.add('hidden');

      if (!currentContextList) return;

      await listMenuActions.sendToMusicService(currentContextList);

      setContextList(null);
    };

    // Handle delete option click
    deleteOption.onclick = async () => {
      const currentContextList = getContextList();
      contextMenu.classList.add('hidden');
      setContextList(null);

      if (!currentContextList) return;

      await listMenuActions.deleteList(currentContextList);
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
        const currentContextList = getContextList();
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
        const currentContextList = getContextList();
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
    const currentContextList = getContextList();

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

        // Collection names are free text, so they are escaped for both the
        // attribute and the label. A name carrying a quote would otherwise
        // close data-group-name early and the move would report the wrong
        // destination; a name carrying a tag would rewrite the submenu.
        const safeName = escapeHtml(collection.name);

        html += `
          <button 
            class="w-full text-left px-4 py-2 text-sm text-gray-300 hover:text-white transition-colors whitespace-nowrap ${disabledClass}"
            data-group-id="${escapeHtml(collection._id)}"
            data-group-name="${safeName}"
            ${isCurrentGroup ? 'disabled' : ''}
          >
            <i class="fas fa-folder mr-2 w-4 text-center text-gray-500"></i>
            ${safeName}
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
   * @param {string} listId - ID of the list to move
   * @param {string} groupId - Target group ID
   * @param {string} groupName - Target group name (for toast message)
   */
  async function moveListToCollection(listId, groupId, groupName) {
    const contextMenu = document.getElementById('contextMenu');
    const moveListSubmenu = document.getElementById('moveListSubmenu');

    // Hide menus
    if (contextMenu) contextMenu.classList.add('hidden');
    if (moveListSubmenu) moveListSubmenu.classList.add('hidden');

    // The caller passes an opaque list id; the toast has to name the list.
    const listName = getListMetadata(listId)?.name || listId;

    try {
      await apiCall(`/api/lists/${encodeURIComponent(listId)}/move`, {
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

    setContextList(null);
  }

  // Return public API
  return {
    positionContextMenu,
    hideAllContextMenus,
    getDeviceIcon,
    showDownloadListSubmenu,
    initializeContextMenu,
  };
}
