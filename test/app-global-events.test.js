const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert');

describe('app-global-events module', () => {
  let registerAppGlobalEvents;

  beforeEach(async () => {
    const module = await import('../src/js/modules/app-global-events.js');
    registerAppGlobalEvents = module.registerAppGlobalEvents;
  });

  it('registers click/contextmenu handlers for context menu cleanup', () => {
    const handlers = { click: [], contextmenu: [] };
    const doc = {
      addEventListener(eventName, handler) {
        handlers[eventName].push(handler);
      },
    };
    const hideAllContextMenus = mock.fn();

    registerAppGlobalEvents({ doc, hideAllContextMenus });

    assert.strictEqual(handlers.click.length, 1);
    assert.strictEqual(handlers.contextmenu.length, 2);

    handlers.click[0]({});
    handlers.contextmenu[0]({ target: { closest: () => null } });
    assert.strictEqual(hideAllContextMenus.mock.calls.length, 2);
  });

  it('prevents native context menu for list buttons only', () => {
    const handlers = { click: [], contextmenu: [] };
    const doc = {
      addEventListener(eventName, handler) {
        handlers[eventName].push(handler);
      },
    };

    registerAppGlobalEvents({ doc, hideAllContextMenus: () => {} });

    const preventDefault = mock.fn();
    handlers.contextmenu[1]({
      target: { closest: () => ({}) },
      preventDefault,
    });
    assert.strictEqual(preventDefault.mock.calls.length, 1);

    const preventDefaultNonList = mock.fn();
    handlers.contextmenu[1]({
      target: { closest: () => null },
      preventDefault: preventDefaultNonList,
    });
    assert.strictEqual(preventDefaultNonList.mock.calls.length, 0);
  });
});
