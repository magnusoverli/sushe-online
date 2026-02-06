/**
 * Tests for modal-helpers.js utility module
 */

const { describe, it, mock } = require('node:test');
const assert = require('node:assert');

// Set up minimal DOM globals before importing
if (typeof globalThis.window === 'undefined') {
  globalThis.window = globalThis;
}
if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

let setupModalBehavior;

describe('modal-helpers', async () => {
  const mod = await import('../src/js/utils/modal-helpers.js');
  setupModalBehavior = mod.setupModalBehavior;

  it('should call closeModal on click-outside (target === modal)', () => {
    const closeModal = mock.fn();
    const listeners = {};
    const modal = {
      addEventListener: (event, handler) => {
        listeners[event] = handler;
      },
      removeEventListener: mock.fn(),
      classList: {
        contains: () => false,
      },
    };

    // Override document to capture keydown listener
    const origDoc = globalThis.document;
    const docListeners = {};
    globalThis.document = {
      addEventListener: (event, handler) => {
        docListeners[event] = handler;
      },
      removeEventListener: mock.fn(),
    };

    setupModalBehavior(modal, closeModal);

    // Simulate click on backdrop (target === modal)
    listeners.click({ target: modal });
    assert.strictEqual(closeModal.mock.calls.length, 1);

    globalThis.document = origDoc;
  });

  it('should not call closeModal on click inside modal content', () => {
    const closeModal = mock.fn();
    const listeners = {};
    const modal = {
      addEventListener: (event, handler) => {
        listeners[event] = handler;
      },
      removeEventListener: mock.fn(),
      classList: {
        contains: () => false,
      },
    };

    const origDoc = globalThis.document;
    globalThis.document = {
      addEventListener: () => {},
      removeEventListener: mock.fn(),
    };

    setupModalBehavior(modal, closeModal);

    // Simulate click on child element (target !== modal)
    listeners.click({ target: { parentNode: modal } });
    assert.strictEqual(closeModal.mock.calls.length, 0);

    globalThis.document = origDoc;
  });

  it('should call closeModal on Escape key when modal is visible', () => {
    const closeModal = mock.fn();
    const listeners = {};
    const docListeners = {};
    const modal = {
      addEventListener: (event, handler) => {
        listeners[event] = handler;
      },
      removeEventListener: mock.fn(),
      classList: {
        contains: (cls) => (cls === 'hidden' ? false : false),
      },
    };

    const origDoc = globalThis.document;
    globalThis.document = {
      addEventListener: (event, handler) => {
        docListeners[event] = handler;
      },
      removeEventListener: mock.fn(),
    };

    setupModalBehavior(modal, closeModal);

    // Simulate Escape key
    docListeners.keydown({ key: 'Escape' });
    assert.strictEqual(closeModal.mock.calls.length, 1);

    globalThis.document = origDoc;
  });

  it('should not call closeModal on Escape when modal is hidden', () => {
    const closeModal = mock.fn();
    const docListeners = {};
    const modal = {
      addEventListener: () => {},
      removeEventListener: mock.fn(),
      classList: {
        contains: (cls) => cls === 'hidden',
      },
    };

    const origDoc = globalThis.document;
    globalThis.document = {
      addEventListener: (event, handler) => {
        docListeners[event] = handler;
      },
      removeEventListener: mock.fn(),
    };

    setupModalBehavior(modal, closeModal);

    docListeners.keydown({ key: 'Escape' });
    assert.strictEqual(closeModal.mock.calls.length, 0);

    globalThis.document = origDoc;
  });

  it('should return a cleanup function', () => {
    const modal = {
      addEventListener: () => {},
      removeEventListener: mock.fn(),
      classList: { contains: () => false },
    };

    const origDoc = globalThis.document;
    globalThis.document = {
      addEventListener: () => {},
      removeEventListener: mock.fn(),
    };

    const cleanup = setupModalBehavior(modal, mock.fn());
    assert.strictEqual(typeof cleanup, 'function');

    cleanup();
    assert.strictEqual(modal.removeEventListener.mock.calls.length, 1);
    assert.strictEqual(
      globalThis.document.removeEventListener.mock.calls.length,
      1
    );

    globalThis.document = origDoc;
  });
});
