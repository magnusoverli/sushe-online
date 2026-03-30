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
    contains: () => false,
  };
}

describe('context submenu controller', async () => {
  const { createContextSubmenuController } =
    await import('../src/js/utils/context-submenu-controller.js');

  it('closes sibling branches when a branch opens', () => {
    const elements = {
      contextMenu: createElement('contextMenu'),
      triggerA: createElement('triggerA'),
      triggerB: createElement('triggerB'),
      submenuA: createElement('submenuA'),
      submenuB: createElement('submenuB'),
    };

    globalThis.document = {
      getElementById: (id) => elements[id] || null,
    };

    const hoverConfigs = new Map();
    const onShowA = mock.fn();
    const onShowB = mock.fn();
    const onHideA = mock.fn();
    const onHideB = mock.fn();

    const controller = createContextSubmenuController(
      {
        contextMenuId: 'contextMenu',
        branches: [
          {
            triggerId: 'triggerA',
            submenuIds: ['submenuA'],
            onShow: onShowA,
            onHide: onHideA,
          },
          {
            triggerId: 'triggerB',
            submenuIds: ['submenuB'],
            onShow: onShowB,
            onHide: onHideB,
          },
        ],
      },
      {
        setupSubmenuHoverFn: (trigger, config) => {
          hoverConfigs.set(trigger.id, config);
          return { destroy: () => {}, clearHideTimeout: () => {} };
        },
        setupChainedSubmenusFn: () => ({ destroy: () => {} }),
      }
    );

    controller.initialize();

    hoverConfigs.get('triggerA').onShow();
    hoverConfigs.get('triggerB').onShow();

    assert.strictEqual(onShowA.mock.calls.length, 1);
    assert.strictEqual(onShowB.mock.calls.length, 1);
    assert.ok(onHideA.mock.calls.length >= 1);
  });

  it('cleans up hover and chained handlers on destroy', () => {
    const elements = {
      contextMenu: createElement('contextMenu'),
      triggerA: createElement('triggerA'),
      submenuA: createElement('submenuA'),
    };

    globalThis.document = {
      getElementById: (id) => elements[id] || null,
    };

    const hoverDestroy = mock.fn();
    const hoverClear = mock.fn();
    const chainedDestroy = mock.fn();

    const controller = createContextSubmenuController(
      {
        contextMenuId: 'contextMenu',
        branches: [
          {
            triggerId: 'triggerA',
            submenuIds: ['submenuA'],
            onShow: () => {},
            onHide: () => {},
          },
        ],
      },
      {
        setupSubmenuHoverFn: () => ({
          destroy: hoverDestroy,
          clearHideTimeout: hoverClear,
        }),
        setupChainedSubmenusFn: () => ({ destroy: chainedDestroy }),
      }
    );

    controller.initialize();
    controller.destroy();

    assert.strictEqual(hoverClear.mock.calls.length, 1);
    assert.strictEqual(hoverDestroy.mock.calls.length, 1);
    assert.strictEqual(chainedDestroy.mock.calls.length, 1);
  });

  it('hides every branch through hideAll', () => {
    const elements = {
      contextMenu: createElement('contextMenu'),
      triggerA: createElement('triggerA'),
      triggerB: createElement('triggerB'),
      submenuA: createElement('submenuA'),
      submenuB: createElement('submenuB'),
    };

    globalThis.document = {
      getElementById: (id) => elements[id] || null,
    };

    const onHideA = mock.fn();
    const onHideB = mock.fn();
    const onHideAll = mock.fn();

    const controller = createContextSubmenuController(
      {
        contextMenuId: 'contextMenu',
        onHideAll,
        branches: [
          {
            triggerId: 'triggerA',
            submenuIds: ['submenuA'],
            onShow: () => {},
            onHide: onHideA,
          },
          {
            triggerId: 'triggerB',
            submenuIds: ['submenuB'],
            onShow: () => {},
            onHide: onHideB,
          },
        ],
      },
      {
        setupSubmenuHoverFn: () => ({
          destroy: () => {},
          clearHideTimeout: () => {},
        }),
        setupChainedSubmenusFn: () => ({ destroy: () => {} }),
      }
    );

    controller.hideAll();

    assert.strictEqual(onHideA.mock.calls.length, 1);
    assert.strictEqual(onHideB.mock.calls.length, 1);
    assert.strictEqual(onHideAll.mock.calls.length, 1);
  });
});
