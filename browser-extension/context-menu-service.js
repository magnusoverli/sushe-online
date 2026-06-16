// Context menu rendering and lookup for the SuShe Online extension.

(function () {
  function createContextMenuService(deps = {}) {
    const chromeApi = deps.chrome || chrome;
    const logger = deps.logger || console;
    const { MENU } = deps.constants || globalThis.ExtensionConstants;

    let lastMenuSignature = null;
    let activeMenuKind = null;
    let menuListById = {};

    function resetSignature() {
      lastMenuSignature = null;
      activeMenuKind = null;
      menuListById = {};
    }

    function getSignature(kind, data = null) {
      return JSON.stringify({ kind, data });
    }

    function buildListSignatureData(userListsByYear) {
      const years = Object.keys(userListsByYear).sort((a, b) => {
        if (a === 'Uncategorized') return 1;
        if (b === 'Uncategorized') return -1;
        return parseInt(b) - parseInt(a);
      });

      return years.map((year) => ({
        year,
        lists: (userListsByYear[year] || []).map((list) => ({
          id: list._id,
          name: list.name,
          count: list.count,
        })),
      }));
    }

    async function removeAllMenus() {
      return new Promise((resolve) => {
        chromeApi.contextMenus.removeAll(() => {
          if (chromeApi.runtime.lastError) {
            logger.log(
              'Remove all menus error (ignored):',
              chromeApi.runtime.lastError
            );
          }
          resolve();
        });
      });
    }

    function createMenu(options) {
      chromeApi.contextMenus.create(options, () => {
        if (chromeApi.runtime.lastError) {
          logger.log(
            'Menu creation error (ignored):',
            chromeApi.runtime.lastError
          );
        }
      });
    }

    function createMainMenu() {
      createMenu({
        id: MENU.MAIN_ID,
        title: 'Add to SuShe Online',
        contexts: MENU.CONTEXTS,
        documentUrlPatterns: MENU.DOCUMENT_URL_PATTERNS,
      });
    }

    function createChildMenu(id, title, options = {}) {
      const menuOptions = {
        id,
        parentId: options.parentId || MENU.MAIN_ID,
        title,
        contexts: MENU.CONTEXTS,
      };

      if (Object.prototype.hasOwnProperty.call(options, 'enabled')) {
        menuOptions.enabled = options.enabled;
      }

      createMenu(menuOptions);
    }

    async function updateWithLists(userListsByYear, userLists) {
      const menuSignature = getSignature(
        'lists',
        buildListSignatureData(userListsByYear)
      );
      if (activeMenuKind === 'lists' && lastMenuSignature === menuSignature) {
        return;
      }

      try {
        await removeAllMenus();
        menuListById = {};
        createMainMenu();

        if (userLists.length === 0) {
          createChildMenu(
            MENU.NO_LISTS_ID,
            'No lists found - Create one first!',
            { enabled: false }
          );
          activeMenuKind = 'lists';
          lastMenuSignature = menuSignature;
          return;
        }

        const years = Object.keys(userListsByYear).sort((a, b) => {
          if (a === 'Uncategorized') return 1;
          if (b === 'Uncategorized') return -1;
          return parseInt(b) - parseInt(a);
        });

        for (const year of years) {
          const lists = userListsByYear[year];
          const yearId = `sushe-year-${year}`;
          createChildMenu(yearId, `${year} (${lists.length})`);

          lists.forEach((list) => {
            const listMenuId = `${MENU.LIST_PREFIX}${list._id}`;
            menuListById[listMenuId] = list;
            createChildMenu(listMenuId, list.name, { parentId: yearId });
          });
        }

        activeMenuKind = 'lists';
        lastMenuSignature = menuSignature;
      } catch (error) {
        logger.error('Error updating context menu:', error);
      }
    }

    async function showWelcome() {
      try {
        await removeAllMenus();
        resetSignature();
        createMainMenu();
        createChildMenu(MENU.WELCOME_ID, 'Welcome! Click to get started', {
          enabled: false,
        });
        createChildMenu(MENU.SETUP_ID, 'Open Settings & Login');

        activeMenuKind = 'welcome';
        lastMenuSignature = getSignature('welcome');
      } catch (error) {
        logger.error('Error showing welcome menu:', error);
      }
    }

    async function showError(message) {
      try {
        await removeAllMenus();
        resetSignature();
        createMainMenu();

        const isAuthError =
          message === 'Not logged in' ||
          message.includes('401') ||
          message.includes('authenticated');
        const errorTitle = isAuthError
          ? 'Not logged in to SuShe Online'
          : `Error: ${message.substring(0, 50)}`;

        createChildMenu(MENU.ERROR_ID, errorTitle, { enabled: false });

        if (isAuthError) {
          createChildMenu(MENU.LOGIN_ID, 'Click to login');
        } else {
          createChildMenu(MENU.REFRESH_ID, 'Try again');
        }

        activeMenuKind = 'error';
        lastMenuSignature = getSignature('error', message);
      } catch (error) {
        logger.error('Error showing error menu:', error);
      }
    }

    function findListForMenuId(menuItemId, userLists, userListsByYear) {
      const clickedListId = menuItemId.replace(MENU.LIST_PREFIX, '');
      return (
        menuListById[menuItemId] ||
        userLists.find((list) => list._id === clickedListId) ||
        Object.values(userListsByYear)
          .flat()
          .find((list) => list._id === clickedListId) ||
        null
      );
    }

    return {
      findListForMenuId,
      removeAllMenus,
      resetSignature,
      showError,
      showWelcome,
      updateWithLists,
    };
  }

  globalThis.ContextMenuService = {
    createContextMenuService,
  };
})();
