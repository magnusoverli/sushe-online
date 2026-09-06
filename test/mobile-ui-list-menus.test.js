const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert');

function createClickableElement() {
  const listeners = new Map();
  return {
    addEventListener(eventName, handler) {
      listeners.set(eventName, handler);
    },
    trigger(eventName) {
      const handler = listeners.get(eventName);
      if (handler) {
        handler({
          preventDefault() {},
          stopPropagation() {},
        });
      }
    },
  };
}

/**
 * The list action sheet wires every button unconditionally, so a stub sheet
 * has to offer all of them.
 */
function createListActionSheet() {
  const buttons = new Map(
    [
      'download-toggle',
      'download-json',
      'download-pdf',
      'download-csv',
      'edit',
      'send-to-service',
      'delete',
    ].map((action) => [`[data-action="${action}"]`, createClickableElement()])
  );

  const downloadOptions = {
    classList: { add() {}, remove() {} },
    style: {},
    offsetHeight: 0,
    scrollHeight: 100,
  };

  return {
    button: (action) => buttons.get(`[data-action="${action}"]`),
    sheet: {
      querySelector(selector) {
        if (selector === '[data-download-options]') return downloadOptions;
        if (selector === '[data-download-chevron]') return { style: {} };
        return buttons.get(selector) ?? null;
      },
      querySelectorAll: () => [],
    },
  };
}

describe('mobile-ui list menus', () => {
  let createMobileListMenus;

  beforeEach(async () => {
    const module = await import('../src/js/modules/mobile-ui/list-menus.js');
    createMobileListMenus = module.createMobileListMenus;
  });

  it('wires list menu download action through shared list actions', async () => {
    const downloadToggleBtn = createClickableElement();
    const downloadJsonBtn = createClickableElement();
    const downloadPdfBtn = createClickableElement();
    const downloadCsvBtn = createClickableElement();
    const editBtn = createClickableElement();
    const sendBtn = createClickableElement();
    const deleteBtn = createClickableElement();
    const downloadOptions = {
      classList: { add() {}, remove() {} },
      style: {},
      offsetHeight: 0,
      scrollHeight: 100,
    };

    const actionSheet = {
      querySelector(selector) {
        const map = {
          '[data-action="download-toggle"]': downloadToggleBtn,
          '[data-download-options]': downloadOptions,
          '[data-download-chevron]': { style: {} },
          '[data-action="download-json"]': downloadJsonBtn,
          '[data-action="download-pdf"]': downloadPdfBtn,
          '[data-action="download-csv"]': downloadCsvBtn,
          '[data-action="edit"]': editBtn,
          '[data-action="toggle-main"]': null,
          '[data-action="send-to-service"]': sendBtn,
          '[data-action="delete"]': deleteBtn,
          '[data-action="move-to-collection"]': null,
        };
        return map[selector] ?? null;
      },
      querySelectorAll() {
        return [];
      },
    };

    const downloadCalls = [];
    let closeCalls = 0;
    const listMenus = createMobileListMenus({
      createActionSheet: () => ({
        sheet: actionSheet,
        close: () => {
          closeCalls++;
        },
      }),
      getCurrentList: () => 'list-a',
      getLists: () => ({ 'list-a': {} }),
      getListMetadata: () => ({ name: 'List A', year: 2024 }),
      getSortedGroups: () => [],
      getCurrentUser: () => ({ spotifyAuth: true, musicService: 'spotify' }),
      listMenuActions: {
        downloadList: (listId, format) => downloadCalls.push([listId, format]),
        renameList: () => {},
        toggleMainForList: () => {},
        sendToMusicService: async () => {},
      },
      showConfirmation: async () => false,
      apiCall: async () => {},
      selectList: () => {},
      refreshGroupsAndLists: async () => {},
      updateListNav: () => {},
      showToast: () => {},
      openRenameCategoryModal: () => {},
    });

    listMenus.showMobileListMenu('list-a');
    downloadJsonBtn.trigger('click');
    downloadPdfBtn.trigger('click');
    downloadCsvBtn.trigger('click');

    assert.deepStrictEqual(downloadCalls, [
      ['list-a', 'json'],
      ['list-a', 'pdf'],
      ['list-a', 'csv'],
    ]);
    assert.strictEqual(closeCalls, 3);
  });

  it('ignores orphaned category menu and wires rename action', () => {
    let actionSheetCalls = 0;
    const renameBtn = createClickableElement();

    const listMenus = createMobileListMenus({
      createActionSheet: () => {
        actionSheetCalls++;
        return {
          sheet: {
            querySelector(selector) {
              if (selector === '[data-action="rename"]') return renameBtn;
              if (selector === '[data-action="delete"]') return null;
              return null;
            },
          },
          close: () => {},
        };
      },
      getCurrentList: () => null,
      getLists: () => ({}),
      getListMetadata: () => ({}),
      getSortedGroups: () => [],
      getCurrentUser: () => ({}),
      listMenuActions: {
        downloadList: () => {},
        renameList: () => {},
        toggleMainForList: () => {},
        sendToMusicService: async () => {},
      },
      showConfirmation: async () => false,
      apiCall: async () => {},
      selectList: () => {},
      refreshGroupsAndLists: async () => {},
      updateListNav: () => {},
      showToast: () => {},
      openRenameCategoryModal: mock.fn(),
    });

    listMenus.showMobileCategoryMenu('orphaned', 'Uncategorized', false);
    assert.strictEqual(actionSheetCalls, 0);

    listMenus.showMobileCategoryMenu('group-1', 'Collection', false);
    renameBtn.trigger('click');
    assert.strictEqual(actionSheetCalls, 1);
  });
  it('routes delete through the shared action rather than its own copy', async () => {
    // The mobile sheet used to carry a second copy of the delete flow that had
    // drifted from the desktop one (no snapshot cleanup, no cleared selection).
    const { sheet, button } = createListActionSheet();
    const deleted = [];

    const listMenus = createMobileListMenus({
      createActionSheet: () => ({ sheet, close: () => {} }),
      getLists: () => ({ 'list-a': {} }),
      getListMetadata: () => ({ name: 'List A', year: 2024 }),
      getSortedGroups: () => [],
      getCurrentUser: () => ({}),
      listMenuActions: {
        downloadList: () => {},
        renameList: () => {},
        toggleMainForList: () => {},
        sendToMusicService: async () => {},
        deleteList: async (listId) => {
          deleted.push(listId);
          return true;
        },
      },
      showConfirmation: async () => true,
      apiCall: async () => {},
      refreshGroupsAndLists: async () => {},
      updateListNav: () => {},
      showToast: () => {},
      openRenameCategoryModal: () => {},
    });

    listMenus.showMobileListMenu('list-a');
    button('delete').trigger('click');
    await Promise.resolve();

    assert.deepStrictEqual(deleted, ['list-a']);
  });

  it('escapes the list name in the action sheet heading', () => {
    let contentHtml = '';
    const { sheet } = createListActionSheet();

    const listMenus = createMobileListMenus({
      createActionSheet: (options) => {
        contentHtml = options.contentHtml;
        return { sheet, close: () => {} };
      },
      getLists: () => ({}),
      getListMetadata: () => ({ name: '<img src=x onerror=alert(1)>' }),
      getSortedGroups: () => [],
      getCurrentUser: () => ({}),
      listMenuActions: {
        downloadList: () => {},
        renameList: () => {},
        toggleMainForList: () => {},
        sendToMusicService: async () => {},
        deleteList: async () => true,
      },
      showConfirmation: async () => false,
      apiCall: async () => {},
      refreshGroupsAndLists: async () => {},
      updateListNav: () => {},
      showToast: () => {},
      openRenameCategoryModal: () => {},
    });

    listMenus.showMobileListMenu('list-a');

    assert.ok(!contentHtml.includes('<img'), 'a list name is not markup');
    assert.ok(contentHtml.includes('&lt;img'));
  });

  it('escapes the group name in the category sheet heading', () => {
    let contentHtml = '';

    const listMenus = createMobileListMenus({
      createActionSheet: (options) => {
        contentHtml = options.contentHtml;
        return {
          sheet: { querySelector: () => null, querySelectorAll: () => [] },
          close: () => {},
        };
      },
      getLists: () => ({}),
      getListMetadata: () => ({}),
      getSortedGroups: () => [],
      getCurrentUser: () => ({}),
      listMenuActions: {
        downloadList: () => {},
        renameList: () => {},
        toggleMainForList: () => {},
        sendToMusicService: async () => {},
        deleteList: async () => true,
      },
      showConfirmation: async () => false,
      apiCall: async () => {},
      refreshGroupsAndLists: async () => {},
      updateListNav: () => {},
      showToast: () => {},
      openRenameCategoryModal: () => {},
    });

    listMenus.showMobileCategoryMenu('g-1', '<script>alert(1)</script>', false);

    assert.ok(!contentHtml.includes('<script>'));
    assert.ok(contentHtml.includes('&lt;script&gt;'));
  });
});
