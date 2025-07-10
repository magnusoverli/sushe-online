/* eslint-disable no-console */
// SortableJS-based Drag and Drop Module for Album Reordering
import Sortable from 'sortablejs';

const DragDropManager = (function () {
  // SortableJS instances
  let sortableInstance = null;
  let saveCallback = null;

  // Mobile detection
  const isMobile = () => window.innerWidth <= 768 || 'ontouchstart' in window;

  // Prevent duplicate initialization
  let initialized = false;

  // Initialize SortableJS for container
  function initialize() {
    const container = document.getElementById('albumContainer');
    if (!container) return;

    if (initialized) return;
    initialized = true;

    // Find the rows container
    const rowsContainer =
      container.querySelector('.album-rows-container') ||
      container.querySelector('.mobile-album-list') ||
      container;

    if (!rowsContainer) return;

    // Destroy existing instance if it exists
    if (sortableInstance) {
      sortableInstance.destroy();
    }

    // Configure SortableJS options
    const sortableOptions = {
      animation: 200,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      forceFallback: false,
      fallbackClass: 'sortable-fallback',
      fallbackOnBody: true,
      swapThreshold: 0.65,
      invertSwap: false,
      invertedSwapThreshold: 0.1,
      direction: 'vertical',
      touchStartThreshold: 3,

      // Mobile-specific options
      ...(isMobile() && {
        delay: 500, // 500ms touch-and-hold delay
        delayOnTouchOnly: true,
        touchStartThreshold: 10,
        forceFallback: true,
        fallbackTolerance: 5,
      }),

      // Filter to prevent dragging on interactive elements
      filter: 'textarea, select, input, button, .no-drag',
      preventOnFilter: true,

      onStart: handleSortStart,
      onEnd: handleSortEnd,
      onMove: handleSortMove,
    };

    // Create SortableJS instance
    sortableInstance = Sortable.create(rowsContainer, sortableOptions);
  }

  // SortableJS event handlers
  function handleSortStart(evt) {
    const item = evt.item;

    // Add visual feedback for mobile
    if (isMobile()) {
      item.classList.add('dragging-mobile');
      // Add haptic feedback if available
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
    }

    // Store original index
    item.dataset.originalIndex = evt.oldIndex;
  }

  function handleSortEnd(evt) {
    const item = evt.item;
    const oldIndex = parseInt(item.dataset.originalIndex);
    const newIndex = evt.newIndex;

    // Remove visual feedback
    item.classList.remove('dragging-mobile');

    // Clean up
    delete item.dataset.originalIndex;

    // Only save if position actually changed
    if (oldIndex !== newIndex && saveCallback) {
      // Update position numbers immediately for better UX
      updateAlbumPositions(evt.to);

      // Call save callback
      saveCallback(oldIndex, newIndex).catch((error) => {
        console.error('Error saving reorder:', error);
        showToast('Error saving changes', 'error');
        // Revert the change on error
        if (sortableInstance) {
          const items = Array.from(evt.to.children);
          const itemToMove = items[newIndex];
          if (oldIndex < items.length) {
            evt.to.insertBefore(itemToMove, items[oldIndex]);
          } else {
            evt.to.appendChild(itemToMove);
          }
          updateAlbumPositions(evt.to);
        }
      });
    }
  }

  function handleSortMove(evt) {
    // Prevent dropping on non-draggable elements
    const related = evt.related;
    if (related && related.classList.contains('no-drop')) {
      return false;
    }
    return true;
  }

  // Utility function to show toast messages
  function showToast(message, type = 'info') {
    // Try to use existing toast system if available
    if (window.showToast) {
      window.showToast(message, type);
      return;
    }

    // Fallback toast implementation
    const toast = document.createElement('div');
    toast.className = `fixed top-4 right-4 px-4 py-2 rounded-lg text-white z-50 ${
      type === 'error' ? 'bg-red-600' : 'bg-gray-800'
    }`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, 3000);
  }

  // Update positions without rebuilding - optimized version
  function updateAlbumPositions(container) {
    const rows = container.querySelectorAll('.album-row, .album-card');

    // Use for loop for better performance than forEach
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      // Use optimized selector - try O(1) lookup first, then fallback
      let positionEl = row.querySelector('[data-position-element="true"]');
      if (!positionEl) {
        positionEl = row.querySelector('.position-display');
      }

      if (positionEl) {
        positionEl.textContent = i + 1;
      }
      row.dataset.index = i;
    }
  }

  // Make row draggable (now handled by SortableJS)
  function makeRowDraggable(row) {
    // SortableJS handles draggability automatically
    // Just ensure the row has the proper classes and isn't filtered out
    if (row.classList.contains('no-drag')) {
      row.classList.remove('no-drag');
    }
  }

  // Destroy SortableJS instance
  function destroy() {
    if (sortableInstance) {
      sortableInstance.destroy();
      sortableInstance = null;
    }
    initialized = false;
  }

  // Public API
  return {
    initialize,
    makeRowDraggable,
    destroy,
    setupDropHandler: function (callback) {
      saveCallback = callback;
      // Re-initialize if needed to apply the new callback
      if (initialized) {
        destroy();
        initialize();
      }
    },
    // Additional utility methods
    updatePositions: updateAlbumPositions,
    isMobile: isMobile,
  };
})();

// Export for use in other files
window.DragDropManager = DragDropManager;
