const { describe, it, mock } = require('node:test');
const assert = require('node:assert');

function createClassList(initial = []) {
  const classes = new Set(initial);
  return {
    add: (...items) => items.forEach((item) => classes.add(item)),
    remove: (...items) => items.forEach((item) => classes.delete(item)),
    contains: (item) => classes.has(item),
  };
}

function createElement(id, initialClasses = ['hidden']) {
  const listeners = {};
  return {
    id,
    classList: createClassList(initialClasses),
    style: {},
    innerHTML: '',
    addEventListener: (event, handler) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    },
    removeEventListener: (event, handler) => {
      if (!listeners[event]) return;
      listeners[event] = listeners[event].filter((h) => h !== handler);
    },
    getBoundingClientRect: () => ({ top: 100, right: 400 }),
    querySelectorAll: () => [],
    querySelector: () => null,
    contains: () => false,
  };
}

function buildDeps(overrides = {}) {
  return {
    apiCall: async () => ({}),
    showToast: () => {},
    showConfirmation: () => {},
    showReasoningModal: async () => null,
    showViewReasoningModal: () => {},
    escapeHtml: (s) => s,
    positionContextMenu: () => {},
    createActionSheet: () => ({ close: () => {} }),
    groupListsByYear: () => ({
      listsByYear: { 2024: ['list-2024'] },
      sortedYears: ['2024'],
    }),
    editRecommendationReasoning: async () => {},
    removeRecommendation: async () => {},
    getListData: () => [],
    setListData: () => {},
    getLists: () => ({}),
    getCurrentListId: () => '',
    setCurrentListId: () => {},
    getCurrentRecommendationsYear: () => 2024,
    setCurrentRecommendationsYear: () => {},
    getRealtimeSyncModuleInstance: () => null,
    hideAllContextMenus: () => {},
    clearPlaycountCache: () => {},
    updateListNavActiveState: () => {},
    updateHeaderTitle: () => {},
    updateMobileHeader: () => {},
    showLoadingSpinner: () => {},
    refreshRecommendationYears: () => {},
    playAlbumByMetadata: () => {},
    showPlayAlbumSubmenuForAlbum: () => {},
    createContextSubmenuController: () => ({
      initialize: () => {},
      hideAll: () => {},
      destroy: () => {},
    }),
    ...overrides,
  };
}

describe('recommendation context menu coordination', async () => {
  const { createRecommendations } =
    await import('../src/js/modules/recommendations.js');

  it('hides play submenu when add-to-list submenu opens', () => {
    const elements = {
      recommendationContextMenu: createElement('recommendationContextMenu', []),
      playRecommendationOption: createElement('playRecommendationOption', []),
      addToListOption: createElement('addToListOption', []),
      removeRecommendationOption: createElement(
        'removeRecommendationOption',
        []
      ),
      editReasoningOption: createElement('editReasoningOption', []),
      recommendationAddSubmenu: createElement('recommendationAddSubmenu'),
      recommendationAddListsSubmenu: createElement(
        'recommendationAddListsSubmenu'
      ),
      playAlbumSubmenu: createElement('playAlbumSubmenu'),
    };

    globalThis.document = {
      getElementById: (id) => elements[id] || null,
    };
    globalThis.window = { currentUser: {} };

    const controllerConfigs = [];
    const recommendations = createRecommendations(
      buildDeps({
        createContextSubmenuController: (config) => {
          controllerConfigs.push(config);
          return {
            initialize: () => {},
            hideAll: () => {},
            destroy: () => {},
          };
        },
      })
    );

    recommendations.initializeRecommendationContextMenu();

    elements.playAlbumSubmenu.classList.remove('hidden');
    elements.playRecommendationOption.classList.add(
      'bg-gray-700',
      'text-white'
    );

    const config = controllerConfigs[0];
    const addBranch = config.branches.find(
      (branch) => branch.triggerId === 'addToListOption'
    );
    addBranch.onShow();

    assert.ok(elements.playAlbumSubmenu.classList.contains('hidden'));
    assert.ok(
      !elements.playRecommendationOption.classList.contains('bg-gray-700')
    );
  });

  it('registers chained submenu coordination for recommendation menu', () => {
    const elements = {
      recommendationContextMenu: createElement('recommendationContextMenu', []),
      playRecommendationOption: createElement('playRecommendationOption', []),
      addToListOption: createElement('addToListOption', []),
      removeRecommendationOption: createElement(
        'removeRecommendationOption',
        []
      ),
      editReasoningOption: createElement('editReasoningOption', []),
      recommendationAddSubmenu: createElement('recommendationAddSubmenu'),
      recommendationAddListsSubmenu: createElement(
        'recommendationAddListsSubmenu'
      ),
      playAlbumSubmenu: createElement('playAlbumSubmenu'),
    };

    globalThis.document = {
      getElementById: (id) => elements[id] || null,
    };
    globalThis.window = { currentUser: {} };

    const createContextSubmenuController = mock.fn(() => ({
      initialize: () => {},
      hideAll: () => {},
      destroy: () => {},
    }));

    const recommendations = createRecommendations(
      buildDeps({
        createContextSubmenuController,
      })
    );

    recommendations.initializeRecommendationContextMenu();

    assert.strictEqual(createContextSubmenuController.mock.calls.length, 1);

    const config = createContextSubmenuController.mock.calls[0].arguments[0];
    assert.strictEqual(
      config.contextMenuId,
      elements.recommendationContextMenu
    );
    assert.strictEqual(config.branches.length, 2);
    assert.strictEqual(
      config.branches[0].triggerId,
      'playRecommendationOption'
    );
    assert.strictEqual(config.branches[1].triggerId, 'addToListOption');
  });
});
