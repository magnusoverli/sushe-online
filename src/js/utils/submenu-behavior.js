/**
 * Submenu hover behavior utilities.
 * Manages show/hide of submenus with mouseenter/mouseleave timeouts.
 */

/**
 * Set up hover behavior for a menu trigger that opens a submenu.
 * Handles mouseenter to show, mouseleave with timeout to hide,
 * and optional highlight classes on the trigger.
 *
 * @param {HTMLElement} trigger - The menu item that triggers the submenu
 * @param {Object} options - Configuration options
 * @param {Function} options.onShow - Called when submenu should be shown
 * @param {Function|HTMLElement[]} options.relatedElements - Elements (or function returning them) to check when mouse leaves
 * @param {Function} [options.onHide] - Called when submenu should be hidden
 * @param {string[]} [options.highlightClasses] - CSS classes to add/remove on trigger (default: ['bg-gray-700', 'text-white'])
 * @param {number} [options.hideDelay] - Delay in ms before hiding (default: 100)
 * @param {boolean} [options.showOnClick] - Also show on click (default: true)
 * @returns {{ destroy: Function, clearHideTimeout: Function }} Cleanup and control functions
 */
export function setupSubmenuHover(trigger, options) {
  const {
    onShow,
    relatedElements,
    onHide,
    highlightClasses = ['bg-gray-700', 'text-white'],
    hideDelay = 100,
    showOnClick = true,
  } = options;

  let hideTimeout = null;

  const clearHideTimeout = () => {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
  };

  const handleMouseEnter = () => {
    clearHideTimeout();
    onShow();
  };

  const handleMouseLeave = (e) => {
    const elements =
      typeof relatedElements === 'function'
        ? relatedElements()
        : relatedElements;
    const movedToRelated = elements.some(
      (el) => el && (e.relatedTarget === el || el.contains(e.relatedTarget))
    );

    if (!movedToRelated) {
      hideTimeout = setTimeout(() => {
        if (onHide) {
          onHide();
        }
        highlightClasses.forEach((cls) => trigger.classList.remove(cls));
      }, hideDelay);
    }
  };

  const handleClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onShow();
  };

  trigger.addEventListener('mouseenter', handleMouseEnter);
  trigger.addEventListener('mouseleave', handleMouseLeave);
  if (showOnClick) {
    trigger.addEventListener('click', handleClick);
  }

  return {
    clearHideTimeout,
    destroy: () => {
      clearHideTimeout();
      trigger.removeEventListener('mouseenter', handleMouseEnter);
      trigger.removeEventListener('mouseleave', handleMouseLeave);
      if (showOnClick) {
        trigger.removeEventListener('click', handleClick);
      }
    },
  };
}

/**
 * Set up coordinated hide behavior for a context menu with submenus.
 * When the mouse leaves any of the connected menus, all submenus are hidden
 * after a short delay, unless the mouse moves to another connected menu.
 *
 * @param {Object} config - Configuration
 * @param {HTMLElement} config.contextMenu - The main context menu
 * @param {Array<{ element: HTMLElement, triggerElement?: HTMLElement, relatedMenus?: HTMLElement[] }>} config.submenus - Submenu configurations
 * @param {Function} [config.onHideAll] - Called when all submenus are hidden
 * @param {number} [config.hideDelay] - Delay in ms before hiding (default: 100)
 * @returns {{ destroy: Function }} Cleanup function
 */
export function setupChainedSubmenus(config) {
  const { contextMenu, submenus, onHideAll, hideDelay = 100 } = config;
  let submenuTimeout;
  const cleanups = [];

  const allElements = [contextMenu, ...submenus.map((s) => s.element)];

  const hideAllSubmenus = () => {
    submenuTimeout = setTimeout(() => {
      submenus.forEach((sub) => {
        if (sub.element) sub.element.classList.add('hidden');
        if (sub.triggerElement) {
          sub.triggerElement.classList.remove('bg-gray-700', 'text-white');
        }
      });
      if (onHideAll) onHideAll();
    }, hideDelay);
  };

  const cancelHide = () => {
    if (submenuTimeout) clearTimeout(submenuTimeout);
  };

  // Context menu leave handler
  const handleContextMenuLeave = (e) => {
    const movedToAny = allElements.some(
      (el) => el && (e.relatedTarget === el || el.contains(e.relatedTarget))
    );
    if (!movedToAny) {
      hideAllSubmenus();
    }
  };

  contextMenu.addEventListener('mouseleave', handleContextMenuLeave);
  cleanups.push(() =>
    contextMenu.removeEventListener('mouseleave', handleContextMenuLeave)
  );

  // Submenu handlers
  submenus.forEach((sub) => {
    if (!sub.element) return;

    const handleEnter = () => cancelHide();
    const handleLeave = (e) => {
      // Check if moving to context menu or any related menu
      const relatedMenus = sub.relatedMenus || [];
      const checkElements = [contextMenu, ...relatedMenus];
      const movedToRelated = checkElements.some(
        (el) => el && (e.relatedTarget === el || el.contains(e.relatedTarget))
      );
      if (!movedToRelated) {
        hideAllSubmenus();
      }
    };

    sub.element.addEventListener('mouseenter', handleEnter);
    sub.element.addEventListener('mouseleave', handleLeave);
    cleanups.push(() => {
      sub.element.removeEventListener('mouseenter', handleEnter);
      sub.element.removeEventListener('mouseleave', handleLeave);
    });
  });

  return {
    destroy: () => {
      cancelHide();
      cleanups.forEach((fn) => fn());
    },
  };
}
