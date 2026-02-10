/**
 * Recommendations Module
 *
 * Handles all recommendation UI: viewing, displaying, context menus,
 * mobile action sheets, and adding recommendations to lists.
 *
 * @param {Object} deps - External dependencies injected from app.js
 * @returns {Object} Public API
 */

import { renderAlbumList } from '../utils/album-list-renderer.js';

export function createRecommendations(deps = {}) {
  const {
    apiCall,
    showToast,
    showConfirmation,
    showReasoningModal,
    showViewReasoningModal,
    escapeHtml,
    positionContextMenu,
    createActionSheet,
    groupListsByYear,
    editRecommendationReasoning,
    removeRecommendation,
    setupSubmenuHover,
    getListData,
    setListData,
    getLists,
    getCurrentListId,
    setCurrentListId,
    getCurrentRecommendationsYear,
    setCurrentRecommendationsYear,
    getRealtimeSyncModuleInstance,
    hideAllContextMenus,
    clearPlaycountCache,
    updateListNavActiveState,
    updateHeaderTitle,
    updateMobileHeader,
    showLoadingSpinner,
    refreshRecommendationYears,
  } = deps;

  // ============ PRIVATE STATE ============

  /** Current recommendation context for context menu: { rec, year } */
  let currentRecommendationContext = null;

  /** Currently highlighted year in add-to-list recommendation submenu */
  let currentRecommendationAddHighlightedYear = null;

  /** Timeout for hiding recommendation add-to-list submenu */
  let recommendationAddListsHideTimeout = null;

  // ============ RECOMMEND ALBUM ============

  /**
   * Recommend an album for a given year.
   * Shows reasoning modal, then POSTs recommendation.
   * @param {Object} album - Album object with artist, album, etc.
   * @param {number} year - Year to recommend for
   */
  async function recommendAlbum(album, year) {
    const reasoning = await showReasoningModal(album, year);
    if (!reasoning) return; // User cancelled

    try {
      const response = await apiCall(`/api/recommendations/${year}`, {
        method: 'POST',
        body: JSON.stringify({ album, reasoning }),
      });

      if (response.error) {
        showToast(response.error, 'info');
      } else {
        showToast(`Recommended "${album.album}" by ${album.artist}`, 'success');
        // Refresh sidebar to show/update recommendations button for this year
        if (refreshRecommendationYears) refreshRecommendationYears();
      }
    } catch (err) {
      if (err.status === 409) {
        showToast(err.error || 'This album was already recommended', 'info');
      } else if (err.status === 403) {
        showToast('Recommendations are locked for this year', 'error');
      } else {
        showToast('Error adding recommendation', 'error');
      }
    }
  }

  // ============ GROUP LISTS ============

  /**
   * Group user's lists by year for the "Add to List" submenu.
   * Unlike move-to-list, does NOT exclude the current list.
   */
  function groupUserListsForAdd() {
    return groupListsByYear(getLists());
  }

  // ============ SELECT / DISPLAY RECOMMENDATIONS ============

  /**
   * Select and display recommendations for a year.
   * Entry point called from sidebar and navigation.
   * @param {number} year - The year to show recommendations for
   */
  async function selectRecommendations(year) {
    try {
      const previousListId = getCurrentListId();

      setCurrentListId('');
      setCurrentRecommendationsYear(year);

      const rtSync = getRealtimeSyncModuleInstance();
      if (rtSync && previousListId) {
        rtSync.unsubscribeFromList(previousListId);
      }

      clearPlaycountCache();

      // === IMMEDIATE UI UPDATES ===
      updateListNavActiveState('', year);
      updateHeaderTitle(`${year} Recommendations`);
      updateMobileHeader();

      const fab = document.getElementById('addAlbumFAB');
      if (fab) {
        fab.style.display = 'flex';
      }

      const container = document.getElementById('albumContainer');
      if (container) {
        showLoadingSpinner(container);
      }

      // === FETCH AND RENDER DATA ===
      try {
        const response = await apiCall(`/api/recommendations/${year}`);

        if (getCurrentRecommendationsYear() === year) {
          displayRecommendations(
            response.recommendations,
            year,
            response.locked
          );
          // Refresh sidebar to reflect any add/remove changes
          if (refreshRecommendationYears) refreshRecommendationYears();
        }
      } catch (err) {
        console.warn('Failed to fetch recommendations:', err);
        showToast('Error loading recommendations', 'error');
      }
    } catch (_error) {
      showToast('Error loading recommendations', 'error');
    }
  }

  // ============ MOBILE MENU ============

  /**
   * Show mobile bottom sheet menu for recommendation actions.
   */
  function showMobileRecommendationMenu(rec, year, locked) {
    const isOwner = window.currentUser?._id === rec.recommender_id;
    const isAdmin = window.currentUser?.role === 'admin';
    const hasAnyService =
      window.currentUser?.spotifyAuth || window.currentUser?.tidalAuth;
    const hasReasoning = rec.reasoning && rec.reasoning.trim().length > 0;

    const contentHtml = `
          <h3 class="font-semibold text-white mb-1 truncate">${escapeHtml(rec.album)}</h3>
          <p class="text-sm text-gray-400 mb-4 truncate">${escapeHtml(rec.artist)}</p>
          
          ${
            hasAnyService
              ? `
          <button data-action="play"
                  class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm">
            <i class="fas fa-play mr-3 text-green-400"></i>Play Album
          </button>
          `
              : ''
          }
          
          ${
            hasReasoning
              ? `
          <button data-action="view-reasoning"
                  class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm">
            <i class="fas fa-comment-alt mr-3 text-purple-400"></i>Reason for recommendation
          </button>
          `
              : ''
          }
          
          ${
            isOwner && !locked
              ? `
          <button data-action="edit-reasoning"
                  class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm">
            <i class="fas fa-edit mr-3 text-blue-400"></i>${hasReasoning ? 'Edit' : 'Add'} Reason
          </button>
          `
              : ''
          }
          
          <button data-action="add-to-list"
                  class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm">
            <i class="fas fa-plus mr-3 text-gray-400"></i>Add to List...
          </button>
          
          ${
            (isOwner || isAdmin) && !locked
              ? `
          <div class="border-t border-gray-700 my-2"></div>
          <button data-action="remove"
                  class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded-sm text-red-500">
            <i class="fas fa-trash mr-3"></i>Remove Recommendation
          </button>
          `
              : ''
          }
          
          <button data-action="cancel"
                  class="w-full text-center py-3 px-4 mt-2 bg-gray-800 rounded-sm">
            Cancel
          </button>`;

    const { sheet, close } = createActionSheet({
      contentHtml,
      checkCurrentList: false,
    });

    const playBtn = sheet.querySelector('[data-action="play"]');
    const viewReasoningBtn = sheet.querySelector(
      '[data-action="view-reasoning"]'
    );
    const editReasoningBtn = sheet.querySelector(
      '[data-action="edit-reasoning"]'
    );
    const addToListBtn = sheet.querySelector('[data-action="add-to-list"]');
    const removeBtn = sheet.querySelector('[data-action="remove"]');

    if (playBtn) {
      playBtn.addEventListener('click', (e) => {
        e.preventDefault();
        close();
        if (window.playAlbumSafe) {
          window.playAlbumSafe(rec.album_id);
        }
      });
    }

    if (viewReasoningBtn) {
      viewReasoningBtn.addEventListener('click', (e) => {
        e.preventDefault();
        close();
        showViewReasoningModal(rec);
      });
    }

    if (editReasoningBtn) {
      editReasoningBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        close();
        await editRecommendationReasoning(
          rec,
          year,
          apiCall,
          showReasoningModal,
          showToast,
          selectRecommendations
        );
      });
    }

    if (addToListBtn) {
      addToListBtn.addEventListener('click', (e) => {
        e.preventDefault();
        close();
        showMobileAddRecommendationToListSheet(rec, year);
      });
    }

    if (removeBtn) {
      removeBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        close();
        await removeRecommendation(
          rec,
          year,
          apiCall,
          showConfirmation,
          showToast,
          selectRecommendations
        );
      });
    }
  }

  // ============ MOBILE ADD-TO-LIST SHEET ============

  /**
   * Show mobile sheet to select list for adding recommendation.
   */
  function showMobileAddRecommendationToListSheet(rec, year) {
    const {
      listsByYear: lby,
      sortedYears,
      listsWithoutYear,
    } = groupListsByYear(getLists(), {
      includeWithoutYear: true,
      includeNames: true,
    });

    const hasAnyLists = sortedYears.length > 0 || listsWithoutYear.length > 0;

    let contentHtml;
    let panelClasses = '';

    if (!hasAnyLists) {
      contentHtml = `
            <h3 class="font-semibold text-white mb-1">Add to List</h3>
            <p class="text-sm text-gray-400 mb-4">${escapeHtml(rec.album)} by ${escapeHtml(rec.artist)}</p>
            
            <div class="py-8 text-center text-gray-500">
              No lists available
            </div>
            
            <button data-action="cancel"
                    class="w-full text-center py-3 px-4 mt-2 bg-gray-800 rounded-sm">
              Cancel
            </button>`;
    } else {
      panelClasses = 'max-h-[80vh] overflow-y-auto';

      const yearSections = sortedYears
        .map(
          (yr, idx) => `
          <div class="year-section" data-year="${yr}">
            <button data-action="toggle-year" data-year="${yr}"
                    class="w-full flex items-center justify-between py-3 px-4 hover:bg-gray-800 rounded-sm">
              <span class="font-medium text-white">${yr}</span>
              <div class="flex items-center gap-2">
                <span class="text-xs text-gray-500">${lby[yr].length} list${lby[yr].length !== 1 ? 's' : ''}</span>
                <i class="fas fa-chevron-down text-gray-500 text-xs transition-transform duration-200" data-year-chevron="${yr}"></i>
              </div>
            </button>
            <div data-year-lists="${yr}" class="${idx === 0 ? '' : 'hidden'} overflow-hidden transition-all duration-200 ease-out" style="${idx === 0 ? '' : 'max-height: 0;'}">
              <div class="ml-4 border-l-2 border-gray-700 pl-2">
                ${lby[yr]
                  .map(
                    (list) => `
                  <button data-target-list="${list.id}"
                          class="w-full text-left py-2.5 px-3 hover:bg-gray-800 rounded-sm text-gray-300">
                    ${escapeHtml(list.name)}
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
                    (list) => `
                  <button data-target-list="${list.id}"
                          class="w-full text-left py-2.5 px-3 hover:bg-gray-800 rounded-sm text-gray-300">
                    ${escapeHtml(list.name)}
                  </button>
                `
                  )
                  .join('')}
              </div>
            </div>
          </div>
        `
          : '';

      contentHtml = `
            <h3 class="font-semibold text-white mb-1">Add to List</h3>
            <p class="text-sm text-gray-400 mb-4 truncate">${escapeHtml(rec.album)} by ${escapeHtml(rec.artist)}</p>
            
            ${yearSections}
            ${otherSection}
            
            <button data-action="cancel"
                    class="w-full text-center py-3 px-4 mt-2 bg-gray-800 rounded-sm">
              Cancel
            </button>`;
    }

    const { sheet, close } = createActionSheet({
      contentHtml,
      panelClasses,
      hideFAB: false,
      restoreFAB: false,
    });

    const expandedYears = new Set();
    if (sortedYears.length > 0) {
      expandedYears.add(sortedYears[0]);
      const firstChevron = sheet.querySelector(
        `[data-year-chevron="${sortedYears[0]}"]`
      );
      if (firstChevron) {
        firstChevron.style.transform = 'rotate(180deg)';
      }
    }

    sheet.querySelectorAll('[data-action="toggle-year"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const yr = btn.dataset.year;
        const listContainer = sheet.querySelector(`[data-year-lists="${yr}"]`);
        const chevron = sheet.querySelector(`[data-year-chevron="${yr}"]`);

        if (!listContainer) return;

        const isExpanded = expandedYears.has(yr);

        if (isExpanded) {
          listContainer.style.maxHeight = '0';
          if (chevron) chevron.style.transform = 'rotate(0deg)';
          setTimeout(() => {
            listContainer.classList.add('hidden');
          }, 200);
          expandedYears.delete(yr);
        } else {
          listContainer.classList.remove('hidden');
          void listContainer.offsetHeight;
          listContainer.style.maxHeight = listContainer.scrollHeight + 'px';
          if (chevron) chevron.style.transform = 'rotate(180deg)';
          expandedYears.add(yr);
        }
      });
    });

    sheet.querySelectorAll('[data-target-list]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const targetList = btn.dataset.targetList;
        close();

        try {
          await addRecommendationToListMobile(rec, targetList, year);
        } catch (err) {
          console.error('Error adding recommendation to list:', err);
        }
      });
    });
  }

  /**
   * Add recommendation album to a user's list (mobile version).
   */
  async function addRecommendationToListMobile(rec, targetListId, year) {
    currentRecommendationContext = { rec, year };
    await addRecommendationToList(targetListId);
    currentRecommendationContext = null;
  }

  // ============ DISPLAY RECOMMENDATIONS ============

  /**
   * Display recommendations in the album container.
   * Responsive: mobile cards or desktop table via shared renderer.
   */
  function displayRecommendations(recommendations, year, locked) {
    const container = document.getElementById('albumContainer');
    if (!container) return;

    container.innerHTML = '';

    if (locked) {
      const banner = document.createElement('div');
      banner.className =
        'bg-yellow-900/50 border border-yellow-700 text-yellow-200 px-4 py-3 rounded-lg mb-4 flex items-center gap-2';
      banner.innerHTML = `
        <i class="fas fa-lock"></i>
        <span>Recommendations for ${year} are locked. No new albums can be added.</span>
      `;
      container.appendChild(banner);
    }

    renderAlbumList({
      container,
      items: recommendations,
      columns: [
        'cover',
        'artist',
        'albumName',
        'genre',
        'recommendedBy',
        'dateAdded',
      ],
      escapeHtml,
      emptyState: {
        icon: 'fas fa-thumbs-up',
        title: `No recommendations yet for ${year}`,
        subtitle: 'Click the + button to recommend an album',
      },
      onContextMenu: (e, rec) => showRecommendationContextMenu(e, rec, year),
      onMenuClick: (rec) => showMobileRecommendationMenu(rec, year, locked),
      onReasoningClick: (rec) => showViewReasoningModal(rec),
      showPosition: false,
      mobileCardHeight: 150,
    });
  }

  // ============ DESKTOP CONTEXT MENU ============

  /**
   * Show context menu for a recommendation album (desktop right-click).
   */
  function showRecommendationContextMenu(e, rec, year) {
    hideAllContextMenus();

    currentRecommendationContext = { rec, year };

    const contextMenu = document.getElementById('recommendationContextMenu');
    if (!contextMenu) return;

    const isOwner = window.currentUser?._id === rec.recommender_id;
    const ownerDivider = contextMenu.querySelector(
      '.recommendation-owner-divider'
    );
    const editReasoningOption = document.getElementById('editReasoningOption');

    if (ownerDivider) ownerDivider.classList.toggle('hidden', !isOwner);
    if (editReasoningOption)
      editReasoningOption.classList.toggle('hidden', !isOwner);

    const isAdmin = window.currentUser?.role === 'admin';
    const adminDivider = contextMenu.querySelector(
      '.recommendation-admin-divider'
    );
    const removeOption = document.getElementById('removeRecommendationOption');

    if (adminDivider) adminDivider.classList.toggle('hidden', !isAdmin);
    if (removeOption) removeOption.classList.toggle('hidden', !isAdmin);

    positionContextMenu(contextMenu, e.clientX, e.clientY);
  }

  /**
   * Initialize recommendation context menu event handlers.
   * Called once during DOMContentLoaded.
   */
  function initializeRecommendationContextMenu() {
    const contextMenu = document.getElementById('recommendationContextMenu');
    const playOption = document.getElementById('playRecommendationOption');
    const removeOption = document.getElementById('removeRecommendationOption');

    if (!contextMenu) return;

    if (playOption) {
      playOption.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (!currentRecommendationContext) return;
        const { rec } = currentRecommendationContext;

        if (window.playAlbumSafe) {
          window.playAlbumSafe(rec.album_id);
        }

        contextMenu.classList.add('hidden');
        currentRecommendationContext = null;
      });
    }

    if (removeOption) {
      removeOption.addEventListener('click', async () => {
        contextMenu.classList.add('hidden');

        if (!currentRecommendationContext) return;
        const { rec, year } = currentRecommendationContext;

        await removeRecommendation(
          rec,
          year,
          apiCall,
          showConfirmation,
          showToast,
          selectRecommendations
        );

        currentRecommendationContext = null;
      });
    }

    const editReasoningOption = document.getElementById('editReasoningOption');
    if (editReasoningOption) {
      editReasoningOption.addEventListener('click', async () => {
        contextMenu.classList.add('hidden');

        if (!currentRecommendationContext) return;
        const { rec, year } = currentRecommendationContext;

        await editRecommendationReasoning(
          rec,
          year,
          apiCall,
          showReasoningModal,
          showToast,
          selectRecommendations
        );

        currentRecommendationContext = null;
      });
    }

    const addToListOption = document.getElementById('addToListOption');
    if (addToListOption) {
      setupSubmenuHover(addToListOption, {
        onShow: showRecommendationAddSubmenu,
        relatedElements: () => [
          document.getElementById('recommendationAddSubmenu'),
        ],
        onHide: () => {
          const submenu = document.getElementById('recommendationAddSubmenu');
          if (submenu) submenu.classList.add('hidden');
          currentRecommendationAddHighlightedYear = null;
        },
      });
    }
  }

  // ============ DESKTOP ADD-TO-LIST SUBMENUS ============

  /**
   * Show the add-to-list submenu with years.
   */
  function showRecommendationAddSubmenu() {
    const submenu = document.getElementById('recommendationAddSubmenu');
    const listsSubmenu = document.getElementById(
      'recommendationAddListsSubmenu'
    );
    const addToListOption = document.getElementById('addToListOption');
    const contextMenu = document.getElementById('recommendationContextMenu');

    if (!submenu || !addToListOption || !contextMenu) return;

    if (listsSubmenu) {
      listsSubmenu.classList.add('hidden');
    }

    currentRecommendationAddHighlightedYear = null;

    addToListOption.classList.add('bg-gray-700', 'text-white');

    const { listsByYear: lby, sortedYears } = groupUserListsForAdd();

    if (sortedYears.length === 0) {
      submenu.innerHTML =
        '<div class="px-4 py-2 text-sm text-gray-500">No lists available</div>';
    } else {
      submenu.innerHTML = sortedYears
        .map(
          (year) => `
          <button class="flex items-center justify-between w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap" data-add-year="${year}">
            <span>${year}</span>
            <i class="fas fa-chevron-right text-xs ml-3 text-gray-500"></i>
          </button>
        `
        )
        .join('');

      submenu.querySelectorAll('[data-add-year]').forEach((btn) => {
        btn.addEventListener('mouseenter', () => {
          if (recommendationAddListsHideTimeout) {
            clearTimeout(recommendationAddListsHideTimeout);
            recommendationAddListsHideTimeout = null;
          }
          const year = btn.dataset.addYear;
          showRecommendationAddListsSubmenu(year, btn, lby);
        });

        btn.addEventListener('mouseleave', (e) => {
          const listsMenu = document.getElementById(
            'recommendationAddListsSubmenu'
          );
          const toListsSubmenu =
            listsMenu &&
            (e.relatedTarget === listsMenu ||
              listsMenu.contains(e.relatedTarget));

          if (!toListsSubmenu) {
            recommendationAddListsHideTimeout = setTimeout(() => {
              if (listsMenu) listsMenu.classList.add('hidden');
              btn.classList.remove('bg-gray-700', 'text-white');
              currentRecommendationAddHighlightedYear = null;
            }, 100);
          }
        });
      });
    }

    const optionRect = addToListOption.getBoundingClientRect();
    const menuRect = contextMenu.getBoundingClientRect();

    submenu.style.left = `${menuRect.right}px`;
    submenu.style.top = `${optionRect.top}px`;
    submenu.classList.remove('hidden');
  }

  /**
   * Show the lists submenu for a specific year.
   */
  function showRecommendationAddListsSubmenu(year, yearButton, listsByYear) {
    const listsSubmenu = document.getElementById(
      'recommendationAddListsSubmenu'
    );
    const yearSubmenu = document.getElementById('recommendationAddSubmenu');

    if (!listsSubmenu || !yearSubmenu) return;

    if (
      currentRecommendationAddHighlightedYear &&
      currentRecommendationAddHighlightedYear !== year
    ) {
      const prevBtn = yearSubmenu.querySelector(
        `[data-add-year="${currentRecommendationAddHighlightedYear}"]`
      );
      if (prevBtn) {
        prevBtn.classList.remove('bg-gray-700', 'text-white');
      }
    }

    yearButton.classList.add('bg-gray-700', 'text-white');
    currentRecommendationAddHighlightedYear = year;

    const yearLists = listsByYear[year] || [];

    if (yearLists.length === 0) {
      listsSubmenu.classList.add('hidden');
      return;
    }

    listsSubmenu.innerHTML = yearLists
      .map(
        (listId) => `
        <button class="block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap w-full" data-add-target-list="${listId}">
          <span class="mr-2">\u2022</span>${getLists()[listId]?.name || listId}
        </button>
      `
      )
      .join('');

    listsSubmenu.querySelectorAll('[data-add-target-list]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const targetListId = btn.dataset.addTargetList;

        document
          .getElementById('recommendationContextMenu')
          ?.classList.add('hidden');
        yearSubmenu.classList.add('hidden');
        listsSubmenu.classList.add('hidden');

        await addRecommendationToList(targetListId);
      });
    });

    listsSubmenu.onmouseenter = () => {
      if (recommendationAddListsHideTimeout) {
        clearTimeout(recommendationAddListsHideTimeout);
        recommendationAddListsHideTimeout = null;
      }
    };

    listsSubmenu.onmouseleave = (e) => {
      const yearMenu = document.getElementById('recommendationAddSubmenu');
      const toYearSubmenu =
        yearMenu &&
        (e.relatedTarget === yearMenu || yearMenu.contains(e.relatedTarget));

      if (!toYearSubmenu) {
        recommendationAddListsHideTimeout = setTimeout(() => {
          listsSubmenu.classList.add('hidden');
          if (currentRecommendationAddHighlightedYear) {
            const yearBtn = yearMenu?.querySelector(
              `[data-add-year="${currentRecommendationAddHighlightedYear}"]`
            );
            if (yearBtn) {
              yearBtn.classList.remove('bg-gray-700', 'text-white');
            }
            currentRecommendationAddHighlightedYear = null;
          }
        }, 100);
      }
    };

    const yearRect = yearButton.getBoundingClientRect();
    const yearSubmenuRect = yearSubmenu.getBoundingClientRect();

    listsSubmenu.style.left = `${yearSubmenuRect.right}px`;
    listsSubmenu.style.top = `${yearRect.top}px`;
    listsSubmenu.classList.remove('hidden');
  }

  // ============ ADD TO LIST ============

  /**
   * Add a recommendation album to a user's list.
   * Shared by both desktop and mobile flows.
   */
  async function addRecommendationToList(targetListId) {
    if (!currentRecommendationContext) {
      showToast('No album selected', 'error');
      return;
    }

    const { rec } = currentRecommendationContext;
    const targetMeta = getLists()[targetListId];
    const targetListName = targetMeta?.name || 'Unknown';

    let targetAlbums = getListData(targetListId);

    if (!targetAlbums) {
      try {
        const data = await apiCall(
          `/api/lists/${encodeURIComponent(targetListId)}`
        );
        setListData(targetListId, data);
        targetAlbums = data;
      } catch (_err) {
        showToast('Failed to load list data', 'error');
        currentRecommendationContext = null;
        return;
      }
    }

    const key = `${rec.artist}::${rec.album}`.toLowerCase();
    const isDuplicate = targetAlbums?.some(
      (a) => `${a.artist}::${a.album}`.toLowerCase() === key
    );

    if (isDuplicate) {
      showToast(`"${rec.album}" is already in "${targetListName}"`, 'info');
      currentRecommendationContext = null;
      return;
    }

    const albumToAdd = {
      album_id: rec.album_id,
      artist: rec.artist,
      album: rec.album,
      release_date: rec.release_date || null,
      country: rec.country || null,
      genre_1: rec.genre_1 || null,
      genre_2: rec.genre_2 || null,
    };

    try {
      await apiCall(`/api/lists/${encodeURIComponent(targetListId)}/items`, {
        method: 'PATCH',
        body: JSON.stringify({ added: [albumToAdd] }),
      });

      showToast(`Added "${rec.album}" to "${targetListName}"`, 'success');

      const listMetadata = getLists()[targetListId];
      if (listMetadata) {
        listMetadata._data = null;
      }
    } catch (_err) {
      showToast('Failed to add album to list', 'error');
    }

    currentRecommendationContext = null;
  }

  // ============ PUBLIC API ============

  return {
    recommendAlbum,
    selectRecommendations,
    initializeRecommendationContextMenu,
    // Expose for hideAllContextMenus in app.js
    getContext: () => currentRecommendationContext,
    clearContext: () => {
      currentRecommendationContext = null;
    },
    clearHighlightState: () => {
      currentRecommendationAddHighlightedYear = null;
    },
  };
}
