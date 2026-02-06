/**
 * Tests for submenu-behavior.js utility module
 */

const { describe, it, mock } = require('node:test');
const assert = require('node:assert');

let setupSubmenuHover, setupChainedSubmenus;

describe('submenu-behavior', async () => {
  const mod = await import('../src/js/utils/submenu-behavior.js');
  setupSubmenuHover = mod.setupSubmenuHover;
  setupChainedSubmenus = mod.setupChainedSubmenus;

  function createMockElement() {
    const listeners = {};
    return {
      addEventListener: (event, handler) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(handler);
      },
      removeEventListener: (event, handler) => {
        if (listeners[event]) {
          listeners[event] = listeners[event].filter((h) => h !== handler);
        }
      },
      classList: {
        add: mock.fn(),
        remove: mock.fn(),
        contains: () => false,
      },
      contains: () => false,
      _listeners: listeners,
      _trigger: (event, eventObj = {}) => {
        if (listeners[event]) {
          listeners[event].forEach((h) => h(eventObj));
        }
      },
    };
  }

  describe('setupSubmenuHover', () => {
    it('should call onShow on mouseenter', () => {
      const trigger = createMockElement();
      const onShow = mock.fn();

      setupSubmenuHover(trigger, {
        onShow,
        relatedElements: [],
      });

      trigger._trigger('mouseenter');
      assert.strictEqual(onShow.mock.calls.length, 1);
    });

    it('should call onShow on click by default', () => {
      const trigger = createMockElement();
      const onShow = mock.fn();

      setupSubmenuHover(trigger, {
        onShow,
        relatedElements: [],
      });

      trigger._trigger('click', {
        preventDefault: () => {},
        stopPropagation: () => {},
      });
      assert.strictEqual(onShow.mock.calls.length, 1);
    });

    it('should not call onShow on click when showOnClick is false', () => {
      const trigger = createMockElement();
      const onShow = mock.fn();

      setupSubmenuHover(trigger, {
        onShow,
        relatedElements: [],
        showOnClick: false,
      });

      // Click listeners should not be registered
      assert.strictEqual(trigger._listeners['click']?.length || 0, 0);
    });

    it('should remove listeners on destroy', () => {
      const trigger = createMockElement();
      const onShow = mock.fn();

      const { destroy } = setupSubmenuHover(trigger, {
        onShow,
        relatedElements: [],
      });

      assert.ok(trigger._listeners['mouseenter'].length > 0);
      destroy();
      assert.strictEqual(trigger._listeners['mouseenter'].length, 0);
      assert.strictEqual(trigger._listeners['mouseleave'].length, 0);
      assert.strictEqual(trigger._listeners['click'].length, 0);
    });

    it('should return clearHideTimeout function', () => {
      const trigger = createMockElement();
      const { clearHideTimeout } = setupSubmenuHover(trigger, {
        onShow: () => {},
        relatedElements: [],
      });

      assert.strictEqual(typeof clearHideTimeout, 'function');
      // Should not throw even when no timeout is pending
      clearHideTimeout();
    });

    it('should call onHide on mouseleave when not moving to related element', (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const trigger = createMockElement();
      const onHide = mock.fn();

      setupSubmenuHover(trigger, {
        onShow: () => {},
        relatedElements: [],
        onHide,
      });

      // Simulate mouseleave with unrelated target
      trigger._trigger('mouseleave', { relatedTarget: null });

      // onHide should not be called immediately (delayed by hideDelay)
      assert.strictEqual(onHide.mock.calls.length, 0);

      // Advance timers past default 100ms hideDelay
      t.mock.timers.tick(150);

      assert.strictEqual(onHide.mock.calls.length, 1);
    });

    it('should NOT call onHide when moving to a related element', (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const trigger = createMockElement();
      const relatedEl = createMockElement();
      relatedEl.contains = () => false; // relatedTarget IS the element itself
      const onHide = mock.fn();

      setupSubmenuHover(trigger, {
        onShow: () => {},
        relatedElements: [relatedEl],
        onHide,
      });

      // Simulate mouseleave where relatedTarget is the related element
      trigger._trigger('mouseleave', { relatedTarget: relatedEl });

      t.mock.timers.tick(200);
      assert.strictEqual(onHide.mock.calls.length, 0);
    });

    it('should NOT call onHide when moving to a child of related element', (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const trigger = createMockElement();
      const relatedEl = createMockElement();
      const childEl = {};
      relatedEl.contains = (el) => el === childEl;
      const onHide = mock.fn();

      setupSubmenuHover(trigger, {
        onShow: () => {},
        relatedElements: [relatedEl],
        onHide,
      });

      trigger._trigger('mouseleave', { relatedTarget: childEl });

      t.mock.timers.tick(200);
      assert.strictEqual(onHide.mock.calls.length, 0);
    });

    it('should remove highlight classes on hide', (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const trigger = createMockElement();

      setupSubmenuHover(trigger, {
        onShow: () => {},
        relatedElements: [],
      });

      trigger._trigger('mouseleave', { relatedTarget: null });
      t.mock.timers.tick(150);

      // Default highlight classes should be removed
      const removeCalls = trigger.classList.remove.mock.calls;
      assert.ok(removeCalls.length >= 2);
      const removedClasses = removeCalls.map((c) => c.arguments[0]);
      assert.ok(removedClasses.includes('bg-gray-700'));
      assert.ok(removedClasses.includes('text-white'));
    });

    it('should support relatedElements as a function', (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const trigger = createMockElement();
      const relatedEl = createMockElement();
      relatedEl.contains = () => false;
      const onHide = mock.fn();

      setupSubmenuHover(trigger, {
        onShow: () => {},
        relatedElements: () => [relatedEl],
        onHide,
      });

      // Moving to the related element - should not hide
      trigger._trigger('mouseleave', { relatedTarget: relatedEl });
      t.mock.timers.tick(200);
      assert.strictEqual(onHide.mock.calls.length, 0);
    });

    it('should respect custom hideDelay', (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const trigger = createMockElement();
      const onHide = mock.fn();

      setupSubmenuHover(trigger, {
        onShow: () => {},
        relatedElements: [],
        onHide,
        hideDelay: 500,
      });

      trigger._trigger('mouseleave', { relatedTarget: null });

      t.mock.timers.tick(400);
      assert.strictEqual(onHide.mock.calls.length, 0);

      t.mock.timers.tick(200);
      assert.strictEqual(onHide.mock.calls.length, 1);
    });

    it('should cancel hide timeout on re-enter', (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const trigger = createMockElement();
      const onShow = mock.fn();
      const onHide = mock.fn();

      setupSubmenuHover(trigger, {
        onShow,
        relatedElements: [],
        onHide,
      });

      // Leave, then re-enter before timeout fires
      trigger._trigger('mouseleave', { relatedTarget: null });
      t.mock.timers.tick(50); // Half of default 100ms
      trigger._trigger('mouseenter');

      t.mock.timers.tick(200); // Past the original timeout
      assert.strictEqual(onHide.mock.calls.length, 0);
      assert.strictEqual(onShow.mock.calls.length, 1);
    });
  });

  describe('setupChainedSubmenus', () => {
    it('should accept contextMenu and submenus config', () => {
      const contextMenu = createMockElement();
      const submenu1 = createMockElement();

      const result = setupChainedSubmenus({
        contextMenu,
        submenus: [{ element: submenu1 }],
      });

      assert.strictEqual(typeof result.destroy, 'function');
    });

    it('should add mouseleave handler to context menu', () => {
      const contextMenu = createMockElement();
      const submenu1 = createMockElement();

      setupChainedSubmenus({
        contextMenu,
        submenus: [{ element: submenu1 }],
      });

      assert.ok(contextMenu._listeners['mouseleave'].length > 0);
    });

    it('should add mouseenter and mouseleave handlers to submenus', () => {
      const contextMenu = createMockElement();
      const submenu1 = createMockElement();

      setupChainedSubmenus({
        contextMenu,
        submenus: [{ element: submenu1 }],
      });

      assert.ok(submenu1._listeners['mouseenter'].length > 0);
      assert.ok(submenu1._listeners['mouseleave'].length > 0);
    });

    it('should clean up all listeners on destroy', () => {
      const contextMenu = createMockElement();
      const submenu1 = createMockElement();
      const submenu2 = createMockElement();

      const { destroy } = setupChainedSubmenus({
        contextMenu,
        submenus: [{ element: submenu1 }, { element: submenu2 }],
      });

      destroy();
      assert.strictEqual(contextMenu._listeners['mouseleave'].length, 0);
      assert.strictEqual(submenu1._listeners['mouseenter'].length, 0);
      assert.strictEqual(submenu1._listeners['mouseleave'].length, 0);
      assert.strictEqual(submenu2._listeners['mouseenter'].length, 0);
      assert.strictEqual(submenu2._listeners['mouseleave'].length, 0);
    });

    it('should skip null submenu elements', () => {
      const contextMenu = createMockElement();

      // Should not throw
      const { destroy } = setupChainedSubmenus({
        contextMenu,
        submenus: [{ element: null }],
      });

      assert.strictEqual(typeof destroy, 'function');
    });

    it('should hide submenus and call onHideAll after mouseleave timeout', (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const contextMenu = createMockElement();
      const submenu = createMockElement();
      const onHideAll = mock.fn();

      setupChainedSubmenus({
        contextMenu,
        submenus: [{ element: submenu }],
        onHideAll,
      });

      // Simulate mouse leaving context menu to unrelated element
      contextMenu._trigger('mouseleave', { relatedTarget: null });

      t.mock.timers.tick(150);

      assert.strictEqual(onHideAll.mock.calls.length, 1);
      // submenu should have 'hidden' added
      const addCalls = submenu.classList.add.mock.calls;
      assert.ok(
        addCalls.some((c) => c.arguments[0] === 'hidden'),
        'submenu should be hidden'
      );
    });

    it('should remove highlight from triggerElement on hide', (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const contextMenu = createMockElement();
      const submenu = createMockElement();
      const triggerEl = createMockElement();

      setupChainedSubmenus({
        contextMenu,
        submenus: [{ element: submenu, triggerElement: triggerEl }],
      });

      contextMenu._trigger('mouseleave', { relatedTarget: null });
      t.mock.timers.tick(150);

      // classList.remove may be called with multiple args in one call
      const removeCalls = triggerEl.classList.remove.mock.calls;
      const allRemovedClasses = removeCalls.flatMap((c) =>
        Array.from(c.arguments)
      );
      assert.ok(allRemovedClasses.includes('bg-gray-700'));
      assert.ok(allRemovedClasses.includes('text-white'));
    });

    it('should NOT hide when mouse moves from context menu to submenu', (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const contextMenu = createMockElement();
      const submenu = createMockElement();
      submenu.contains = () => false;
      const onHideAll = mock.fn();

      setupChainedSubmenus({
        contextMenu,
        submenus: [{ element: submenu }],
        onHideAll,
      });

      // Mouse leaves context menu and enters the submenu element directly
      contextMenu._trigger('mouseleave', { relatedTarget: submenu });

      t.mock.timers.tick(200);
      assert.strictEqual(onHideAll.mock.calls.length, 0);
    });

    it('should cancel hide when mouse enters a submenu', (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const contextMenu = createMockElement();
      const submenu = createMockElement();
      const onHideAll = mock.fn();

      setupChainedSubmenus({
        contextMenu,
        submenus: [{ element: submenu }],
        onHideAll,
      });

      // Mouse leaves context menu to unrelated, then enters submenu
      contextMenu._trigger('mouseleave', { relatedTarget: null });
      t.mock.timers.tick(50);
      submenu._trigger('mouseenter');

      t.mock.timers.tick(200);
      assert.strictEqual(onHideAll.mock.calls.length, 0);
    });

    it('should hide when mouse leaves submenu to unrelated element', (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const contextMenu = createMockElement();
      const submenu = createMockElement();
      const onHideAll = mock.fn();

      setupChainedSubmenus({
        contextMenu,
        submenus: [{ element: submenu }],
        onHideAll,
      });

      // Mouse leaves submenu to unrelated element
      submenu._trigger('mouseleave', { relatedTarget: null });

      t.mock.timers.tick(150);
      assert.strictEqual(onHideAll.mock.calls.length, 1);
    });

    it('should NOT hide when mouse moves from submenu back to context menu', (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const contextMenu = createMockElement();
      contextMenu.contains = () => false;
      const submenu = createMockElement();
      const onHideAll = mock.fn();

      setupChainedSubmenus({
        contextMenu,
        submenus: [{ element: submenu }],
        onHideAll,
      });

      // Mouse leaves submenu back to context menu
      submenu._trigger('mouseleave', { relatedTarget: contextMenu });

      t.mock.timers.tick(200);
      assert.strictEqual(onHideAll.mock.calls.length, 0);
    });

    it('should NOT hide when mouse moves to relatedMenus element', (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const contextMenu = createMockElement();
      const submenu1 = createMockElement();
      const submenu2 = createMockElement();
      submenu2.contains = () => false;
      const onHideAll = mock.fn();

      setupChainedSubmenus({
        contextMenu,
        submenus: [
          { element: submenu1, relatedMenus: [submenu2] },
          { element: submenu2 },
        ],
        onHideAll,
      });

      // Mouse leaves submenu1 to submenu2 (a related menu)
      submenu1._trigger('mouseleave', { relatedTarget: submenu2 });

      t.mock.timers.tick(200);
      assert.strictEqual(onHideAll.mock.calls.length, 0);
    });
  });
});
