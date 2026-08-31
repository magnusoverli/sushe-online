const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

function createClassList() {
  const values = new Set(['hidden']);
  return {
    add(...classes) {
      classes.forEach((className) => values.add(className));
    },
    remove(...classes) {
      classes.forEach((className) => values.delete(className));
    },
    toggle(className, force) {
      if (force === undefined ? !values.has(className) : force) {
        values.add(className);
      } else {
        values.delete(className);
      }
    },
    contains(className) {
      return values.has(className);
    },
  };
}

function createElement(overrides = {}) {
  const listeners = {};
  return {
    disabled: false,
    files: [],
    innerHTML: '',
    textContent: '',
    classList: createClassList(),
    listeners,
    addEventListener(event, handler) {
      listeners[event] = handler;
    },
    ...overrides,
  };
}

function createModalHarness() {
  const elements = {
    '#historicalImportFiles': createElement(),
    '#historicalImportRows': createElement(),
    '#historicalImportStatus': createElement(),
    '#cancelHistoricalImportBtn': createElement(),
    '#previewHistoricalImportBtn': createElement({ disabled: true }),
    '#commitHistoricalImportBtn': createElement({ disabled: true }),
  };
  const modal = createElement({
    querySelector(selector) {
      return elements[selector] || null;
    },
  });
  const modalOptions = [];
  let closeCalls = 0;

  return {
    elements,
    modal,
    modalOptions,
    getCloseCalls: () => closeCalls,
    createSettingsModalBase(options) {
      modalOptions.push(options);
      return {
        modal,
        close() {
          closeCalls += 1;
          options.onClose?.();
        },
      };
    },
  };
}

function createFile(name, payload, { raw = false } = {}) {
  return {
    name,
    async text() {
      return raw ? payload : JSON.stringify(payload);
    },
  };
}

function getClientIds(html) {
  return Array.from(
    html.matchAll(/data-import-row data-client-id="([^"]+)"/g),
    (match) => match[1]
  );
}

function selectUser(rowsElement, clientId, value) {
  rowsElement.listeners.change({
    target: {
      dataset: { clientId },
      value,
      matches(selector) {
        return selector === '.historical-import-user';
      },
    },
  });
}

describe('settings admin historical import actions', () => {
  let createSettingsAdminHistoricalImportActions;
  let validateHistoricalListPayload;

  beforeEach(async () => {
    const module =
      await import('../src/js/modules/settings-drawer/handlers/admin-historical-import-actions.js');
    createSettingsAdminHistoricalImportActions =
      module.createSettingsAdminHistoricalImportActions;
    validateHistoricalListPayload = module.validateHistoricalListPayload;
  });

  it('opens the standard modal for multiple JSON files and keeps targets explicit', async () => {
    const harness = createModalHarness();
    const payload = {
      version: 1,
      list: { name: 'Top <Ten>', year: 2019 },
      albums: [{ title: 'One' }],
      serverOnly: { retain: true },
      targetUserId: 'must-not-be-used',
    };
    const actions = createSettingsAdminHistoricalImportActions({
      apiCall: async () => ({}),
      categoryData: {
        admin: {
          users: [
            { _id: 'u1', username: 'Alice <Admin>' },
            { _id: 'u2', username: 'Bob' },
          ],
        },
      },
      createSettingsModalBase: harness.createSettingsModalBase,
    });

    actions.handleHistoricalListImport();
    harness.elements['#historicalImportFiles'].files = [
      createFile('same<script>.json', payload),
      createFile('same<script>.json', {
        version: 1,
        list: { name: 'Second', year: 2020 },
        albums: [],
      }),
    ];
    await harness.elements['#historicalImportFiles'].listeners.change();

    const html = harness.elements['#historicalImportRows'].innerHTML;
    const clientIds = getClientIds(html);
    assert.strictEqual(harness.modalOptions.length, 1);
    assert.strictEqual(harness.modalOptions[0].appendToBody, true);
    assert.match(harness.modalOptions[0].bodyHtml, /multiple/);
    assert.deepStrictEqual(clientIds.length, 2);
    assert.notStrictEqual(clientIds[0], clientIds[1]);
    assert.doesNotMatch(html, /same<script>/);
    assert.match(html, /same&lt;script&gt;\.json/);
    assert.match(html, /Top &lt;Ten&gt;/);
    assert.match(html, /Alice &lt;Admin&gt;/);
    assert.strictEqual(
      harness.elements['#previewHistoricalImportBtn'].disabled,
      true
    );

    selectUser(harness.elements['#historicalImportRows'], clientIds[0], 'u1');
    assert.strictEqual(
      harness.elements['#previewHistoricalImportBtn'].disabled,
      true
    );
    selectUser(harness.elements['#historicalImportRows'], clientIds[1], 'u2');
    assert.strictEqual(
      harness.elements['#previewHistoricalImportBtn'].disabled,
      false
    );
  });

  it('enables commit only after a committable preview and renders commit results', async () => {
    const harness = createModalHarness();
    const apiCalls = [];
    const toasts = [];
    const actions = createSettingsAdminHistoricalImportActions({
      apiCall: async (url, options) => {
        const body = JSON.parse(options.body);
        apiCalls.push({ url, body });
        if (url.endsWith('/preview')) {
          return {
            previewHash: 'preview-hash',
            canCommit: true,
            imports: body.imports.map((item, index) => ({
              clientId: item.clientId,
              targetUsername: index === 0 ? 'Alice' : 'Bob',
              listName: item.payload.list.name,
              year: item.payload.list.year,
              albumCount: item.payload.albums.length,
              existingCanonicalCount: index,
              newCanonicalCount: 1,
              warnings: index === 0 ? ['Review duplicate'] : [],
              errors: [],
              canCommit: true,
            })),
          };
        }

        return {
          success: false,
          imported: 1,
          failed: 1,
          results: [
            {
              clientId: body.imports[0].clientId,
              status: 'imported',
              listId: 'list<1>',
            },
            {
              clientId: body.imports[1].clientId,
              status: 'failed',
              error: 'Already imported <list>',
            },
          ],
        };
      },
      showToast: (...args) => toasts.push(args),
      categoryData: {
        admin: {
          users: [
            { _id: 'u1', username: 'Alice' },
            { _id: 'u2', username: 'Bob' },
          ],
        },
      },
      createSettingsModalBase: harness.createSettingsModalBase,
    });
    const firstPayload = {
      version: 1,
      list: { name: 'First', year: 2018 },
      albums: [{ rank: 1 }],
      retained: true,
    };

    actions.handleHistoricalListImport();
    harness.elements['#historicalImportFiles'].files = [
      createFile('duplicate.json', firstPayload),
      createFile('duplicate.json', {
        version: 1,
        list: { name: 'Second', year: 2017 },
        albums: [{ rank: 1 }, { rank: 2 }],
      }),
    ];
    await harness.elements['#historicalImportFiles'].listeners.change();
    const clientIds = getClientIds(
      harness.elements['#historicalImportRows'].innerHTML
    );
    selectUser(harness.elements['#historicalImportRows'], clientIds[0], 'u1');
    selectUser(harness.elements['#historicalImportRows'], clientIds[1], 'u2');

    await harness.elements['#previewHistoricalImportBtn'].listeners.click();

    assert.strictEqual(apiCalls[0].url.endsWith('/preview'), true);
    assert.deepStrictEqual(
      apiCalls[0].body.imports.map((item) => item.targetUserId),
      ['u1', 'u2']
    );
    assert.deepStrictEqual(apiCalls[0].body.imports[0].payload, firstPayload);
    assert.strictEqual(
      harness.elements['#commitHistoricalImportBtn'].disabled,
      false
    );

    selectUser(harness.elements['#historicalImportRows'], clientIds[0], 'u2');
    assert.strictEqual(
      harness.elements['#commitHistoricalImportBtn'].disabled,
      true
    );
    selectUser(harness.elements['#historicalImportRows'], clientIds[0], 'u1');
    await harness.elements['#previewHistoricalImportBtn'].listeners.click();

    await harness.elements['#commitHistoricalImportBtn'].listeners.click();

    assert.strictEqual(apiCalls[2].url.endsWith('/commit'), true);
    assert.strictEqual(apiCalls[2].body.previewHash, 'preview-hash');
    assert.deepStrictEqual(apiCalls[2].body.imports, apiCalls[1].body.imports);
    assert.strictEqual(
      harness.elements['#commitHistoricalImportBtn'].disabled,
      true
    );
    assert.match(
      harness.elements['#historicalImportRows'].innerHTML,
      /Imported \(list list&lt;1&gt;\)/
    );
    assert.match(
      harness.elements['#historicalImportRows'].innerHTML,
      /Already imported &lt;list&gt;/
    );
    assert.deepStrictEqual(toasts[0], [
      'Historical import complete: 1 imported, 1 failed',
      'error',
    ]);
  });

  it('shows malformed files and keeps preview disabled', async () => {
    const harness = createModalHarness();
    const actions = createSettingsAdminHistoricalImportActions({
      apiCall: async () => {
        throw new Error('preview should not run');
      },
      categoryData: {
        admin: { users: [{ _id: 'u1', username: 'Alice' }] },
      },
      createSettingsModalBase: harness.createSettingsModalBase,
    });

    actions.handleHistoricalListImport();
    harness.elements['#historicalImportFiles'].files = [
      createFile('broken.json', '{not json', { raw: true }),
    ];
    await harness.elements['#historicalImportFiles'].listeners.change();

    assert.match(
      harness.elements['#historicalImportRows'].innerHTML,
      /Invalid JSON/
    );
    assert.strictEqual(
      harness.elements['#previewHistoricalImportBtn'].disabled,
      true
    );
    assert.deepStrictEqual(
      validateHistoricalListPayload({
        version: 1,
        list: { name: 'Missing year' },
        albums: [],
      }),
      ['list.year must be an integer']
    );
  });
});
