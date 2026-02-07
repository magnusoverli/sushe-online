/**
 * Tests for modal-factory.js
 *
 * Tests the createModal factory function which provides lifecycle management
 * for modals: open/close, escape key, backdrop click, event listener cleanup,
 * beforeClose prevention, destroy, toggle, and addListener tracking.
 */

const { describe, it, mock } = require('node:test');
const assert = require('node:assert');

// Set up minimal DOM globals before importing
if (typeof globalThis.window === 'undefined') {
  globalThis.window = globalThis;
}

/**
 * Create a mock DOM element with classList, addEventListener, removeEventListener, and remove.
 */
function createMockElement() {
  const classes = new Set(['hidden']);
  return {
    classList: {
      add: (cls) => classes.add(cls),
      remove: (cls) => classes.delete(cls),
      contains: (cls) => classes.has(cls),
    },
    addEventListener: mock.fn(),
    removeEventListener: mock.fn(),
    remove: mock.fn(),
    _classes: classes,
  };
}

/**
 * Set up mock document.body and document globals for modal tests.
 * Returns restore function to clean up after test.
 */
function setupMockDocument() {
  const origDoc = globalThis.document;
  const docListeners = {};
  globalThis.document = {
    addEventListener: mock.fn((event, handler) => {
      if (!docListeners[event]) docListeners[event] = [];
      docListeners[event].push(handler);
    }),
    removeEventListener: mock.fn(),
    body: { style: {} },
  };
  return {
    docListeners,
    restore: () => {
      globalThis.document = origDoc;
    },
  };
}

let createModal;

describe('modal-factory', async () => {
  const mod = await import('../src/js/modules/modal-factory.js');
  createModal = mod.createModal;

  describe('createModal - basic API', () => {
    it('should throw if element is not provided', () => {
      const { restore } = setupMockDocument();
      assert.throws(() => createModal({}), /Modal element is required/);
      restore();
    });

    it('should return controller with all expected methods', () => {
      const { restore } = setupMockDocument();
      const element = createMockElement();
      const controller = createModal({ element });

      assert.strictEqual(typeof controller.open, 'function');
      assert.strictEqual(typeof controller.close, 'function');
      assert.strictEqual(typeof controller.destroy, 'function');
      assert.strictEqual(typeof controller.toggle, 'function');
      assert.strictEqual(typeof controller.isOpen, 'function');
      assert.strictEqual(typeof controller.addListener, 'function');
      restore();
    });

    it('should start in closed state', () => {
      const { restore } = setupMockDocument();
      const element = createMockElement();
      const controller = createModal({ element });

      assert.strictEqual(controller.isOpen(), false);
      restore();
    });
  });

  describe('open', () => {
    it('should remove hidden class and set body overflow', () => {
      const { restore } = setupMockDocument();
      const element = createMockElement();
      const controller = createModal({ element });

      controller.open();

      assert.strictEqual(element._classes.has('hidden'), false);
      assert.strictEqual(document.body.style.overflow, 'hidden');
      assert.strictEqual(controller.isOpen(), true);
      restore();
    });

    it('should call onOpen callback', () => {
      const { restore } = setupMockDocument();
      const element = createMockElement();
      const onOpen = mock.fn();
      const controller = createModal({ element, onOpen });

      controller.open();

      assert.strictEqual(onOpen.mock.calls.length, 1);
      restore();
    });

    it('should not open twice (idempotent)', () => {
      const { restore } = setupMockDocument();
      const element = createMockElement();
      const onOpen = mock.fn();
      const controller = createModal({ element, onOpen });

      controller.open();
      controller.open();

      assert.strictEqual(onOpen.mock.calls.length, 1);
      restore();
    });

    it('should register escape keydown listener on document when closeOnEscape is true', () => {
      const { restore } = setupMockDocument();
      const element = createMockElement();
      const controller = createModal({ element, closeOnEscape: true });

      controller.open();

      // document.addEventListener should have been called with 'keydown'
      const calls = document.addEventListener.mock.calls;
      const keydownCall = calls.find((c) => c.arguments[0] === 'keydown');
      assert.ok(keydownCall, 'Should register keydown listener on document');
      restore();
    });

    it('should not register escape listener when closeOnEscape is false', () => {
      const { restore } = setupMockDocument();
      const element = createMockElement();
      const controller = createModal({ element, closeOnEscape: false });

      controller.open();

      const calls = document.addEventListener.mock.calls;
      const keydownCall = calls.find((c) => c.arguments[0] === 'keydown');
      assert.strictEqual(keydownCall, undefined);
      restore();
    });

    it('should register backdrop click listener when backdrop and closeOnBackdrop are set', () => {
      const { restore } = setupMockDocument();
      const element = createMockElement();
      const backdrop = createMockElement();
      const controller = createModal({
        element,
        backdrop,
        closeOnBackdrop: true,
      });

      controller.open();

      const calls = backdrop.addEventListener.mock.calls;
      const clickCall = calls.find((c) => c.arguments[0] === 'click');
      assert.ok(clickCall, 'Should register click listener on backdrop');
      restore();
    });

    it('should not register backdrop listener when closeOnBackdrop is false', () => {
      const { restore } = setupMockDocument();
      const element = createMockElement();
      const backdrop = createMockElement();
      const controller = createModal({
        element,
        backdrop,
        closeOnBackdrop: false,
      });

      controller.open();

      const calls = backdrop.addEventListener.mock.calls;
      const clickCall = calls.find((c) => c.arguments[0] === 'click');
      assert.strictEqual(clickCall, undefined);
      restore();
    });

    it('should register close button listener', () => {
      const { restore } = setupMockDocument();
      const element = createMockElement();
      const closeButton = createMockElement();
      const controller = createModal({ element, closeButton });

      controller.open();

      const calls = closeButton.addEventListener.mock.calls;
      const clickCall = calls.find((c) => c.arguments[0] === 'click');
      assert.ok(clickCall, 'Should register click listener on close button');
      restore();
    });
  });

  describe('close', () => {
    it('should add hidden class and restore body overflow', () => {
      const { restore } = setupMockDocument();
      const element = createMockElement();
      const controller = createModal({ element });

      controller.open();
      controller.close();

      assert.strictEqual(element._classes.has('hidden'), true);
      assert.strictEqual(document.body.style.overflow, '');
      assert.strictEqual(controller.isOpen(), false);
      restore();
    });

    it('should call onClose callback', () => {
      const { restore } = setupMockDocument();
      const element = createMockElement();
      const onClose = mock.fn();
      const controller = createModal({ element, onClose });

      controller.open();
      controller.close();

      assert.strictEqual(onClose.mock.calls.length, 1);
      restore();
    });

    it('should return true when already closed (no-op)', () => {
      const { restore } = setupMockDocument();
      const element = createMockElement();
      const controller = createModal({ element });

      const result = controller.close();
      assert.strictEqual(result, true);
      restore();
    });

    it('should remove all tracked event listeners on close', () => {
      const { restore } = setupMockDocument();
      const element = createMockElement();
      const backdrop = createMockElement();
      const closeButton = createMockElement();
      const controller = createModal({
        element,
        backdrop,
        closeButton,
        closeOnEscape: true,
        closeOnBackdrop: true,
      });

      controller.open();
      controller.close();

      // document should have removeEventListener called for keydown
      const docRemoveCalls = document.removeEventListener.mock.calls;
      const keydownRemove = docRemoveCalls.find(
        (c) => c.arguments[0] === 'keydown'
      );
      assert.ok(keydownRemove, 'Should remove keydown listener from document');

      // backdrop should have removeEventListener called for click
      const backdropRemoveCalls = backdrop.removeEventListener.mock.calls;
      const backdropClickRemove = backdropRemoveCalls.find(
        (c) => c.arguments[0] === 'click'
      );
      assert.ok(
        backdropClickRemove,
        'Should remove click listener from backdrop'
      );

      // closeButton should have removeEventListener called for click
      const btnRemoveCalls = closeButton.removeEventListener.mock.calls;
      const btnClickRemove = btnRemoveCalls.find(
        (c) => c.arguments[0] === 'click'
      );
      assert.ok(
        btnClickRemove,
        'Should remove click listener from close button'
      );
      restore();
    });
  });

  describe('beforeClose', () => {
    it('should prevent close when beforeClose returns false', () => {
      const { restore } = setupMockDocument();
      const element = createMockElement();
      const beforeClose = mock.fn(() => false);
      const controller = createModal({ element, beforeClose });

      controller.open();
      const result = controller.close();

      assert.strictEqual(result, false);
      assert.strictEqual(controller.isOpen(), true);
      assert.strictEqual(element._classes.has('hidden'), false);
      restore();
    });

    it('should allow close when beforeClose returns true', () => {
      const { restore } = setupMockDocument();
      const element = createMockElement();
      const beforeClose = mock.fn(() => true);
      const controller = createModal({ element, beforeClose });

      controller.open();
      const result = controller.close();

      assert.strictEqual(result, true);
      assert.strictEqual(controller.isOpen(), false);
      restore();
    });

    it('should allow close when beforeClose returns undefined', () => {
      const { restore } = setupMockDocument();
      const element = createMockElement();
      const beforeClose = mock.fn(() => undefined);
      const controller = createModal({ element, beforeClose });

      controller.open();
      const result = controller.close();

      assert.strictEqual(result, true);
      assert.strictEqual(controller.isOpen(), false);
      restore();
    });
  });

  describe('escape key handling', () => {
    it('should close modal on Escape key when open', () => {
      const { docListeners, restore } = setupMockDocument();
      const element = createMockElement();
      const controller = createModal({ element, closeOnEscape: true });

      controller.open();

      // Fire the keydown handler with Escape
      assert.ok(docListeners.keydown, 'Should have registered keydown');
      docListeners.keydown[0]({ key: 'Escape' });

      assert.strictEqual(controller.isOpen(), false);
      restore();
    });

    it('should not close on non-Escape keys', () => {
      const { docListeners, restore } = setupMockDocument();
      const element = createMockElement();
      const controller = createModal({ element, closeOnEscape: true });

      controller.open();

      docListeners.keydown[0]({ key: 'Enter' });
      assert.strictEqual(controller.isOpen(), true);
      restore();
    });
  });

  describe('backdrop click handling', () => {
    it('should close when clicking directly on backdrop', () => {
      const { restore } = setupMockDocument();
      const element = createMockElement();
      const backdrop = createMockElement();
      const controller = createModal({
        element,
        backdrop,
        closeOnBackdrop: true,
      });

      controller.open();

      // Find the click handler registered on the backdrop
      const clickCall = backdrop.addEventListener.mock.calls.find(
        (c) => c.arguments[0] === 'click'
      );
      const clickHandler = clickCall.arguments[1];

      // Simulate click where target === backdrop
      clickHandler({ target: backdrop });

      assert.strictEqual(controller.isOpen(), false);
      restore();
    });

    it('should not close when clicking inside modal content', () => {
      const { restore } = setupMockDocument();
      const element = createMockElement();
      const backdrop = createMockElement();
      const controller = createModal({
        element,
        backdrop,
        closeOnBackdrop: true,
      });

      controller.open();

      const clickCall = backdrop.addEventListener.mock.calls.find(
        (c) => c.arguments[0] === 'click'
      );
      const clickHandler = clickCall.arguments[1];

      // Simulate click on child (target !== backdrop)
      clickHandler({ target: { parentNode: backdrop } });

      assert.strictEqual(controller.isOpen(), true);
      restore();
    });
  });

  describe('close button handling', () => {
    it('should close when close button is clicked', () => {
      const { restore } = setupMockDocument();
      const element = createMockElement();
      const closeButton = createMockElement();
      const controller = createModal({ element, closeButton });

      controller.open();

      const clickCall = closeButton.addEventListener.mock.calls.find(
        (c) => c.arguments[0] === 'click'
      );
      const clickHandler = clickCall.arguments[1];

      // Simulate click with stopPropagation
      const event = { stopPropagation: mock.fn() };
      clickHandler(event);

      assert.strictEqual(controller.isOpen(), false);
      assert.strictEqual(event.stopPropagation.mock.calls.length, 1);
      restore();
    });
  });

  describe('toggle', () => {
    it('should open when closed', () => {
      const { restore } = setupMockDocument();
      const element = createMockElement();
      const controller = createModal({ element });

      controller.toggle();
      assert.strictEqual(controller.isOpen(), true);
      restore();
    });

    it('should close when open', () => {
      const { restore } = setupMockDocument();
      const element = createMockElement();
      const controller = createModal({ element });

      controller.open();
      controller.toggle();
      assert.strictEqual(controller.isOpen(), false);
      restore();
    });
  });

  describe('destroy', () => {
    it('should close and remove element from DOM', () => {
      const { restore } = setupMockDocument();
      const element = createMockElement();
      const onClose = mock.fn();
      const controller = createModal({ element, onClose });

      controller.open();
      controller.destroy();

      assert.strictEqual(controller.isOpen(), false);
      assert.strictEqual(element.remove.mock.calls.length, 1);
      assert.strictEqual(onClose.mock.calls.length, 1);
      restore();
    });

    it('should handle destroy when already closed', () => {
      const { restore } = setupMockDocument();
      const element = createMockElement();
      const controller = createModal({ element });

      controller.destroy();

      assert.strictEqual(element.remove.mock.calls.length, 1);
      restore();
    });
  });

  describe('addListener', () => {
    it('should track and clean up custom listeners on close', () => {
      const { restore } = setupMockDocument();
      const element = createMockElement();
      const controller = createModal({ element });

      const customEl = createMockElement();
      const handler = mock.fn();
      controller.addListener(customEl, 'click', handler);

      // Verify listener was added
      const addCall = customEl.addEventListener.mock.calls.find(
        (c) => c.arguments[0] === 'click'
      );
      assert.ok(addCall, 'Should add event listener');

      // Open then close to trigger cleanup
      controller.open();
      controller.close();

      // Verify listener was removed
      const removeCall = customEl.removeEventListener.mock.calls.find(
        (c) => c.arguments[0] === 'click'
      );
      assert.ok(removeCall, 'Should remove event listener on close');
      restore();
    });

    it('should handle null element gracefully', () => {
      const { restore } = setupMockDocument();
      const element = createMockElement();
      const controller = createModal({ element });

      // Should not throw
      controller.addListener(null, 'click', () => {});
      restore();
    });

    it('should pass addEventListener options through', () => {
      const { restore } = setupMockDocument();
      const element = createMockElement();
      const controller = createModal({ element });

      const customEl = createMockElement();
      const opts = { capture: true };
      controller.addListener(customEl, 'click', () => {}, opts);

      const addCall = customEl.addEventListener.mock.calls.find(
        (c) => c.arguments[0] === 'click'
      );
      assert.strictEqual(addCall.arguments[2], opts);
      restore();
    });
  });

  describe('re-open after close', () => {
    it('should work correctly when opened after being closed', () => {
      const { restore } = setupMockDocument();
      const element = createMockElement();
      const onOpen = mock.fn();
      const onClose = mock.fn();
      const controller = createModal({ element, onOpen, onClose });

      controller.open();
      assert.strictEqual(controller.isOpen(), true);

      controller.close();
      assert.strictEqual(controller.isOpen(), false);

      controller.open();
      assert.strictEqual(controller.isOpen(), true);
      assert.strictEqual(onOpen.mock.calls.length, 2);
      assert.strictEqual(onClose.mock.calls.length, 1);
      restore();
    });
  });
});
