
import Sortable from 'sortablejs';

const DragDropManager = (function () {
  
  let sortableInstance = null;
  let saveCallback = null;

  
  const isMobile = () => window.innerWidth <= 768 || 'ontouchstart' in window;

  
  let initialized = false;

  
  function initialize() {
    const container = document.getElementById('albumContainer');
    if (!container) return;

    if (initialized) return;
    initialized = true;

    
    const rowsContainer =
      container.querySelector('.album-rows-container') ||
      container.querySelector('.mobile-album-list') ||
      container;

    if (!rowsContainer) return;

    
    if (sortableInstance) {
      sortableInstance.destroy();
    }

    
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

      
      ...(isMobile() && {
        delay: 350, 
        delayOnTouchOnly: true,
        touchStartThreshold: 10,
        forceFallback: true,
        fallbackTolerance: 5,
      }),

      
      filter: 'textarea, select, input, button, .no-drag',
      preventOnFilter: true,

      onStart: handleSortStart,
      onEnd: handleSortEnd,
      onMove: handleSortMove,
    };

    
    sortableInstance = Sortable.create(rowsContainer, sortableOptions);
  }

  
  function handleSortStart(evt) {
    const item = evt.item;

    
    if (isMobile()) {
      item.classList.add('dragging-mobile');
      
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
    }

    
    item.dataset.originalIndex = evt.oldIndex;
  }

  function handleSortEnd(evt) {
    const item = evt.item;
    const oldIndex = parseInt(item.dataset.originalIndex);
    const newIndex = evt.newIndex;

    
    item.classList.remove('dragging-mobile');

    
    delete item.dataset.originalIndex;

    
    if (oldIndex !== newIndex && saveCallback) {
      
      updateAlbumPositions(evt.to);

      
      saveCallback(oldIndex, newIndex).catch((error) => {
        console.error('Error saving reorder:', error);
        showToast('Error saving changes', 'error');
        
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
    
    const related = evt.related;
    if (related && related.classList.contains('no-drop')) {
      return false;
    }
    return true;
  }

  
  function showToast(message, type = 'info') {
    
    if (window.showToast) {
      window.showToast(message, type);
      return;
    }

    
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

  
  function updateAlbumPositions(container) {
    const rows = container.querySelectorAll('.album-row, .album-card');

    
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      
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

  
  function makeRowDraggable(row) {
    
    
    if (row.classList.contains('no-drag')) {
      row.classList.remove('no-drag');
    }
  }

  
  function destroy() {
    if (sortableInstance) {
      sortableInstance.destroy();
      sortableInstance = null;
    }
    initialized = false;
  }

  
  return {
    initialize,
    makeRowDraggable,
    destroy,
    setupDropHandler: function (callback) {
      saveCallback = callback;
      
      if (initialized) {
        destroy();
        initialize();
      }
    },
    
    updatePositions: updateAlbumPositions,
    isMobile: isMobile,
  };
})();


window.DragDropManager = DragDropManager;
