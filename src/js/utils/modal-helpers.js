/**
 * Modal behavior helpers.
 * Sets up common modal patterns: click-outside-to-close and ESC key handling.
 */

/**
 * Set up standard modal behavior (click-outside and ESC key to close).
 *
 * @param {HTMLElement} modal - The modal backdrop element
 * @param {Function} closeModal - Function to call when closing the modal
 * @returns {Function} Cleanup function to remove event listeners
 */
export function setupModalBehavior(modal, closeModal) {
  // Click outside to close
  const handleBackdropClick = (e) => {
    if (e.target === modal) {
      closeModal();
    }
  };
  modal.addEventListener('click', handleBackdropClick);

  // ESC key to close
  const handleEscape = (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeModal();
    }
  };
  document.addEventListener('keydown', handleEscape);

  // Return cleanup function
  return () => {
    modal.removeEventListener('click', handleBackdropClick);
    document.removeEventListener('keydown', handleEscape);
  };
}
