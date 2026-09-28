const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../browser-extension/extension-constants');
require('../browser-extension/shared-utils');
require('../browser-extension/context-menu-service');

function harness() {
  const items = new Map();
  let fail = false;
  const chrome = {
    runtime: {},
    contextMenus: {
      removeAll: (callback) =>
        setImmediate(() => {
          items.clear();
          callback();
        }),
      create: (options, callback) =>
        setImmediate(() => {
          assert.equal(items.has(options.id), false, `duplicate ${options.id}`);
          if (fail) {
            chrome.runtime.lastError = { message: 'Menu unavailable' };
            fail = false;
          } else {
            items.set(options.id, options);
          }
          callback();
          delete chrome.runtime.lastError;
        }),
    },
  };
  return {
    items,
    fail: () => {
      fail = true;
    },
    menus: globalThis.ContextMenuService.createContextMenuService({ chrome }),
  };
}

test('overlapping context menu rebuilds finish with the latest coherent menu', async () => {
  const { items, menus } = harness();
  const list = { _id: 'list', name: 'List', year: 2026 };
  await Promise.all([
    menus.updateWithLists({ 2026: [list] }, [list]),
    menus.showError('Not logged in'),
  ]);
  assert.equal(items.has('sushe-list-list'), false);
  assert.equal(items.has('sushe-login'), true);
});

test('a failed render is not cached as successful and the same menu can retry', async () => {
  const { menus, items, fail } = harness();
  fail();
  await assert.rejects(menus.showWelcome(), /Menu unavailable/);
  await menus.showWelcome();
  assert.equal(items.has('sushe-setup'), true);
});

test('a newly started worker can resolve persisted menu IDs without rendering first', () => {
  const { menus } = harness();
  const list = { _id: 'list', name: 'List' };
  assert.equal(menus.findListForMenuId('sushe-list-list', [list]), list);
  assert.equal(
    menus.findListForMenuId(
      globalThis.ExtensionConstants.MENU.LAST_USED_ID,
      [list],
      { id: 'list' }
    ),
    list
  );
  assert.equal(menus.findListForMenuId('sushe-list-old-account', [list]), null);
});
