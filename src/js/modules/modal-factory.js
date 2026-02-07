/**
 * Modal Factory - Lifecycle Management
 *
 * Provides a consistent pattern for creating modals with automatic
 * event listener cleanup, keyboard handling, and backdrop interactions.
 *
 * Replaces duplicated modal boilerplate across:
 * - modals.js (confirmation, reasoning, view reasoning)
 * - duplicate-review-modal.js
 * - manual-album-audit-modal.js
 * - similar-album-modal.js
 *
 * @module modal-factory
 */

/**
 * @typedef {Object} ModalOptions
 * @property {HTMLElement} element - Modal element
 * @property {HTMLElement} [backdrop] - Backdrop element (for click-to-close). If same as element, clicks on the element itself will close.
 * @property {HTMLElement} [closeButton] - Close button element
 * @property {boolean} [closeOnEscape=true] - Close modal on Escape key
 * @property {boolean} [closeOnBackdrop=true] - Close modal on backdrop click
 * @property {Function} [onOpen] - Callback when modal opens
 * @property {Function} [onClose] - Callback when modal closes
 * @property {Function} [beforeClose] - Callback before close (return false to prevent)
 */

/**
 * Create a managed modal instance with automatic event listener cleanup.
 *
 * @param {ModalOptions} options - Configuration options
 * @returns {Object} Modal controller with open, close, destroy, toggle, isOpen, addListener methods
 */
export function createModal(options) {
  const {
    element,
    backdrop,
    closeButton,
    closeOnEscape = true,
    closeOnBackdrop = true,
    onOpen,
    onClose,
    beforeClose,
  } = options;

  if (!element) {
    throw new Error('Modal element is required');
  }

  // Track all event listeners for cleanup
  const trackedListeners = [];
  let isOpen = false;

  /**
   * Add an event listener and track it for automatic cleanup
   * @param {EventTarget} el - Element to attach listener to
   * @param {string} event - Event name
   * @param {Function} handler - Event handler
   * @param {Object} [opts] - addEventListener options
   */
  function addListener(el, event, handler, opts) {
    if (!el) return;
    el.addEventListener(event, handler, opts);
    trackedListeners.push({ element: el, event, handler, options: opts });
  }

  /**
   * Remove all tracked event listeners
   */
  function removeAllListeners() {
    for (const {
      element: el,
      event,
      handler,
      options: opts,
    } of trackedListeners) {
      el.removeEventListener(event, handler, opts);
    }
    trackedListeners.length = 0;
  }

  /**
   * Handle keyboard events (Escape to close)
   * @param {KeyboardEvent} e
   */
  function handleKeyboard(e) {
    if (e.key === 'Escape' && closeOnEscape) {
      close();
    }
  }

  /**
   * Handle backdrop clicks
   * @param {MouseEvent} e
   */
  function handleBackdropClick(e) {
    if (e.target === backdrop && closeOnBackdrop) {
      close();
    }
  }

  /**
   * Handle close button clicks
   * @param {MouseEvent} e
   */
  function handleCloseButton(e) {
    if (e) e.stopPropagation();
    close();
  }

  /**
   * Open the modal
   */
  function open() {
    if (isOpen) return;

    if (onOpen) {
      onOpen();
    }

    element.classList.remove('hidden');
    isOpen = true;

    document.body.style.overflow = 'hidden';

    // Attach event listeners
    if (closeOnEscape) {
      addListener(document, 'keydown', handleKeyboard);
    }

    if (backdrop && closeOnBackdrop) {
      addListener(backdrop, 'click', handleBackdropClick);
    }

    if (closeButton) {
      addListener(closeButton, 'click', handleCloseButton);
    }
  }

  /**
   * Close the modal
   * @returns {boolean} True if closed, false if prevented
   */
  function close() {
    if (!isOpen) return true;

    if (beforeClose && beforeClose() === false) {
      return false;
    }

    element.classList.add('hidden');
    isOpen = false;

    document.body.style.overflow = '';

    removeAllListeners();

    if (onClose) {
      onClose();
    }

    return true;
  }

  /**
   * Destroy the modal and remove from DOM
   */
  function destroy() {
    close();
    element.remove();
  }

  /**
   * Check if modal is currently open
   * @returns {boolean}
   */
  function getIsOpen() {
    return isOpen;
  }

  /**
   * Toggle modal open/closed
   */
  function toggle() {
    if (isOpen) {
      close();
    } else {
      open();
    }
  }

  return {
    open,
    close,
    destroy,
    toggle,
    isOpen: getIsOpen,
    addListener,
  };
}
