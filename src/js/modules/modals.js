/**
 * Modals Module
 *
 * Confirmation and reasoning modal dialogs.
 *
 * @module modals
 */

/**
 * @typedef {Object} ConfirmationOptions
 * @property {string} [checkboxLabel] - If provided, shows a checkbox that must be checked
 */

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

/**
 * Show the reasoning modal for recommending an album
 *
 * @param {Object} album - Album object with artist, album properties
 * @param {number} year - Year for the recommendation
 * @param {string} [existingReasoning] - Pre-fill with existing reasoning (for edit mode)
 * @param {boolean} [isEditMode=false] - Whether this is an edit operation
 * @returns {Promise<string|null>} Promise resolving to reasoning text or null if cancelled
 */
export function showReasoningModal(
  album,
  year,
  existingReasoning = '',
  isEditMode = false
) {
  const modal = document.getElementById('recommendReasoningModal');
  const albumTitleEl = document.getElementById('reasoningAlbumTitle');
  const artistNameEl = document.getElementById('reasoningArtistName');
  const albumCoverEl = document.getElementById('reasoningAlbumCover');
  const textareaEl = document.getElementById('reasoningText');
  const charCountEl = document.getElementById('reasoningCharCount');
  const errorEl = document.getElementById('reasoningError');
  const submitBtn = document.getElementById('reasoningSubmitBtn');
  const cancelBtn = document.getElementById('reasoningCancelBtn');

  if (!modal || !textareaEl) {
    return Promise.resolve(null);
  }

  // Set album info
  albumTitleEl.textContent = album.album || 'Unknown Album';
  artistNameEl.textContent = album.artist || 'Unknown Artist';

  // Set cover art - prefer album_id API, then cover_art_url, then image
  if (album.album_id) {
    const imgUrl = `/api/albums/${encodeURIComponent(album.album_id)}/cover`;
    albumCoverEl.innerHTML = `<img src="${imgUrl}" alt="Album cover" class="w-12 h-12 rounded-sm object-cover" onerror="this.parentElement.innerHTML='<i class=\\'fas fa-compact-disc text-gray-500\\'></i>'">`;
  } else if (album.cover_art_url || album.image) {
    const imgUrl = album.cover_art_url || album.image;
    albumCoverEl.innerHTML = `<img src="${imgUrl}" alt="Album cover" class="w-12 h-12 rounded-sm object-cover">`;
  } else {
    albumCoverEl.innerHTML =
      '<i class="fas fa-compact-disc text-gray-500"></i>';
  }

  // Set button text based on mode
  submitBtn.textContent = isEditMode ? 'Save' : 'Recommend';

  // Pre-fill with existing reasoning
  textareaEl.value = existingReasoning;
  charCountEl.textContent = existingReasoning.length.toString();
  errorEl.classList.add('hidden');

  return new Promise((resolve) => {
    const updateCharCount = () => {
      charCountEl.textContent = textareaEl.value.length.toString();
    };

    const cleanup = () => {
      textareaEl.removeEventListener('input', updateCharCount);
      submitBtn.removeEventListener('click', handleSubmit);
      cancelBtn.removeEventListener('click', handleCancel);
      modal.removeEventListener('click', handleBackdropClick);
      document.removeEventListener('keydown', handleEscKey);
    };

    const handleSubmit = () => {
      const reasoning = textareaEl.value.trim();
      if (!reasoning) {
        errorEl.classList.remove('hidden');
        textareaEl.focus();
        return;
      }
      modal.classList.add('hidden');
      cleanup();
      resolve(reasoning);
    };

    const handleCancel = () => {
      modal.classList.add('hidden');
      cleanup();
      resolve(null);
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

    textareaEl.addEventListener('input', updateCharCount);
    submitBtn.addEventListener('click', handleSubmit);
    cancelBtn.addEventListener('click', handleCancel);
    modal.addEventListener('click', handleBackdropClick);
    document.addEventListener('keydown', handleEscKey);

    modal.classList.remove('hidden');
    setTimeout(() => textareaEl.focus(), 100);
  });
}

/**
 * Hide the reasoning modal
 */
export function hideReasoningModal() {
  const modal = document.getElementById('recommendReasoningModal');
  if (modal) {
    modal.classList.add('hidden');
  }
}

/**
 * Show a read-only modal displaying recommendation reasoning
 *
 * @param {Object} rec - Recommendation object with album, artist, reasoning, etc.
 */
export function showViewReasoningModal(rec) {
  const modal = document.getElementById('viewReasoningModal');
  const albumTitleEl = document.getElementById('viewReasoningAlbumTitle');
  const artistNameEl = document.getElementById('viewReasoningArtistName');
  const albumCoverEl = document.getElementById('viewReasoningAlbumCover');
  const recommenderEl = document.getElementById('viewReasoningRecommender');
  const reasoningTextEl = document.getElementById('viewReasoningText');
  const closeBtn = document.getElementById('viewReasoningCloseBtn');

  if (!modal) return;

  // Set content
  albumTitleEl.textContent = rec.album || 'Unknown Album';
  artistNameEl.textContent = rec.artist || 'Unknown Artist';
  recommenderEl.textContent = rec.recommended_by || 'Unknown';
  reasoningTextEl.textContent = rec.reasoning || 'No reasoning provided';

  // Set cover art
  if (rec.album_id) {
    const imgUrl = `/api/albums/${encodeURIComponent(rec.album_id)}/cover`;
    albumCoverEl.innerHTML = `<img src="${imgUrl}" alt="Album cover" class="w-10 h-10 rounded-sm object-cover" onerror="this.parentElement.innerHTML='<i class=\\'fas fa-compact-disc text-gray-500\\'></i>'">`;
  } else {
    albumCoverEl.innerHTML =
      '<i class="fas fa-compact-disc text-gray-500"></i>';
  }

  const hideModal = () => {
    modal.classList.add('hidden');
    closeBtn.removeEventListener('click', hideModal);
    modal.removeEventListener('click', handleBackdropClick);
    document.removeEventListener('keydown', handleEscKey);
  };

  const handleBackdropClick = (e) => {
    if (e.target === modal) {
      hideModal();
    }
  };

  const handleEscKey = (e) => {
    if (e.key === 'Escape') {
      hideModal();
    }
  };

  closeBtn.addEventListener('click', hideModal);
  modal.addEventListener('click', handleBackdropClick);
  document.addEventListener('keydown', handleEscKey);

  modal.classList.remove('hidden');
}

/**
 * Hide the view reasoning modal
 */
export function hideViewReasoningModal() {
  const modal = document.getElementById('viewReasoningModal');
  if (modal) {
    modal.classList.add('hidden');
  }
}
