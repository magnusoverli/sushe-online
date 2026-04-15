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

function createElement(id) {
  return {
    id,
    classList: createClassList(),
    style: {},
    innerHTML: '',
    querySelector: () => null,
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 100, right: 380 }),
  };
}

describe('album context menu submenu controller wiring', async () => {
  const { createAlbumContextMenu } =
    await import('../src/js/modules/album-context-menu.js');

  it('initializes shared submenu controller for album context menu', () => {
    const elements = {
      albumContextMenu: createElement('albumContextMenu'),
      removeAlbumOption: createElement('removeAlbumOption'),
      editAlbumOption: createElement('editAlbumOption'),
      playAlbumOption: createElement('playAlbumOption'),
      moveAlbumOption: createElement('moveAlbumOption'),
      copyAlbumOption: createElement('copyAlbumOption'),
      playAlbumSubmenu: createElement('playAlbumSubmenu'),
      albumMoveSubmenu: createElement('albumMoveSubmenu'),
      albumMoveListsSubmenu: createElement('albumMoveListsSubmenu'),
      albumCopySubmenu: createElement('albumCopySubmenu'),
    };

    globalThis.document = {
      getElementById: (id) => elements[id] || null,
    };
    globalThis.window = { currentUser: {} };

    const initialize = mock.fn();
    const createContextSubmenuController = mock.fn(() => ({
      initialize,
      hideAll: () => {},
      destroy: () => {},
    }));

    const module = createAlbumContextMenu({
      getListData: () => [],
      getLists: () => ({}),
      getCurrentListId: () => 'list-1',
      getCurrentRecommendationsYear: () => null,
      getContextAlbum: () => ({ index: null, albumId: null }),
      setContextAlbum: () => {},
      getTrackAbortController: () => null,
      setTrackAbortController: () => {},
      findAlbumByIdentity: () => null,
      showMobileEditForm: () => {},
      showMobileEditFormSafe: () => {},
      showPlayAlbumSubmenu: () => {},
      showConfirmation: () => {},
      showToast: () => {},
      saveList: async () => {},
      selectList: () => {},
      loadLists: async () => {},
      getRecommendationsModule: () => ({ recommendAlbum: async () => {} }),
      getMobileUIModule: () => ({
        showMoveConfirmation: () => {},
        showCopyConfirmation: () => {},
      }),
      createContextSubmenuController,
    });

    module.initializeAlbumContextMenu();

    assert.strictEqual(createContextSubmenuController.mock.calls.length, 1);
    const config = createContextSubmenuController.mock.calls[0].arguments[0];
    assert.strictEqual(config.contextMenuId, elements.albumContextMenu);
    assert.strictEqual(config.branches.length, 3);
    assert.strictEqual(config.branches[0].triggerId, 'playAlbumOption');
    assert.strictEqual(config.branches[1].triggerId, 'moveAlbumOption');
    assert.strictEqual(config.branches[2].triggerId, 'copyAlbumOption');
    assert.strictEqual(initialize.mock.calls.length, 1);
  });

  it('hides submenu controller state during global menu hide', () => {
    const elements = {
      albumContextMenu: createElement('albumContextMenu'),
      removeAlbumOption: createElement('removeAlbumOption'),
      editAlbumOption: createElement('editAlbumOption'),
      playAlbumOption: createElement('playAlbumOption'),
    };

    globalThis.document = {
      getElementById: (id) => elements[id] || null,
    };

    const hideAll = mock.fn();
    const setContextAlbum = mock.fn();
    const setTrackAbortController = mock.fn();
    const abort = mock.fn();

    const module = createAlbumContextMenu({
      getListData: () => [],
      getLists: () => ({}),
      getCurrentListId: () => 'list-1',
      getCurrentRecommendationsYear: () => null,
      getContextAlbum: () => ({ index: null, albumId: null }),
      setContextAlbum,
      getTrackAbortController: () => ({ abort }),
      setTrackAbortController,
      findAlbumByIdentity: () => null,
      showMobileEditForm: () => {},
      showMobileEditFormSafe: () => {},
      showPlayAlbumSubmenu: () => {},
      showConfirmation: () => {},
      showToast: () => {},
      saveList: async () => {},
      selectList: () => {},
      loadLists: async () => {},
      getRecommendationsModule: () => ({ recommendAlbum: async () => {} }),
      getMobileUIModule: () => ({
        showMoveConfirmation: () => {},
        showCopyConfirmation: () => {},
      }),
      createContextSubmenuController: () => ({
        initialize: () => {},
        hideAll,
        destroy: () => {},
      }),
    });

    module.hideSubmenuOnLeave();
    module.hideAllContextMenus();

    assert.strictEqual(hideAll.mock.calls.length, 1);
    assert.strictEqual(setContextAlbum.mock.calls.length, 1);
    assert.deepStrictEqual(setContextAlbum.mock.calls[0].arguments, [
      null,
      null,
    ]);
    assert.strictEqual(abort.mock.calls.length, 1);
    assert.strictEqual(setTrackAbortController.mock.calls.length, 1);
  });
});
