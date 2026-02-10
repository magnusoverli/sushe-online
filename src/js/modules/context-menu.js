/**
 * Context Menu Module
 *
 * Shared utilities for context menu positioning and visibility management.
 * Imported by context-menus.js, album-display.js, album-context-menu.js, etc.
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

// All known menu/submenu element IDs that should be hidden
const MENU_IDS = [
  'contextMenu',
  'albumContextMenu',
  'albumMoveSubmenu',
  'albumCopySubmenu',
  'playAlbumSubmenu',
  'downloadListSubmenu',
  'recommendationContextMenu',
  'recommendationAddSubmenu',
  'recommendationAddListsSubmenu',
  'personalRecContextMenu',
  'personalRecAddSubmenu',
  'personalRecAddListsSubmenu',
];

// Option elements that receive highlights when their submenu is open
const OPTION_IDS = [
  'moveAlbumOption',
  'copyAlbumOption',
  'playAlbumOption',
  'downloadListOption',
  'addToListOption',
  'addPersonalRecToListOption',
];

/**
 * Hide all known context menus and submenus, remove option highlights, restore FAB.
 * Modules should call this then perform any additional module-specific cleanup
 * (e.g., clearing context state, canceling abort controllers).
 */
export function hideAllContextMenus() {
  // Hide all known menus
  for (const id of MENU_IDS) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  }

  // Remove highlights from submenu parent options
  for (const id of OPTION_IDS) {
    document.getElementById(id)?.classList.remove('bg-gray-700', 'text-white');
  }

  // Restore FAB visibility
  const fab = document.getElementById('addAlbumFAB');
  if (fab) {
    fab.style.display = 'flex';
  }
}
