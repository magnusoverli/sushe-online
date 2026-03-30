import { setupSubmenuHover, setupChainedSubmenus } from './submenu-behavior.js';

/**
 * Create a shared controller for context-menu submenus.
 *
 * The controller coordinates:
 * - top-level trigger hover/click behavior
 * - mutual exclusion between submenu branches
 * - chained mouse-leave behavior across context menu + submenus
 * - cleanup of event listeners/timeouts on re-initialization
 *
 * @param {Object} config
 * @param {string|HTMLElement} config.contextMenuId - Context menu element/id
 * @param {Array<Object>} config.branches - Submenu branch definitions
 * @param {number} [config.hideDelay=100] - Hide delay in ms
 * @param {boolean} [config.showOnClick=true] - Whether trigger click also opens submenu
 * @param {Function} [config.onHideAll] - Called after all branches are hidden
 * @param {Object} [deps] - Optional test overrides
 * @param {Function} [deps.setupSubmenuHoverFn] - Override setupSubmenuHover
 * @param {Function} [deps.setupChainedSubmenusFn] - Override setupChainedSubmenus
 * @returns {{ initialize: Function, hideAll: Function, destroy: Function }}
 */
export function createContextSubmenuController(config, deps = {}) {
  const {
    contextMenuId,
    branches = [],
    hideDelay = 100,
    showOnClick = true,
    onHideAll,
  } = config;

  const setupSubmenuHoverFn = deps.setupSubmenuHoverFn || setupSubmenuHover;
  const setupChainedSubmenusFn =
    deps.setupChainedSubmenusFn || setupChainedSubmenus;

  let hoverHandles = [];
  let chainedHandle = null;

  const resolveElement = (elementOrId) => {
    if (!elementOrId) return null;
    if (typeof elementOrId === 'string') {
      return document.getElementById(elementOrId);
    }
    return elementOrId;
  };

  const resolveElements = (items = []) =>
    items.map((item) => resolveElement(item)).filter(Boolean);

  const hideBranch = (branch) => {
    if (!branch) return;

    branch.onHide?.();

    const triggerEl = resolveElement(branch.triggerId);
    triggerEl?.classList.remove('bg-gray-700', 'text-white');
  };

  const hideOtherBranches = (activeBranch) => {
    branches.forEach((branch) => {
      if (branch !== activeBranch) {
        hideBranch(branch);
      }
    });
  };

  const hideAllBranches = () => {
    branches.forEach((branch) => hideBranch(branch));
    onHideAll?.();
  };

  const buildChainedSubmenuConfig = () => {
    const submenus = [];

    branches.forEach((branch) => {
      const triggerEl = resolveElement(branch.triggerId);
      const relatedMenus = resolveElements(branch.relatedMenuIds || []);

      (branch.submenuIds || []).forEach((submenuId) => {
        const submenuEl = resolveElement(submenuId);
        submenus.push({
          element: submenuEl,
          triggerElement: triggerEl,
          relatedMenus,
        });
      });
    });

    return submenus;
  };

  const destroy = () => {
    hoverHandles.forEach((handle) => {
      handle?.clearHideTimeout?.();
      handle?.destroy?.();
    });
    hoverHandles = [];

    chainedHandle?.destroy?.();
    chainedHandle = null;
  };

  const initialize = () => {
    destroy();

    const contextMenuEl = resolveElement(contextMenuId);
    if (!contextMenuEl) return;

    branches.forEach((branch) => {
      const triggerEl = resolveElement(branch.triggerId);
      if (!triggerEl) return;

      const handle = setupSubmenuHoverFn(triggerEl, {
        onShow: () => {
          hideOtherBranches(branch);
          branch.onShow?.();
        },
        relatedElements: () =>
          resolveElements([
            ...(branch.submenuIds || []),
            ...(branch.relatedMenuIds || []),
          ]),
        onHide: () => hideBranch(branch),
        hideDelay,
        showOnClick:
          typeof branch.showOnClick === 'boolean'
            ? branch.showOnClick
            : showOnClick,
      });

      hoverHandles.push(handle);
    });

    chainedHandle = setupChainedSubmenusFn({
      contextMenu: contextMenuEl,
      submenus: buildChainedSubmenuConfig(),
      hideDelay,
      onHideAll: hideAllBranches,
    });
  };

  return {
    initialize,
    hideAll: hideAllBranches,
    destroy,
  };
}
