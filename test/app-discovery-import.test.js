const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

describe('app-discovery-import module', () => {
  let createAppDiscoveryImport;
  let OriginalFileReader;

  beforeEach(async () => {
    const module = await import('../src/js/modules/app-discovery-import.js');
    createAppDiscoveryImport = module.createAppDiscoveryImport;
    OriginalFileReader = globalThis.FileReader;
  });

  afterEach(() => {
    globalThis.FileReader = OriginalFileReader;
  });

  it('shows error toast when discovery event payload is incomplete', async () => {
    const toasts = [];
    const listeners = {};

    const handlers = createAppDiscoveryImport({
      showToast: (...args) => toasts.push(args),
      win: {
        addEventListener(event, handler) {
          listeners[event] = handler;
        },
      },
      fetchFn: async () => ({ ok: true, json: async () => ({}) }),
      getListData: () => [],
      apiCall: async () => [],
      saveList: async () => {},
      getLists: () => ({}),
      getCurrentListId: () => null,
      selectList: () => {},
      importList: async () => {},
      updateListNav: () => {},
      setPendingImport: () => {},
      setPendingImportFilename: () => {},
    });

    handlers.registerDiscoveryAddAlbumHandler();
    await listeners['discovery-add-album']({ detail: { artist: 'A' } });

    assert.deepStrictEqual(toasts[0], ['Missing album information', 'error']);
  });

  it('prevents duplicate discovery adds and skips saving', async () => {
    const toasts = [];
    const listeners = {};
    let saveCalls = 0;

    const handlers = createAppDiscoveryImport({
      showToast: (...args) => toasts.push(args),
      win: {
        addEventListener(event, handler) {
          listeners[event] = handler;
        },
      },
      fetchFn: async () => ({
        ok: true,
        json: async () => ({
          'release-groups': [
            {
              id: 'rg-1',
              title: 'The Album',
              'artist-credit': [{ name: 'The Artist' }],
            },
          ],
        }),
      }),
      getListData: () => [{ artist: 'The Artist', album: 'The Album' }],
      apiCall: async () => [],
      saveList: async () => {
        saveCalls += 1;
      },
      getLists: () => ({}),
      getCurrentListId: () => null,
      selectList: () => {},
      importList: async () => {},
      updateListNav: () => {},
      setPendingImport: () => {},
      setPendingImportFilename: () => {},
    });

    handlers.registerDiscoveryAddAlbumHandler();
    await listeners['discovery-add-album']({
      detail: { artist: 'The Artist', album: 'The Album', listName: 'list-1' },
    });

    assert.strictEqual(saveCalls, 0);
    assert.deepStrictEqual(toasts[1], [
      '"The Album" already exists in "list-1"',
      'error',
    ]);
  });

  it('wires import button and opens conflict modal for existing list', async () => {
    const toasts = [];
    const pending = [];
    const pendingNames = [];
    const importBtn = {};
    const fileInput = { files: [], value: '' };
    const conflictName = { textContent: '' };
    const conflictModal = { classList: { remove: () => {} } };

    const doc = {
      getElementById(id) {
        if (id === 'importBtn') return importBtn;
        if (id === 'fileInput') return fileInput;
        if (id === 'conflictListName') return conflictName;
        if (id === 'importConflictModal') return conflictModal;
        return null;
      },
    };

    globalThis.FileReader = class {
      readAsText(file) {
        this.onload({ target: { result: file.__contents } });
      }
    };

    const handlers = createAppDiscoveryImport({
      doc,
      showToast: (...args) => toasts.push(args),
      getLists: () => ({ existing: { name: 'existing' } }),
      importList: async () => {
        throw new Error('should not import existing');
      },
      updateListNav: () => {},
      selectList: () => {},
      setPendingImport: (value) => pending.push(value),
      setPendingImportFilename: (value) => pendingNames.push(value),
      win: null,
    });

    handlers.initializeFileImportHandlers();

    fileInput.files = [
      {
        name: 'existing.json',
        __contents: JSON.stringify([{ album: 'A' }]),
      },
    ];

    await fileInput.onchange({ target: fileInput });

    assert.strictEqual(conflictName.textContent, 'existing');
    assert.deepStrictEqual(pendingNames, ['existing']);
    assert.strictEqual(Array.isArray(pending[0].albums), true);
    assert.strictEqual(toasts.length, 0);
  });

  it('imports new file and selects new list', async () => {
    const importCalls = [];
    const selections = [];
    const toasts = [];
    const importBtn = {};
    const fileInput = {
      files: [],
      value: '',
      clickCalled: 0,
      click() {
        this.clickCalled += 1;
      },
    };

    const doc = {
      getElementById(id) {
        if (id === 'importBtn') return importBtn;
        if (id === 'fileInput') return fileInput;
        return null;
      },
    };

    globalThis.FileReader = class {
      readAsText(file) {
        this.onload({ target: { result: file.__contents } });
      }
    };

    const handlers = createAppDiscoveryImport({
      doc,
      showToast: (...args) => toasts.push(args),
      getLists: () => ({}),
      importList: async (...args) => importCalls.push(args),
      updateListNav: () => {},
      selectList: (name) => selections.push(name),
      setPendingImport: () => {},
      setPendingImportFilename: () => {},
      win: null,
    });

    handlers.initializeFileImportHandlers();

    importBtn.onclick();
    assert.strictEqual(fileInput.clickCalled, 1);

    fileInput.files = [
      {
        name: 'new-list.json',
        __contents: JSON.stringify({
          albums: [{ artist: 'A', album: 'B' }],
          _metadata: { list_name: 'new-list' },
        }),
      },
    ];

    await fileInput.onchange({ target: fileInput });

    assert.deepStrictEqual(importCalls[0], [
      'new-list',
      [{ artist: 'A', album: 'B' }],
      { list_name: 'new-list' },
    ]);
    assert.deepStrictEqual(selections, ['new-list']);
    assert.deepStrictEqual(toasts[0], ['Successfully imported 1 albums']);
    assert.strictEqual(fileInput.value, '');
  });
});
