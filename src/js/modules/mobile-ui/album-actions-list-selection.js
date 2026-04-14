export function createMobileListSelectionActions(deps = {}) {
  const {
    createActionSheet,
    getCurrentList,
    getListData,
    getLists,
    showMoveConfirmation,
    showCopyConfirmation,
  } = deps;

  /**
   * Group lists by year for the move submenu (matches desktop logic)
   * @returns {Object} { listsByYear, sortedYears, listsWithoutYear }
   */
  function groupListsForMove() {
    const currentListId = getCurrentList();
    const lists = getLists();
    const listsByYear = {};
    const listsWithoutYear = [];

    Object.keys(lists).forEach((listId) => {
      // Skip current list
      if (listId === currentListId) return;

      const meta = lists[listId];
      const listName = meta?.name || 'Unknown';
      const year = meta?.year;

      if (year) {
        if (!listsByYear[year]) {
          listsByYear[year] = [];
        }
        listsByYear[year].push({ id: listId, name: listName });
      } else {
        listsWithoutYear.push({ id: listId, name: listName });
      }
    });

    // Sort years descending (newest first)
    const sortedYears = Object.keys(listsByYear).sort(
      (a, b) => parseInt(b) - parseInt(a)
    );

    return { listsByYear, sortedYears, listsWithoutYear };
  }

  /**
   * Show a mobile list selection sheet with year-based accordion grouping.
   * Shared by both move and copy flows.
   * @param {Object} options - Sheet options
   * @param {string} options.title - Sheet title (e.g. "Move to List", "Copy to List")
   * @param {number} options.index - Album index
   * @param {string} options.albumId - Album identity string
   * @param {Function} options.onSelect - Callback when a target list is selected: (albumId, targetListId) => void
   */
  function showMobileListSelectionSheet({ title, index, albumId, onSelect }) {
    const currentList = getCurrentList();

    // Validate index
    const albumsForSheet = getListData(currentList);
    if (
      isNaN(index) ||
      index < 0 ||
      !albumsForSheet ||
      index >= albumsForSheet.length
    ) {
      console.error('Invalid album index:', index);
      return;
    }

    const album = albumsForSheet[index];

    // Group lists by year
    const { listsByYear, sortedYears, listsWithoutYear } = groupListsForMove();
    const hasAnyLists = sortedYears.length > 0 || listsWithoutYear.length > 0;

    let actionSheet, close;

    if (!hasAnyLists) {
      ({ sheet: actionSheet, close } = createActionSheet({
        contentHtml: `
            <h3 class="font-semibold text-white mb-1">${title}</h3>
            <p class="text-sm text-gray-400 mb-4">${album.album} by ${album.artist}</p>
            
            <div class="py-8 text-center text-gray-500">
              No other lists available
            </div>
            
            <button data-action="cancel"
                    class="w-full text-center py-3 px-4 mt-2 bg-gray-800 rounded-sm">
              Cancel
            </button>`,
        hideFAB: false,
        restoreFAB: false,
      }));
    } else {
      // Build year accordion sections
      const yearSections = sortedYears
        .map(
          (year, idx) => `
          <div class="year-section" data-year="${year}">
            <button data-action="toggle-year" data-year="${year}"
                    class="w-full flex items-center justify-between py-3 px-4 hover:bg-gray-800 rounded-sm">
              <span class="font-medium text-white">${year}</span>
              <div class="flex items-center gap-2">
                <span class="text-xs text-gray-500">${listsByYear[year].length} list${listsByYear[year].length !== 1 ? 's' : ''}</span>
                <i class="fas fa-chevron-down text-gray-500 text-xs transition-transform duration-200" data-year-chevron="${year}"></i>
              </div>
            </button>
            <div data-year-lists="${year}" class="${idx === 0 ? '' : 'hidden'} overflow-hidden transition-all duration-200 ease-out" style="${idx === 0 ? '' : 'max-height: 0;'}">
              <div class="ml-4 border-l-2 border-gray-700 pl-2">
                ${listsByYear[year]
                  .map(
                    (list) => `
                  <button data-target-list="${list.id}"
                          class="w-full text-left py-2.5 px-3 hover:bg-gray-800 rounded-sm text-gray-300">
                    ${list.name}
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

      // Build "Other" section for lists without year
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
                    ${list.name}
                  </button>
                `
                  )
                  .join('')}
              </div>
            </div>
          </div>
        `
          : '';

      ({ sheet: actionSheet, close } = createActionSheet({
        contentHtml: `
            <h3 class="font-semibold text-white mb-1">${title}</h3>
            <p class="text-sm text-gray-400 mb-4 truncate">${album.album} by ${album.artist}</p>
            
            ${yearSections}
            ${otherSection}
            
            <button data-action="cancel"
                    class="w-full text-center py-3 px-4 mt-2 bg-gray-800 rounded-sm">
              Cancel
            </button>`,
        panelClasses: 'max-h-[80vh] overflow-y-auto',
        hideFAB: false,
        restoreFAB: false,
      }));
    }

    // Track expanded state for each year
    const expandedYears = new Set();
    // First year is expanded by default (if any years exist)
    if (sortedYears.length > 0) {
      expandedYears.add(sortedYears[0]);
      // Rotate chevron for first year since it's expanded
      const firstChevron = actionSheet.querySelector(
        `[data-year-chevron="${sortedYears[0]}"]`
      );
      if (firstChevron) {
        firstChevron.style.transform = 'rotate(180deg)';
      }
    }

    // Attach toggle handlers to year headers
    actionSheet
      .querySelectorAll('[data-action="toggle-year"]')
      .forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const year = btn.dataset.year;
          const listContainer = actionSheet.querySelector(
            `[data-year-lists="${year}"]`
          );
          const chevron = actionSheet.querySelector(
            `[data-year-chevron="${year}"]`
          );

          if (!listContainer) return;

          const isExpanded = expandedYears.has(year);

          if (isExpanded) {
            // Collapse
            listContainer.style.maxHeight = '0';
            if (chevron) chevron.style.transform = 'rotate(0deg)';
            setTimeout(() => {
              listContainer.classList.add('hidden');
            }, 200);
            expandedYears.delete(year);
          } else {
            // Expand
            listContainer.classList.remove('hidden');
            void listContainer.offsetHeight; // Force reflow
            listContainer.style.maxHeight = listContainer.scrollHeight + 'px';
            if (chevron) chevron.style.transform = 'rotate(180deg)';
            expandedYears.add(year);
          }
        });
      });

    // Attach click handlers to list buttons
    actionSheet.querySelectorAll('[data-target-list]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const targetList = btn.dataset.targetList;
        close();
        onSelect(albumId, targetList);
      });
    });
  }

  /**
   * Show mobile sheet to select target list for moving album
   * @param {number} index - Album index
   * @param {string} albumId - Album identity string
   */
  function showMobileMoveToListSheet(index, albumId) {
    showMobileListSelectionSheet({
      title: 'Move to List',
      index,
      albumId,
      onSelect: showMoveConfirmation,
    });
  }

  /**
   * Show mobile sheet to select target list for copying album
   * @param {number} index - Album index
   * @param {string} albumId - Album identity string
   */
  function showMobileCopyToListSheet(index, albumId) {
    showMobileListSelectionSheet({
      title: 'Copy to List',
      index,
      albumId,
      onSelect: showCopyConfirmation,
    });
  }

  return {
    showMobileMoveToListSheet,
    showMobileCopyToListSheet,
  };
}
