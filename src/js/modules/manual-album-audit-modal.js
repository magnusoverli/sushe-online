/**
 * Manual Album Audit Modal
 *
 * Admin tool for reviewing manual albums that may match canonical albums
 * in the database, allowing merge or mark-as-distinct actions.
 */

import { showToast } from './utils.js';

let modalElement = null;
let currentData = null;
let currentIndex = 0;
let isLoading = false;

/**
 * Open the manual album audit modal
 * Fetches manual albums and displays review interface
 */
export async function openManualAlbumAudit() {
  if (isLoading) return;

  isLoading = true;

  try {
    // Create modal if doesn't exist
    if (!modalElement) {
      createModal();
    }

    // Show loading state
    showModal();
    setLoadingState(true);

    // Fetch manual albums
    const response = await fetch('/api/admin/audit/manual-albums', {
      credentials: 'same-origin',
    });

    if (!response.ok) {
      throw new Error('Failed to fetch manual albums');
    }

    currentData = await response.json();
    currentIndex = 0;

    setLoadingState(false);

    if (currentData.totalWithMatches === 0) {
      showEmptyState();
    } else {
      showCurrentItem();
    }
  } catch (err) {
    console.error('Error opening manual album audit:', err);
    showToast('Failed to load manual albums', 'error');
    closeModal();
  } finally {
    isLoading = false;
  }
}

function createModal() {
  modalElement = document.createElement('div');
  modalElement.id = 'manualAlbumAuditModal';
  modalElement.className =
    'hidden fixed inset-0 bg-black bg-opacity-70 z-[10001] flex items-center justify-center p-4';
  modalElement.innerHTML = `
    <div class="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
      <!-- Header -->
      <div class="p-5 border-b border-gray-800 flex items-center justify-between">
        <div>
          <h3 class="text-xl font-bold text-white">Manual Album Reconciliation</h3>
          <p class="text-gray-400 text-sm mt-1" id="auditProgress">Loading...</p>
        </div>
        <button id="auditCloseBtn" class="text-gray-400 hover:text-white transition-colors">
          <i class="fas fa-times text-xl"></i>
        </button>
      </div>
      
      <!-- Content -->
      <div class="flex-1 overflow-y-auto p-5" id="auditContent">
        <!-- Loading state -->
        <div id="auditLoading" class="flex flex-col items-center justify-center py-12">
          <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-green-500 mb-4"></div>
          <p class="text-gray-400">Scanning manual albums...</p>
        </div>
        
        <!-- Empty state -->
        <div id="auditEmpty" class="hidden flex flex-col items-center justify-center py-12">
          <i class="fas fa-check-circle text-6xl text-green-500 mb-4"></i>
          <p class="text-xl text-white font-semibold mb-2">All Clear!</p>
          <p class="text-gray-400 text-center">No manual albums found that match existing albums.</p>
        </div>
        
        <!-- Comparison view -->
        <div id="auditComparison" class="hidden">
          <!-- Populated dynamically -->
        </div>
      </div>
      
      <!-- Footer -->
      <div id="auditFooter" class="hidden p-5 border-t border-gray-800 flex flex-col sm:flex-row gap-3">
        <button id="auditMergeBtn" class="flex-1 px-4 py-3 bg-green-700 hover:bg-green-600 text-white rounded font-semibold transition-colors flex items-center justify-center gap-2">
          <i class="fas fa-compress-arrows-alt"></i>
          Merge Albums
        </button>
        <button id="auditDistinctBtn" class="flex-1 px-4 py-3 bg-blue-700 hover:bg-blue-600 text-white rounded font-semibold transition-colors flex items-center justify-center gap-2">
          <i class="fas fa-not-equal"></i>
          Different Albums
        </button>
        <button id="auditSkipBtn" class="px-4 py-3 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors flex items-center justify-center gap-2">
          <i class="fas fa-forward"></i>
          Skip
        </button>
      </div>
    </div>
  `;

  // Event listeners
  modalElement.addEventListener('click', (e) => {
    if (e.target === modalElement) {
      closeModal();
    }
  });

  modalElement
    .querySelector('#auditCloseBtn')
    .addEventListener('click', closeModal);
  modalElement
    .querySelector('#auditMergeBtn')
    .addEventListener('click', handleMerge);
  modalElement
    .querySelector('#auditDistinctBtn')
    .addEventListener('click', handleMarkDistinct);
  modalElement
    .querySelector('#auditSkipBtn')
    .addEventListener('click', handleSkip);

  // Escape key
  document.addEventListener('keydown', handleEscapeKey);

  document.body.appendChild(modalElement);
}

function handleEscapeKey(e) {
  if (
    e.key === 'Escape' &&
    modalElement &&
    !modalElement.classList.contains('hidden')
  ) {
    closeModal();
  }
}

function showModal() {
  if (!modalElement) return;
  modalElement.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  if (!modalElement) return;
  modalElement.classList.add('hidden');
  document.body.style.overflow = '';
  currentData = null;
  currentIndex = 0;
}

function setLoadingState(loading) {
  const loadingEl = modalElement.querySelector('#auditLoading');
  const emptyEl = modalElement.querySelector('#auditEmpty');
  const comparisonEl = modalElement.querySelector('#auditComparison');
  const footerEl = modalElement.querySelector('#auditFooter');

  if (loading) {
    loadingEl.classList.remove('hidden');
    emptyEl.classList.add('hidden');
    comparisonEl.classList.add('hidden');
    footerEl.classList.add('hidden');
  } else {
    loadingEl.classList.add('hidden');
  }
}

function showEmptyState() {
  const emptyEl = modalElement.querySelector('#auditEmpty');
  const comparisonEl = modalElement.querySelector('#auditComparison');
  const footerEl = modalElement.querySelector('#auditFooter');
  const progressEl = modalElement.querySelector('#auditProgress');

  emptyEl.classList.remove('hidden');
  comparisonEl.classList.add('hidden');
  footerEl.classList.add('hidden');
  progressEl.textContent = `${currentData.totalManual} manual albums, none need review`;
}

function showCurrentItem() {
  // Filter to only albums with matches
  const albumsWithMatches = currentData.manualAlbums.filter(
    (a) => a.matches.length > 0
  );

  if (currentIndex >= albumsWithMatches.length) {
    showEmptyState();
    modalElement.querySelector('#auditProgress').textContent =
      'Review complete!';
    return;
  }

  const album = albumsWithMatches[currentIndex];
  const bestMatch = album.matches[0];

  const comparisonEl = modalElement.querySelector('#auditComparison');
  const footerEl = modalElement.querySelector('#auditFooter');
  const progressEl = modalElement.querySelector('#auditProgress');

  progressEl.textContent = `Reviewing ${currentIndex + 1} of ${albumsWithMatches.length} (${currentData.totalManual} total manual)`;

  // Build cover URLs
  const manualCoverUrl = album.hasCover
    ? `/api/albums/${encodeURIComponent(album.manualId)}/cover`
    : null;
  const canonicalCoverUrl = bestMatch.hasCover
    ? `/api/albums/${encodeURIComponent(bestMatch.albumId)}/cover`
    : null;

  const placeholderSvg = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 24 24' fill='none' stroke='%23666' stroke-width='1'%3E%3Crect x='3' y='3' width='18' height='18' rx='2'/%3E%3Ccircle cx='12' cy='12' r='4'/%3E%3Ccircle cx='12' cy='12' r='1'/%3E%3C/svg%3E`;

  // Build usage info
  const usageInfo = album.usedIn
    .map((u) => `${u.username}'s ${u.listName} (${u.year})`)
    .join(', ');

  comparisonEl.innerHTML = `
    <div class="grid grid-cols-2 gap-4 mb-4">
      <!-- Manual Album (left) -->
      <div class="bg-gray-800 rounded-lg p-4">
        <div class="text-xs text-orange-500 uppercase tracking-wide mb-2 flex items-center gap-1">
          <i class="fas fa-hand-paper"></i>
          Manual Entry
        </div>
        <div class="aspect-square mb-3 bg-gray-900 rounded overflow-hidden">
          <img 
            src="${manualCoverUrl || placeholderSvg}" 
            alt="${escapeHtml(album.album)}"
            class="w-full h-full object-cover"
            onerror="this.src='${placeholderSvg}'"
          />
        </div>
        <div class="text-white font-semibold truncate" title="${escapeHtml(album.album)}">
          ${escapeHtml(album.album)}
        </div>
        <div class="text-gray-400 text-sm truncate" title="${escapeHtml(album.artist)}">
          ${escapeHtml(album.artist)}
        </div>
        <div class="text-xs text-gray-500 mt-2 truncate" title="${album.manualId}">
          ID: ${album.manualId.substring(0, 20)}...
        </div>
      </div>
      
      <!-- Canonical Album (right) -->
      <div class="bg-gray-800 rounded-lg p-4 border-2 border-green-600/50">
        <div class="text-xs text-green-500 uppercase tracking-wide mb-2 flex items-center gap-1">
          <i class="fas fa-database"></i>
          Canonical (${bestMatch.confidence}% match)
        </div>
        <div class="aspect-square mb-3 bg-gray-900 rounded overflow-hidden">
          <img 
            src="${canonicalCoverUrl || placeholderSvg}" 
            alt="${escapeHtml(bestMatch.album)}"
            class="w-full h-full object-cover"
            onerror="this.src='${placeholderSvg}'"
          />
        </div>
        <div class="text-white font-semibold truncate" title="${escapeHtml(bestMatch.album)}">
          ${escapeHtml(bestMatch.album)}
        </div>
        <div class="text-gray-400 text-sm truncate" title="${escapeHtml(bestMatch.artist)}">
          ${escapeHtml(bestMatch.artist)}
        </div>
        <div class="text-xs text-gray-500 mt-2 truncate" title="${bestMatch.albumId}">
          ID: ${bestMatch.albumId.substring(0, 20)}...
        </div>
      </div>
    </div>
    
    <!-- Usage info -->
    <div class="p-3 bg-gray-800/50 rounded text-sm mb-3">
      <div class="text-gray-400">
        <strong class="text-gray-300">Used in:</strong> ${escapeHtml(usageInfo) || 'No lists'}
      </div>
    </div>
    
    <!-- Other matches -->
    ${
      album.matches.length > 1
        ? `
      <div class="p-3 bg-blue-900/20 border border-blue-800/30 rounded text-sm">
        <div class="text-blue-300 font-medium mb-1">Other potential matches:</div>
        <div class="text-gray-400 text-xs">
          ${album.matches
            .slice(1)
            .map(
              (m) =>
                `${escapeHtml(m.artist)} - ${escapeHtml(m.album)} (${m.confidence}%)`
            )
            .join('<br>')}
        </div>
      </div>
    `
        : ''
    }
    
    <!-- Action explanation -->
    <div class="mt-4 p-3 bg-gray-800/50 rounded text-sm text-gray-400">
      <strong class="text-gray-300">Merge:</strong> Update all lists using the manual entry to use the canonical album (metadata will sync).<br>
      <strong class="text-gray-300">Different:</strong> Mark these as distinct albums (won't be suggested again).
    </div>
  `;

  // Store current item data for actions
  comparisonEl.dataset.manualId = album.manualId;
  comparisonEl.dataset.canonicalId = bestMatch.albumId;

  comparisonEl.classList.remove('hidden');
  footerEl.classList.remove('hidden');
}

async function handleMerge() {
  const comparisonEl = modalElement.querySelector('#auditComparison');
  const manualId = comparisonEl.dataset.manualId;
  const canonicalId = comparisonEl.dataset.canonicalId;

  try {
    setButtonsLoading(true);

    const response = await fetch('/api/admin/audit/merge-album', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        manualAlbumId: manualId,
        canonicalAlbumId: canonicalId,
        syncMetadata: true,
      }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Merge failed');
    }

    const result = await response.json();

    showToast(
      `Merged! Updated ${result.updatedListItems} list items. Recomputed ${result.affectedYears?.length || 0} aggregate lists.`,
      'success'
    );

    // Remove merged album from current data and move to next
    const albumsWithMatches = currentData.manualAlbums.filter(
      (a) => a.matches.length > 0
    );
    const currentAlbum = albumsWithMatches[currentIndex];
    currentData.manualAlbums = currentData.manualAlbums.filter(
      (a) => a.manualId !== currentAlbum.manualId
    );

    showCurrentItem();
  } catch (err) {
    console.error('Merge error:', err);
    showToast(`Merge failed: ${err.message}`, 'error');
  } finally {
    setButtonsLoading(false);
  }
}

async function handleMarkDistinct() {
  const comparisonEl = modalElement.querySelector('#auditComparison');
  const manualId = comparisonEl.dataset.manualId;
  const canonicalId = comparisonEl.dataset.canonicalId;

  try {
    setButtonsLoading(true);

    const response = await fetch('/api/albums/mark-distinct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        album_id_1: manualId,
        album_id_2: canonicalId,
      }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to mark as distinct');
    }

    showToast('Marked as different albums', 'success');

    // Move to next item
    currentIndex++;
    showCurrentItem();
  } catch (err) {
    console.error('Mark distinct error:', err);
    showToast(`Failed: ${err.message}`, 'error');
  } finally {
    setButtonsLoading(false);
  }
}

function handleSkip() {
  currentIndex++;
  showCurrentItem();
}

function setButtonsLoading(loading) {
  const mergeBtn = modalElement.querySelector('#auditMergeBtn');
  const distinctBtn = modalElement.querySelector('#auditDistinctBtn');
  const skipBtn = modalElement.querySelector('#auditSkipBtn');

  mergeBtn.disabled = loading;
  distinctBtn.disabled = loading;
  skipBtn.disabled = loading;

  if (loading) {
    mergeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
  } else {
    mergeBtn.innerHTML =
      '<i class="fas fa-compress-arrows-alt"></i> Merge Albums';
  }
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Cleanup
export function cleanup() {
  if (modalElement) {
    document.removeEventListener('keydown', handleEscapeKey);
    modalElement.remove();
    modalElement = null;
  }
}
