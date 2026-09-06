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

/**
 * Every context menu and submenu rendered by contextMenusComponent().
 *
 * This list is the contract: a menu missing from it is never closed by the
 * document-click handler, so it survives its own parent and hangs over the
 * page until something else happens to hide it. Both `moveListSubmenu` and
 * `categoryContextMenu` were missing and did exactly that.
 *
 * test/context-menu-dom-contract.test.js renders the template and fails if a
 * menu is added there without being added here.
 */
const MENU_IDS = [
  // List context menu (sidebar right-click) and its submenus
  'contextMenu',
  'downloadListSubmenu',
  'moveListSubmenu',
  // Category context menu (sidebar group right-click)
  'categoryContextMenu',
  // Album context menu and its two-level submenus
  'albumContextMenu',
  'albumMoveSubmenu',
  'albumMoveListsSubmenu',
  'albumCopySubmenu',
  'albumCopyListsSubmenu',
  'playAlbumSubmenu',
  // Recommendation context menu and its submenus
  'recommendationContextMenu',
  'recommendationAddSubmenu',
  'recommendationAddListsSubmenu',
];

/**
 * Options that take a highlight while their submenu is open.
 *
 * These must be un-highlighted alongside the hide, or the row stays lit under
 * a menu that is no longer there. Year rows inside a submenu are not listed:
 * they are rebuilt with the submenu's innerHTML and cannot outlive it.
 */
const OPTION_IDS = [
  'downloadListOption',
  'moveListOption',
  'moveAlbumOption',
  'copyAlbumOption',
  'playAlbumOption',
  'playRecommendationOption',
  'addToListOption',
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
