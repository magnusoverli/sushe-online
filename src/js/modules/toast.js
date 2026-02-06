/**
 * Toast Notification Module
 *
 * Provides toast notifications with configurable duration and dependency injection.
 *
 * @module toast
 */

/**
 * @typedef {Object} ToastDependencies
 * @property {Function} [getElement] - Function returning toast DOM element
 * @property {Function} [setTimeout] - Timer function (for testing)
 * @property {Function} [clearTimeout] - Clear timer function (for testing)
 */

/**
 * @typedef {Object} ToastService
 * @property {Function} show - Show toast notification
 * @property {Function} calculateDuration - Calculate toast duration
 */

/**
 * Calculate appropriate duration for toast based on message and type
 *
 * @param {string} message - Toast message content
 * @param {string} type - Toast type ('success', 'error', 'info')
 * @returns {number} Duration in milliseconds
 */
export function calculateToastDuration(message, type) {
  if (type === 'success' && message.includes('successfully')) {
    return 5000;
  } else if (type === 'error') {
    return 5000;
  } else if (message.includes('...')) {
    return 10000;
  } else {
    return 3000;
  }
}

/**
 * Create a toast service with dependency injection
 *
 * @param {ToastDependencies} [deps] - Injectable dependencies
 * @returns {ToastService} Toast service instance
 */
export function createToastService(deps = {}) {
  const getElement =
    deps.getElement || (() => document.getElementById('toast'));
  const setTimeoutFn = deps.setTimeout || setTimeout;
  const clearTimeoutFn = deps.clearTimeout || clearTimeout;

  let toastTimer = null;

  function show(message, type = 'success', duration = null) {
    const toast = getElement();

    if (!toast) {
      console.warn('Toast element not found');
      return;
    }

    if (toastTimer) {
      clearTimeoutFn(toastTimer);
      toastTimer = null;
    }

    toast.classList.remove('show');
    toast.textContent = message;
    toast.className = 'toast ' + type;

    setTimeoutFn(() => toast.classList.add('show'), 10);

    if (duration === null) {
      duration = calculateToastDuration(message, type);
    }

    toastTimer = setTimeoutFn(() => {
      toast.classList.remove('show');
      toastTimer = null;
    }, duration);
  }

  return {
    show,
    calculateDuration: calculateToastDuration,
  };
}

// Default instance for backwards compatibility
const defaultToastService = createToastService();

/**
 * Show toast notification (default instance)
 * Backwards compatible convenience export
 *
 * @param {string} message - Message to display
 * @param {string} [type='success'] - Type of toast ('success', 'error', 'info')
 * @param {number|null} [duration=null] - Duration in ms (auto-calculated if null)
 */
export function showToast(message, type = 'success', duration = null) {
  defaultToastService.show(message, type, duration);
}
