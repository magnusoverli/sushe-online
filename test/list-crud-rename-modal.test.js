/**
 * openRenameModal is what "Edit Details" resolves to on both the desktop
 * context menu and the mobile action sheet.
 *
 * Every test that covered that path stopped at a mocked openRenameModal, so
 * when "Pivot to list IDs" (1bfdf74) pointed its heading lookup at an element
 * id that no template renders, the guard `if (!modal || !currentNameSpan ||
 * !nameInput) return;` began returning on every invocation and nothing noticed.
 * These tests run the real function against a stub document.
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

function createElement({ onRemove, ...extra } = {}) {
  return {
    classList: createClassList(),
    dataset: {},
    value: '',
    textContent: '',
    setAttribute() {},
    removeAttribute() {},
    querySelectorAll: () => [],
    querySelector: () => null,
    contains: () => false,
    addEventListener() {},
    removeEventListener() {},
    focus() {},
    select() {},
    // Detaches the element for real, so a test notices when something removes
    // the modal from the page.
    remove: () => onRemove?.(),
    ...extra,
  };
}

/**
 * @param {object} [options]
 * @param {string[]} [options.omit] - element ids to leave out of the document
 */
function stubDocument({ omit = [] } = {}) {
  const elements = new Map();
  for (const id of [
    'renameListModal',
    'newListNameInput',
    'currentListName',
    'editListYear',
    'editYearError',
    'cancelRenameBtn',
    'confirmRenameBtn',
  ]) {
    if (omit.includes(id)) continue;
    elements.set(id, createElement({ onRemove: () => elements.delete(id) }));
  }

  return {
    elements,
    doc: {
      getElementById: (id) => elements.get(id) ?? null,
      body: { style: {} },
      activeElement: null,
      addEventListener() {},
      removeEventListener() {},
    },
  };
}

describe('openRenameModal', () => {
  let createListCrud;
  let savedDocument;

  beforeEach(async () => {
    savedDocument = global.document;
    const module = await import('../src/js/modules/list-crud.js');
    createListCrud = module.createListCrud;
  });

  afterEach(() => {
    if (savedDocument === undefined) delete global.document;
    else global.document = savedDocument;
  });

  const buildCrud = (deps = {}) =>
    createListCrud({
      getListMetadata: () => ({ name: 'Best of 2024', year: 2024 }),
      getLists: () => ({}),
      apiCall: async () => ({}),
      showToast() {},
      updateListNav() {},
      ...deps,
    });

  it('opens the editor for a list', () => {
    const { elements, doc } = stubDocument();
    global.document = doc;

    const crud = buildCrud();
    crud.initializeRenameList();
    crud.openRenameModal('a3f9c2b1d4e5f607');

    const modal = elements.get('renameListModal');
    assert.strictEqual(
      modal.classList.contains('hidden'),
      false,
      'the edit-list modal must actually be shown'
    );
    assert.strictEqual(modal.dataset.listId, 'a3f9c2b1d4e5f607');
  });

  it('fills the form from the list metadata, not from the id', () => {
    const { elements, doc } = stubDocument();
    global.document = doc;

    const crud = buildCrud();
    crud.initializeRenameList();
    crud.openRenameModal('a3f9c2b1d4e5f607');

    assert.strictEqual(elements.get('newListNameInput').value, 'Best of 2024');
    assert.strictEqual(
      elements.get('currentListName').textContent,
      'Best of 2024'
    );
    assert.strictEqual(elements.get('editListYear').value, 2024);
  });

  it('still opens when the decorative heading is missing', () => {
    // The heading only labels the dialog. Letting it gate the open is what
    // turned a stale id into a dead menu item.
    const { elements, doc } = stubDocument({ omit: ['currentListName'] });
    global.document = doc;

    const crud = buildCrud();
    crud.initializeRenameList();
    crud.openRenameModal('a3f9c2b1d4e5f607');

    assert.strictEqual(
      elements.get('renameListModal').classList.contains('hidden'),
      false
    );
  });

  it('opens even when nothing initialised the modal first', () => {
    // The mobile sheet and the context menu both reach openRenameModal
    // directly; it must not depend on bootstrap having run.
    const { elements, doc } = stubDocument();
    global.document = doc;

    buildCrud().openRenameModal('a3f9c2b1d4e5f607');

    assert.strictEqual(
      elements.get('renameListModal').classList.contains('hidden'),
      false
    );
  });

  it('survives being initialised twice', () => {
    // createModal's destroy() removes the element from the DOM, so a second
    // init must be a no-op rather than a teardown-and-rebuild.
    const { elements, doc } = stubDocument();
    global.document = doc;

    const crud = buildCrud();
    crud.initializeRenameList();
    crud.initializeRenameList();
    crud.openRenameModal('a3f9c2b1d4e5f607');

    assert.strictEqual(
      elements.get('renameListModal').classList.contains('hidden'),
      false
    );
  });

  it('falls back to the id when the list has no metadata', () => {
    const { elements, doc } = stubDocument();
    global.document = doc;

    const crud = buildCrud({ getListMetadata: () => null });
    crud.initializeRenameList();
    crud.openRenameModal('a3f9c2b1d4e5f607');

    assert.strictEqual(
      elements.get('newListNameInput').value,
      'a3f9c2b1d4e5f607'
    );
  });
});
