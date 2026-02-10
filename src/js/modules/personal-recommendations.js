/**
 * Personal Recommendations Module
 *
 * Handles display and interaction for AI-generated personal weekly album recommendations.
 * Follows the same patterns as the community recommendations module.
 *
 * @module personal-recommendations
 */

/**
 * Create the personal recommendations module with injected dependencies.
 * @param {Object} deps - Dependencies
 * @returns {Object} Public API
 */
export function createPersonalRecommendations(deps = {}) {
  const {
    apiCall,
    showToast,
    showViewReasoningModal,
    escapeHtml,
    positionContextMenu,
    createActionSheet,
    groupListsByYear,
    setupSubmenuHover,
    getListData,
    setListData,
    getLists,
    setCurrentListId,
    getCurrentPersonalRecListId,
    setCurrentPersonalRecListId,
    setPersonalRecLists,
    hideAllContextMenus,
    clearPlaycountCache,
    updateListNavActiveState,
    updateHeaderTitle,
    updateMobileHeader,
    showLoadingSpinner,
    setCurrentRecommendationsYear,
  } = deps;

  let currentContext = null;

  /** Currently highlighted year in add-to-list submenu */
  let personalRecAddHighlightedYear = null;

  /** Timeout for hiding the lists submenu */
  let personalRecAddListsHideTimeout = null;

  // ============ SELECT & DISPLAY ============

  /**
   * Select and display a personal recommendation list.
   * @param {string} listId - The personal recommendation list ID
   */
  async function selectPersonalRecList(listId) {
    try {
      setCurrentListId('');
      setCurrentRecommendationsYear(null);
      setCurrentPersonalRecListId(listId);

      clearPlaycountCache();

      // === IMMEDIATE UI UPDATES ===
      updateListNavActiveState('', null, listId);
      updateHeaderTitle("This Week's Picks");
      updateMobileHeader();

      const fab = document.getElementById('addAlbumFAB');
      if (fab) fab.style.display = 'none';

      const container = document.getElementById('albumContainer');
      if (container) showLoadingSpinner(container);

      // === FETCH AND RENDER DATA ===
      try {
        const response = await apiCall(
          `/api/personal-recommendations/${encodeURIComponent(listId)}`
        );

        if (getCurrentPersonalRecListId() === listId) {
          displayPersonalRecs(response.list, response.items || []);
        }
      } catch (err) {
        console.warn('Failed to fetch personal recommendations:', err);
        showToast('Error loading recommendations', 'error');
      }
    } catch (_error) {
      showToast('Error loading recommendations', 'error');
    }
  }

  /**
   * Display personal recommendation albums in the main content area.
   * @param {Object} list - The recommendation list metadata
   * @param {Array} items - Array of recommendation items with album data
   */
  function displayPersonalRecs(list, items) {
    const container = document.getElementById('albumContainer');
    if (!container) return;

    const isMobile = window.innerWidth < 1024;
    container.innerHTML = '';

    // Handle failed lists
    if (list && list.status === 'failed') {
      const errorDiv = document.createElement('div');
      errorDiv.className = 'text-center text-gray-400 mt-20 px-4';
      errorDiv.innerHTML = `
        <i class="fas fa-robot text-4xl mb-4 block opacity-50 text-purple-400"></i>
        <p class="text-xl mb-2">We couldn't generate your recommendations this week</p>
        <p class="text-sm text-gray-500 mb-4">${list.error_message ? escapeHtml(list.error_message) : 'This can happen when our AI service is temporarily unavailable.'}</p>
        <p class="text-sm text-gray-500">We'll try again next Monday!</p>
      `;
      container.appendChild(errorDiv);
      return;
    }

    if (!items || items.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'text-center text-gray-500 mt-20 px-4';
      emptyDiv.innerHTML = `
        <i class="fas fa-robot text-4xl mb-4 block opacity-50 text-purple-400"></i>
        <p class="text-xl mb-2">No recommendations yet</p>
        <p class="text-sm">Your personalized picks will appear here every Monday</p>
      `;
      container.appendChild(emptyDiv);
      return;
    }

    // Week label
    if (list && list.week_start) {
      const weekLabel = document.createElement('div');
      const weekDate = new Date(list.week_start);
      const endDate = new Date(weekDate);
      endDate.setDate(endDate.getDate() + 6);
      const fmt = { month: 'short', day: 'numeric' };
      weekLabel.className =
        'flex items-center gap-2 mb-4 text-sm text-gray-400';
      weekLabel.innerHTML = `
        <i class="fas fa-wand-magic-sparkles text-purple-400"></i>
        <span>Week of ${weekDate.toLocaleDateString('en-US', fmt)} - ${endDate.toLocaleDateString('en-US', fmt)}</span>
        <span class="text-gray-600">&middot; ${items.length} picks</span>
      `;
      container.appendChild(weekLabel);
    }

    if (isMobile) {
      const cardContainer = document.createElement('div');
      cardContainer.className = 'mobile-album-list';

      items.forEach((item, index) => {
        const card = createMobileCard(item, index);
        cardContainer.appendChild(card);
      });
      container.appendChild(cardContainer);
    } else {
      const table = createDesktopTable(items);
      container.appendChild(table);
    }
  }

  // ============ MOBILE CARDS ============

  /**
   * Create a mobile card for a personal recommendation item.
   * @param {Object} item - Recommendation item
   * @param {number} index - Index
   * @returns {HTMLElement}
   */
  function createMobileCard(item, index) {
    const cardWrapper = document.createElement('div');
    cardWrapper.className = 'album-card-wrapper h-[170px]';

    const card = document.createElement('div');
    card.className = 'album-card album-row relative h-[170px] bg-gray-900';
    card.dataset.albumId = item.album_id;
    card.dataset.personalRecIndex = index;

    const coverSrc = item.album_id
      ? `/api/albums/${encodeURIComponent(item.album_id)}/cover`
      : '';

    const mobileGenre = item.genre_1
      ? escapeHtml(item.genre_1) +
        (item.genre_2 ? ', ' + escapeHtml(item.genre_2) : '')
      : item.genre_2
        ? escapeHtml(item.genre_2)
        : '';

    card.innerHTML = `
      <div class="flex h-full">
        <div class="w-[100px] h-full shrink-0">
          <div class="w-full h-full bg-gray-700 overflow-hidden">
            ${coverSrc ? `<img src="${coverSrc}" alt="${escapeHtml(item.album || '')}" class="w-full h-full object-cover" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'flex items-center justify-center w-full h-full text-gray-500\\'><i class=\\'fas fa-compact-disc text-2xl\\'></i></div>'">` : '<div class="flex items-center justify-center w-full h-full text-gray-500"><i class="fas fa-compact-disc text-2xl"></i></div>'}
          </div>
        </div>
        <div class="flex-1 min-w-0 p-3 flex flex-col justify-center">
          <p class="text-white text-sm font-medium truncate">${escapeHtml(item.album || 'Unknown Album')}</p>
          <p class="text-gray-400 text-xs truncate mt-0.5">${escapeHtml(item.artist || 'Unknown Artist')}</p>
          ${mobileGenre || item.country ? `<p class="text-gray-500 text-xs truncate mt-1">${mobileGenre ? `<i class="fas fa-tag fa-xs mr-1"></i>${mobileGenre}` : ''}${mobileGenre && item.country ? ' <span class="text-gray-600">&middot;</span> ' : ''}${item.country ? `<i class="fas fa-globe fa-xs mr-1"></i>${escapeHtml(item.country)}` : ''}</p>` : ''}
          ${item.reasoning ? `<p class="text-gray-500 text-xs mt-1 line-clamp-2"><i class="fas fa-robot text-purple-400 mr-1"></i>${escapeHtml(item.reasoning)}</p>` : ''}
        </div>
        <div class="w-[25px] shrink-0 flex items-center justify-center">
          <button class="personal-rec-mobile-menu p-2 text-gray-400 active:text-gray-200" data-personal-rec-index="${index}">
            <i class="fas fa-ellipsis-v"></i>
          </button>
        </div>
      </div>
    `;

    // Position badge
    const badge = document.createElement('div');
    const colors =
      index < 3
        ? ['bg-yellow-500', 'bg-gray-300', 'bg-amber-600'][index]
        : 'bg-gray-600';
    badge.className = `absolute top-1 left-1 ${colors} text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center`;
    badge.textContent = index + 1;
    card.querySelector('.flex.h-full').prepend(badge);

    // Mobile menu handler
    const menuBtn = card.querySelector('.personal-rec-mobile-menu');
    if (menuBtn) {
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showMobileMenu(item);
      });
    }

    cardWrapper.appendChild(card);
    return cardWrapper;
  }

  // ============ DESKTOP TABLE ============

  /**
   * Create the desktop table for personal recommendation items.
   * @param {Array} items - Recommendation items
   * @returns {HTMLElement}
   */
  function createDesktopTable(items) {
    const table = document.createElement('table');
    table.className = 'w-full album-table recommendations-table';
    table.innerHTML = `
      <thead>
        <tr class="text-left text-gray-400 text-xs uppercase tracking-wider border-b border-gray-700">
          <th class="py-3 px-2 w-12"></th>
          <th class="py-3 px-2">Artist</th>
          <th class="py-3 px-2">Album</th>
          <th class="py-3 px-2">Genre</th>
          <th class="py-3 px-2">Country</th>
          <th class="py-3 px-2">AI Reasoning</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;

    const tbody = table.querySelector('tbody');

    items.forEach((item, index) => {
      const row = document.createElement('tr');
      row.className =
        'album-row hover:bg-gray-800/50 border-b border-gray-800 cursor-pointer';
      row.dataset.albumId = item.album_id;

      const coverSrc = item.album_id
        ? `/api/albums/${encodeURIComponent(item.album_id)}/cover`
        : '';

      const genreDisplay = item.genre_1
        ? escapeHtml(item.genre_1) +
          (item.genre_2 ? ', ' + escapeHtml(item.genre_2) : '')
        : item.genre_2
          ? escapeHtml(item.genre_2)
          : '';

      row.innerHTML = `
        <td class="py-2 px-2">
          <div class="w-10 h-10 bg-gray-700 rounded overflow-hidden relative">
            ${coverSrc ? `<img src="${coverSrc}" alt="${escapeHtml(item.album || '')}" class="w-full h-full object-cover" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'flex items-center justify-center w-full h-full text-gray-500\\'><i class=\\'fas fa-compact-disc\\'></i></div>'">` : '<div class="flex items-center justify-center w-full h-full text-gray-500"><i class="fas fa-compact-disc"></i></div>'}
          </div>
        </td>
        <td class="py-2 px-2 text-white">${escapeHtml(item.artist || '')}</td>
        <td class="py-2 px-2 text-gray-300">${escapeHtml(item.album || '')}</td>
        <td class="py-2 px-2 text-gray-400 text-sm">${genreDisplay}</td>
        <td class="py-2 px-2 text-gray-400 text-sm">${escapeHtml(item.country || '')}</td>
        <td class="py-2 px-2 text-gray-500 text-sm max-w-xs">
          <span class="flex items-center gap-1">
            <i class="fas fa-robot text-purple-400 text-xs shrink-0"></i>
            <span class="truncate">${item.reasoning ? escapeHtml(item.reasoning) : ''}</span>
            ${item.reasoning ? `<button class="view-reasoning-btn text-gray-500 hover:text-purple-400 p-1 transition-colors shrink-0" title="View full reasoning" data-personal-rec-index="${index}"><i class="fas fa-expand-alt text-xs"></i></button>` : ''}
          </span>
        </td>
      `;

      // Desktop context menu
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showDesktopContextMenu(e, item);
      });

      // View reasoning click
      const reasoningBtn = row.querySelector('.view-reasoning-btn');
      if (reasoningBtn) {
        reasoningBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          showViewReasoningModal({
            artist: item.artist,
            album: item.album,
            reasoning: item.reasoning,
            recommended_by: 'AI',
          });
        });
      }

      tbody.appendChild(row);
    });

    return table;
  }

  // ============ CONTEXT MENUS ============

  /**
   * Show desktop context menu for a personal rec album.
   * @param {Event} e - Mouse event
   * @param {Object} item - Recommendation item
   */
  function showDesktopContextMenu(e, item) {
    hideAllContextMenus();
    currentContext = { item };

    const menu = document.getElementById('personalRecContextMenu');
    if (!menu) return;

    positionContextMenu(menu, e.clientX, e.clientY);
  }

  /**
   * Show mobile action sheet for a personal rec album.
   * @param {Object} item - Recommendation item
   */
  function showMobileMenu(item) {
    currentContext = { item };

    const actions = [
      {
        label: 'Play Album',
        icon: 'fas fa-play',
        handler: () => {
          if (window.playAlbumSafe) {
            window.playAlbumSafe(item.album_id);
          }
        },
      },
      {
        label: 'Add to List...',
        icon: 'fas fa-plus',
        handler: () => showMobileAddToListSheet(item),
      },
      {
        label: 'View AI Reasoning',
        icon: 'fas fa-comment-alt',
        handler: () => {
          showViewReasoningModal({
            artist: item.artist,
            album: item.album,
            reasoning: item.reasoning,
            recommended_by: 'AI',
          });
        },
      },
    ];

    createActionSheet(
      `${item.artist} - ${item.album}`,
      actions.map(
        (a) => `
        <button class="action-sheet-option" data-action="${a.label}">
          <i class="${a.icon} w-5 text-center mr-3"></i>${a.label}
        </button>
      `
      ),
      (el) => {
        el.querySelectorAll('.action-sheet-option').forEach((btn, i) => {
          btn.addEventListener('click', () => {
            actions[i].handler();
            el.remove();
          });
        });
      }
    );
  }

  /**
   * Show mobile "Add to List" sheet.
   * @param {Object} item - Recommendation item
   */
  function showMobileAddToListSheet(item) {
    const allLists = getLists();
    const yearGroups = groupListsByYear
      ? groupListsByYear(allLists)
      : { sortedYears: [], listsByYear: {} };

    const buttons = [];
    const handlers = [];

    yearGroups.sortedYears.forEach((year) => {
      buttons.push(
        `<div class="text-xs text-gray-500 uppercase tracking-wider px-4 py-2">${year}</div>`
      );
      const yearLists = yearGroups.listsByYear[year] || [];
      yearLists.forEach((list) => {
        const listId = list._id || list.id;
        const listName = list.name;
        buttons.push(
          `<button class="action-sheet-option" data-target-list="${listId}">
            <i class="fas fa-list w-5 text-center mr-3"></i>${escapeHtml(listName)}
          </button>`
        );
        handlers.push({ listId, listName });
      });
    });

    createActionSheet('Add to List', buttons, (el) => {
      el.querySelectorAll('[data-target-list]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const targetId = btn.dataset.targetList;
          addPersonalRecToList(targetId, item);
          el.remove();
        });
      });
    });
  }

  /**
   * Add a personal recommendation album to a user's list.
   * @param {string} targetListId - Target list ID
   * @param {Object} item - Recommendation item
   */
  async function addPersonalRecToList(targetListId, item) {
    try {
      const existingData = getListData(targetListId);
      if (existingData && Array.isArray(existingData)) {
        const isDuplicate = existingData.some(
          (a) => a.album_id === item.album_id
        );
        if (isDuplicate) {
          showToast('Album already exists in that list', 'info');
          return;
        }
      }

      const albumToAdd = {
        album_id: item.album_id,
        artist: item.artist,
        album: item.album,
        cover_image: item.cover_image || '',
      };

      await apiCall(`/api/lists/${encodeURIComponent(targetListId)}/items`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ added: [albumToAdd] }),
      });

      // Invalidate cached list data
      setListData(targetListId, null);

      const listName = getLists()[targetListId]?.name || 'list';
      showToast(`Added "${item.album}" to ${listName}`, 'success');
    } catch (err) {
      console.error('Failed to add album to list:', err);
      showToast('Failed to add album to list', 'error');
    }
  }

  /**
   * Initialize context menu event handlers.
   * Called once during DOMContentLoaded.
   */
  function initializePersonalRecContextMenu() {
    const menu = document.getElementById('personalRecContextMenu');
    if (!menu) return;

    const playOption = document.getElementById('playPersonalRecOption');
    const addToListOption = document.getElementById(
      'addPersonalRecToListOption'
    );
    const viewReasoningOption = document.getElementById(
      'viewPersonalRecReasoningOption'
    );

    if (playOption) {
      playOption.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (currentContext?.item && window.playAlbumSafe) {
          window.playAlbumSafe(currentContext.item.album_id);
        }
        hideAllContextMenus();
        currentContext = null;
      });
    }

    if (addToListOption && setupSubmenuHover) {
      setupSubmenuHover(addToListOption, {
        onShow: showPersonalRecAddSubmenu,
        relatedElements: () => [
          document.getElementById('personalRecAddSubmenu'),
        ],
        onHide: () => {
          const submenu = document.getElementById('personalRecAddSubmenu');
          if (submenu) submenu.classList.add('hidden');
          const listsSubmenu = document.getElementById(
            'personalRecAddListsSubmenu'
          );
          if (listsSubmenu) listsSubmenu.classList.add('hidden');
          personalRecAddHighlightedYear = null;
        },
      });
    }

    if (viewReasoningOption) {
      viewReasoningOption.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (currentContext?.item) {
          showViewReasoningModal({
            artist: currentContext.item.artist,
            album: currentContext.item.album,
            reasoning: currentContext.item.reasoning,
            recommended_by: 'AI',
          });
        }
        hideAllContextMenus();
        currentContext = null;
      });
    }
  }

  /**
   * Show the add-to-list year submenu for personal recommendations.
   * Positions the submenu relative to the context menu and populates year buttons.
   */
  function showPersonalRecAddSubmenu() {
    const submenu = document.getElementById('personalRecAddSubmenu');
    const listsSubmenu = document.getElementById('personalRecAddListsSubmenu');
    const addToListOption = document.getElementById(
      'addPersonalRecToListOption'
    );
    const contextMenu = document.getElementById('personalRecContextMenu');

    if (!submenu || !addToListOption || !contextMenu) return;

    if (listsSubmenu) {
      listsSubmenu.classList.add('hidden');
    }

    personalRecAddHighlightedYear = null;

    addToListOption.classList.add('bg-gray-700', 'text-white');

    const allLists = getLists();
    const yearGroups = groupListsByYear
      ? groupListsByYear(allLists)
      : { sortedYears: [], listsByYear: {} };

    if (yearGroups.sortedYears.length === 0) {
      submenu.innerHTML =
        '<div class="px-4 py-2 text-sm text-gray-500">No lists available</div>';
    } else {
      submenu.innerHTML = yearGroups.sortedYears
        .map(
          (year) => `
          <button class="flex items-center justify-between w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap" data-personal-rec-add-year="${year}">
            <span>${year}</span>
            <i class="fas fa-chevron-right text-xs ml-3 text-gray-500"></i>
          </button>
        `
        )
        .join('');

      submenu
        .querySelectorAll('[data-personal-rec-add-year]')
        .forEach((btn) => {
          btn.addEventListener('mouseenter', () => {
            if (personalRecAddListsHideTimeout) {
              clearTimeout(personalRecAddListsHideTimeout);
              personalRecAddListsHideTimeout = null;
            }
            const year = btn.dataset.personalRecAddYear;
            showPersonalRecAddListsSubmenu(
              year,
              btn,
              yearGroups.listsByYear,
              submenu
            );
          });

          btn.addEventListener('mouseleave', (e) => {
            const listsMenu = document.getElementById(
              'personalRecAddListsSubmenu'
            );
            const toListsSubmenu =
              listsMenu &&
              (e.relatedTarget === listsMenu ||
                listsMenu.contains(e.relatedTarget));

            if (!toListsSubmenu) {
              personalRecAddListsHideTimeout = setTimeout(() => {
                if (listsMenu) listsMenu.classList.add('hidden');
                btn.classList.remove('bg-gray-700', 'text-white');
                personalRecAddHighlightedYear = null;
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
   * Show the lists submenu for a specific year in the personal rec add-to-list flow.
   * @param {string} year - The year to show lists for
   * @param {HTMLElement} yearButton - The year button element
   * @param {Object} listsByYear - Map of year to list arrays
   * @param {HTMLElement} yearSubmenu - The year submenu element
   */
  function showPersonalRecAddListsSubmenu(
    year,
    yearButton,
    listsByYear,
    yearSubmenu
  ) {
    const listsSubmenu = document.getElementById('personalRecAddListsSubmenu');

    if (!listsSubmenu || !yearSubmenu) return;

    // Remove highlight from previously highlighted year
    if (
      personalRecAddHighlightedYear &&
      personalRecAddHighlightedYear !== year
    ) {
      const prevBtn = yearSubmenu.querySelector(
        `[data-personal-rec-add-year="${personalRecAddHighlightedYear}"]`
      );
      if (prevBtn) {
        prevBtn.classList.remove('bg-gray-700', 'text-white');
      }
    }

    yearButton.classList.add('bg-gray-700', 'text-white');
    personalRecAddHighlightedYear = year;

    const yearLists = listsByYear[year] || [];

    if (yearLists.length === 0) {
      listsSubmenu.classList.add('hidden');
      return;
    }

    listsSubmenu.innerHTML = yearLists
      .map((list) => {
        const listId = list._id || list.id;
        return `
        <button class="block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap w-full" data-personal-rec-add-target-list="${listId}">
          <span class="mr-2">\u2022</span>${escapeHtml(list.name)}
        </button>
      `;
      })
      .join('');

    listsSubmenu
      .querySelectorAll('[data-personal-rec-add-target-list]')
      .forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const targetListId = btn.dataset.personalRecAddTargetList;

          hideAllContextMenus();

          if (currentContext?.item) {
            await addPersonalRecToList(targetListId, currentContext.item);
          }
          currentContext = null;
        });
      });

    // Coordinate mouse events between year submenu and lists submenu
    listsSubmenu.onmouseenter = () => {
      if (personalRecAddListsHideTimeout) {
        clearTimeout(personalRecAddListsHideTimeout);
        personalRecAddListsHideTimeout = null;
      }
    };

    listsSubmenu.onmouseleave = (e) => {
      const yearMenu = document.getElementById('personalRecAddSubmenu');
      const toYearSubmenu =
        yearMenu &&
        (e.relatedTarget === yearMenu || yearMenu.contains(e.relatedTarget));

      if (!toYearSubmenu) {
        personalRecAddListsHideTimeout = setTimeout(() => {
          listsSubmenu.classList.add('hidden');
          if (personalRecAddHighlightedYear) {
            const yearBtn = yearMenu?.querySelector(
              `[data-personal-rec-add-year="${personalRecAddHighlightedYear}"]`
            );
            if (yearBtn) {
              yearBtn.classList.remove('bg-gray-700', 'text-white');
            }
            personalRecAddHighlightedYear = null;
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

  /**
   * Fetch personal recommendation lists for sidebar display.
   * Called during loadLists().
   * @returns {Promise<Array>} Personal rec lists
   */
  async function fetchPersonalRecLists() {
    try {
      const response = await apiCall('/api/personal-recommendations');
      const lists = response.lists || [];
      setPersonalRecLists(lists);
      return lists;
    } catch (_err) {
      // Non-critical - feature may be disabled
      setPersonalRecLists([]);
      return [];
    }
  }

  /**
   * Get the context for external use.
   * @returns {Object|null}
   */
  function getContext() {
    return currentContext;
  }

  /**
   * Clear the context.
   */
  function clearContext() {
    currentContext = null;
  }

  return {
    selectPersonalRecList,
    displayPersonalRecs,
    initializePersonalRecContextMenu,
    fetchPersonalRecLists,
    addPersonalRecToList,
    getContext,
    clearContext,
  };
}
