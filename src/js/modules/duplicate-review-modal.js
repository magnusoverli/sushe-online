/**
 * Duplicate Review Modal
 *
 * Full-featured modal for reviewing and resolving potential duplicate albums.
 * Shows side-by-side comparison with field diffs, cover images, and action buttons.
 */

import { escapeHtml, getPlaceholderSvg } from './html-utils.js';

let modalElement = null;
let currentPairs = [];
let currentIndex = 0;
let onComplete = null;
let resolvedCount = 0;

/**
 * Open the duplicate review modal with a list of potential duplicate pairs
 *
 * @param {Array} pairs - Array of duplicate pairs from the API
 * @param {Function} onCompleteCallback - Called when all pairs are processed or modal is closed
 * @returns {Promise<{resolved: number, remaining: number}>}
 */
export function openDuplicateReviewModal(pairs, onCompleteCallback = null) {
  return new Promise((resolve) => {
    if (!pairs || pairs.length === 0) {
      resolve({ resolved: 0, remaining: 0 });
      return;
    }

    currentPairs = [...pairs];
    currentIndex = 0;
    resolvedCount = 0;
    onComplete = () => {
      const result = {
        resolved: resolvedCount,
        remaining: currentPairs.length - currentIndex,
      };
      if (onCompleteCallback) onCompleteCallback(result);
      resolve(result);
    };

    createModal();
    renderCurrentPair();
    showModal();
  });
}

function createModal() {
  if (modalElement) {
    modalElement.remove();
  }

  modalElement = document.createElement('div');
  modalElement.id = 'duplicateReviewModal';
  // Use z-[10002] to ensure modal is above #modalPortal (z-10001) and similar-album-modal (z-10001)
  modalElement.className =
    'fixed inset-0 z-[10002] flex items-center justify-center p-4 safe-area-modal duplicate-review-modal hidden';
  modalElement.innerHTML = `
    <div class="settings-modal-backdrop"></div>
    <div class="settings-modal-content duplicate-review-modal-content">
      <div class="settings-modal-header">
        <div class="flex items-center gap-2">
          <h3 class="settings-modal-title">Review Duplicates</h3>
          <span id="duplicateProgress" class="px-2 py-0.5 bg-gray-700 text-gray-300 text-xs sm:text-sm rounded">
            1 / 1
          </span>
        </div>
        <button class="settings-modal-close" id="duplicateModalClose">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <div class="settings-modal-body duplicate-review-modal-body" id="duplicateReviewContent">
        <!-- Content rendered dynamically -->
      </div>
      <div class="settings-modal-footer duplicate-review-modal-footer">
        <div class="flex gap-2">
          <button id="keepLeftBtn" class="settings-button bg-green-700 hover:bg-green-600" type="button">
            <i class="fas fa-check"></i><span class="hidden sm:inline ml-1">Keep</span> Left
          </button>
          <button id="keepRightBtn" class="settings-button bg-green-700 hover:bg-green-600" type="button">
            <i class="fas fa-check"></i><span class="hidden sm:inline ml-1">Keep</span> Right
          </button>
        </div>
        <div class="flex gap-2">
          <button id="markDistinctBtn" class="settings-button bg-blue-700 hover:bg-blue-600" type="button">
            <i class="fas fa-not-equal"></i><span class="hidden sm:inline ml-1">Different</span>
          </button>
          <button id="skipPairBtn" class="settings-button" type="button">
            <i class="fas fa-forward"></i><span class="hidden sm:inline ml-1">Skip</span>
          </button>
        </div>
      </div>
    </div>
  `;

  // Event listeners
  const backdrop = modalElement.querySelector('.settings-modal-backdrop');
  const closeBtn = modalElement.querySelector('#duplicateModalClose');

  if (backdrop) {
    backdrop.addEventListener('click', handleClose);
  }
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleClose();
    });
  }
  modalElement
    .querySelector('#keepLeftBtn')
    .addEventListener('click', () => handleMerge('left'));
  modalElement
    .querySelector('#keepRightBtn')
    .addEventListener('click', () => handleMerge('right'));
  modalElement
    .querySelector('#markDistinctBtn')
    .addEventListener('click', handleMarkDistinct);
  modalElement
    .querySelector('#skipPairBtn')
    .addEventListener('click', handleSkip);

  // Keyboard shortcuts
  document.addEventListener('keydown', handleKeyboard);

  document.body.appendChild(modalElement);
}

function showModal() {
  modalElement.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function hideModal() {
  modalElement.classList.add('hidden');
  document.body.style.overflow = '';
  document.removeEventListener('keydown', handleKeyboard);
}

function handleClose() {
  hideModal();
  if (onComplete) onComplete();
}

function handleKeyboard(e) {
  if (modalElement.classList.contains('hidden')) return;

  switch (e.key) {
    case 'Escape':
      handleClose();
      break;
    case '1':
    case 'ArrowLeft':
      if (!e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleMerge('left');
      }
      break;
    case '2':
    case 'ArrowRight':
      if (!e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleMerge('right');
      }
      break;
    case '3':
    case 'd':
      if (!e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleMarkDistinct();
      }
      break;
    case 's':
    case 'ArrowDown':
      if (!e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleSkip();
      }
      break;
  }
}

function renderCurrentPair() {
  if (currentIndex >= currentPairs.length) {
    renderComplete();
    return;
  }

  const pair = currentPairs[currentIndex];
  const content = modalElement.querySelector('#duplicateReviewContent');
  const progress = modalElement.querySelector('#duplicateProgress');

  progress.textContent = `${currentIndex + 1} / ${currentPairs.length}`;

  const leftCoverUrl = pair.album1.hasCover
    ? `/api/albums/${encodeURIComponent(pair.album1.album_id)}/cover`
    : null;
  const rightCoverUrl = pair.album2.hasCover
    ? `/api/albums/${encodeURIComponent(pair.album2.album_id)}/cover`
    : null;

  const placeholderSvg = getPlaceholderSvg(200);

  // Calculate field diffs
  const diffs = calculateDiffs(pair.album1, pair.album2);

  // Build list of differing fields (only shown if they differ)
  const diffFields1 = [];
  const diffFields2 = [];

  // Show artist/album diffs if they differ (since names are always shown, highlight the difference)
  if (diffs.artist) {
    diffFields1.push(renderDiffField('Artist', pair.album1.artist));
    diffFields2.push(renderDiffField('Artist', pair.album2.artist));
  }
  if (diffs.album) {
    diffFields1.push(renderDiffField('Album', pair.album1.album));
    diffFields2.push(renderDiffField('Album', pair.album2.album));
  }
  if (diffs.release_date) {
    diffFields1.push(
      renderDiffField('Release', pair.album1.release_date || 'Unknown')
    );
    diffFields2.push(
      renderDiffField('Release', pair.album2.release_date || 'Unknown')
    );
  }
  if (diffs.genres) {
    diffFields1.push(
      renderDiffField(
        'Genre',
        formatGenres(pair.album1.genre_1, pair.album1.genre_2)
      )
    );
    diffFields2.push(
      renderDiffField(
        'Genre',
        formatGenres(pair.album2.genre_1, pair.album2.genre_2)
      )
    );
  }
  if (diffs.trackCount) {
    diffFields1.push(
      renderDiffField(
        'Tracks',
        pair.album1.trackCount !== null
          ? `${pair.album1.trackCount} tracks`
          : 'Unknown'
      )
    );
    diffFields2.push(
      renderDiffField(
        'Tracks',
        pair.album2.trackCount !== null
          ? `${pair.album2.trackCount} tracks`
          : 'Unknown'
      )
    );
  }

  const diffSection1 =
    diffFields1.length > 0
      ? `<div class="mt-2 pt-2 border-t border-gray-700 space-y-0.5">${diffFields1.join('')}</div>`
      : '';
  const diffSection2 =
    diffFields2.length > 0
      ? `<div class="mt-2 pt-2 border-t border-gray-700 space-y-0.5">${diffFields2.join('')}</div>`
      : '';

  content.innerHTML = `
    <!-- Confidence Banner - compact on mobile -->
    <div class="mb-3 p-2 sm:p-3 rounded-lg ${pair.confidence >= 90 ? 'bg-red-900/30 border border-red-700/50' : pair.confidence >= 75 ? 'bg-yellow-900/30 border border-yellow-700/50' : 'bg-blue-900/30 border border-blue-700/50'}">
      <div class="flex items-center justify-between flex-wrap gap-1">
        <span class="text-sm sm:text-base font-bold ${pair.confidence >= 90 ? 'text-red-400' : pair.confidence >= 75 ? 'text-yellow-400' : 'text-blue-400'}">
          ${pair.confidence}% Match
        </span>
        <span class="text-xs ${diffs.hasDifferences ? 'text-yellow-400' : 'text-green-400'}">
          ${diffs.hasDifferences ? `${diffs.differenceCount} diff` : 'Match'}
        </span>
      </div>
    </div>

    <!-- Side-by-side comparison - always 2 columns -->
    <div class="duplicate-review-compare">
      <!-- Left Album -->
      <div class="duplicate-review-card bg-gray-800/50 rounded-lg p-2 sm:p-4 border-2 border-transparent hover:border-green-600/50 transition-colors">
        <div class="text-center mb-2">
          <span class="px-2 py-0.5 bg-gray-700 text-gray-300 text-xs rounded-full">Left</span>
        </div>
        <div class="duplicate-review-cover aspect-square mb-2 sm:mb-3 bg-gray-900 rounded overflow-hidden">
          <img 
            src="${leftCoverUrl || placeholderSvg}" 
            alt="${escapeHtml(pair.album1.album)}"
            class="w-full h-full object-cover"
            onerror="this.src='${placeholderSvg}'"
          />
        </div>
        <div class="text-center">
          <div class="album-title text-white font-semibold text-sm sm:text-base truncate" title="${escapeHtml(pair.album1.album)}">${escapeHtml(pair.album1.album)}</div>
          <div class="album-artist text-gray-400 text-xs sm:text-sm truncate" title="${escapeHtml(pair.album1.artist)}">${escapeHtml(pair.album1.artist)}</div>
          ${diffSection1}
        </div>
      </div>

      <!-- Right Album -->
      <div class="duplicate-review-card bg-gray-800/50 rounded-lg p-2 sm:p-4 border-2 border-transparent hover:border-green-600/50 transition-colors">
        <div class="text-center mb-2">
          <span class="px-2 py-0.5 bg-gray-700 text-gray-300 text-xs rounded-full">Right</span>
        </div>
        <div class="duplicate-review-cover aspect-square mb-2 sm:mb-3 bg-gray-900 rounded overflow-hidden">
          <img 
            src="${rightCoverUrl || placeholderSvg}" 
            alt="${escapeHtml(pair.album2.album)}"
            class="w-full h-full object-cover"
            onerror="this.src='${placeholderSvg}'"
          />
        </div>
        <div class="text-center">
          <div class="album-title text-white font-semibold text-sm sm:text-base truncate" title="${escapeHtml(pair.album2.album)}">${escapeHtml(pair.album2.album)}</div>
          <div class="album-artist text-gray-400 text-xs sm:text-sm truncate" title="${escapeHtml(pair.album2.artist)}">${escapeHtml(pair.album2.artist)}</div>
          ${diffSection2}
        </div>
      </div>
    </div>
  `;

  // Store current pair data for actions
  modalElement.dataset.leftId = pair.album1.album_id;
  modalElement.dataset.rightId = pair.album2.album_id;
}

function renderDiffField(label, value) {
  return `
    <div class="bg-yellow-900/20 border-l-2 border-yellow-500 pl-1.5 py-0.5 text-xs">
      <span class="text-gray-500">${label}:</span>
      <span class="text-yellow-300 block truncate" title="${escapeHtml(value)}">${escapeHtml(value)}</span>
    </div>
  `;
}

function calculateDiffs(album1, album2) {
  // Normalize strings, treating null/undefined/empty as equivalent
  const normalize = (s) => (s || '').toLowerCase().trim();

  // Check if two values are meaningfully different (not just null vs empty)
  const isDifferent = (a, b) => {
    const normA = normalize(a);
    const normB = normalize(b);
    // Both empty = same, otherwise compare
    if (!normA && !normB) return false;
    return normA !== normB;
  };

  const diffs = {
    artist: isDifferent(album1.artist, album2.artist),
    album: isDifferent(album1.album, album2.album),
    release_date: isDifferent(album1.release_date, album2.release_date),
    genres:
      isDifferent(album1.genre_1, album2.genre_1) ||
      isDifferent(album1.genre_2, album2.genre_2),
    trackCount:
      album1.trackCount !== album2.trackCount &&
      album1.trackCount !== null &&
      album2.trackCount !== null,
  };

  diffs.hasDifferences = Object.values(diffs).some((v) => v === true);
  diffs.differenceCount = Object.values(diffs).filter((v) => v === true).length;

  return diffs;
}

function formatGenres(g1, g2) {
  if (!g1 && !g2) return 'None';
  if (!g2) return g1;
  return `${g1}, ${g2}`;
}

function renderComplete() {
  const content = modalElement.querySelector('#duplicateReviewContent');
  const progress = modalElement.querySelector('#duplicateProgress');
  const footer = modalElement.querySelector('.settings-modal-footer');

  if (progress) progress.textContent = 'Complete';

  if (content) {
    content.innerHTML = `
      <div class="text-center py-12">
        <i class="fas fa-check-circle text-5xl text-green-500 mb-4"></i>
        <h3 class="text-xl font-bold text-white mb-2">Review Complete</h3>
        <p class="text-gray-400 mb-4">
          Processed ${resolvedCount} of ${currentPairs.length} potential duplicates
        </p>
        <p class="text-sm text-gray-500">
          ${currentPairs.length - resolvedCount > 0 ? `${currentPairs.length - resolvedCount} pairs were skipped` : 'All pairs processed!'}
        </p>
      </div>
    `;
  }

  if (footer) {
    footer.innerHTML = `
      <button id="closeCompleteBtn" class="settings-button bg-green-700 hover:bg-green-600 px-6">
        <i class="fas fa-check mr-2"></i>Done
      </button>
    `;

    const closeBtn = footer.querySelector('#closeCompleteBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', handleClose);
    }
  }
}

async function handleMerge(direction) {
  const keepId =
    direction === 'left'
      ? modalElement.dataset.leftId
      : modalElement.dataset.rightId;
  const deleteId =
    direction === 'left'
      ? modalElement.dataset.rightId
      : modalElement.dataset.leftId;

  setButtonsLoading(true);

  try {
    const response = await fetch('/admin/api/merge-albums', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ keepAlbumId: keepId, deleteAlbumId: deleteId }),
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error);

    const metadataMsg = data.metadataMerged ? ' (metadata merged)' : '';
    showToast(
      `Merged: ${data.listItemsUpdated} reference${data.listItemsUpdated !== 1 ? 's' : ''} updated${metadataMsg}`,
      'success'
    );
    resolvedCount++;
    currentIndex++;
    renderCurrentPair();
  } catch (err) {
    console.error('Error merging albums:', err);
    showToast('Error merging albums: ' + err.message, 'error');
  } finally {
    setButtonsLoading(false);
  }
}

async function handleMarkDistinct() {
  const album1 = modalElement.dataset.leftId;
  const album2 = modalElement.dataset.rightId;

  setButtonsLoading(true);

  try {
    const response = await fetch('/api/albums/mark-distinct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ album_id_1: album1, album_id_2: album2 }),
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error);

    showToast('Marked as different albums', 'success');
    resolvedCount++;
    currentIndex++;
    renderCurrentPair();
  } catch (err) {
    console.error('Error marking as distinct:', err);
    showToast('Error: ' + err.message, 'error');
  } finally {
    setButtonsLoading(false);
  }
}

function handleSkip() {
  currentIndex++;
  renderCurrentPair();
}

function setButtonsLoading(loading) {
  const buttons = modalElement.querySelectorAll(
    '#keepLeftBtn, #keepRightBtn, #markDistinctBtn, #skipPairBtn'
  );
  buttons.forEach((btn) => {
    btn.disabled = loading;
  });
}

function showToast(message, type = 'info') {
  // Try to use the global showToast if available
  if (typeof window.showToast === 'function') {
    window.showToast(message, type);
  } else {
    console.log(`[${type}] ${message}`);
  }
}

/**
 * Close the modal programmatically
 */
export function closeDuplicateReviewModal() {
  if (modalElement) {
    handleClose();
  }
}
