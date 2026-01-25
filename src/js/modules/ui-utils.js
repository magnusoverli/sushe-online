/**
 * UI Utilities Module
 *
 * Common UI utility functions for positioning, notifications, and confirmations.
 *
 * @module ui-utils
 */

// Toast notification timer (module-level state)
let toastTimer = null;

/**
 * Position a context menu element, adjusting if it would overflow the viewport
 * Uses requestAnimationFrame for performance optimization
 *
 * @param {HTMLElement} menu - Menu element to position
 * @param {number} x - Initial X position
 * @param {number} y - Initial Y position
 */
export function positionContextMenu(menu, x, y) {
  // Hide FAB when context menu is shown to avoid overlap on mobile
  const fab = document.getElementById('addAlbumFAB');
  if (fab) {
    fab.style.display = 'none';
  }

  // Initial position
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.classList.remove('hidden');

  // Use requestAnimationFrame to batch the read phase after paint
  requestAnimationFrame(() => {
    // Read phase - measure menu dimensions and viewport
    const rect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Calculate phase - determine adjustments needed
    let adjustedX = x;
    let adjustedY = y;

    if (rect.right > viewportWidth) {
      adjustedX = x - rect.width;
    }
    if (rect.bottom > viewportHeight) {
      adjustedY = y - rect.height;
    }

    // Write phase - apply adjustments if needed
    if (adjustedX !== x || adjustedY !== y) {
      menu.style.left = `${adjustedX}px`;
      menu.style.top = `${adjustedY}px`;
    }
  });
}

/**
 * Show toast notification with configurable duration
 *
 * @param {string} message - Message to display
 * @param {string} [type='success'] - Type of toast ('success', 'error', 'info')
 * @param {number|null} [duration=null] - Duration in ms (auto-calculated if null)
 */
export function showToast(message, type = 'success', duration = null) {
  const toast = document.getElementById('toast');

  // Clear any existing timer
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }

  // Remove 'show' class immediately to reset animation
  toast.classList.remove('show');

  toast.textContent = message;
  toast.className = 'toast ' + type;

  // Show the toast
  setTimeout(() => toast.classList.add('show'), 10);

  // Determine duration based on type and content
  if (duration === null) {
    // Default durations
    if (type === 'success' && message.includes('successfully')) {
      duration = 5000; // 5 seconds for success messages
    } else if (type === 'error') {
      duration = 5000; // 5 seconds for errors
    } else if (message.includes('...')) {
      duration = 10000; // 10 seconds for "loading" messages
    } else {
      duration = 3000; // 3 seconds for other messages
    }
  }

  // Set timer to hide the toast
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
    toastTimer = null;
  }, duration);
}

/**
 * Show a confirmation modal
 * Supports both callback and promise-based usage
 *
 * @param {string} title - Modal title
 * @param {string} message - Main message
 * @param {string} [subMessage] - Secondary message
 * @param {string} [confirmText='Confirm'] - Text for confirm button
 * @param {Function|null} [onConfirm=null] - Callback for confirmation (if null, returns Promise)
 * @param {Object} [options] - Additional options
 * @param {string} [options.checkboxLabel] - If provided, shows a checkbox that must be checked to confirm
 * @returns {Promise<boolean>|void} Promise resolving to true/false if no callback provided
 */
export function showConfirmation(
  title,
  message,
  subMessage,
  confirmText = 'Confirm',
  onConfirm = null,
  options = {}
) {
  const modal = document.getElementById('confirmationModal');
  const titleEl = document.getElementById('confirmationTitle');
  const messageEl = document.getElementById('confirmationMessage');
  const subMessageEl = document.getElementById('confirmationSubMessage');
  const confirmBtn = document.getElementById('confirmationConfirmBtn');
  const cancelBtn = document.getElementById('confirmationCancelBtn');
  const checkboxContainer = document.getElementById(
    'confirmationCheckboxContainer'
  );
  const checkbox = document.getElementById('confirmationCheckbox');
  const checkboxLabel = document.getElementById('confirmationCheckboxLabel');

  titleEl.textContent = title;
  messageEl.textContent = message;
  subMessageEl.textContent = subMessage || '';
  confirmBtn.textContent = confirmText;

  // Handle optional checkbox requirement
  const requiresCheckbox = !!options.checkboxLabel;
  if (requiresCheckbox) {
    checkboxContainer.classList.remove('hidden');
    checkboxLabel.textContent = options.checkboxLabel;
    checkbox.checked = false;
    confirmBtn.disabled = true;
    confirmBtn.classList.add('opacity-50', 'cursor-not-allowed');
  } else {
    checkboxContainer.classList.add('hidden');
    confirmBtn.disabled = false;
    confirmBtn.classList.remove('opacity-50', 'cursor-not-allowed');
  }

  // If onConfirm is provided, use callback style
  if (onConfirm) {
    const handleCheckboxChange = requiresCheckbox
      ? () => {
          if (checkbox.checked) {
            confirmBtn.disabled = false;
            confirmBtn.classList.remove('opacity-50', 'cursor-not-allowed');
          } else {
            confirmBtn.disabled = true;
            confirmBtn.classList.add('opacity-50', 'cursor-not-allowed');
          }
        }
      : null;

    const cleanup = () => {
      confirmBtn.removeEventListener('click', handleConfirm);
      cancelBtn.removeEventListener('click', handleCancel);
      modal.removeEventListener('click', handleBackdropClick);
      document.removeEventListener('keydown', handleEscKey);
      if (requiresCheckbox && handleCheckboxChange) {
        checkbox.removeEventListener('change', handleCheckboxChange);
        checkbox.checked = false;
      }
    };

    const handleConfirm = () => {
      modal.classList.add('hidden');
      cleanup();
      onConfirm();
    };

    const handleCancel = () => {
      modal.classList.add('hidden');
      cleanup();
    };

    const handleBackdropClick = (e) => {
      if (e.target === modal) {
        handleCancel();
      }
    };

    const handleEscKey = (e) => {
      if (e.key === 'Escape') {
        handleCancel();
      }
    };

    confirmBtn.addEventListener('click', handleConfirm);
    cancelBtn.addEventListener('click', handleCancel);
    modal.addEventListener('click', handleBackdropClick);
    document.addEventListener('keydown', handleEscKey);
    if (requiresCheckbox && handleCheckboxChange) {
      checkbox.addEventListener('change', handleCheckboxChange);
    }

    modal.classList.remove('hidden');
    setTimeout(() => confirmBtn.focus(), 100);
    return;
  }

  // Otherwise return a promise for async/await style
  return new Promise((resolve) => {
    const handleCheckboxChange = requiresCheckbox
      ? () => {
          if (checkbox.checked) {
            confirmBtn.disabled = false;
            confirmBtn.classList.remove('opacity-50', 'cursor-not-allowed');
          } else {
            confirmBtn.disabled = true;
            confirmBtn.classList.add('opacity-50', 'cursor-not-allowed');
          }
        }
      : null;

    const cleanup = () => {
      confirmBtn.removeEventListener('click', handleConfirm);
      cancelBtn.removeEventListener('click', handleCancel);
      modal.removeEventListener('click', handleBackdropClick);
      document.removeEventListener('keydown', handleEscKey);
      if (requiresCheckbox && handleCheckboxChange) {
        checkbox.removeEventListener('change', handleCheckboxChange);
        checkbox.checked = false;
      }
    };

    const handleConfirm = () => {
      modal.classList.add('hidden');
      cleanup();
      resolve(true);
    };

    const handleCancel = () => {
      modal.classList.add('hidden');
      cleanup();
      resolve(false);
    };

    const handleBackdropClick = (e) => {
      if (e.target === modal) {
        handleCancel();
      }
    };

    const handleEscKey = (e) => {
      if (e.key === 'Escape') {
        handleCancel();
      }
    };

    confirmBtn.addEventListener('click', handleConfirm);
    cancelBtn.addEventListener('click', handleCancel);
    modal.addEventListener('click', handleBackdropClick);
    document.addEventListener('keydown', handleEscKey);
    if (requiresCheckbox && handleCheckboxChange) {
      checkbox.addEventListener('change', handleCheckboxChange);
    }

    modal.classList.remove('hidden');
    setTimeout(() => confirmBtn.focus(), 100);
  });
}

/**
 * Hide the confirmation modal
 */
export function hideConfirmation() {
  const modal = document.getElementById('confirmationModal');
  modal.classList.add('hidden');
}
