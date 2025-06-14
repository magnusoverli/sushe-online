// Drag and Drop Module for Album Reordering
const DragDropManager = (function() {
  // Drag and drop state
  let draggedElement = null;
  let draggedIndex = null;
  let placeholder = null;
  let lastValidDropIndex = null;
  
  // Auto-scroll state
  let autoScrollInterval = null;
  let currentScrollSpeed = 0;
  let scrollAcceleration = 1;
  let scrollableContainer = null;

  // Initialize drag and drop for container
  function initialize() {
    const container = document.getElementById('albumContainer');
    if (!container) return;

    console.debug('DragDropManager: initialize', {
      containerFound: !!container,
    });
    
    container.addEventListener('dragover', handleContainerDragOver);
    container.addEventListener('dragleave', handleContainerDragLeave);
  }

  // Enhanced auto-scroll implementation
  function startAutoScroll(direction, speed) {
    if (autoScrollInterval) {
      clearInterval(autoScrollInterval);
    }

    console.debug('DragDropManager: startAutoScroll', {
      direction,
      speed,
    });
    
    currentScrollSpeed = speed;
    scrollAcceleration = 1;
    
    autoScrollInterval = setInterval(() => {
      if (scrollableContainer) {
        // Gradually increase speed for smoother acceleration
        if (scrollAcceleration < 2.5) {
          scrollAcceleration += 0.05;
        }
        
        const adjustedSpeed = currentScrollSpeed * scrollAcceleration;
        const currentScroll = scrollableContainer.scrollTop;
        const newScroll = currentScroll + (direction * adjustedSpeed);
        console.debug('DragDropManager: autoScroll tick', {
          adjustedSpeed,
          newScroll,
        });
        
        if (direction > 0) {
          const maxScroll = scrollableContainer.scrollHeight - scrollableContainer.clientHeight;
          scrollableContainer.scrollTop = Math.min(newScroll, maxScroll);
          
          // Stop if we've reached the bottom
          if (scrollableContainer.scrollTop >= maxScroll) {
            stopAutoScroll();
          }
        } else {
          scrollableContainer.scrollTop = Math.max(newScroll, 0);
          
          // Stop if we've reached the top
          if (scrollableContainer.scrollTop <= 0) {
            stopAutoScroll();
          }
        }
      }
    }, 16); // 60fps
  }
  
  function stopAutoScroll() {
    if (autoScrollInterval) {
      clearInterval(autoScrollInterval);
      autoScrollInterval = null;
      currentScrollSpeed = 0;
      scrollAcceleration = 1;
      console.debug('DragDropManager: stopAutoScroll');
    }
  }

  // Drag handlers
  function handleDragStart(e) {
    // Don't start drag if we're editing a comment or selecting genre/country
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') {
      e.preventDefault();
      return;
    }

    console.debug('DragDropManager: drag start', {
      index: this.dataset.index,
      clientX: e.clientX,
      clientY: e.clientY,
    });
    
    draggedElement = this;
    draggedIndex = parseInt(this.dataset.index);
    
    // Find the scrollable container (the parent with overflow-y-auto)
    scrollableContainer = this.closest('.overflow-y-auto') || document.getElementById('albumContainer').parentElement;
    
    placeholder = document.createElement('div');
    placeholder.className = 'album-row drag-placeholder album-grid gap-4 px-4 py-3 border-b border-gray-800';
    placeholder.style.height = this.offsetHeight + 'px';

    console.debug('DragDropManager: placeholder created', {
      height: this.offsetHeight,
    });
    
    this.classList.add('dragging');
    
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', this.innerHTML);
    
    requestAnimationFrame(() => {
      this.style.display = 'none';
      this.parentNode.insertBefore(placeholder, this.nextSibling);
      console.debug('DragDropManager: placeholder inserted');
    });
  }

  function handleContainerDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    console.debug('DragDropManager: container drag over');
    
    const rowsContainer = this.querySelector('.album-rows-container') || this;
    
    // Enhanced auto-scroll logic
    if (scrollableContainer) {
      const clientY = e.clientY;
      const viewportHeight = window.innerHeight;
      const containerRect = scrollableContainer.getBoundingClientRect();
      
      // Larger scroll zones for easier triggering (20% of viewport height each)
      const scrollZoneSize = Math.max(80, viewportHeight * 0.2);
      
      // Calculate effective boundaries
      const topBoundary = Math.max(containerRect.top, 0);
      const bottomBoundary = Math.min(containerRect.bottom, viewportHeight);
      
      // Define scroll trigger zones
      const topScrollTrigger = topBoundary + scrollZoneSize;
      const bottomScrollTrigger = bottomBoundary - scrollZoneSize;
      
      // Calculate scroll speed based on position within the zone
      let shouldScroll = false;
      let scrollDirection = 0;
      let scrollSpeed = 0;
      
      if (clientY < topScrollTrigger && clientY >= topBoundary) {
        // In top scroll zone
        shouldScroll = true;
        scrollDirection = -1;
        
        // Calculate speed based on how deep into the zone we are
        const zoneDepth = (topScrollTrigger - clientY) / scrollZoneSize;
        scrollSpeed = Math.max(3, Math.min(20, zoneDepth * 20));
        
        // Extra boost if very close to edge
        if (clientY < topBoundary + 30) {
          scrollSpeed = Math.min(30, scrollSpeed * 1.5);
        }
      } else if (clientY > bottomScrollTrigger && clientY <= bottomBoundary) {
        // In bottom scroll zone
        shouldScroll = true;
        scrollDirection = 1;
        
        // Calculate speed based on how deep into the zone we are
        const zoneDepth = (clientY - bottomScrollTrigger) / scrollZoneSize;
        scrollSpeed = Math.max(3, Math.min(20, zoneDepth * 20));
        
        // Extra boost if very close to edge
        if (clientY > bottomBoundary - 30) {
          scrollSpeed = Math.min(30, scrollSpeed * 1.5);
        }
      }
      
      if (shouldScroll) {
        startAutoScroll(scrollDirection, scrollSpeed);
      } else {
        stopAutoScroll();
      }
    }
    
    // Update placeholder position
    const afterElement = getDragAfterElement(rowsContainer, e.clientY);
    console.debug('DragDropManager: afterElement', {
      afterElementIndex: afterElement ? afterElement.dataset.index : null,
      clientY: e.clientY,
    });
    
    if (!placeholder || !placeholder.parentNode) return;
    
    if (afterElement == null) {
      rowsContainer.appendChild(placeholder);
      lastValidDropIndex = rowsContainer.children.length - 1;
      console.debug('DragDropManager: appended placeholder', {
        lastValidDropIndex,
      });
    } else {
      rowsContainer.insertBefore(placeholder, afterElement);
      const allElements = Array.from(rowsContainer.children);
      lastValidDropIndex = allElements.indexOf(placeholder);
      console.debug('DragDropManager: inserted placeholder', {
        lastValidDropIndex,
      });
    }
    
    this.classList.add('drag-active');
  }

  function handleContainerDragLeave(e) {
    const rect = this.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right ||
        e.clientY < rect.top || e.clientY > rect.bottom) {
      this.classList.remove('drag-active');
      stopAutoScroll();
      console.debug('DragDropManager: container drag leave');
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
    stopAutoScroll();

    console.debug('DragDropManager: drag end', {
      draggedIndex,
    });
    
    if (draggedElement) {
      draggedElement.style.display = '';
      draggedElement.classList.remove('dragging');
    }
    
    // Only remove placeholder if it still exists (wasn't removed by drop handler)
    if (placeholder && placeholder.parentNode) {
      placeholder.parentNode.removeChild(placeholder);
      console.debug('DragDropManager: placeholder removed on drag end');
    }
    
    document.getElementById('albumContainer').classList.remove('drag-active');
    
    draggedElement = null;
    draggedIndex = null;
    placeholder = null;
    lastValidDropIndex = null;
    scrollableContainer = null;
    console.debug('DragDropManager: state cleared after drag end');
  }

  async function handleContainerDrop(e, saveCallback) {
    e.preventDefault();
    e.stopPropagation();

    console.debug('DragDropManager: container drop', {
      draggedIndex,
      lastValidDropIndex,
    });
    
    stopAutoScroll();
    this.classList.remove('drag-active');
    
    if (!draggedElement || lastValidDropIndex === null || !placeholder) return;
    
    const rowsContainer = this.querySelector('.album-rows-container') || this;
    
    // Calculate the final drop index
    let dropIndex = lastValidDropIndex;
    console.debug('DragDropManager: initial dropIndex', { dropIndex });
    
    // Get the actual number of album rows (excluding placeholder)
    const albumRows = rowsContainer.querySelectorAll('.album-row:not(.drag-placeholder)');
    const maxIndex = albumRows.length - 1;
    
    // Adjust drop index if dragging from before the drop position
    if (draggedIndex < dropIndex) {
      dropIndex--;
    }
    console.debug('DragDropManager: adjusted dropIndex after drag check', { dropIndex });
    
    // Ensure drop index is within valid bounds
    dropIndex = Math.max(0, Math.min(dropIndex, maxIndex));
    console.debug('DragDropManager: bounded dropIndex', { dropIndex });
    
    // Only proceed if the position actually changed
    if (dropIndex !== draggedIndex) {
      try {
        // Remove the placeholder first
        if (placeholder && placeholder.parentNode) {
          placeholder.parentNode.removeChild(placeholder);
          placeholder = null;
          console.debug('DragDropManager: placeholder removed before inserting');
        }
        
        // Calculate where to insert the dragged element
        const allRows = Array.from(rowsContainer.querySelectorAll('.album-row:not(.dragging)'));
        
        // Determine the reference element for insertion
        let referenceElement = null;
        if (dropIndex < allRows.length) {
          // Adjust reference based on original position
          if (draggedIndex < dropIndex) {
            referenceElement = allRows[dropIndex];
          } else {
            referenceElement = allRows[dropIndex];
          }
        }
        
        // Insert the dragged element at the new position
        if (referenceElement) {
          rowsContainer.insertBefore(draggedElement, referenceElement);
        } else {
          // If no reference element, append to the end
          rowsContainer.appendChild(draggedElement);
        }
        console.debug('DragDropManager: element moved', { from: draggedIndex, to: dropIndex });
        
        // Show the dragged element
        draggedElement.style.display = '';
        draggedElement.classList.remove('dragging');
        
        // Update all position numbers and data-index attributes
        updateAlbumPositions(rowsContainer);
        
        // Call the save callback if provided
        if (saveCallback) {
          console.debug('DragDropManager: saving', { from: draggedIndex, to: dropIndex });
          await saveCallback(draggedIndex, dropIndex);
        }
        
      } catch (error) {
        console.error('Error saving reorder:', error);
        showToast('Error saving changes', 'error');
        // On error, trigger a rebuild through the callback
        if (saveCallback) {
          saveCallback(null, null, true); // Third parameter indicates error/rebuild needed
        }
      }
    } else {
      // Position didn't change, just clean up
      console.debug('DragDropManager: position unchanged');
      if (placeholder && placeholder.parentNode) {
        placeholder.parentNode.removeChild(placeholder);
        placeholder = null;
        console.debug('DragDropManager: placeholder removed (unchanged position)');
      }
      
      // Show the dragged element in its original position
      draggedElement.style.display = '';
      draggedElement.classList.remove('dragging');
    }
    
    // Clean up drag state
    draggedElement = null;
    draggedIndex = null;
    lastValidDropIndex = null;
    scrollableContainer = null;
    console.debug('DragDropManager: cleanup after drop');
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

    console.debug('DragDropManager: positions updated', {
      totalRows: rows.length,
    });
  }

  // Make row draggable
  function makeRowDraggable(row) {
    row.draggable = true;
    row.addEventListener('dragstart', handleDragStart);
    row.addEventListener('dragend', handleDragEnd);

    console.debug('DragDropManager: row made draggable', {
      index: row.dataset.index,
    });
  }

  // Public API
  return {
    initialize,
    makeRowDraggable,
    setupDropHandler: function(saveCallback) {
      const container = document.getElementById('albumContainer');
      if (container) {
        console.debug('DragDropManager: setup drop handler');

        // Remove any existing drop handlers
        if (container._dropHandler) {
          container.removeEventListener('drop', container._dropHandler);
        }
        container.removeEventListener('drop', handleContainerDrop);

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
