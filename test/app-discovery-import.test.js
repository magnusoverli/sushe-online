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
