// Serialize the entire remove/create transaction; failed renders remain retryable.
(function () {
  function createContextMenuService({
    chrome,
    constants = globalThis.ExtensionConstants,
  }) {
    const { MENU } = constants;
    const { createSerialQueue, sortListYears } = globalThis.SharedUtils;
    const enqueue = createSerialQueue();
    let signature = null;

    function call(method, ...args) {
      return new Promise((resolve, reject) => {
        chrome.contextMenus[method](...args, () => {
          const error = chrome.runtime.lastError;
          if (error) reject(new Error(error.message));
          else resolve();
        });
      });
    }

    function child(id, title, options = {}) {
      return {
        id,
        title,
        parentId: MENU.MAIN_ID,
        contexts: MENU.CONTEXTS,
        ...options,
      };
    }

    function render(children) {
      const menus = [
        {
          id: MENU.MAIN_ID,
          title: 'Add to SuShe Online',
          contexts: MENU.CONTEXTS,
          documentUrlPatterns: MENU.DOCUMENT_URL_PATTERNS,
        },
        ...children,
      ];
      const next = JSON.stringify(menus);
      return enqueue(async () => {
        if (signature === next) return;
        signature = null;
        await call('removeAll');
        for (const menu of menus) await call('create', menu);
        signature = next;
      });
    }

    function updateWithLists(groups, lists, lastUsed) {
      const children = [];
      const recent = lists.find((list) => list._id === lastUsed?.id);
      if (!lists.length)
        children.push(
          child(MENU.NO_LISTS_ID, 'No lists found - Create one first!', {
            enabled: false,
          })
        );
      if (recent) {
        children.push(
          child(
            MENU.LAST_USED_ID,
            `Last used: ${recent.year || 'Uncategorized'} - ${recent.name}`
          )
        );
      }
      for (const year of sortListYears(groups)) {
        const yearId = `sushe-year-${year}`;
        children.push(child(yearId, `${year} (${groups[year].length})`));
        for (const list of groups[year]) {
          const id = `${MENU.LIST_PREFIX}${list._id}`;
          children.push(child(id, list.name, { parentId: yearId }));
        }
      }
      return render(children);
    }

    function findListForMenuId(menuId, lists, lastUsed) {
      // Chrome retains menu items when a service worker suspends. Resolve their
      // stable IDs against the current account, without a prior in-memory render.
      const id =
        menuId === MENU.LAST_USED_ID
          ? lastUsed?.id
          : String(menuId).startsWith(MENU.LIST_PREFIX)
            ? menuId.slice(MENU.LIST_PREFIX.length)
            : null;
      return lists.find((list) => list._id === id) || null;
    }

    function showError(message) {
      const isAuth = message === 'Not logged in';
      const isConfig = message === 'Not configured';
      return render([
        child(
          MENU.ERROR_ID,
          isAuth ? 'Not logged in to SuShe Online' : message.slice(0, 70),
          { enabled: false }
        ),
        child(
          isAuth ? MENU.LOGIN_ID : isConfig ? MENU.SETUP_ID : MENU.REFRESH_ID,
          isAuth ? 'Click to login' : isConfig ? 'Open Settings' : 'Try again'
        ),
      ]);
    }

    return {
      updateWithLists,
      showError,
      showWelcome: () =>
        render([
          child(MENU.WELCOME_ID, 'Welcome! Click to get started', {
            enabled: false,
          }),
          child(MENU.SETUP_ID, 'Open Settings & Login'),
        ]),
      findListForMenuId,
    };
  }
  globalThis.ContextMenuService = { createContextMenuService };
})();
