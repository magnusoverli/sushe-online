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
 * @param {Function} deps.getCurrentList - Get current list name
 * @param {Function} deps.selectList - Select a list
 * @param {Function} deps.getListMenuConfig - Get list menu configuration
 * @param {Function} deps.hideAllContextMenus - Hide all context menus
 * @param {Function} deps.positionContextMenu - Position a context menu
 * @param {Function} deps.toggleMobileLists - Toggle mobile list panel
 * @param {Function} deps.setCurrentContextList - Set current context list
 * @returns {Object} List navigation module API
 */
export function createListNav(deps = {}) {
  const {
    getLists,
    getListMetadata,
    getCurrentList,
    selectList,
    getListMenuConfig,
    hideAllContextMenus,
    positionContextMenu,
    toggleMobileLists,
    setCurrentContextList,
  } = deps;

  // ============ EXPAND STATE MANAGEMENT ============

  /**
   * Get expand/collapse state from localStorage
   * @returns {Object} State object with year keys and boolean values
   */
  function getYearExpandState() {
    try {
      const state = localStorage.getItem('yearExpandState');
      return state ? JSON.parse(state) : {};
    } catch (_e) {
      return {};
    }
  }

  /**
   * Save expand/collapse state to localStorage
   * @param {Object} state - State object to save
   */
  function saveYearExpandState(state) {
    try {
      localStorage.setItem('yearExpandState', JSON.stringify(state));
    } catch (_e) {
      // Silently fail if localStorage is full
    }
  }

  /**
   * Toggle year section expand/collapse
   * @param {string} year - Year or 'uncategorized'
   * @param {HTMLElement} container - Container element
   */
  function toggleYearSection(year, container) {
    const state = getYearExpandState();
    const isExpanded = state[year] !== false; // Default to expanded
    state[year] = !isExpanded;
    saveYearExpandState(state);

    // Update UI
    const section = container.querySelector(`[data-year-section="${year}"]`);
    if (section) {
      const listsContainer = section.querySelector('.year-lists');
      const chevron = section.querySelector('.year-chevron');
      if (listsContainer) {
        listsContainer.classList.toggle('hidden', isExpanded);
      }
      if (chevron) {
        chevron.classList.toggle('fa-chevron-right', isExpanded);
        chevron.classList.toggle('fa-chevron-down', !isExpanded);
      }
    }
  }

  // ============ LIST GROUPING ============

  /**
   * Group lists by year
   * @returns {Object} { listsByYear: Object, uncategorized: Array, sortedYears: Array }
   */
  function groupListsByYear() {
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
   * Generate HTML for year section header
   * @param {string} year - Year label
   * @param {number} count - Number of lists in this year
   * @param {boolean} isExpanded - Whether section is expanded
   * @returns {string} HTML string
   */
  function createYearHeaderHTML(year, count, isExpanded) {
    const chevronClass = isExpanded ? 'fa-chevron-down' : 'fa-chevron-right';
    return `
      <div class="flex items-center">
        <i class="fas ${chevronClass} mr-2 text-xs year-chevron"></i>
        <span>${year}</span>
      </div>
      <span class="text-xs text-gray-400 bg-gray-800 px-1 py-px rounded-sm font-normal">${count}</span>
    `;
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

  // ============ YEAR SECTION RENDERING ============

  /**
   * Create a year section element
   * @param {string} year - Year label
   * @param {Array} yearLists - Lists for this year
   * @param {boolean} isMobile - Whether rendering for mobile
   * @param {HTMLElement} container - Parent container
   * @returns {HTMLElement} Section element
   */
  function createYearSection(year, yearLists, isMobile, container) {
    const expandState = getYearExpandState();
    const isExpanded = expandState[year] !== false; // Default to expanded

    const section = document.createElement('div');
    section.className = 'year-section mb-1';
    section.setAttribute('data-year-section', year);

    // Year header
    const header = document.createElement('button');
    const paddingClass = isMobile ? 'py-2' : 'py-1.5';
    header.className = `w-full text-left px-3 ${paddingClass} rounded-sm text-sm hover:bg-gray-800 transition duration-200 text-white flex items-center justify-between font-bold`;
    header.innerHTML = createYearHeaderHTML(year, yearLists.length, isExpanded);
    header.onclick = (e) => {
      e.preventDefault();
      toggleYearSection(year, container);
    };
    header.oncontextmenu = (e) => e.preventDefault();

    section.appendChild(header);

    // Lists container
    const listsContainer = document.createElement('ul');
    listsContainer.className = `year-lists pl-4 ${isExpanded ? '' : 'hidden'}`;

    yearLists.forEach(({ name: listName }) => {
      const li = createListButton(listName, isMobile, container);
      listsContainer.appendChild(li);
    });

    section.appendChild(listsContainer);
    return section;
  }

  // ============ MAIN RENDER FUNCTION ============

  /**
   * Render list items into a container
   * @param {HTMLElement} container - Container element
   * @param {boolean} isMobile - Whether rendering for mobile
   */
  function renderListItems(container, isMobile = false) {
    container.innerHTML = '';

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
      // Update the header to say "Uncategorized"
      const headerSpan = section.querySelector('.flex.items-center span');
      if (headerSpan) {
        headerSpan.textContent = 'Uncategorized';
      }
      container.appendChild(section);
    }
  }

  /**
   * Update sidebar navigation with year tree view
   */
  function updateListNav() {
    const nav = document.getElementById('listNav');
    const mobileNav = document.getElementById('mobileListNav');

    if (nav) renderListItems(nav, false);
    if (mobileNav) renderListItems(mobileNav, true);

    // Cache list names locally for faster startup
    cacheListNames();
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
