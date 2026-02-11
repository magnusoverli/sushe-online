/**
 * List Navigation Module
 *
 * Handles sidebar navigation rendering, year grouping, expand/collapse state,
 * and list button interactions. Uses dependency injection for testability.
 *
 * @module list-nav
 */

/**
 * Factory function to create the list navigation module with injected dependencies
 *
 * @param {Object} deps - Dependencies
 * @param {Function} deps.getLists - Get all lists object
 * @param {Function} deps.getListMetadata - Get metadata for a list
 * @param {Function} deps.getGroups - Get all groups object
 * @param {Function} deps.getSortedGroups - Get groups sorted by sort_order
 * @param {Function} deps.getCurrentList - Get current list name
 * @param {Function} deps.selectList - Select a list
 * @param {Function} deps.getListMenuConfig - Get list menu configuration
 * @param {Function} deps.hideAllContextMenus - Hide all context menus
 * @param {Function} deps.positionContextMenu - Position a context menu
 * @param {Function} deps.toggleMobileLists - Toggle mobile list panel
 * @param {Function} deps.setCurrentContextList - Set current context list
 * @param {Function} deps.setCurrentContextGroup - Set current context group for category menus
 * @param {Function} deps.apiCall - Make API calls
 * @param {Function} deps.showToast - Show toast notifications
 * @param {Function} deps.refreshGroupsAndLists - Refresh groups and lists from server
 * @param {Function} deps.yearHasRecommendations - Check if a year has recommendations
 * @returns {Object} List navigation module API
 */
export function createListNav(deps = {}) {
  const {
    getLists,
    getListMetadata,
    getGroups,
    getSortedGroups,
    getCurrentList,
    selectList,
    getListMenuConfig,
    hideAllContextMenus,
    positionContextMenu,
    toggleMobileLists,
    setCurrentContextList,
    setCurrentContextGroup,
    apiCall,
    showToast,
    refreshGroupsAndLists,
    yearHasRecommendations,
  } = deps;

  // Track sortable instances for cleanup
  let groupsSortable = null;
  const listSortables = new Map();

  // ============ EXPAND STATE MANAGEMENT ============

  /**
   * Get expand/collapse state from localStorage
   * @returns {Object} State object with group ID keys and boolean values
   */
  function getGroupExpandState() {
    try {
      // Try new key first, fall back to old key for migration
      let state = localStorage.getItem('groupExpandState');
      if (!state) {
        // Migrate from old yearExpandState
        state = localStorage.getItem('yearExpandState');
        if (state) {
          // Convert year keys to group IDs if possible
          // For now, just use the old state structure
          localStorage.setItem('groupExpandState', state);
          localStorage.removeItem('yearExpandState');
        }
      }
      return state ? JSON.parse(state) : {};
    } catch (_e) {
      return {};
    }
  }

  /**
   * Save expand/collapse state to localStorage
   * @param {Object} state - State object to save
   */
  function saveGroupExpandState(state) {
    try {
      localStorage.setItem('groupExpandState', JSON.stringify(state));
    } catch (_e) {
      // Silently fail if localStorage is full
    }
  }

  /**
   * Toggle group section expand/collapse
   * @param {string} groupId - Group ID or group name for legacy support
   * @param {HTMLElement} container - Container element
   */
  function toggleGroupSection(groupId, container) {
    const state = getGroupExpandState();
    const isExpanded = state[groupId] !== false; // Default to expanded
    state[groupId] = !isExpanded;
    saveGroupExpandState(state);

    // Update UI
    const section = container.querySelector(
      `[data-group-section="${groupId}"]`
    );
    if (section) {
      const listsContainer = section.querySelector('.group-lists');
      const chevron = section.querySelector('.group-chevron');
      if (listsContainer) {
        listsContainer.classList.toggle('hidden', isExpanded);
      }
      if (chevron) {
        chevron.classList.toggle('fa-chevron-right', isExpanded);
        chevron.classList.toggle('fa-chevron-down', !isExpanded);
      }
    }
  }

  // Legacy function for backward compatibility during transition
  function getYearExpandState() {
    return getGroupExpandState();
  }

  function saveYearExpandState(state) {
    saveGroupExpandState(state);
  }

  function toggleYearSection(year, container) {
    // Find the section by year data attribute for legacy support
    const section = container.querySelector(`[data-year-section="${year}"]`);
    if (section) {
      const groupId = section.getAttribute('data-group-id') || year;
      toggleGroupSection(groupId, container);
    }
  }

  // ============ LIST GROUPING ============

  /**
   * Group lists by their assigned groups
   * Lists are now keyed by _id (not name) to support duplicate names in different categories
   * @returns {Object} { groups: Array of group objects with lists, orphaned: Array }
   */
  function groupListsByGroup() {
    const lists = getLists();
    const allGroups = getGroups ? getGroups() : {};
    const sortedGroups = getSortedGroups ? getSortedGroups() : [];

    // Create a map of groupId -> lists
    const listsByGroupId = {};
    const orphaned = [];

    // lists is now keyed by listId, not name
    Object.keys(lists).forEach((listId) => {
      const meta = getListMetadata(listId);
      const groupId = meta?.groupId;

      if (groupId && allGroups[groupId]) {
        if (!listsByGroupId[groupId]) {
          listsByGroupId[groupId] = [];
        }
        // Include both _id and name for use in rendering
        listsByGroupId[groupId].push({
          _id: listId,
          name: meta?.name || 'Unknown',
          meta,
        });
      } else {
        orphaned.push({ _id: listId, name: meta?.name || 'Unknown', meta });
      }
    });

    // Sort lists within each group by sortOrder
    Object.keys(listsByGroupId).forEach((groupId) => {
      listsByGroupId[groupId].sort(
        (a, b) => (a.meta?.sortOrder || 0) - (b.meta?.sortOrder || 0)
      );
    });

    // Build the result array using sorted groups
    const groupsWithLists = sortedGroups.map((group) => ({
      ...group,
      lists: listsByGroupId[group._id] || [],
    }));

    return { groups: groupsWithLists, orphaned };
  }

  /**
   * Legacy function: Group lists by year (for backward compatibility)
   * @returns {Object} { listsByYear: Object, uncategorized: Array, sortedYears: Array }
   */
  function groupListsByYear() {
    // If groups are available, use the new system
    if (getGroups && getSortedGroups) {
      const { groups: groupsWithLists, orphaned } = groupListsByGroup();

      // Convert to legacy format for backward compatibility
      const listsByYear = {};
      const uncategorized = [...orphaned];
      const sortedYears = [];

      groupsWithLists.forEach((group) => {
        if (group.isYearGroup && group.year) {
          listsByYear[group.year] = group.lists;
          sortedYears.push(String(group.year));
        } else {
          // Collections go to uncategorized in legacy view
          uncategorized.push(...group.lists);
        }
      });

      // Sort years descending
      sortedYears.sort((a, b) => parseInt(b) - parseInt(a));

      return { listsByYear, uncategorized, sortedYears };
    }

    // Fallback to old behavior if groups not available
    // lists is now keyed by listId, not name
    const lists = getLists();
    const listsByYear = {};
    const uncategorized = [];

    Object.keys(lists).forEach((listId) => {
      const meta = getListMetadata(listId);
      const year = meta?.year;

      if (year) {
        if (!listsByYear[year]) {
          listsByYear[year] = [];
        }
        listsByYear[year].push({
          _id: listId,
          name: meta?.name || 'Unknown',
          meta,
        });
      } else {
        uncategorized.push({
          _id: listId,
          name: meta?.name || 'Unknown',
          meta,
        });
      }
    });

    // Sort years descending
    const sortedYears = Object.keys(listsByYear).sort(
      (a, b) => parseInt(b) - parseInt(a)
    );

    return { listsByYear, uncategorized, sortedYears };
  }

  // ============ HTML GENERATION ============

  /**
   * Generate HTML for group section header
   * @param {string} name - Group name
   * @param {boolean} isExpanded - Whether section is expanded
   * @param {boolean} isYearGroup - Whether this is a year-based group
   * @param {boolean} isMobile - Whether rendering for mobile
   * @param {string} groupId - Group ID for menu button
   * @returns {string} HTML string
   */
  function createGroupHeaderHTML(
    name,
    isExpanded,
    isYearGroup,
    isMobile = false,
    groupId = ''
  ) {
    const chevronClass = isExpanded ? 'fa-chevron-down' : 'fa-chevron-right';
    const iconClass = isYearGroup ? 'fa-calendar-alt' : 'fa-folder';

    // For mobile: show menu button (menu accessed via click)
    // For desktop: no right-side element (menu accessed via right-click)
    // Don't show menu button for virtual "Uncategorized" group (orphaned lists)
    const rightSide =
      isMobile && groupId && groupId !== 'orphaned'
        ? `<button data-category-menu-btn="${groupId}" class="p-1 text-gray-400 active:text-gray-200 no-drag shrink-0 category-menu-btn" aria-label="Category options">
          <i class="fas fa-ellipsis-v text-xs"></i>
        </button>`
        : '';

    return `
      <div class="flex items-center flex-1 min-w-0">
        <i class="fas ${chevronClass} mr-2 text-xs group-chevron shrink-0"></i>
        <i class="fas ${iconClass} mr-2 text-xs text-gray-500 shrink-0"></i>
        <span class="truncate">${name}</span>
      </div>
      ${rightSide}
    `;
  }

  /**
   * Legacy: Generate HTML for year section header
   * @param {string} year - Year label
   * @param {boolean} isExpanded - Whether section is expanded
   * @param {boolean} isMobile - Whether rendering for mobile
   * @param {string} groupId - Group ID for menu button
   * @returns {string} HTML string
   */
  function createYearHeaderHTML(
    year,
    isExpanded,
    isMobile = false,
    groupId = ''
  ) {
    return createGroupHeaderHTML(year, isExpanded, true, isMobile, groupId);
  }

  /**
   * Generate HTML for recommendations button
   * @param {number} year - Year for recommendations
   * @param {boolean} isActive - Whether recommendations is currently selected
   * @param {boolean} isMobile - Whether rendering for mobile
   * @returns {string} HTML string
   */
  function createRecommendationsButtonHTML(year, isActive, isMobile) {
    const paddingClass = isMobile ? 'py-3' : 'py-2';
    const widthClass = isMobile ? 'flex-1' : 'w-full';
    const activeClass = isActive ? 'active' : '';

    return `
      <button data-recommendations-year="${year}" class="recommendations-btn ${widthClass} text-left px-3 ${paddingClass} rounded-sm text-sm transition duration-200 text-gray-300 ${activeClass} flex items-center">
        <i class="fas fa-thumbs-up mr-2 shrink-0 text-blue-400"></i>
        <span class="truncate flex-1">Recommendations</span>
      </button>
    `;
  }

  /**
   * Generate HTML for list button
   * @param {string} listId - List ID
   * @param {string} listName - List name (for display)
   * @param {boolean} isActive - Whether list is currently selected
   * @param {boolean} isMain - Whether list is marked as main
   * @param {boolean} isMobile - Whether rendering for mobile
   * @returns {string} HTML string
   */
  function createListButtonHTML(listId, listName, isActive, isMain, isMobile) {
    const paddingClass = isMobile ? 'py-3' : 'py-2';
    const widthClass = isMobile ? 'flex-1' : 'w-full';
    const activeClass = isActive ? 'active' : '';
    const mainBadge = isMain
      ? '<i class="fas fa-star text-yellow-500 ml-1 shrink-0 text-xs" title="Main list"></i>'
      : '';

    // Use data-list-id for the ID, keep data-list-name for display/logging purposes
    const buttonHTML = `
      <button data-list-id="${listId}" data-list-name="${listName}" class="sidebar-list-btn ${widthClass} text-left px-3 ${paddingClass} rounded-sm text-sm transition duration-200 text-gray-300 ${activeClass} flex items-center">
        <i class="fas fa-list mr-2 shrink-0"></i>
        <span class="truncate flex-1">${listName}</span>
        ${mainBadge}
      </button>
    `;

    if (isMobile) {
      return `
        ${buttonHTML}
        <button data-list-menu-btn="${listId}" data-list-menu-name="${listName}" class="p-2 text-gray-400 active:text-gray-200 no-drag shrink-0" aria-label="List options">
          <i class="fas fa-ellipsis-v"></i>
        </button>
      `;
    }

    return buttonHTML;
  }

  // ============ LIST BUTTON CREATION ============

  /**
   * Create a list button element with event handlers
   * @param {string} listId - List ID
   * @param {boolean} isMobile - Whether rendering for mobile
   * @param {HTMLElement} _container - Parent container (unused but kept for signature compatibility)
   * @returns {HTMLElement} List item element
   */
  function createListButton(listId, isMobile, _container) {
    const meta = getListMetadata(listId);
    const listName = meta?.name || 'Unknown';
    const isMain = meta?.isMain || false;
    const currentListId = getCurrentList();
    const isActive = currentListId === listId;
    const li = document.createElement('li');

    if (isMobile) {
      li.className = 'flex items-center';
    }
    li.innerHTML = createListButtonHTML(
      listId,
      listName,
      isActive,
      isMain,
      isMobile
    );

    const button = li.querySelector('[data-list-id]');
    const menuButton = li.querySelector('[data-list-menu-btn]');

    if (!isMobile) {
      // Desktop: attach right-click context menu
      attachDesktopContextMenu(button, listId);
    } else {
      // Mobile: attach click handler to three-dot menu button
      attachMobileMenuButton(menuButton, listId);
    }

    // Click handler for selecting the list
    button.onclick = () => {
      selectList(listId);
      if (isMobile) toggleMobileLists();
    };

    return li;
  }

  /**
   * Attach desktop context menu to button
   * @param {HTMLElement} button - Button element
   * @param {string} listId - List ID
   */
  function attachDesktopContextMenu(button, listId) {
    button.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();

      hideAllContextMenus();
      setCurrentContextList(listId);

      const contextMenu = document.getElementById('contextMenu');
      if (!contextMenu) return;

      // Get shared menu configuration
      const menuConfig = getListMenuConfig(listId);

      // Update the playlist option text based on user's music service
      const updatePlaylistText = document.getElementById('updatePlaylistText');
      if (updatePlaylistText) {
        updatePlaylistText.textContent = menuConfig.musicServiceText;
      }

      // Update the toggle main option text based on current status
      const toggleMainText = document.getElementById('toggleMainText');
      const toggleMainOption = document.getElementById('toggleMainOption');
      if (toggleMainText && toggleMainOption) {
        toggleMainText.textContent = menuConfig.mainToggleText;
        const icon = toggleMainOption.querySelector('i');
        icon.classList.remove('fa-star', 'fa-star-half-alt');
        icon.classList.add(menuConfig.mainIconClass);

        // Hide option if list has no year (can't be main)
        if (!menuConfig.hasYear) {
          toggleMainOption.classList.add('hidden');
        } else {
          toggleMainOption.classList.remove('hidden');
        }
      }

      // Show/hide move to collection option based on whether list is in a collection
      const moveListOption = document.getElementById('moveListOption');
      if (moveListOption) {
        if (menuConfig.isInCollection) {
          moveListOption.classList.remove('hidden');
        } else {
          moveListOption.classList.add('hidden');
        }
      }

      // Position the menu at cursor
      positionContextMenu(contextMenu, e.clientX, e.clientY);
    });
  }

  /**
   * Attach mobile menu button handlers
   * @param {HTMLElement} menuButton - Menu button element
   * @param {string} listId - List ID
   */
  function attachMobileMenuButton(menuButton, listId) {
    if (!menuButton) return;

    // Prevent touch events from bubbling to parent
    menuButton.addEventListener(
      'touchstart',
      (e) => {
        e.stopPropagation();
      },
      { passive: true }
    );

    menuButton.addEventListener(
      'touchend',
      (e) => {
        e.stopPropagation();
      },
      { passive: true }
    );

    menuButton.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (window.showMobileListMenu) {
        window.showMobileListMenu(listId);
      }
    });
  }

  // ============ GROUP SECTION RENDERING ============

  /**
   * Create a group section element
   * @param {Object} group - Group object { _id, name, year, isYearGroup, lists }
   * @param {boolean} isMobile - Whether rendering for mobile
   * @param {HTMLElement} container - Parent container
   * @returns {HTMLElement} Section element
   */
  function createGroupSection(group, isMobile, container) {
    const { _id, name, year, isYearGroup, lists: groupLists } = group;
    const expandState = getGroupExpandState();
    const stateKey = _id || name; // Use ID if available, fall back to name
    const isExpanded = expandState[stateKey] !== false; // Default to expanded

    const section = document.createElement('div');
    section.className = `group-section mb-1 ${isYearGroup ? 'year-group' : 'collection-group'}`;
    section.setAttribute('data-group-section', stateKey);
    section.setAttribute('data-group-id', _id || '');
    if (year) {
      section.setAttribute('data-year-section', year); // Legacy support
    }

    // Group header - use div wrapper for proper layout with menu button
    const headerWrapper = document.createElement('div');
    headerWrapper.className = 'group-header-wrapper flex items-center';

    const header = document.createElement('button');
    const paddingClass = isMobile ? 'py-2' : 'py-1.5';
    header.className = `group-header-btn flex-1 text-left px-3 ${paddingClass} rounded-sm text-sm transition duration-200 text-white flex items-center justify-between font-bold`;
    header.innerHTML = createGroupHeaderHTML(
      name,
      isExpanded,
      isYearGroup,
      isMobile,
      _id || ''
    );

    // Click handler for expand/collapse (not on the menu button)
    header.onclick = (e) => {
      // Don't toggle if clicking the menu button
      if (e.target.closest('[data-category-menu-btn]')) {
        return;
      }
      e.preventDefault();
      toggleGroupSection(stateKey, container);
    };

    // Desktop: right-click context menu on header
    // Don't show context menu for virtual "Uncategorized" group (orphaned lists)
    if (!isMobile && _id && _id !== 'orphaned') {
      header.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        showCategoryContextMenu(_id, name, isYearGroup, e.clientX, e.clientY);
      };
    } else {
      header.oncontextmenu = (e) => e.preventDefault();
    }

    headerWrapper.appendChild(header);

    // Mobile: attach click handler to menu button
    // Don't show menu button for virtual "Uncategorized" group (orphaned lists)
    if (isMobile && _id && _id !== 'orphaned') {
      // Use event delegation - attach handler after appending to section
      setTimeout(() => {
        const menuBtn = header.querySelector(
          `[data-category-menu-btn="${_id}"]`
        );
        if (menuBtn) {
          attachCategoryMenuButton(menuBtn, _id, name, isYearGroup);
        }
      }, 0);
    }

    section.appendChild(headerWrapper);

    // Lists container
    const listsContainer = document.createElement('ul');
    listsContainer.className = `group-lists pl-4 ${isExpanded ? '' : 'hidden'}`;
    // Add legacy class for CSS compatibility
    if (isYearGroup) {
      listsContainer.classList.add('year-lists');
    }

    groupLists.forEach(({ _id: listId }) => {
      const li = createListButton(listId, isMobile, container);
      listsContainer.appendChild(li);
    });

    // Add recommendations button at the bottom of year groups (only if recommendations exist)
    if (isYearGroup && year) {
      const hasRecs = yearHasRecommendations && yearHasRecommendations(year);
      if (hasRecs) {
        const recommendationsLi = createRecommendationsButton(year, isMobile);
        listsContainer.appendChild(recommendationsLi);
      }
    }

    section.appendChild(listsContainer);
    return section;
  }

  /**
   * Create a recommendations button element with event handlers
   * @param {number} year - Year for recommendations
   * @param {boolean} isMobile - Whether rendering for mobile
   * @returns {HTMLElement} List item element
   */
  function createRecommendationsButton(year, isMobile) {
    // Check if recommendations is currently active for this year
    const currentRecommendationsYear = window.currentRecommendationsYear;
    const isActive = currentRecommendationsYear === year;

    const li = document.createElement('li');
    if (isMobile) {
      li.className = 'flex items-center';
    }
    li.innerHTML = createRecommendationsButtonHTML(year, isActive, isMobile);

    const button = li.querySelector('[data-recommendations-year]');

    // Click handler for selecting recommendations
    button.onclick = () => {
      if (window.selectRecommendations) {
        window.selectRecommendations(year);
      }
      if (isMobile && toggleMobileLists) {
        toggleMobileLists();
      }
    };

    return li;
  }

  /**
   * Show category context menu (desktop)
   * @param {string} groupId - Group ID
   * @param {string} groupName - Group name
   * @param {boolean} isYearGroup - Whether this is a year group
   * @param {number} x - X position
   * @param {number} y - Y position
   */
  function showCategoryContextMenu(groupId, groupName, isYearGroup, x, y) {
    // Don't show menu for virtual "Uncategorized" group (orphaned lists)
    if (groupId === 'orphaned') {
      return;
    }

    hideAllContextMenus();

    if (setCurrentContextGroup) {
      setCurrentContextGroup({ id: groupId, name: groupName, isYearGroup });
    }

    const contextMenu = document.getElementById('categoryContextMenu');
    if (!contextMenu) return;

    // Update menu options based on group type
    const deleteOption = document.getElementById('deleteCategoryOption');
    const renameOption = document.getElementById('renameCategoryOption');

    if (deleteOption) {
      // Year groups can't be manually deleted
      if (isYearGroup) {
        deleteOption.classList.add('hidden');
      } else {
        deleteOption.classList.remove('hidden');
      }
    }

    if (renameOption) {
      // Year groups can't be renamed (name must match year)
      if (isYearGroup) {
        renameOption.classList.add('hidden');
      } else {
        renameOption.classList.remove('hidden');
      }
    }

    positionContextMenu(contextMenu, x, y);
  }

  /**
   * Attach mobile menu button handlers for category
   * @param {HTMLElement} menuButton - Menu button element
   * @param {string} groupId - Group ID
   * @param {string} groupName - Group name
   * @param {boolean} isYearGroup - Whether this is a year group
   */
  function attachCategoryMenuButton(
    menuButton,
    groupId,
    groupName,
    isYearGroup
  ) {
    if (!menuButton) return;

    // Don't attach menu for virtual "Uncategorized" group (orphaned lists)
    if (groupId === 'orphaned') {
      return;
    }

    // Prevent touch events from bubbling to parent (which would toggle expand)
    menuButton.addEventListener(
      'touchstart',
      (e) => {
        e.stopPropagation();
      },
      { passive: true }
    );

    menuButton.addEventListener(
      'touchend',
      (e) => {
        e.stopPropagation();
      },
      { passive: true }
    );

    menuButton.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (window.showMobileCategoryMenu) {
        window.showMobileCategoryMenu(groupId, groupName, isYearGroup);
      }
    });
  }

  /**
   * Legacy: Create a year section element
   * @param {string} year - Year label
   * @param {Array} yearLists - Lists for this year
   * @param {boolean} isMobile - Whether rendering for mobile
   * @param {HTMLElement} container - Parent container
   * @returns {HTMLElement} Section element
   */
  function createYearSection(year, yearLists, isMobile, container) {
    // Convert to group format and use createGroupSection
    const group = {
      _id: null,
      name: year,
      year: year === 'uncategorized' ? null : parseInt(year, 10),
      isYearGroup: year !== 'uncategorized',
      lists: yearLists,
    };
    return createGroupSection(group, isMobile, container);
  }

  // ============ MAIN RENDER FUNCTION ============

  /**
   * Render list items into a container
   * @param {HTMLElement} container - Container element
   * @param {boolean} isMobile - Whether rendering for mobile
   */
  function renderListItems(container, isMobile = false) {
    container.innerHTML = '';

    // Use new group-based rendering if groups are available
    if (getGroups && getSortedGroups) {
      const { groups: groupsWithLists, orphaned } = groupListsByGroup();

      // Render each group section
      // Show all collections (even empty), but only show year-groups with lists
      groupsWithLists.forEach((group) => {
        if (group.lists.length > 0 || !group.isYearGroup) {
          const section = createGroupSection(group, isMobile, container);
          container.appendChild(section);
        }
      });

      // Add orphaned lists if any (shouldn't happen after migration)
      if (orphaned.length > 0) {
        const orphanedGroup = {
          _id: 'orphaned',
          name: 'Uncategorized',
          year: null,
          isYearGroup: false,
          lists: orphaned,
        };
        const section = createGroupSection(orphanedGroup, isMobile, container);
        container.appendChild(section);
      }

      return;
    }

    // Legacy fallback: use year-based rendering
    const { listsByYear, uncategorized, sortedYears } = groupListsByYear();

    // Create year sections
    sortedYears.forEach((year) => {
      const yearLists = listsByYear[year];
      const section = createYearSection(year, yearLists, isMobile, container);
      container.appendChild(section);
    });

    // Add uncategorized section if there are any
    if (uncategorized.length > 0) {
      const section = createYearSection(
        'uncategorized',
        uncategorized.map((item) => ({ name: item.name })),
        isMobile,
        container
      );
      container.appendChild(section);
    }
  }

  /**
   * Update sidebar navigation with year tree view
   */
  function updateListNav() {
    const nav = document.getElementById('listNav');
    const mobileNav = document.getElementById('mobileListNav');

    // Clean up existing sortables before re-rendering
    destroySortables();

    if (nav) renderListItems(nav, false);
    if (mobileNav) renderListItems(mobileNav, true);

    // Initialize drag-and-drop for both desktop and mobile
    if (nav && apiCall) {
      initializeDragAndDrop(nav, false);
    }
    if (mobileNav && apiCall) {
      initializeDragAndDrop(mobileNav, true);
    }

    // Cache list names locally for faster startup
    cacheListNames();
  }

  // ============ DRAG AND DROP ============

  /**
   * Destroy all sortable instances
   */
  function destroySortables() {
    if (groupsSortable) {
      groupsSortable.destroy();
      groupsSortable = null;
    }
    listSortables.forEach((sortable) => sortable.destroy());
    listSortables.clear();
  }

  /**
   * Initialize drag-and-drop for the sidebar
   * @param {HTMLElement} container - The sidebar container
   * @param {boolean} isMobile - Whether this is mobile view
   */
  function initializeDragAndDrop(container, isMobile = false) {
    if (!window.Sortable) {
      console.warn('SortableJS not loaded, drag-and-drop disabled');
      return;
    }

    // Initialize sortable for groups (reorder groups)
    initializeGroupsSortable(container, isMobile);

    // Initialize sortable for lists within each group
    const groupSections = container.querySelectorAll('.group-section');
    groupSections.forEach((section) => {
      const groupId = section.getAttribute('data-group-id');
      if (groupId) {
        initializeListsSortable(section, groupId, isMobile);
      }
    });

    // Mobile: handle scroll vs drag conflict
    if (isMobile) {
      setupMobileTouchHandling(container);
    }
  }

  /**
   * Setup mobile touch handling for scroll vs drag conflict
   * Allows scrolling for the first 200ms, then blocks it for drag
   * @param {HTMLElement} container - The sidebar container
   */
  function setupMobileTouchHandling(container) {
    const SCROLL_GRACE_PERIOD = 200; // ms - allow scroll during this initial period
    let touchState = null;

    const onTouchStart = (e) => {
      const item = e.target.closest('.group-section, .group-lists > li');
      if (
        !item ||
        e.target.closest(
          'button, .no-drag, [data-list-menu-btn], [data-category-menu-btn]'
        )
      ) {
        return;
      }
      touchState = { startTime: Date.now() };
    };

    const onTouchMove = (e) => {
      if (!touchState) return;
      const elapsed = Date.now() - touchState.startTime;
      // Allow scroll during grace period, block after (for drag)
      if (elapsed >= SCROLL_GRACE_PERIOD) {
        e.preventDefault();
      }
    };

    const onTouchEnd = () => {
      touchState = null;
    };

    // Use passive for start/end, non-passive for move to allow preventDefault
    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd, { passive: true });
  }

  /**
   * Initialize sortable for reordering groups
   * @param {HTMLElement} container - The sidebar container
   * @param {boolean} isMobile - Whether this is mobile view
   */
  function initializeGroupsSortable(container, isMobile = false) {
    // Mobile-specific SortableJS options
    const mobileOptions = isMobile
      ? {
          delay: 300, // 300ms touch-and-hold delay
          delayOnTouchOnly: true,
          touchStartThreshold: 10, // Allow 10px movement before cancelling drag
          forceFallback: true,
          fallbackTolerance: 5,
        }
      : {};

    groupsSortable = new window.Sortable(container, {
      animation: 150,
      handle: '.group-header-wrapper', // Drag by the header wrapper, not entire section
      draggable: '.group-section',
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      filter:
        '.group-lists, .category-menu-btn, [data-category-menu-btn], .no-drag', // Exclude list items and menu buttons
      preventOnFilter: false,
      ...mobileOptions,
      onStart: function (evt) {
        // Mobile haptic feedback
        if (isMobile && navigator.vibrate) {
          navigator.vibrate(50);
        }
        evt.item.classList.add('sidebar-dragging');
      },
      onEnd: async (evt) => {
        evt.item.classList.remove('sidebar-dragging');

        if (evt.oldIndex === evt.newIndex) return;

        // Get the new order of group IDs
        const sections = container.querySelectorAll('.group-section');
        const newOrder = Array.from(sections)
          .map((s) => s.getAttribute('data-group-id'))
          .filter((id) => id && id !== 'orphaned');

        try {
          await apiCall('/api/groups/reorder', {
            method: 'POST',
            body: JSON.stringify({ order: newOrder }),
          });

          // Update local state
          if (refreshGroupsAndLists) {
            await refreshGroupsAndLists();
          }
        } catch (err) {
          console.error('Failed to reorder groups:', err);
          if (showToast) {
            showToast('Failed to reorder groups', 'error');
          }
          // Refresh to restore original order
          updateListNav();
        }
      },
    });
  }

  /**
   * Initialize sortable for reordering lists within a group
   * @param {HTMLElement} section - The group section element
   * @param {string} groupId - The group ID
   * @param {boolean} isMobile - Whether this is mobile view
   */
  function initializeListsSortable(section, groupId, isMobile = false) {
    const listsContainer = section.querySelector('.group-lists');
    if (!listsContainer) return;

    // Mobile-specific SortableJS options
    const mobileOptions = isMobile
      ? {
          delay: 300, // 300ms touch-and-hold delay
          delayOnTouchOnly: true,
          touchStartThreshold: 10, // Allow 10px movement before cancelling drag
          forceFallback: true,
          fallbackTolerance: 5,
        }
      : {};

    const sortable = new window.Sortable(listsContainer, {
      group: 'lists', // Allow dragging between groups
      animation: 150,
      handle: '.sidebar-list-btn',
      draggable: 'li',
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      filter: '[data-list-menu-btn], .no-drag', // Exclude menu buttons
      preventOnFilter: false,
      ...mobileOptions,
      onStart: function (evt) {
        // Mobile haptic feedback
        if (isMobile && navigator.vibrate) {
          navigator.vibrate(50);
        }
        evt.item.classList.add('sidebar-list-dragging');
      },
      onEnd: async (evt) => {
        evt.item.classList.remove('sidebar-list-dragging');

        const listId = evt.item
          .querySelector('[data-list-id]')
          ?.getAttribute('data-list-id');
        if (!listId) return;

        const fromGroupId = evt.from
          .closest('.group-section')
          ?.getAttribute('data-group-id');
        const toGroupId = evt.to
          .closest('.group-section')
          ?.getAttribute('data-group-id');

        // Check if moved to a different group
        if (fromGroupId !== toGroupId && toGroupId) {
          // Move list to new group
          try {
            await apiCall(`/api/lists/${encodeURIComponent(listId)}/move`, {
              method: 'POST',
              body: JSON.stringify({ groupId: toGroupId }),
            });

            if (showToast) {
              showToast('List moved successfully', 'success');
            }

            // Refresh to update state
            if (refreshGroupsAndLists) {
              await refreshGroupsAndLists();
            }
          } catch (err) {
            console.error('Failed to move list:', err);
            if (showToast) {
              showToast('Failed to move list', 'error');
            }
            updateListNav();
          }
        } else if (toGroupId && evt.oldIndex !== evt.newIndex) {
          // Reorder within the same group
          const listItems = evt.to.querySelectorAll('li');
          const newOrder = Array.from(listItems)
            .map((li) =>
              li.querySelector('[data-list-id]')?.getAttribute('data-list-id')
            )
            .filter(Boolean);

          try {
            await apiCall('/api/lists/reorder', {
              method: 'POST',
              body: JSON.stringify({ groupId: toGroupId, order: newOrder }),
            });

            // Update local state
            if (refreshGroupsAndLists) {
              await refreshGroupsAndLists();
            }
          } catch (err) {
            console.error('Failed to reorder lists:', err);
            if (showToast) {
              showToast('Failed to reorder lists', 'error');
            }
            updateListNav();
          }
        }
      },
    });

    listSortables.set(groupId, sortable);
  }

  /**
   * Cache list names to localStorage
   */
  function cacheListNames() {
    const lists = getLists();
    try {
      localStorage.setItem(
        'cachedListNames',
        JSON.stringify(Object.keys(lists))
      );
    } catch (e) {
      // Handle quota exceeded error gracefully
      if (e.name === 'QuotaExceededError') {
        console.warn('LocalStorage quota exceeded, skipping cache');
        // Attempt to free up space by removing old cache entries
        try {
          const keysToRemove = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (
              key &&
              (key.startsWith('lists_cache') ||
                key.startsWith('lastSelectedListData_'))
            ) {
              keysToRemove.push(key);
            }
          }
          keysToRemove.forEach((key) => localStorage.removeItem(key));
        } catch (cleanupErr) {
          console.warn('Failed to cleanup localStorage:', cleanupErr);
        }
      } else {
        console.warn('Failed to cache list names', e);
      }
    }
  }

  /**
   * Update only the active state in sidebar (optimized - no DOM rebuild)
   * @param {string} activeListId - ID of the active list
   * @param {number|null} activeRecommendationsYear - Year if recommendations is active
   */
  function updateListNavActiveState(
    activeListId,
    activeRecommendationsYear = null
  ) {
    const nav = document.getElementById('listNav');
    const mobileNav = document.getElementById('mobileListNav');

    const updateActiveState = (container) => {
      if (!container) return;

      // Find only list buttons (those with data-list-id attribute)
      const buttons = container.querySelectorAll('[data-list-id]');
      buttons.forEach((button) => {
        const listId = button.dataset.listId;
        if (!listId) return;

        const isActive = listId === activeListId && !activeRecommendationsYear;

        // Toggle active class - background is handled by ::before pseudo-element in CSS
        if (isActive) {
          button.classList.add('active');
        } else {
          button.classList.remove('active');
        }
      });

      // Update recommendations buttons active state
      const recommendationsButtons = container.querySelectorAll(
        '[data-recommendations-year]'
      );
      recommendationsButtons.forEach((button) => {
        const year = parseInt(button.dataset.recommendationsYear, 10);
        const isActive = activeRecommendationsYear === year;

        if (isActive) {
          button.classList.add('active');
        } else {
          button.classList.remove('active');
        }
      });
    };

    updateActiveState(nav);
    updateActiveState(mobileNav);
  }

  // Return public API
  return {
    updateListNav,
    updateListNavActiveState,
    getYearExpandState,
    saveYearExpandState,
    toggleYearSection,
    groupListsByYear,
    createYearHeaderHTML,
    createListButtonHTML,
    createRecommendationsButtonHTML,
    createListButton,
    createRecommendationsButton,
    createYearSection,
    renderListItems,
  };
}
