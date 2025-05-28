// Drag and Drop Module for Album Reordering
const DragDropManager = (function() {
  // Drag and drop state
  let draggedElement = null;
  let draggedIndex = null;
  let placeholder = null;
  let lastValidDropIndex = null;

  // Initialize drag and drop for container
  function initialize() {
    const container = document.getElementById('albumContainer');
    if (!container) return;
    
    container.addEventListener('dragover', handleContainerDragOver);
    container.addEventListener('drop', handleContainerDrop);
    container.addEventListener('dragleave', handleContainerDragLeave);
  }

  // Drag handlers
  function handleDragStart(e) {
    // Don't start drag if we're editing a comment or selecting genre/country
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') {
      e.preventDefault();
      return;
    }
    
    draggedElement = this;
    draggedIndex = parseInt(this.dataset.index);
    
    placeholder = document.createElement('div');
    placeholder.className = 'album-row drag-placeholder grid grid-cols-[50px_60px_1fr_0.8fr_0.5fr_0.6fr_0.6fr_1.2fr] gap-4 px-4 py-3 border-b border-gray-800';
    placeholder.style.height = this.offsetHeight + 'px';
    placeholder.innerHTML = '<div class="col-span-full text-center text-gray-500">Drop album here</div>';
    
    this.classList.add('dragging');
    
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', this.innerHTML);
    
    requestAnimationFrame(() => {
      this.style.display = 'none';
      this.parentNode.insertBefore(placeholder, this.nextSibling);
    });
  }

  function handleContainerDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    const rowsContainer = this.querySelector('.album-rows-container') || this;
    const afterElement = getDragAfterElement(rowsContainer, e.clientY);
    
    if (!placeholder || !placeholder.parentNode) return;
    
    if (afterElement == null) {
      rowsContainer.appendChild(placeholder);
      lastValidDropIndex = rowsContainer.children.length - 1;
    } else {
      rowsContainer.insertBefore(placeholder, afterElement);
      const allElements = Array.from(rowsContainer.children);
      lastValidDropIndex = allElements.indexOf(placeholder);
    }
    
    this.classList.add('drag-active');
  }

  function handleContainerDragLeave(e) {
    const rect = this.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || 
        e.clientY < rect.top || e.clientY > rect.bottom) {
      this.classList.remove('drag-active');
    }
  }

  function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.album-row:not(.dragging):not(.drag-placeholder)')];
    
    return draggableElements.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      
      if (offset < 0 && offset > closest.offset) {
        return { offset: offset, element: child };
      } else {
        return closest;
      }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }

  function handleDragEnd(e) {
    if (draggedElement) {
      draggedElement.style.display = '';
      draggedElement.classList.remove('dragging');
    }
    
    // Only remove placeholder if it still exists (wasn't removed by drop handler)
    if (placeholder && placeholder.parentNode) {
      placeholder.parentNode.removeChild(placeholder);
    }
    
    document.getElementById('albumContainer').classList.remove('drag-active');
    
    draggedElement = null;
    draggedIndex = null;
    placeholder = null;
    lastValidDropIndex = null;
  }

  async function handleContainerDrop(e, saveCallback) {
    e.preventDefault();
    e.stopPropagation();
    
    this.classList.remove('drag-active');
    
    if (!draggedElement || lastValidDropIndex === null || !placeholder) return;
    
    const rowsContainer = this.querySelector('.album-rows-container') || this;
    
    let dropIndex = lastValidDropIndex;
    if (draggedIndex < dropIndex) {
      dropIndex--;
    }
    
    if (dropIndex !== draggedIndex) {
      try {
        // First, immediately update the DOM by moving the dragged element
        if (placeholder && placeholder.parentNode) {
          // Insert the dragged element where the placeholder is
          placeholder.parentNode.insertBefore(draggedElement, placeholder);
          // Remove the placeholder
          placeholder.parentNode.removeChild(placeholder);
          placeholder = null;
        }
        
        // Show the dragged element in its new position
        draggedElement.style.display = '';
        draggedElement.classList.remove('dragging');
        
        // Update all position numbers and data-index attributes
        updateAlbumPositions(rowsContainer);
        
        // Call the save callback if provided
        if (saveCallback) {
          await saveCallback(draggedIndex, dropIndex);
        }
        
        showToast('Reordered successfully');
        
      } catch (error) {
        console.error('Error saving reorder:', error);
        showToast('Error saving changes', 'error');
        // On error, trigger a rebuild through the callback
        if (saveCallback) {
          saveCallback(null, null, true); // Third parameter indicates error/rebuild needed
        }
      }
    }
    
    // Clean up drag state
    draggedElement = null;
    draggedIndex = null;
    lastValidDropIndex = null;
  }

  // Update positions without rebuilding
  function updateAlbumPositions(container) {
    const rows = Array.from(container.querySelectorAll('.album-row:not(.drag-placeholder)'));
    
    rows.forEach((row, index) => {
      // Update the position number
      const positionEl = row.querySelector('.flex.items-center.justify-center');
      if (positionEl) {
        positionEl.textContent = index + 1;
      }
      
      // Update the data-index attribute
      row.dataset.index = index;
    });
  }

  // Make row draggable
  function makeRowDraggable(row) {
    row.draggable = true;
    row.addEventListener('dragstart', handleDragStart);
    row.addEventListener('dragend', handleDragEnd);
  }

  // Public API
  return {
    initialize,
    makeRowDraggable,
    setupDropHandler: function(saveCallback) {
      const container = document.getElementById('albumContainer');
      if (container) {
        // Remove any existing drop handler
        container.removeEventListener('drop', container._dropHandler);
        
        // Create new handler with the callback
        container._dropHandler = function(e) {
          handleContainerDrop.call(this, e, saveCallback);
        };
        
        // Add the new handler
        container.addEventListener('drop', container._dropHandler);
      }
    }
  };
})();

// Export for use in other files
window.DragDropManager = DragDropManager;