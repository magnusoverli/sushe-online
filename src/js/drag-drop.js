// Drag and Drop Module for Album Reordering using SortableJS
const DragDropManager = (function() {
  let sortable = null;
  let saveCallback = null;

  // Auto-scroll state
  let autoScrollInterval = null;
  let currentScrollSpeed = 0;
  let scrollAcceleration = 1;
  let scrollableContainer = null;

  function initialize() {
    const container = document.getElementById('albumContainer');
    if (!container || !window.Sortable) return;

    const rowsContainer = container.querySelector('.album-rows-container') || container;
    scrollableContainer = rowsContainer.closest('.overflow-y-auto') || container.parentElement;

    if (sortable) {
      sortable.destroy();
    }

    sortable = Sortable.create(rowsContainer, {
      animation: 150,
      draggable: '.album-row',
      forceFallback: true,
      fallbackClass: 'dragging',
      ghostClass: 'drag-placeholder',
      chosenClass: 'dragging',
      scroll: false,
      onStart(evt) {
        evt.item.dataset.originalIndex = evt.oldIndex;
        container.classList.add('drag-active', 'dragging-active');
        document.body.classList.add('desktop-dragging');
      },
      onMove(evt) {
        handleAutoScroll(evt.originalEvent);
      },
      onEnd(evt) {
        stopAutoScroll();
        container.classList.remove('drag-active', 'dragging-active');
        document.body.classList.remove('desktop-dragging');

        if (evt.oldIndex !== evt.newIndex && typeof saveCallback === 'function') {
          Promise.resolve(saveCallback(evt.oldIndex, evt.newIndex)).catch(console.error);
        }

        updateAlbumPositions(rowsContainer);
      }
    });
  }

  function handleAutoScroll(e) {
    if (!scrollableContainer) return;
    const clientY = e.clientY;
    const viewportHeight = window.innerHeight;
    const containerRect = scrollableContainer.getBoundingClientRect();

    const scrollZoneSize = Math.max(80, viewportHeight * 0.2);
    const topBoundary = Math.max(containerRect.top, 0);
    const bottomBoundary = Math.min(containerRect.bottom, viewportHeight);
    const topScrollTrigger = topBoundary + scrollZoneSize;
    const bottomScrollTrigger = bottomBoundary - scrollZoneSize;

    let shouldScroll = false;
    let direction = 0;
    let speed = 0;

    if (clientY < topScrollTrigger && clientY >= topBoundary) {
      shouldScroll = true;
      direction = -1;
      const zoneDepth = (topScrollTrigger - clientY) / scrollZoneSize;
      speed = Math.max(3, Math.min(20, zoneDepth * 20));
      if (clientY < topBoundary + 30) speed = Math.min(30, speed * 1.5);
    } else if (clientY > bottomScrollTrigger && clientY <= bottomBoundary) {
      shouldScroll = true;
      direction = 1;
      const zoneDepth = (clientY - bottomScrollTrigger) / scrollZoneSize;
      speed = Math.max(3, Math.min(20, zoneDepth * 20));
      if (clientY > bottomBoundary - 30) speed = Math.min(30, speed * 1.5);
    }

    if (shouldScroll) {
      startAutoScroll(direction, speed);
    } else {
      stopAutoScroll();
    }
  }

  function startAutoScroll(direction, speed) {
    if (autoScrollInterval) {
      clearInterval(autoScrollInterval);
    }

    currentScrollSpeed = speed;
    scrollAcceleration = 1;

    autoScrollInterval = setInterval(() => {
      if (scrollableContainer) {
        if (scrollAcceleration < 2.5) {
          scrollAcceleration += 0.05;
        }

        const adjustedSpeed = currentScrollSpeed * scrollAcceleration;
        const currentScroll = scrollableContainer.scrollTop;
        const newScroll = currentScroll + direction * adjustedSpeed;

        if (direction > 0) {
          const maxScroll = scrollableContainer.scrollHeight - scrollableContainer.clientHeight;
          scrollableContainer.scrollTop = Math.min(newScroll, maxScroll);
          if (scrollableContainer.scrollTop >= maxScroll) {
            stopAutoScroll();
          }
        } else {
          scrollableContainer.scrollTop = Math.max(newScroll, 0);
          if (scrollableContainer.scrollTop <= 0) {
            stopAutoScroll();
          }
        }
      }
    }, 16);
  }

  function stopAutoScroll() {
    if (autoScrollInterval) {
      clearInterval(autoScrollInterval);
      autoScrollInterval = null;
      currentScrollSpeed = 0;
      scrollAcceleration = 1;
    }
  }

  function updateAlbumPositions(container) {
    const rows = Array.from(container.querySelectorAll('.album-row'));
    rows.forEach((row, index) => {
      const positionEl = row.querySelector('.flex.items-center.justify-center');
      if (positionEl) {
        positionEl.textContent = index + 1;
      }
      row.dataset.index = index;
    });
  }

  function makeRowDraggable() {
    // No-op with SortableJS but kept for API compatibility
  }

  function setupDropHandler(callback) {
    saveCallback = callback;
  }

  return { initialize, makeRowDraggable, setupDropHandler };
})();

window.DragDropManager = DragDropManager;
