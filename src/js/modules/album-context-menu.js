/**
 * Album Context Menu Module
 *
 * Handles the album right-click context menu including:
 * - Edit, remove, play, move, recommend, discover, re-identify actions
 * - Move-to-list submenu with year/list hierarchy
 * - Release selection modal for admin re-identification
 * - Hide all context menus helper
 * - Submenu leave behavior
 *
 * Extracted from app.js Phase 8 of separation-of-concerns refactoring.
 *
 * Factory pattern: createAlbumContextMenu(deps) returns public API.
 */

import { verifyAlbumAtIndex } from '../utils/album-identity.js';
import {
  setupSubmenuHover,
  setupChainedSubmenus,
} from '../utils/submenu-behavior.js';
import { groupListsByYear } from '../utils/list-grouping.js';

/**
 * Create the album context menu module
 * @param {Object} deps - Injected dependencies
 * @returns {Object} Public API
 */
export function createAlbumContextMenu(deps = {}) {
  const {
    getListData,
    getLists,
    getCurrentListId,
    getCurrentRecommendationsYear,
    getContextAlbum,
    getContextAlbumId,
    setContextAlbum,
    setContextAlbumId,
    getTrackAbortController,
    setTrackAbortController,
    getCurrentHighlightedYear,
    setCurrentHighlightedYear,
    getMoveListsHideTimeout,
    setMoveListsHideTimeout,
    findAlbumByIdentity,
    showMobileEditForm,
    showMobileEditFormSafe,
    showPlayAlbumSubmenu,
    showConfirmation,
    showToast,
    saveList,
    selectList,
    loadLists,
    getRecommendationsModule,
    getMobileUIModule,
    getListMetadata: _getListMetadata,
  } = deps;

  // ========================================================
  // Hide All Context Menus
  // ========================================================

  /**
   * Hide all context menus helper
   */
  function hideAllContextMenus() {
    const contextMenu = document.getElementById('contextMenu');
    if (contextMenu) {
      contextMenu.classList.add('hidden');
    }

    const albumContextMenu = document.getElementById('albumContextMenu');
    if (albumContextMenu) {
      albumContextMenu.classList.add('hidden');
      // Clear context album references when menu is hidden
      setContextAlbum(null);
      setContextAlbumId(null);

      // Cancel any pending track fetches
      const trackAbortController = getTrackAbortController();
      if (trackAbortController) {
        trackAbortController.abort();
        setTrackAbortController(null);
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

    const recommendationContextMenu = document.getElementById(
      'recommendationContextMenu'
    );
    if (recommendationContextMenu) {
      recommendationContextMenu.classList.add('hidden');
    }

    const recommendationAddSubmenu = document.getElementById(
      'recommendationAddSubmenu'
    );
    if (recommendationAddSubmenu) {
      recommendationAddSubmenu.classList.add('hidden');
    }

    const recommendationAddListsSubmenu = document.getElementById(
      'recommendationAddListsSubmenu'
    );
    if (recommendationAddListsSubmenu) {
      recommendationAddListsSubmenu.classList.add('hidden');
    }

    // Remove highlights from submenu parent options
    const moveOption = document.getElementById('moveAlbumOption');
    const playOption = document.getElementById('playAlbumOption');
    const addToListOption = document.getElementById('addToListOption');
    moveOption?.classList.remove('bg-gray-700', 'text-white');
    playOption?.classList.remove('bg-gray-700', 'text-white');
    addToListOption?.classList.remove('bg-gray-700', 'text-white');

    // Restore FAB visibility if a list or recommendations is selected
    const fab = document.getElementById('addAlbumFAB');
    if (fab && (getCurrentListId() || getCurrentRecommendationsYear())) {
      fab.style.display = 'flex';
    }
  }

  // ========================================================
  // Initialize Album Context Menu
  // ========================================================

  /**
   * Initialize the album context menu with all its action handlers
   */
  function initializeAlbumContextMenu() {
    const contextMenu = document.getElementById('albumContextMenu');
    const removeOption = document.getElementById('removeAlbumOption');
    const editOption = document.getElementById('editAlbumOption');
    const playOption = document.getElementById('playAlbumOption');

    if (!contextMenu || !removeOption || !editOption || !playOption) return;

    // Handle edit option click
    editOption.onclick = () => {
      contextMenu.classList.add('hidden');

      if (getContextAlbum() === null) return;

      // Verify the album is still at the expected index, fallback to identity search
      const albumsForEdit = getListData(getCurrentListId());
      const result = verifyAlbumAtIndex(
        albumsForEdit,
        getContextAlbum(),
        getContextAlbumId(),
        findAlbumByIdentity
      );
      if (result) {
        showMobileEditForm(result.index);
      } else if (getContextAlbumId()) {
        showMobileEditFormSafe(getContextAlbumId());
      } else {
        showToast(
          'Album not found - it may have been moved or removed',
          'error'
        );
      }
    };

    // Handle play option - show submenu with devices (for Spotify) or direct play (for Tidal/local)
    setupSubmenuHover(playOption, {
      onShow: showPlayAlbumSubmenu,
      relatedElements: () => [document.getElementById('playAlbumSubmenu')],
      onHide: () => {
        const submenu = document.getElementById('playAlbumSubmenu');
        if (submenu) submenu.classList.add('hidden');
      },
    });

    // Handle remove option click
    removeOption.onclick = async () => {
      contextMenu.classList.add('hidden');
      if (getContextAlbum() === null) return;

      // Verify the album is still at the expected index, fallback to identity search
      const albumsForRemove = getListData(getCurrentListId());
      const verified = verifyAlbumAtIndex(
        albumsForRemove,
        getContextAlbum(),
        getContextAlbumId(),
        findAlbumByIdentity
      );
      if (!verified) {
        showToast(
          'Album not found - it may have been moved or removed',
          'error'
        );
        return;
      }
      const album = verified.album;
      const indexToRemove = verified.index;

      showConfirmation(
        'Remove Album',
        `Remove "${album.album}" by ${album.artist}?`,
        'This will remove the album from this list.',
        'Remove',
        async () => {
          try {
            // Remove from the list using the correct index
            const albumsToModify = getListData(getCurrentListId());
            if (!albumsToModify) {
              showToast('Error: List data not found', 'error');
              return;
            }
            albumsToModify.splice(indexToRemove, 1);

            // Save to server
            await saveList(getCurrentListId(), albumsToModify);

            // Update display
            selectList(getCurrentListId());

            showToast(`Removed "${album.album}" from the list`);
          } catch (error) {
            console.error('Error removing album:', error);
            showToast('Error removing album', 'error');

            // Reload the list to ensure consistency
            await loadLists();
            selectList(getCurrentListId());
          }

          setContextAlbum(null);
          setContextAlbumId(null);
        }
      );
    };

    // Handle move option click - show submenu
    const moveOption = document.getElementById('moveAlbumOption');
    if (moveOption) {
      setupSubmenuHover(moveOption, {
        onShow: showMoveToListSubmenu,
        relatedElements: () => [
          document.getElementById('albumMoveSubmenu'),
          document.getElementById('albumMoveListsSubmenu'),
        ],
        onHide: () => {
          const submenu = document.getElementById('albumMoveSubmenu');
          const listsSubmenu = document.getElementById('albumMoveListsSubmenu');
          if (submenu) submenu.classList.add('hidden');
          if (listsSubmenu) listsSubmenu.classList.add('hidden');
          setCurrentHighlightedYear(null);
        },
      });
    }

    // Handle recommend option click
    const recommendOption = document.getElementById('recommendAlbumOption');
    if (recommendOption) {
      recommendOption.onclick = async () => {
        contextMenu.classList.add('hidden');

        // Get the album from the currently selected context
        const albumsData = getListData(getCurrentListId());
        const verified = verifyAlbumAtIndex(
          albumsData,
          getContextAlbum(),
          getContextAlbumId(),
          findAlbumByIdentity
        );
        const album = verified?.album;

        if (!album || !album.artist || !album.album) {
          showToast('Could not find album data', 'error');
          setContextAlbum(null);
          setContextAlbumId(null);
          return;
        }

        // Get the year from the current list metadata
        const listMeta = getLists()[getCurrentListId()];
        const year = listMeta?.year;

        if (!year) {
          showToast('Cannot recommend from a list without a year', 'error');
          setContextAlbum(null);
          setContextAlbumId(null);
          return;
        }

        await getRecommendationsModule().recommendAlbum(album, year);

        setContextAlbum(null);
        setContextAlbumId(null);
      };
    }

    // Handle Last.fm discovery options
    const similarOption = document.getElementById('similarArtistsOption');

    if (similarOption) {
      similarOption.onclick = () => {
        contextMenu.classList.add('hidden');

        // Get the artist name from the currently selected album
        const albumsData = getListData(getCurrentListId());
        const verified = verifyAlbumAtIndex(
          albumsData,
          getContextAlbum(),
          getContextAlbumId(),
          findAlbumByIdentity
        );
        const album = verified?.album;

        if (album && album.artist) {
          // Import and call showDiscoveryModal dynamically
          import('./discovery.js').then(({ showDiscoveryModal }) => {
            showDiscoveryModal('similar', { artist: album.artist });
          });
        } else {
          showToast('Could not find album artist', 'error');
        }

        setContextAlbum(null);
        setContextAlbumId(null);
      };
    }

    // Handle re-identify album option (admin only)
    const reidentifyOption = document.getElementById('reidentifyAlbumOption');

    if (reidentifyOption) {
      reidentifyOption.onclick = async () => {
        contextMenu.classList.add('hidden');

        // Get the album from the currently selected context
        const albumsData = getListData(getCurrentListId());
        const verified = verifyAlbumAtIndex(
          albumsData,
          getContextAlbum(),
          getContextAlbumId(),
          findAlbumByIdentity
        );
        const album = verified?.album;

        if (!album || !album.artist || !album.album) {
          showToast('Could not find album data', 'error');
          setContextAlbum(null);
          setContextAlbumId(null);
          return;
        }

        // Show release selection modal
        showReleaseSelectionModal(album);

        setContextAlbum(null);
        setContextAlbumId(null);
      };
    }
  }

  // ========================================================
  // Release Selection Modal (Admin Re-identify)
  // ========================================================

  /**
   * Show release selection modal for admin re-identification
   */
  async function showReleaseSelectionModal(album) {
    const modal = document.getElementById('releaseSelectionModal');
    const subtitle = document.getElementById('releaseSelectionSubtitle');
    const loading = document.getElementById('releaseSelectionLoading');
    const candidatesContainer = document.getElementById(
      'releaseSelectionCandidates'
    );
    const errorContainer = document.getElementById('releaseSelectionError');
    const confirmBtn = document.getElementById('releaseSelectionConfirmBtn');
    const cancelBtn = document.getElementById('releaseSelectionCancelBtn');

    if (!modal) return;

    // Reset state
    subtitle.textContent = `${album.album} by ${album.artist}`;
    loading.classList.remove('hidden');
    candidatesContainer.classList.add('hidden');
    candidatesContainer.innerHTML = '';
    errorContainer.classList.add('hidden');
    confirmBtn.disabled = true;

    let selectedReleaseId = null;
    let cleanup = null;

    // Show modal
    modal.classList.remove('hidden');

    // Setup event handlers
    const handleCancel = () => {
      modal.classList.add('hidden');
      if (cleanup) cleanup();
    };

    const handleBackdropClick = (e) => {
      if (e.target === modal) handleCancel();
    };

    const handleEscKey = (e) => {
      if (e.key === 'Escape') handleCancel();
    };

    const handleConfirm = async () => {
      if (!selectedReleaseId) return;

      confirmBtn.disabled = true;
      confirmBtn.innerHTML =
        '<i class="fas fa-spinner fa-spin mr-2"></i>Applying...';

      try {
        const response = await fetch('/api/admin/album/reidentify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            artist: album.artist,
            album: album.album,
            currentAlbumId: album.album_id,
            newAlbumId: selectedReleaseId,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Re-identification failed');
        }

        modal.classList.add('hidden');
        if (cleanup) cleanup();

        if (data.changed) {
          showToast(`Updated with ${data.trackCount} tracks`, 'success');
          // Reload the list to get updated track data
          await loadLists();
          selectList(getCurrentListId());
        } else {
          showToast(data.message || 'No changes made');
        }
      } catch (error) {
        console.error('Error applying re-identification:', error);
        showToast(`Error: ${error.message}`, 'error');
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Apply Selection';
      }
    };

    cleanup = () => {
      cancelBtn.removeEventListener('click', handleCancel);
      confirmBtn.removeEventListener('click', handleConfirm);
      modal.removeEventListener('click', handleBackdropClick);
      document.removeEventListener('keydown', handleEscKey);
    };

    cancelBtn.addEventListener('click', handleCancel);
    confirmBtn.addEventListener('click', handleConfirm);
    modal.addEventListener('click', handleBackdropClick);
    document.addEventListener('keydown', handleEscKey);

    // Fetch candidates
    try {
      const response = await fetch('/api/admin/album/reidentify/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          artist: album.artist,
          album: album.album,
          currentAlbumId: album.album_id,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Search failed');
      }

      loading.classList.add('hidden');

      if (!data.candidates || data.candidates.length === 0) {
        errorContainer.querySelector('p').textContent =
          'No matching releases found on MusicBrainz';
        errorContainer.classList.remove('hidden');
        return;
      }

      // Render candidates
      candidatesContainer.innerHTML = data.candidates
        .map(
          (candidate) => `
      <label class="release-candidate flex items-center gap-4 p-3 bg-gray-800 rounded-lg cursor-pointer hover:bg-gray-750 border-2 ${candidate.isCurrent ? 'border-yellow-500' : 'border-transparent'} transition-colors">
        <input type="radio" name="releaseCandidate" value="${candidate.id}" class="hidden" ${candidate.isCurrent ? 'checked' : ''}>
        <div class="flex-shrink-0 w-16 h-16 bg-gray-700 rounded overflow-hidden">
          ${
            candidate.coverUrl
              ? `<img src="${candidate.coverUrl}" alt="" class="w-full h-full object-cover" onerror="this.parentElement.innerHTML='<div class=\\'w-full h-full flex items-center justify-center text-gray-500\\'><i class=\\'fas fa-compact-disc text-2xl\\'></i></div>'">`
              : `<div class="w-full h-full flex items-center justify-center text-gray-500"><i class="fas fa-compact-disc text-2xl"></i></div>`
          }
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="font-medium text-white truncate">${candidate.title}</span>
            ${candidate.isCurrent ? '<span class="text-xs bg-yellow-500 text-black px-1.5 py-0.5 rounded">Current</span>' : ''}
          </div>
          <div class="text-sm text-gray-400 truncate">${candidate.artist}</div>
          <div class="flex items-center gap-3 mt-1 text-xs text-gray-500">
            <span class="inline-flex items-center gap-1">
              <i class="fas fa-tag"></i>${candidate.type}${candidate.secondaryTypes?.length ? ' + ' + candidate.secondaryTypes.join(', ') : ''}
            </span>
            ${candidate.trackCount ? `<span class="inline-flex items-center gap-1"><i class="fas fa-music"></i>${candidate.trackCount} tracks</span>` : ''}
            ${candidate.releaseDate ? `<span class="inline-flex items-center gap-1"><i class="fas fa-calendar"></i>${candidate.releaseDate}</span>` : ''}
          </div>
        </div>
        <div class="flex-shrink-0 w-6 h-6 rounded-full border-2 border-gray-600 flex items-center justify-center release-radio">
          <div class="w-3 h-3 rounded-full bg-yellow-500 hidden"></div>
        </div>
      </label>
    `
        )
        .join('');

      candidatesContainer.classList.remove('hidden');

      // Handle selection
      const radioInputs = candidatesContainer.querySelectorAll(
        'input[name="releaseCandidate"]'
      );
      const updateSelection = () => {
        radioInputs.forEach((input) => {
          const label = input.closest('label');
          const radioIndicator = label.querySelector('.release-radio div');
          if (input.checked) {
            label.classList.add('border-yellow-500');
            radioIndicator.classList.remove('hidden');
            selectedReleaseId = input.value;
          } else {
            label.classList.remove('border-yellow-500');
            radioIndicator.classList.add('hidden');
          }
        });
        confirmBtn.disabled = !selectedReleaseId;
        confirmBtn.textContent = 'Apply Selection';
      };

      radioInputs.forEach((input) => {
        input.addEventListener('change', updateSelection);
      });

      // Initialize with current selection
      const currentlySelected = candidatesContainer.querySelector(
        'input[name="releaseCandidate"]:checked'
      );
      if (currentlySelected) {
        selectedReleaseId = currentlySelected.value;
        updateSelection();
      }
    } catch (error) {
      console.error('Error fetching release candidates:', error);
      loading.classList.add('hidden');
      errorContainer.querySelector('p').textContent = error.message;
      errorContainer.classList.remove('hidden');
    }
  }

  // ========================================================
  // Move to List Submenus
  // ========================================================

  /**
   * Group lists by year for the move submenu (only lists with years, excluding current list)
   */
  function groupListsForMove() {
    return groupListsByYear(getLists(), {
      excludeListId: getCurrentListId(),
    });
  }

  /**
   * Show the move to list submenu for desktop (shows years)
   */
  function showMoveToListSubmenu() {
    const submenu = document.getElementById('albumMoveSubmenu');
    const listsSubmenu = document.getElementById('albumMoveListsSubmenu');
    const moveOption = document.getElementById('moveAlbumOption');
    const playSubmenu = document.getElementById('playAlbumSubmenu');
    const playOption = document.getElementById('playAlbumOption');

    if (!submenu || !moveOption) return;

    // Hide the other submenus first
    if (playSubmenu) {
      playSubmenu.classList.add('hidden');
      playOption?.classList.remove('bg-gray-700', 'text-white');
    }
    if (listsSubmenu) {
      listsSubmenu.classList.add('hidden');
    }

    // Reset highlighted year
    setCurrentHighlightedYear(null);

    // Highlight the parent menu item
    moveOption.classList.add('bg-gray-700', 'text-white');

    // Group lists by year
    const { listsByYear, sortedYears } = groupListsForMove();

    if (sortedYears.length === 0) {
      submenu.innerHTML =
        '<div class="px-4 py-2 text-sm text-gray-500">No other lists available</div>';
    } else {
      submenu.innerHTML = sortedYears
        .map(
          (year) => `
        <button class="flex items-center justify-between w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap" data-year="${year}">
          <span>${year}</span>
          <i class="fas fa-chevron-right text-xs ml-3 text-gray-500"></i>
        </button>
      `
        )
        .join('');

      // Add hover handlers to each year option
      submenu.querySelectorAll('[data-year]').forEach((btn) => {
        btn.addEventListener('mouseenter', () => {
          const moveListsHideTimeout = getMoveListsHideTimeout();
          if (moveListsHideTimeout) {
            clearTimeout(moveListsHideTimeout);
            setMoveListsHideTimeout(null);
          }
          const year = btn.dataset.year;
          showMoveToListYearSubmenu(year, btn, listsByYear);
        });

        btn.addEventListener('mouseleave', (e) => {
          const listsMenu = document.getElementById('albumMoveListsSubmenu');
          const toListsSubmenu =
            listsMenu &&
            (e.relatedTarget === listsMenu ||
              listsMenu.contains(e.relatedTarget));

          if (!toListsSubmenu) {
            const timeout = setTimeout(() => {
              if (listsMenu) listsMenu.classList.add('hidden');
              // Remove highlight from year button
              btn.classList.remove('bg-gray-700', 'text-white');
              setCurrentHighlightedYear(null);
            }, 100);
            setMoveListsHideTimeout(timeout);
          }
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
   * Show the lists submenu for a specific year
   */
  function showMoveToListYearSubmenu(year, yearButton, listsByYear) {
    const listsSubmenu = document.getElementById('albumMoveListsSubmenu');
    const yearSubmenu = document.getElementById('albumMoveSubmenu');
    const moveOption = document.getElementById('moveAlbumOption');

    if (!listsSubmenu || !yearSubmenu) return;

    const currentHighlightedYear = getCurrentHighlightedYear();

    // Remove highlight from previously highlighted year
    if (currentHighlightedYear && currentHighlightedYear !== year) {
      const prevBtn = yearSubmenu.querySelector(
        `[data-year="${currentHighlightedYear}"]`
      );
      if (prevBtn) {
        prevBtn.classList.remove('bg-gray-700', 'text-white');
      }
    }

    // Highlight the current year button
    yearButton.classList.add('bg-gray-700', 'text-white');
    setCurrentHighlightedYear(year);

    // Get lists for this year
    const yearLists = listsByYear[year] || [];

    if (yearLists.length === 0) {
      listsSubmenu.classList.add('hidden');
      return;
    }

    // Populate the lists submenu
    listsSubmenu.innerHTML = yearLists
      .map(
        (listId) => `
      <button class="block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap w-full" data-target-list="${listId}">
        <span class="mr-2">&bull;</span>${getLists()[listId]?.name || listId}
      </button>
    `
      )
      .join('');

    // Add click handlers to each list option
    listsSubmenu.querySelectorAll('[data-target-list]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const targetList = btn.dataset.targetList;

        // Hide all menus and remove highlights
        document.getElementById('albumContextMenu')?.classList.add('hidden');
        yearSubmenu.classList.add('hidden');
        listsSubmenu.classList.add('hidden');
        moveOption?.classList.remove('bg-gray-700', 'text-white');

        // Show confirmation modal
        getMobileUIModule().showMoveConfirmation(
          getContextAlbumId(),
          targetList
        );
      });
    });

    // Handle mouse leaving the lists submenu
    listsSubmenu.onmouseenter = () => {
      const moveListsHideTimeout = getMoveListsHideTimeout();
      if (moveListsHideTimeout) {
        clearTimeout(moveListsHideTimeout);
        setMoveListsHideTimeout(null);
      }
    };

    listsSubmenu.onmouseleave = (e) => {
      const yearMenu = document.getElementById('albumMoveSubmenu');
      const toYearSubmenu =
        yearMenu &&
        (e.relatedTarget === yearMenu || yearMenu.contains(e.relatedTarget));

      if (!toYearSubmenu) {
        const timeout = setTimeout(() => {
          listsSubmenu.classList.add('hidden');
          // Remove highlight from year button
          const highlightedYear = getCurrentHighlightedYear();
          if (highlightedYear) {
            const yearBtn = yearMenu?.querySelector(
              `[data-year="${highlightedYear}"]`
            );
            if (yearBtn) {
              yearBtn.classList.remove('bg-gray-700', 'text-white');
            }
            setCurrentHighlightedYear(null);
          }
        }, 100);
        setMoveListsHideTimeout(timeout);
      }
    };

    // Position lists submenu next to the year button
    const yearRect = yearButton.getBoundingClientRect();
    const yearSubmenuRect = yearSubmenu.getBoundingClientRect();

    listsSubmenu.style.left = `${yearSubmenuRect.right}px`;
    listsSubmenu.style.top = `${yearRect.top}px`;
    listsSubmenu.classList.remove('hidden');
  }

  // ========================================================
  // Submenu Leave Behavior
  // ========================================================

  /**
   * Hide submenus when mouse leaves the context menu area
   */
  function hideSubmenuOnLeave() {
    const contextMenu = document.getElementById('albumContextMenu');
    const moveSubmenu = document.getElementById('albumMoveSubmenu');
    const moveListsSubmenu = document.getElementById('albumMoveListsSubmenu');
    const playSubmenu = document.getElementById('playAlbumSubmenu');
    const moveOption = document.getElementById('moveAlbumOption');
    const playOption = document.getElementById('playAlbumOption');

    if (!contextMenu) return;

    const submenus = [];
    if (moveSubmenu) {
      submenus.push({
        element: moveSubmenu,
        triggerElement: moveOption,
        relatedMenus: [moveListsSubmenu].filter(Boolean),
      });
    }
    if (moveListsSubmenu) {
      submenus.push({
        element: moveListsSubmenu,
        relatedMenus: [moveSubmenu].filter(Boolean),
      });
    }
    if (playSubmenu) {
      submenus.push({
        element: playSubmenu,
        triggerElement: playOption,
      });
    }

    setupChainedSubmenus({
      contextMenu,
      submenus,
      onHideAll: () => {
        setCurrentHighlightedYear(null);
      },
    });
  }

  // Public API
  return {
    hideAllContextMenus,
    initializeAlbumContextMenu,
    showReleaseSelectionModal,
    groupListsForMove,
    showMoveToListSubmenu,
    showMoveToListYearSubmenu,
    hideSubmenuOnLeave,
  };
}
