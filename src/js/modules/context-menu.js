/**
 * Context Menu Module
 *
 * Positioning utilities for context menus with viewport overflow handling.
 *
 * @module context-menu
 */

/**
 * @typedef {Object} MenuPosition
 * @property {number} x - X coordinate
 * @property {number} y - Y coordinate
 */

/**
 * Position a context menu element, adjusting if it would overflow the viewport
 * Uses requestAnimationFrame for performance optimization
 *
 * @param {HTMLElement} menu - Menu element to position
 * @param {number} x - Initial X position
 * @param {number} y - Initial Y position
 */
export function positionContextMenu(menu, x, y) {
  // Hide FAB when context menu is shown to avoid overlap on mobile
  const fab = document.getElementById('addAlbumFAB');
  if (fab) {
    fab.style.display = 'none';
  }

  // Initial position
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.classList.remove('hidden');

  // Use requestAnimationFrame to batch the read phase after paint
  requestAnimationFrame(() => {
    // Read phase - measure menu dimensions and viewport
    const rect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Calculate phase - determine adjustments needed
    let adjustedX = x;
    let adjustedY = y;

    if (rect.right > viewportWidth) {
      adjustedX = x - rect.width;
    }
    if (rect.bottom > viewportHeight) {
      adjustedY = y - rect.height;
    }

    // Write phase - apply adjustments if needed
    if (adjustedX !== x || adjustedY !== y) {
      menu.style.left = `${adjustedX}px`;
      menu.style.top = `${adjustedY}px`;
    }
  });
}
