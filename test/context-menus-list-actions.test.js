/**
 * The desktop list context menu, driven through its real handlers against a
 * stub document.
 *
 * Covers the parts that only appear once the menu is wired: the
 * move-to-collection submenu's markup (collection names are free text and were
 * interpolated raw), what each option does to the context-list state, and what
 * the move reports back to the user.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

function createClassList() {
  const classes = new Set(['hidden']);
  return {
    add: (...names) => names.forEach((n) => classes.add(n)),
    remove: (...names) => names.forEach((n) => classes.delete(n)),
    contains: (name) => classes.has(name),
  };
}

function createElement() {
  let renderedFrom = null;
  let buttons = [];

  const el = {
    classList: createClassList(),
    dataset: {},
    style: {},
    innerHTML: '',
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect: () => ({
      top: 0,
      left: 0,
      right: 100,
      bottom: 20,
      width: 100,
      height: 20,
    }),
    contains: () => false,
    querySelector: () => null,

    /**
     * Enough of a parser for these assertions: one stub button per
     * data-group-id in the current innerHTML, re-parsed whenever the markup
     * changes so the handlers the module assigns survive to be invoked.
     */
    querySelectorAll(selector) {
      if (renderedFrom !== el.innerHTML) {
        renderedFrom = el.innerHTML;
        buttons = [
          ...el.innerHTML.matchAll(
            /data-group-id="([^"]*)"\s*\n?\s*data-group-name="([^"]*)"([^>]*)/g
          ),
        ].map(([, groupId, groupName, rest]) => ({
          dataset: { groupId, groupName: decodeEntities(groupName) },
          disabled: /\bdisabled\b/.test(rest),
          onclick: null,
        }));
      }
      return selector.includes(':not([disabled])')
        ? buttons.filter((b) => !b.disabled)
        : buttons;
    },
  };
  return el;
}

/** What the browser does to attribute values on parse. */
function decodeEntities(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const MENU_ELEMENT_IDS = [
  'contextMenu',
  'downloadListOption',
  'renameListOption',
  'toggleMainOption',
  'updatePlaylistOption',
  'deleteListOption',
  'moveListOption',
  'moveListSubmenu',
  'downloadListSubmenu',
  'albumContainer',
  'addAlbumFAB',
];

function stubDocument() {
  const elements = new Map(MENU_ELEMENT_IDS.map((id) => [id, createElement()]));
  return {
    elements,
    doc: {
      getElementById: (id) => elements.get(id) ?? null,
      body: { style: {} },
      addEventListener() {},
      removeEventListener() {},
    },
  };
}

const clickEvent = () => ({ preventDefault() {}, stopPropagation() {} });

describe('desktop list context menu', () => {
  let createContextMenus;
  let saved;

  beforeEach(async () => {
    saved = {
      document: global.document,
      window: global.window,
      requestAnimationFrame: global.requestAnimationFrame,
    };
    global.requestAnimationFrame = () => 0;
    const module = await import('../src/js/modules/context-menus.js');
    createContextMenus = module.createContextMenus;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete global[key];
      else global[key] = value;
    }
  });

  function build({ collections = [], contextList = 'id-a', ...rest } = {}) {
    const { elements, doc } = stubDocument();
    global.document = doc;
    global.window = { innerWidth: 1200, innerHeight: 800, currentUser: {} };

    const state = { contextList, toasts: [], renamed: [], requests: [] };

    createContextMenus({
      getListMetadata: (id) =>
        ({ 'id-a': { name: 'Alpha', groupId: 'g-1' } })[id] || null,
      getLists: () => ({ 'id-a': { _id: 'id-a', name: 'Alpha' } }),
      getCurrentList: () => 'id-a',
      getSortedGroups: () => collections,
      getContextList: () => state.contextList,
      setContextList: (id) => {
        state.contextList = id;
      },
      setCurrentList() {},
      selectList: async () => {},
      apiCall: async (url, options) => {
        state.requests.push({
          url,
          method: options?.method,
          body: options?.body,
        });
        return {};
      },
      showConfirmation: async () => true,
      showToast: (message) => state.toasts.push(message),
      refreshGroupsAndLists: async () => {},
      updateListNav() {},
      openRenameModal: (id) => state.renamed.push(id),
      toggleMainStatus() {},
      updatePlaylist: async () => {},
      ...rest,
    }).initializeContextMenu();

    const openMoveSubmenu = () => {
      elements.get('moveListOption').onclick(clickEvent());
      return elements.get('moveListSubmenu');
    };

    return { elements, state, openMoveSubmenu };
  }

  it('escapes collection names into the move submenu', () => {
    const { openMoveSubmenu } = build({
      collections: [
        { _id: 'g-2', name: 'Rock "n" Roll', isYearGroup: false },
        {
          _id: 'g-3',
          name: '<img src=x onerror=alert(1)>',
          isYearGroup: false,
        },
      ],
    });

    const html = openMoveSubmenu().innerHTML;

    assert.ok(
      html.includes('data-group-name="Rock &quot;n&quot; Roll"'),
      'a quote in a collection name must not close the attribute early'
    );
    assert.ok(
      !html.includes('<img'),
      'a tag in a collection name must not become markup'
    );
    assert.ok(html.includes('&lt;img'), 'the name is still shown, escaped');
  });

  it('round-trips an escaped collection name back through the click handler', async () => {
    const { openMoveSubmenu, state } = build({
      collections: [{ _id: 'g-2', name: 'Rock "n" Roll', isYearGroup: false }],
    });

    const submenu = openMoveSubmenu();
    const [button] = submenu.querySelectorAll('button:not([disabled])');
    await button.onclick();

    assert.deepStrictEqual(
      state.toasts,
      ['Moved "Alpha" to "Rock "n" Roll"'],
      'the toast names the collection as the user typed it'
    );
  });

  it('names the list in the move toast rather than its id', async () => {
    const { openMoveSubmenu, state } = build({
      collections: [{ _id: 'g-2', name: 'Favourites', isYearGroup: false }],
    });

    const [button] = openMoveSubmenu().querySelectorAll(
      'button:not([disabled])'
    );
    await button.onclick();

    assert.deepStrictEqual(state.toasts, ['Moved "Alpha" to "Favourites"']);
    assert.strictEqual(state.requests[0].url, '/api/lists/id-a/move');
  });

  it('marks the collection the list already lives in', () => {
    const { openMoveSubmenu } = build({
      collections: [
        { _id: 'g-1', name: 'Current', isYearGroup: false },
        { _id: 'g-2', name: 'Other', isYearGroup: false },
      ],
    });

    const html = openMoveSubmenu().innerHTML;
    assert.match(html, /data-group-id="g-1"[\s\S]*?disabled/);
  });

  it('leaves year groups out of the collection list', () => {
    const { openMoveSubmenu } = build({
      collections: [
        { _id: 'g-2020', name: '2020', isYearGroup: true },
        { _id: 'g-2', name: 'Favourites', isYearGroup: false },
      ],
    });

    const html = openMoveSubmenu().innerHTML;
    assert.ok(!html.includes('g-2020'));
    assert.ok(html.includes('g-2'));
  });

  it('clears the context list when the editor is opened', () => {
    // Every other option cleared it; rename was the one that did not.
    const { elements, state } = build();

    elements.get('renameListOption').onclick();

    assert.deepStrictEqual(state.renamed, ['id-a']);
    assert.strictEqual(state.contextList, null);
    assert.ok(elements.get('contextMenu').classList.contains('hidden'));
  });

  it('deletes through the shared action and clears the context list', async () => {
    const { elements, state } = build();

    await elements.get('deleteListOption').onclick();

    assert.strictEqual(state.contextList, null);
    assert.deepStrictEqual(state.toasts, ['List "Alpha" deleted']);
    assert.strictEqual(state.requests[0].method, 'DELETE');
  });

  it('does nothing when no list is under the cursor', async () => {
    const { elements, state } = build({ contextList: null });

    elements.get('renameListOption').onclick();
    await elements.get('deleteListOption').onclick();

    assert.deepStrictEqual(state.renamed, []);
    assert.deepStrictEqual(state.toasts, []);
    assert.deepStrictEqual(state.requests, []);
  });
});
