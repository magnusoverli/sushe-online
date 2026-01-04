/**
 * Sorting Module
 *
 * Handles drag-and-drop sorting functionality using SortableJS for both
 * desktop and mobile views. Uses dependency injection for testability.
 *
 * @module sorting
 */

/**
 * Factory function to create the sorting module with injected dependencies
 *
 * @param {Object} deps - Dependencies
 * @param {Function} deps.getListData - Get album array for a list
 * @param {Function} deps.getCurrentList - Get current list name
 * @param {Function} deps.debouncedSaveList - Debounced save function
 * @param {Function} deps.updatePositionNumbers - Update position numbers in UI
 * @param {Function} deps.showToast - Show toast notification
 * @returns {Object} Sorting module API
 */
export function createSorting(deps = {}) {
  const {
    getListData,
    getCurrentList,
    debouncedSaveList,
    updatePositionNumbers,
    showToast,
  } = deps;

  /**
   * Initialize unified sorting using SortableJS for both desktop and mobile
   * @param {HTMLElement} container - Container element
   * @param {boolean} isMobile - Whether this is mobile view
   */
  function initializeUnifiedSorting(container, isMobile) {
    if (!window.Sortable) {
      console.error('SortableJS not loaded');
      return;
    }

    // Clean up any existing sortable instance
    if (container._sortable) {
      container._sortable.destroy();
    }

    // Find the sortable container
    const sortableContainer = isMobile
      ? container.querySelector('.mobile-album-list') || container
      : container.querySelector('.album-rows-container') || container;

    if (!sortableContainer) {
      console.error('Sortable container not found');
      return;
    }

    // Find the actual scrollable element (the parent with overflow-y-auto)
    const scrollElement = isMobile
      ? sortableContainer.closest('.overflow-y-auto')
      : sortableContainer;

    // Configure SortableJS options
    const sortableOptions = {
      animation: 200,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',

      // Touch-and-hold configuration for mobile
      ...(isMobile && {
        delay: 300, // 300ms touch-and-hold delay
        delayOnTouchOnly: true,
        touchStartThreshold: 10, // Allow 10px movement before cancelling drag
        forceFallback: true,
        fallbackTolerance: 5,
      }),

      // Filter to prevent dragging on interactive elements
      filter: 'button, input, textarea, select, .no-drag',
      preventOnFilter: false,

      // Configure scrolling - use SortableJS built-in autoscroll for both desktop and mobile
      scroll: scrollElement, // Scroll the correct scrollable element
      scrollSensitivity: isMobile ? 100 : 30, // Larger zone for mobile
      scrollSpeed: isMobile ? 25 : 15, // Faster scroll for mobile
      bubbleScroll: false, // Disable parent container scrolling to prevent double-scroll

      // Enhanced event handlers
      onStart: function (evt) {
        // Visual feedback
        if (!isMobile) {
          document.body.classList.add('desktop-dragging');
        } else {
          // Mobile-specific feedback
          evt.item.classList.add('dragging-mobile');

          // Haptic feedback already triggered in touchmove handler
          // (onStart fires after delay, gesture context may be expired)
        }
      },
      onEnd: async function (evt) {
        // Clean up visual feedback
        if (!isMobile) {
          document.body.classList.remove('desktop-dragging');
        } else {
          evt.item.classList.remove('dragging-mobile');
        }

        const oldIndex = evt.oldIndex;
        const newIndex = evt.newIndex;

        if (oldIndex !== newIndex) {
          try {
            // Update the data
            const currentList = getCurrentList();
            const list = getListData(currentList);
            if (!list) {
              console.error('List data not found');
              return;
            }
            const [movedItem] = list.splice(oldIndex, 1);
            list.splice(newIndex, 0, movedItem);

            // Immediate optimistic UI update
            updatePositionNumbers(sortableContainer, isMobile);

            // Debounced server save to batch rapid changes
            debouncedSaveList(currentList, list);
          } catch (error) {
            console.error('Error saving reorder:', error);
            if (showToast) {
              showToast('Error saving changes', 'error');
            }
            // Revert the change on error
            const items = Array.from(evt.to.children);
            const itemToMove = items[newIndex];
            if (oldIndex < items.length) {
              evt.to.insertBefore(itemToMove, items[oldIndex]);
            } else {
              evt.to.appendChild(itemToMove);
            }
            updatePositionNumbers(sortableContainer, isMobile);
          }
        }
      },
    };

    // Initialize SortableJS
    const sortable = new Sortable(sortableContainer, sortableOptions);

    // Store reference for cleanup
    container._sortable = sortable;

    // Mobile: Allow scroll initially, then block it after a delay.
    // - 0-200ms: Scroll is ALLOWED (user can start scrolling naturally)
    // - 200ms+: Scroll is BLOCKED (user committed to holding for drag)
    // - 300ms: SortableJS starts the drag
    if (isMobile) {
      const SCROLL_GRACE_PERIOD = 200; // ms - allow scroll during this initial period
      const DRAG_DELAY = 300; // ms - matches SortableJS delay
      let touchState = null;

      const onTouchStart = (e) => {
        const wrapper = e.target.closest('.album-card-wrapper');
        if (!wrapper || e.target.closest('button, .no-drag')) return;

        touchState = {
          startTime: Date.now(),
          vibrated: false,
        };
      };

      const onTouchMove = (e) => {
        if (!touchState) return;

        const elapsed = Date.now() - touchState.startTime;

        // Allow scroll during grace period, block after
        if (elapsed >= SCROLL_GRACE_PERIOD) {
          e.preventDefault();
        }

        // Trigger haptic feedback when delay threshold is reached
        // Must be called within user gesture context (during touchmove)
        if (
          elapsed >= DRAG_DELAY &&
          !touchState.vibrated &&
          navigator.vibrate
        ) {
          navigator.vibrate(50);
          touchState.vibrated = true;
        }
      };

      const onTouchEnd = () => {
        touchState = null;
      };

      // Use non-passive listeners to allow preventDefault
      sortableContainer.addEventListener('touchstart', onTouchStart, {
        passive: true,
      });
      sortableContainer.addEventListener('touchmove', onTouchMove, {
        passive: false,
      });
      sortableContainer.addEventListener('touchend', onTouchEnd, {
        passive: true,
      });
    }
  }

  /**
   * Destroy sorting instance for a container
   * @param {HTMLElement} container - Container element
   */
  function destroySorting(container) {
    if (container._sortable) {
      container._sortable.destroy();
      container._sortable = null;
    }
  }

  // Return public API
  return {
    initializeUnifiedSorting,
    destroySorting,
  };
}
