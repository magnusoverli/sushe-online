/**
 * Manual Album Audit Modal
 *
 * Admin tool for reviewing manual albums that may match canonical albums
 * in the database, allowing merge or mark-as-distinct actions.
 */

import { showToast } from './utils.js';
import { escapeHtml, getPlaceholderSvg } from './html-utils.js';
import { createModal } from './modal-factory.js';

let modalElement = null;
let modalController = null;
let currentData = null;
let currentIndex = 0;
let isLoading = false;

/**
 * Open the manual album audit modal
 * Fetches manual albums and displays review interface
 * @param {number} threshold - Optional threshold (default: read from DOM)
 * @param {object} prefetchedData - Optional pre-fetched data to skip the API call
 */
export async function openManualAlbumAudit(
  threshold = null,
  prefetchedData = null
) {
  if (isLoading) return;

  isLoading = true;

  try {
    // Get threshold from parameter or DOM element
    let thresholdValue = threshold;
    if (thresholdValue === null) {
      const thresholdSelect = document.getElementById('manualAlbumThreshold');
      thresholdValue = thresholdSelect
        ? parseFloat(thresholdSelect.value)
        : 0.15;
    }

    // Create modal if doesn't exist
    if (!modalElement) {
      createModalDOM();
    }

    // Show loading state only if we need to fetch
    showModal();
    if (!prefetchedData) {
      setLoadingState(true);
    }

    // Use pre-fetched data or fetch from API
    if (prefetchedData) {
      currentData = prefetchedData;
    } else {
      // Fetch manual albums with threshold
      const response = await fetch(
        `/api/admin/audit/manual-albums?threshold=${thresholdValue}`,
        {
          credentials: 'same-origin',
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch manual albums');
      }

      currentData = await response.json();
    }
    currentIndex = 0;

    setLoadingState(false);

    // Show integrity issues first if they exist, otherwise show matches
    if (currentData.integrityIssues && currentData.integrityIssues.length > 0) {
      showIntegrityIssues();
    } else if (currentData.totalWithMatches === 0) {
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

function createModalDOM() {
  modalElement = document.createElement('div');
  modalElement.id = 'manualAlbumAuditModal';
  modalElement.className =
    'hidden fixed inset-0 bg-black bg-opacity-70 z-[10001] flex items-center justify-center p-4 safe-area-modal';
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

  document.body.appendChild(modalElement);
}

function setupModalController() {
  const closeBtn = modalElement.querySelector('#auditCloseBtn');

  modalController = createModal({
    element: modalElement,
    backdrop: modalElement, // Click on the overlay itself closes (the outer div IS the backdrop)
    closeButton: closeBtn,
    closeOnEscape: true,
    closeOnBackdrop: true,
    onClose: () => {
      currentData = null;
      currentIndex = 0;
      modalController = null;
    },
  });

  // Button handlers - tracked for automatic cleanup
  modalController.addListener(
    modalElement.querySelector('#auditMergeBtn'),
    'click',
    handleMerge
  );
  modalController.addListener(
    modalElement.querySelector('#auditDistinctBtn'),
    'click',
    handleMarkDistinct
  );
  modalController.addListener(
    modalElement.querySelector('#auditSkipBtn'),
    'click',
    handleSkip
  );
}

function showModal() {
  if (!modalElement) return;
  if (!modalController) {
    setupModalController();
  }
  modalController.open();
}

function closeModal() {
  if (modalController) {
    modalController.close();
    modalController = null;
  } else if (modalElement) {
    modalElement.classList.add('hidden');
    document.body.style.overflow = '';
    currentData = null;
    currentIndex = 0;
  }
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

function showIntegrityIssues() {
  const emptyEl = modalElement.querySelector('#auditEmpty');
  const comparisonEl = modalElement.querySelector('#auditComparison');
  const footerEl = modalElement.querySelector('#auditFooter');
  const progressEl = modalElement.querySelector('#auditProgress');

  emptyEl.classList.add('hidden');
  comparisonEl.classList.remove('hidden');
  footerEl.classList.remove('hidden');

  const issues = currentData.integrityIssues || [];
  progressEl.textContent = `${issues.length} data integrity issue${issues.length !== 1 ? 's' : ''} found`;

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'high':
        return 'text-red-500 border-red-800/50 bg-red-900/20';
      case 'medium':
        return 'text-yellow-500 border-yellow-800/50 bg-yellow-900/20';
      case 'low':
        return 'text-blue-500 border-blue-800/50 bg-blue-900/20';
      default:
        return 'text-gray-500 border-gray-800/50 bg-gray-900/20';
    }
  };

  const renderIssue = (issue, index) => {
    const usageInfo =
      issue.usedIn
        ?.map((u) => `${u.username}'s ${u.listName} (${u.year})`)
        .join(', ') || 'Not used in any lists';

    let actionButtons = '';
    if (issue.fixAction === 'delete_references') {
      actionButtons = `
        <button 
          class="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm rounded transition-colors"
          onclick="window.deleteOrphanedReferences('${escapeHtml(issue.manualId)}', ${index})"
        >
          <i class="fas fa-trash-alt mr-1"></i> Delete References
        </button>
      `;
    } else if (issue.fixAction === 'manual_review') {
      actionButtons = `
        <span class="text-sm text-gray-400">
          <i class="fas fa-exclamation-triangle mr-1"></i> Requires manual review
        </span>
      `;
    } else if (issue.fixAction === 'merge_manual_albums') {
      actionButtons = `
        <span class="text-sm text-gray-400">
          <i class="fas fa-info-circle mr-1"></i> Consider merging duplicates manually
        </span>
      `;
    }

    if (issue.type === 'duplicate_manual') {
      return `
        <div class="p-4 border rounded-lg ${getSeverityColor(issue.severity)}" data-issue-index="${index}">
          <div class="flex items-start justify-between mb-2">
            <div>
              <span class="text-xs uppercase tracking-wide font-semibold">${issue.severity} severity</span>
              <h4 class="font-semibold mt-1">${escapeHtml(issue.description)}</h4>
            </div>
          </div>
          <div class="space-y-2 mt-3">
            ${issue.duplicates
              .map(
                (dup) => `
              <div class="bg-gray-800/50 p-3 rounded">
                <div class="text-white font-medium">${escapeHtml(dup.artist)} - ${escapeHtml(dup.album)}</div>
                <div class="text-xs text-gray-400 mt-1">ID: ${dup.manualId}</div>
                <div class="text-xs text-gray-500 mt-1">Used in: ${dup.usedIn.map((u) => `${u.username}'s ${u.listName}`).join(', ')}</div>
              </div>
            `
              )
              .join('')}
          </div>
          <div class="mt-3">
            ${actionButtons}
          </div>
        </div>
      `;
    }

    return `
      <div class="p-4 border rounded-lg ${getSeverityColor(issue.severity)}" data-issue-index="${index}">
        <div class="flex items-start justify-between mb-2">
          <div>
            <span class="text-xs uppercase tracking-wide font-semibold">${issue.severity} severity</span>
            <h4 class="font-semibold mt-1">${escapeHtml(issue.description)}</h4>
          </div>
        </div>
        <div class="mt-3 space-y-1">
          <div class="text-sm"><strong>Album ID:</strong> ${issue.manualId}</div>
          ${issue.artist ? `<div class="text-sm"><strong>Artist:</strong> ${escapeHtml(issue.artist)}</div>` : ''}
          ${issue.album ? `<div class="text-sm"><strong>Album:</strong> ${escapeHtml(issue.album)}</div>` : ''}
          <div class="text-sm"><strong>Used in:</strong> ${usageInfo}</div>
        </div>
        <div class="mt-3">
          ${actionButtons}
        </div>
      </div>
    `;
  };

  comparisonEl.innerHTML = `
    <div class="space-y-3">
      <div class="bg-gray-800/50 p-4 rounded-lg border border-yellow-600/30">
        <h3 class="text-lg font-semibold text-yellow-400 mb-2">
          <i class="fas fa-exclamation-triangle mr-2"></i>Data Integrity Issues
        </h3>
        <p class="text-sm text-gray-300">
          The following manual albums have data integrity problems that should be fixed before continuing with reconciliation.
        </p>
      </div>
      
      ${issues.map((issue, index) => renderIssue(issue, index)).join('')}
      
      ${
        currentData.totalWithMatches > 0
          ? `
        <div class="mt-4 p-3 bg-blue-900/20 border border-blue-800/30 rounded text-sm text-blue-300">
          <i class="fas fa-info-circle mr-1"></i>
          After fixing these issues, ${currentData.totalWithMatches} manual album${currentData.totalWithMatches !== 1 ? 's' : ''} will be ready for reconciliation review.
        </div>
      `
          : ''
      }
    </div>
  `;

  footerEl.classList.remove('hidden');
  footerEl.innerHTML = `
    <button id="auditCloseIntegrityBtn" class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors">
      Close
    </button>
    ${
      currentData.totalWithMatches > 0
        ? `
      <button id="auditProceedBtn" class="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded transition-colors">
        Proceed to Reconciliation
      </button>
    `
        : ''
    }
  `;

  if (modalController) {
    modalController.addListener(
      modalElement.querySelector('#auditCloseIntegrityBtn'),
      'click',
      closeModal
    );

    if (currentData.totalWithMatches > 0) {
      modalController.addListener(
        modalElement.querySelector('#auditProceedBtn'),
        'click',
        () => {
          currentData.integrityIssues = []; // Clear issues to proceed
          showCurrentItem();
        }
      );
    }
  } else {
    modalElement
      .querySelector('#auditCloseIntegrityBtn')
      .addEventListener('click', closeModal);

    if (currentData.totalWithMatches > 0) {
      modalElement
        .querySelector('#auditProceedBtn')
        .addEventListener('click', () => {
          currentData.integrityIssues = []; // Clear issues to proceed
          showCurrentItem();
        });
    }
  }
}

// Global function for deleting orphaned references
window.deleteOrphanedReferences = async function (albumId, issueIndex) {
  if (
    !confirm(
      'Delete all references to this orphaned album from user lists? This cannot be undone.'
    )
  ) {
    return;
  }

  try {
    const response = await fetch(
      '/api/admin/audit/delete-orphaned-references',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ albumId }),
      }
    );

    if (!response.ok) {
      throw new Error('Failed to delete orphaned references');
    }

    const result = await response.json();
    showToast(
      `Deleted ${result.deletedListItems} orphaned reference${result.deletedListItems !== 1 ? 's' : ''}`,
      'success'
    );

    // Remove this issue from the list
    currentData.integrityIssues.splice(issueIndex, 1);
    currentData.totalIntegrityIssues--;

    // Refresh the display
    if (currentData.integrityIssues.length > 0) {
      showIntegrityIssues();
    } else if (currentData.totalWithMatches > 0) {
      showCurrentItem();
    } else {
      showEmptyState();
    }
  } catch (err) {
    console.error('Error deleting orphaned references:', err);
    showToast('Failed to delete orphaned references', 'error');
  }
};

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

  const placeholderSvg = getPlaceholderSvg(120);

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
