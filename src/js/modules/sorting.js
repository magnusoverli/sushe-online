/**
 * Sorting Module
 *
 * Handles drag-and-drop sorting functionality using SortableJS for both
 * desktop and mobile views. Uses dependency injection for testability.
 *
 * @module sorting
 */

import { loadSortable as defaultLoadSortable } from './sortable-loader.js';

/**
 * Factory function to create the sorting module with injected dependencies
 *
 * @param {Object} deps - Dependencies
 * @param {Function} deps.getListData - Get album array for a list
 * @param {Function} deps.getCurrentList - Get current list name
 * @param {Function} deps.debouncedSaveList - Debounced save function (full data)
 * @param {Function} deps.debouncedSaveReorder - Queue a lightweight reorder save
 * @param {Function} deps.flushReorder - Dispatch pending intent when its view closes
 * @param {Function} deps.updatePositionNumbers - Update position numbers in UI
 * @param {Function} deps.showToast - Show toast notification
 * @param {Function} deps.loadSortable - Load the SortableJS constructor
 * @returns {Object} Sorting module API
 */
export function createSorting(deps = {}) {
  const {
    getListData,
    getCurrentList,
    debouncedSaveList,
    debouncedSaveReorder,
    flushReorder,
    updatePositionNumbers,
    showToast,
    loadSortable = defaultLoadSortable,
  } = deps;
  const initializationTokens = new WeakMap();
  const reorderBatches = new WeakMap();

  /**
   * Initialize unified sorting using SortableJS for both desktop and mobile
   * @param {HTMLElement} container - Container element
   * @param {boolean} isMobile - Whether this is mobile view
   */
  function initializeUnifiedSorting(container, isMobile) {
    destroySorting(container);
    const listId = getCurrentList();
    const token = { listId };
    initializationTokens.set(container, token);
    const isCurrent = () =>
      initializationTokens.get(container) === token &&
      Boolean(listId) &&
      getCurrentList() === listId &&
      !container.closest('[data-read-only="true"]') &&
      !container.querySelector('[data-read-only="true"]');

    return loadSortable()
      .then((Sortable) => {
        if (!isCurrent()) return;
        initializeUnifiedSortingAfterLoad(
          container,
          isMobile,
          Sortable,
          listId,
          token,
          isCurrent
        );
      })
      .catch((error) => {
        console.error('SortableJS not loaded', error);
      });
  }

  function initializeUnifiedSortingAfterLoad(
    container,
    isMobile,
    Sortable,
    listId,
    token,
    isCurrent
  ) {
    // Find the sortable container
    const sortableContainer = isMobile
      ? container.querySelector('.mobile-album-list') || container
      : container.querySelector('.album-rows-container') || container;

    if (!sortableContainer) {
      console.error('Sortable container not found');
      return;
    }

    // Find the actual scrollable element (the parent with overflow-y-auto)
    // Both mobile and desktop need to find the scrollable parent, not the sortable container itself
    // The sortable container (.album-rows-container) is a child of the scrollable element (#albumContainer)
    const scrollElement =
      sortableContainer.closest('.overflow-y-auto') || sortableContainer;

    let draggedItem = null;
    let cleanupTouch = () => {};
    token.cleanup = () => {
      cleanupTouch();
      if (!draggedItem) return;
      if (isMobile) draggedItem.classList.remove('dragging-mobile');
      else document.body.classList.remove('desktop-dragging');
      draggedItem = null;
    };

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
      forceAutoScrollFallback: true, // Force SortableJS autoscroll instead of native browser autoscroll
      scrollSensitivity: 100, // 100px trigger zone for autoscroll
      scrollSpeed: 25, // px per scroll tick
      bubbleScroll: false, // Disable parent container scrolling to prevent double-scroll

      // Enhanced event handlers
      onStart: function (evt) {
        if (!isCurrent()) return;
        draggedItem = evt.item;
        // Visual feedback
        if (!isMobile) {
          document.body.classList.add('desktop-dragging');
        } else {
          // Mobile-specific feedback
          evt.item.classList.add('dragging-mobile');

          // Haptic feedback when drag actually starts
          if (navigator.vibrate) {
            navigator.vibrate(50);
          }
        }
      },
      onEnd: async function (evt) {
        if (!isCurrent()) return;
        draggedItem = null;
        // Clean up visual feedback
        if (!isMobile) {
          document.body.classList.remove('desktop-dragging');
        } else {
          evt.item.classList.remove('dragging-mobile');
        }

        const oldIndex = evt.oldIndex;
        const newIndex = evt.newIndex;

        if (oldIndex !== newIndex) {
          let list = null;
          let batch = null;
          try {
            // Update the data
            list = getListData(listId);
            if (!list) {
              console.error('List data not found');
              return;
            }
            const beforeOrder = [...list];
            const beforeRows = Array.from(evt.to.children);
            beforeRows.splice(newIndex, 1);
            beforeRows.splice(oldIndex, 0, evt.item);
            const [movedItem] = list.splice(oldIndex, 1);
            list.splice(newIndex, 0, movedItem);

            // Immediate optimistic UI update
            updatePositionNumbers(sortableContainer, isMobile);

            // Use lightweight reorder endpoint (only sends album IDs, not full data)
            // This prevents "payload too large" errors for lists with many albums
            // Debounced to prevent API spam during rapid successive drags
            const saving = Promise.resolve(
              debouncedSaveReorder
                ? debouncedSaveReorder(listId, list)
                : debouncedSaveList(listId, list)
            );
            batch = reorderBatches.get(saving);
            if (!batch) {
              batch = { beforeOrder, beforeRows, handled: false };
              reorderBatches.set(saving, batch);
            }
            batch.appliedOrder = [...list];
            await saving;
          } catch (error) {
            if (batch?.handled) return;
            if (batch) batch.handled = true;
            console.error('Error saving reorder:', error);
            // Roll back the captured owner's cache even after navigation, but
            // never undo newer edits or touch the replacement view's DOM.
            const unchanged =
              list &&
              batch &&
              getListData(listId) === list &&
              list.length === batch.appliedOrder.length &&
              list.every((item, index) => item === batch.appliedOrder[index]);
            if (unchanged) {
              list.splice(0, list.length, ...batch.beforeOrder);
            }
            if (!isCurrent()) return;
            showToast?.(
              error.code === 'LIST_CONFLICT' ||
                error.code === 'LIST_REVISION_REQUIRED' ||
                error.code === 'SESSION_EXPIRED'
                ? error.message
                : 'Error saving changes',
              'error'
            );
            if (!unchanged) return;
            // Restore the whole coalesced batch, not just its final gesture.
            batch.beforeRows.forEach((row) => evt.to.appendChild(row));
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
      let touchState = null;

      const onTouchStart = (e) => {
        if (!isCurrent()) return;
        const wrapper = e.target.closest('.album-card-wrapper');
        if (!wrapper || e.target.closest('button, .no-drag')) return;

        touchState = {
          startTime: Date.now(),
        };
      };

      const onTouchMove = (e) => {
        if (!isCurrent() || !touchState) return;

        const elapsed = Date.now() - touchState.startTime;

        // Allow scroll during grace period, block after
        if (elapsed >= SCROLL_GRACE_PERIOD) {
          e.preventDefault();
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
      sortableContainer.addEventListener('touchcancel', onTouchEnd, {
        passive: true,
      });
      cleanupTouch = () => {
        touchState = null;
        sortableContainer.removeEventListener('touchstart', onTouchStart);
        sortableContainer.removeEventListener('touchmove', onTouchMove);
        sortableContainer.removeEventListener('touchend', onTouchEnd);
        sortableContainer.removeEventListener('touchcancel', onTouchEnd);
      };
    }
  }

  /**
   * Destroy sorting instance for a container
   * @param {HTMLElement} container - Container element
   */
  function destroySorting(container) {
    const token = initializationTokens.get(container);
    // Invalidate before destroy, which may itself dispatch drag callbacks.
    initializationTokens.delete(container);
    token?.cleanup?.();
    if (token?.listId) flushReorder?.(token.listId);
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
