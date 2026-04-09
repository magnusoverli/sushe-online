/**
 * App startup UI helpers for flash-to-toast and shell interactions.
 */

export function createAppStartupUi(deps = {}) {
  const doc = deps.doc || (typeof document !== 'undefined' ? document : null);
  const win = deps.win || (typeof window !== 'undefined' ? window : null);
  const storage =
    deps.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  const logger = deps.logger || console;
  const showToast = deps.showToast || (() => {});

  function convertFlashToToast() {
    if (!doc?.body) return;

    doc.body.classList.add('js-enabled');
    const flashMessages = doc.querySelectorAll('[data-flash]');

    logger.log('Flash messages found:', flashMessages.length);
    flashMessages.forEach((element) => {
      const type = element.dataset.flash;
      const message =
        element.dataset.flashContent || element.textContent.trim();

      logger.log('Processing flash:', {
        type,
        message,
        hasContent: !!message,
      });

      if (message) {
        showToast(message, type);
      }
    });
  }

  function initializeSidebarCollapse() {
    const sidebar = doc?.getElementById('sidebar');
    const sidebarToggle = doc?.getElementById('sidebarToggle');
    const mainContent = doc?.querySelector('.main-content');

    if (!sidebar || !sidebarToggle || !mainContent || !storage) {
      return;
    }

    const isCollapsed = storage.getItem('sidebarCollapsed') === 'true';
    if (isCollapsed) {
      sidebar.classList.add('collapsed');
      mainContent.classList.add('sidebar-collapsed');
    }

    doc.documentElement.classList.remove('sidebar-is-collapsed');

    sidebarToggle.addEventListener('click', () => {
      const isCurrentlyCollapsed = sidebar.classList.contains('collapsed');

      if (isCurrentlyCollapsed) {
        sidebar.classList.remove('collapsed');
        mainContent.classList.remove('sidebar-collapsed');
        storage.setItem('sidebarCollapsed', 'false');
      } else {
        sidebar.classList.add('collapsed');
        mainContent.classList.add('sidebar-collapsed');
        storage.setItem('sidebarCollapsed', 'true');
      }
    });
  }

  function registerBeforeUnloadListSaver(getCurrentListId) {
    if (!win || !storage || typeof getCurrentListId !== 'function') {
      return;
    }

    win.addEventListener('beforeunload', () => {
      const currentListId = getCurrentListId();
      if (!currentListId) return;

      try {
        storage.setItem('lastSelectedList', currentListId);
      } catch (error) {
        logger.warn('Failed to save last selected list on unload:', error.name);
      }
    });
  }

  return {
    convertFlashToToast,
    initializeSidebarCollapse,
    registerBeforeUnloadListSaver,
  };
}
