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
   * @returns {Object} { groups: Array of group objects with lists, orphaned: Array }
   */
  function groupListsByGroup() {
    const lists = getLists();
    const allGroups = getGroups ? getGroups() : {};
    const sortedGroups = getSortedGroups ? getSortedGroups() : [];

    // Create a map of groupId -> lists
    const listsByGroupId = {};
    const orphaned = [];

    Object.keys(lists).forEach((listName) => {
      const meta = getListMetadata(listName);
      const groupId = meta?.groupId;

      if (groupId && allGroups[groupId]) {
        if (!listsByGroupId[groupId]) {
          listsByGroupId[groupId] = [];
        }
        listsByGroupId[groupId].push({ name: listName, meta });
      } else {
        orphaned.push({ name: listName, meta });
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
    const lists = getLists();
    const listsByYear = {};
    const uncategorized = [];

    Object.keys(lists).forEach((listName) => {
      const meta = getListMetadata(listName);
      const year = meta?.year;

      if (year) {
        if (!listsByYear[year]) {
          listsByYear[year] = [];
        }
        listsByYear[year].push({ name: listName, meta });
      } else {
        uncategorized.push({ name: listName, meta });
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
   * @param {number} count - Number of lists in this group
   * @param {boolean} isExpanded - Whether section is expanded
   * @param {boolean} isYearGroup - Whether this is a year-based group
   * @param {boolean} isMobile - Whether rendering for mobile
   * @param {string} groupId - Group ID for menu button
   * @returns {string} HTML string
   */
  function createGroupHeaderHTML(
    name,
    count,
    isExpanded,
    isYearGroup,
    isMobile = false,
    groupId = ''
  ) {
    const chevronClass = isExpanded ? 'fa-chevron-down' : 'fa-chevron-right';
    const iconClass = isYearGroup ? 'fa-calendar-alt' : 'fa-folder';

    // For mobile: show menu button instead of count
    // For desktop: show count (menu accessed via right-click)
    const rightSide = isMobile
      ? `<button data-category-menu-btn="${groupId}" class="p-1 text-gray-400 active:text-gray-200 no-drag shrink-0 category-menu-btn" aria-label="Category options">
          <i class="fas fa-ellipsis-v text-xs"></i>
        </button>`
      : `<span class="text-xs text-gray-400 bg-gray-800 px-1 py-px rounded-sm font-normal">${count}</span>`;

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
   * @param {number} count - Number of lists in this year
   * @param {boolean} isExpanded - Whether section is expanded
   * @param {boolean} isMobile - Whether rendering for mobile
   * @param {string} groupId - Group ID for menu button
   * @returns {string} HTML string
   */
  function createYearHeaderHTML(
    year,
    count,
    isExpanded,
    isMobile = false,
    groupId = ''
  ) {
    return createGroupHeaderHTML(
      year,
      count,
      isExpanded,
      true,
      isMobile,
      groupId
    );
  }

  /**
   * Generate HTML for list button
   * @param {string} listName - List name
   * @param {boolean} isActive - Whether list is currently selected
   * @param {boolean} isMain - Whether list is marked as main
   * @param {boolean} isMobile - Whether rendering for mobile
   * @returns {string} HTML string
   */
  function createListButtonHTML(listName, isActive, isMain, isMobile) {
    const paddingClass = isMobile ? 'py-3' : 'py-2';
    const widthClass = isMobile ? 'flex-1' : 'w-full';
    const activeClass = isActive ? 'active' : '';
    const mainBadge = isMain
      ? '<i class="fas fa-star text-yellow-500 ml-1 shrink-0 text-xs" title="Main list"></i>'
      : '';

    const buttonHTML = `
      <button data-list-name="${listName}" class="sidebar-list-btn ${widthClass} text-left px-3 ${paddingClass} rounded-sm text-sm transition duration-200 text-gray-300 ${activeClass} flex items-center">
        <i class="fas fa-list mr-2 shrink-0"></i>
        <span class="truncate flex-1">${listName}</span>
        ${mainBadge}
      </button>
    `;

    if (isMobile) {
      return `
        ${buttonHTML}
        <button data-list-menu-btn="${listName}" class="p-2 text-gray-400 active:text-gray-200 no-drag shrink-0" aria-label="List options">
          <i class="fas fa-ellipsis-v"></i>
        </button>
      `;
    }

    return buttonHTML;
  }

  // ============ LIST BUTTON CREATION ============

  /**
   * Create a list button element with event handlers
   * @param {string} listName - List name
   * @param {boolean} isMobile - Whether rendering for mobile
   * @param {HTMLElement} _container - Parent container (unused but kept for signature compatibility)
   * @returns {HTMLElement} List item element
   */
  function createListButton(listName, isMobile, _container) {
    const meta = getListMetadata(listName);
    const isMain = meta?.isMain || false;
    const currentList = getCurrentList();
    const isActive = currentList === listName;
    const li = document.createElement('li');

    if (isMobile) {
      li.className = 'flex items-center';
    }
    li.innerHTML = createListButtonHTML(listName, isActive, isMain, isMobile);

    const button = li.querySelector('[data-list-name]');
    const menuButton = li.querySelector('[data-list-menu-btn]');

    if (!isMobile) {
      // Desktop: attach right-click context menu
      attachDesktopContextMenu(button, listName);
    } else {
      // Mobile: attach click handler to three-dot menu button
      attachMobileMenuButton(menuButton, listName);
    }

    // Click handler for selecting the list
    button.onclick = () => {
      selectList(listName);
      if (isMobile) toggleMobileLists();
    };

    return li;
  }

  /**
   * Attach desktop context menu to button
   * @param {HTMLElement} button - Button element
   * @param {string} listName - List name
   */
  function attachDesktopContextMenu(button, listName) {
    button.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();

      hideAllContextMenus();
      setCurrentContextList(listName);

      const contextMenu = document.getElementById('contextMenu');
      if (!contextMenu) return;

      // Get shared menu configuration
      const menuConfig = getListMenuConfig(listName);

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

      // Position the menu at cursor
      positionContextMenu(contextMenu, e.clientX, e.clientY);
    });
  }

  /**
   * Attach mobile menu button handlers
   * @param {HTMLElement} menuButton - Menu button element
   * @param {string} listName - List name
   */
  function attachMobileMenuButton(menuButton, listName) {
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
        window.showMobileListMenu(listName);
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
    header.className = `group-header-btn flex-1 text-left px-3 ${paddingClass} rounded-sm text-sm hover:bg-gray-800 transition duration-200 text-white flex items-center justify-between font-bold`;
    header.innerHTML = createGroupHeaderHTML(
      name,
      groupLists.length,
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
    if (!isMobile && _id) {
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
    if (isMobile && _id) {
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

    groupLists.forEach(({ name: listName }) => {
      const li = createListButton(listName, isMobile, container);
      listsContainer.appendChild(li);
    });

    section.appendChild(listsContainer);
    return section;
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
    hideAllContextMenus();

    if (setCurrentContextGroup) {
      setCurrentContextGroup({ id: groupId, name: groupName, isYearGroup });
    }

    const contextMenu = document.getElementById('categoryContextMenu');
    if (!contextMenu) return;

    // Update menu options based on group type
    const deleteOption = document.getElementById('deleteCategoryOption');
    if (deleteOption) {
      // Year groups can't be manually deleted
      if (isYearGroup) {
        deleteOption.classList.add('hidden');
      } else {
        deleteOption.classList.remove('hidden');
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

    // Initialize drag-and-drop for desktop (not mobile for now)
    if (nav && apiCall) {
      initializeDragAndDrop(nav);
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
   */
  function initializeDragAndDrop(container) {
    if (!window.Sortable) {
      console.warn('SortableJS not loaded, drag-and-drop disabled');
      return;
    }

    // Initialize sortable for groups (reorder groups)
    initializeGroupsSortable(container);

    // Initialize sortable for lists within each group
    const groupSections = container.querySelectorAll('.group-section');
    groupSections.forEach((section) => {
      const groupId = section.getAttribute('data-group-id');
      if (groupId) {
        initializeListsSortable(section, groupId);
      }
    });
  }

  /**
   * Initialize sortable for reordering groups
   * @param {HTMLElement} container - The sidebar container
   */
  function initializeGroupsSortable(container) {
    groupsSortable = new window.Sortable(container, {
      animation: 150,
      handle: '.group-section', // Drag by the section
      draggable: '.group-section',
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      filter: '.group-lists', // Don't trigger on list items
      preventOnFilter: false,
      onEnd: async (evt) => {
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
   */
  function initializeListsSortable(section, groupId) {
    const listsContainer = section.querySelector('.group-lists');
    if (!listsContainer) return;

    const sortable = new window.Sortable(listsContainer, {
      group: 'lists', // Allow dragging between groups
      animation: 150,
      handle: '.sidebar-list-btn',
      draggable: 'li',
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      onEnd: async (evt) => {
        const listName = evt.item
          .querySelector('[data-list-name]')
          ?.getAttribute('data-list-name');
        if (!listName) return;

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
            await apiCall(`/api/lists/${encodeURIComponent(listName)}/move`, {
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
              li
                .querySelector('[data-list-name]')
                ?.getAttribute('data-list-name')
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
   * @param {string} activeListName - Name of the active list
   */
  function updateListNavActiveState(activeListName) {
    const nav = document.getElementById('listNav');
    const mobileNav = document.getElementById('mobileListNav');

    const updateActiveState = (container) => {
      if (!container) return;

      // Find only list buttons inside .year-lists containers (not year header buttons)
      const buttons = container.querySelectorAll('.year-lists button');
      buttons.forEach((button) => {
        const listName = button.querySelector('span')?.textContent;
        if (!listName) return;

        const isActive = listName === activeListName;

        // Toggle active class - background is handled by ::before pseudo-element in CSS
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
    createListButton,
    createYearSection,
    renderListItems,
  };
}
